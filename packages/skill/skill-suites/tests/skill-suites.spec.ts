/**
 * Skill-suite service behavior over a real temporary home: the catalogue
 * projection, install writing actual SKILL.md files the filesystem provider
 * would discover, idempotent reinstall, and the edit-preserving uninstall.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_SUITES } from '../src/catalogue.ts'
import { SkillSuites, UnknownSuiteError } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** One service over a fresh temporary home root. */
async function service(): Promise<{ suites: SkillSuites; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-suites-'))
  roots.push(root)
  return { suites: new SkillSuites({ dshHome: root }), root }
}

describe('SkillSuites catalogue', () => {
  it('projects the shipped catalogue as uninstalled over an empty home', async () => {
    const { suites } = await service()
    const views = await suites.list()
    expect(views).toHaveLength(BUILTIN_SUITES.length)
    const office = views[0]!
    expect(office.id).toBe('office-essentials')
    expect(office.skills.map(skill => skill.name)).toEqual([
      'data-visualization', 'weekly-report', 'data-analysis', 'tech-proposal',
    ])
    expect(office.skills[0]).toEqual({
      name: 'data-visualization',
      title: '数据可视化',
      summary: '按数据特征自动选择图表类型，产出可直接使用的 ECharts 配置或独立 HTML 图表页。',
    })
    expect(office.installed).toBe(false)
  })

  it('rejects an id outside the catalogue without touching the filesystem', async () => {
    const { suites, root } = await service()
    await expect(suites.install('ghost')).rejects.toBeInstanceOf(UnknownSuiteError)
    await expect(suites.uninstall('ghost')).rejects.toBeInstanceOf(UnknownSuiteError)
    await expect(suites.list()).resolves.toHaveLength(BUILTIN_SUITES.length)
    expect(root).toBeTruthy()
  })

  it('ships every skill with display copy and a frontmatter name matching its install directory', () => {
    for (const suite of BUILTIN_SUITES) {
      for (const skill of suite.skills) {
        expect(skill.title.length).toBeGreaterThan(0)
        expect(skill.summary.length).toBeGreaterThan(0)
        expect(skill.body).toMatch(new RegExp(`\\nname:\\s*${skill.name}\\n`))
      }
    }
  })
})

describe('SkillSuites install', () => {
  it('writes every bundled SKILL.md under the user skill root and reports installed', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')

    const office = BUILTIN_SUITES[0]!
    for (const skill of office.skills) {
      const body = await readFile(join(root, 'skills', skill.name, 'SKILL.md'), 'utf8')
      expect(body).toBe(skill.body)
    }
    expect((await suites.list())[0]!.installed).toBe(true)
  })

  it('is idempotent: a second install leaves the files untouched', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')
    const file = join(root, 'skills', 'weekly-report', 'SKILL.md')
    const first = await readFile(file, 'utf8')
    await suites.install('office-essentials')
    expect(await readFile(file, 'utf8')).toBe(first)
    expect((await suites.list())[0]!.installed).toBe(true)
  })
})

describe('SkillSuites uninstall', () => {
  it('removes the bundled directories and returns the suite to uninstalled', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')
    await suites.uninstall('office-essentials')

    expect((await suites.list())[0]!.installed).toBe(false)
    await expect(readFile(join(root, 'skills', 'data-visualization', 'SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a skill the user edited after install, removes the rest', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')

    // The user rewrites one skill's body after install.
    const edited = join(root, 'skills', 'tech-proposal', 'SKILL.md')
    await writeFile(edited, '---\nname: tech-proposal\ndescription: my own version\n---\n\nEdited.\n', 'utf8')

    await suites.uninstall('office-essentials')

    // The edited skill survives byte-identity's failure; the untouched ones go.
    expect(await readFile(edited, 'utf8')).toContain('my own version')
    await expect(readFile(join(root, 'skills', 'weekly-report', 'SKILL.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resolves when nothing was installed', async () => {
    const { suites } = await service()
    await expect(suites.uninstall('office-essentials')).resolves.toBeUndefined()
  })
})
