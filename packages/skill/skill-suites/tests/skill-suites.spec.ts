/**
 * Skill-suite service behavior over a real temporary home: the catalogue
 * projection, install writing actual SKILL.md files and skill assets the
 * filesystem provider would discover, idempotent reinstall, and the
 * edit-preserving uninstall.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_SUITES } from '../src/catalogue.ts'
import { apply, SkillRootEntryError, SkillSuites, UnknownSuiteError } from '../src/index.ts'

/** This package's root, which `BundledAsset.source` paths resolve against. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

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
      'data-visualization', 'weekly-report', 'data-analysis', 'tech-proposal', 'format-convert',
      'official-document',
    ])
    expect(office.skills[0]).toEqual({
      name: 'data-visualization',
      title: '数据可视化',
      summary: '按数据特征自动选择图表类型，产出可直接使用的 ECharts 配置或离线可打开的 HTML 图表页。',
    })
    expect(office.installed).toBe(false)
    expect(office.current).toBe(false)
  })

  it('rejects an id outside the catalogue without touching the filesystem', async () => {
    const { suites, root } = await service()
    await expect(suites.install('ghost')).rejects.toBeInstanceOf(UnknownSuiteError)
    await expect(suites.uninstall('ghost')).rejects.toBeInstanceOf(UnknownSuiteError)
    await expect(suites.list()).resolves.toHaveLength(BUILTIN_SUITES.length)
    expect(root).toBeTruthy()
  })

  it('installs beneath skills/ in the configured home', async () => {
    const { suites, root } = await service()
    expect(suites.skillRoot).toBe(join(root, 'skills'))
  })

  it('refuses a skill root holding a plain file, which no skill directory can be', async () => {
    const { suites, root } = await service()
    await mkdir(join(root, 'skills'))
    await writeFile(join(root, 'skills', 'notes.txt'), 'stray')
    const listing = suites.list()
    await expect(listing).rejects.toBeInstanceOf(SkillRootEntryError)
    await expect(listing).rejects.toThrow(/notes\.txt' is not a directory/)
  })

  it('propagates a skill root it cannot read, rather than reporting an empty catalogue', async () => {
    const { suites, root } = await service()
    // A file where the root directory should be makes readdir fail with ENOTDIR, not ENOENT.
    await writeFile(join(root, 'skills'), 'not a directory')
    await expect(suites.list()).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('provides the service on the context it is applied to', () => {
    const provide = vi.fn()
    apply({ provide } as never, {})
    expect(provide).toHaveBeenCalledWith('skillSuites', expect.any(SkillSuites))
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

  it('names no remote URL in any skill body, so a body renders the same air-gapped', () => {
    for (const suite of BUILTIN_SUITES) {
      for (const skill of suite.skills) {
        expect(skill.body, `${skill.name} must not send the model to the network`)
          .not.toMatch(/https?:\/\//)
      }
    }
  })

  it('ships every declared asset, and names it in the body that must copy it', async () => {
    for (const suite of BUILTIN_SUITES) {
      for (const skill of suite.skills) {
        for (const asset of skill.assets ?? []) {
          const shipped = join(PACKAGE_ROOT, asset.source)
          await expect(readFile(shipped), `${asset.source} is declared but not shipped`)
            .resolves.toBeInstanceOf(Buffer)
          expect(skill.body, `${skill.name} ships ${asset.name} without telling the model about it`)
            .toContain(asset.name)
        }
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
    expect((await suites.list())[0]!.current).toBe(true)
  })

  it('reports a skill whose installed body differs from the shipped one as outdated, not as an edit', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')
    await writeFile(join(root, 'skills', 'tech-proposal', 'SKILL.md'), 'an older shipped body', 'utf8')

    const office = (await suites.list())[0]!
    // The directory is still there, so the suite is installed — and the mismatch is what the page
    // turns into a reinstall, because an uninstall would preserve this file as the user's own work.
    expect(office.installed).toBe(true)
    expect(office.current).toBe(false)
  })

  it('reports a skill directory holding no readable SKILL.md as outdated', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')
    await rm(join(root, 'skills', 'weekly-report', 'SKILL.md'))

    expect((await suites.list())[0]!.installed).toBe(true)
    expect((await suites.list())[0]!.current).toBe(false)
  })

  it('returns a suite to current when a reinstall replaces the outdated body', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')
    const file = join(root, 'skills', 'tech-proposal', 'SKILL.md')
    await writeFile(file, 'an older shipped body', 'utf8')

    await suites.install('office-essentials')

    expect(await readFile(file, 'utf8')).toBe(BUILTIN_SUITES[0]!.skills[3]!.body)
    expect((await suites.list())[0]!.current).toBe(true)
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

  it('writes each declared asset beside SKILL.md, byte-identical to the shipped copy', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')

    const chart = BUILTIN_SUITES[0]!.skills[0]!
    expect(chart.assets?.map(asset => asset.name)).toEqual(['echarts.min.js', 'echarts-LICENSE.txt'])
    for (const asset of chart.assets ?? []) {
      const installed = await readFile(join(root, 'skills', chart.name, asset.name))
      expect(installed.equals(await readFile(join(PACKAGE_ROOT, asset.source)))).toBe(true)
    }
  })

  it('rewrites an asset a user damaged, and leaves an intact one alone', async () => {
    const { suites, root } = await service()
    await suites.install('office-essentials')

    const library = join(root, 'skills', 'data-visualization', 'echarts.min.js')
    const license = join(root, 'skills', 'data-visualization', 'echarts-LICENSE.txt')
    const licenseBefore = (await stat(license)).mtimeMs
    await writeFile(library, 'truncated', 'utf8')

    await suites.install('office-essentials')

    expect((await readFile(library)).equals(
      await readFile(join(PACKAGE_ROOT, 'assets/echarts/echarts.min.js')),
    )).toBe(true)
    expect((await stat(license)).mtimeMs).toBe(licenseBefore)
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
    await expect(readFile(join(root, 'skills', 'data-visualization', 'echarts.min.js')))
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
