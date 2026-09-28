#!/usr/bin/env node
/**
 * Fetch the document-conversion toolkit that ships inside the installer.
 *
 * The office suite's 格式转换 and 公文格式 skills are not pure JavaScript: `convert_document` and
 * `write_official_document` reach LibreOffice, pandoc, and poppler through the Harness conversion
 * seam, and each provider resolves a bare command name against PATH once, at plugin apply. On an
 * air-gapped LAN machine none of those binaries exist, so every office route reports itself
 * unreachable. This script materialises them under `build/tools/`, which `package.json`'s
 * `extraResources` copies to `resources/tools/` and `src/main/runtime/harness-runtime.ts` prepends
 * to the Harness process PATH.
 *
 * Run it on a build machine that HAS network. The result is the offline half of the deal.
 *
 *   node scripts/fetch-convert-tools.mjs                      # download, verify, lay out
 *   node scripts/fetch-convert-tools.mjs --trust-on-first-use # accept and print unpinned checksums
 *   node scripts/fetch-convert-tools.mjs --verify             # no network: check what is on disk
 *   node scripts/fetch-convert-tools.mjs … --allow-missing-fonts # build a package without the 公文 typefaces
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const DESKTOP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOOLS_ROOT = path.join(DESKTOP_ROOT, 'build', 'tools')
const FONTS_ROOT = path.join(DESKTOP_ROOT, 'build', 'fonts')
const CACHE_ROOT = path.join(DESKTOP_ROOT, 'build', '.tools-cache')
const MANIFEST_PATH = path.join(TOOLS_ROOT, 'MANIFEST.json')

/**
 * The pinned upstream releases, one entry per converter.
 *
 * `sha256` is `null` until someone has actually downloaded the archive once: a checksum nobody
 * verified is worse than an absent one, because it looks like a guarantee. Run the script with
 * `--trust-on-first-use`, paste the printed digests in here, and every later build is pinned.
 *
 * Bump `version` when upstream moves. A stale version 404s, which is the intended failure: the
 * index pages are linked in each entry's `releases` field.
 */
const WINDOWS_TOOLS = [
  {
    id: 'libreoffice',
    version: '25.2.5',
    releases: 'https://download.documentfoundation.org/libreoffice/stable/',
    url: (version) =>
      `https://download.documentfoundation.org/libreoffice/stable/${version}/win/x86_64/LibreOffice_${version}_Win_x86-64.msi`,
    archive: 'msi',
    sha256: null,
    // The whole install tree moves, not just the executables: `soffice` loads its filters, its
    // configuration registry, and its fonts from `share/` beside `program/`.
    locate: 'program/soffice.exe',
    executables: ['program/soffice.com', 'program/soffice.exe']
  },
  {
    id: 'pandoc',
    version: '3.6.3',
    releases: 'https://github.com/jgm/pandoc/releases',
    url: (version) =>
      `https://github.com/jgm/pandoc/releases/download/${version}/pandoc-${version}-windows-x86_64.zip`,
    archive: 'zip',
    sha256: null,
    locate: 'pandoc.exe',
    executables: ['pandoc.exe']
  },
  {
    id: 'poppler',
    version: '24.08.0',
    releases: 'https://github.com/oschwartz10612/poppler-windows/releases',
    url: (version) =>
      `https://github.com/oschwartz10612/poppler-windows/releases/download/v${version}-0/Release-${version}-0.zip`,
    archive: 'zip',
    sha256: null,
    locate: 'pdftotext.exe',
    executables: ['pdftotext.exe', 'pdftohtml.exe', 'pdffonts.exe']
  }
]

/**
 * Where LibreOffice reads fonts from inside its own install tree.
 *
 * Dropping the GB/T 9704—2012 typefaces here rather than installing them system-wide keeps the
 * deployment free of admin rights, the system font directory, and the registry — and uninstalling
 * the app takes them with it.
 */
const BUNDLED_FONT_DESTINATION = ['libreoffice', 'share', 'fonts', 'truetype']

/** Typefaces GB/T 9704—2012 names that Windows does NOT ship, so the toolkit has to carry them. */
export const EXPECTED_FONT_FILES = ['FZXBSJW.TTF', '仿宋_GB2312.ttf', '楷体_GB2312.ttf']

/**
 * Which required typefaces a bundled set is missing, matched case-insensitively.
 *
 * Windows file names are case-insensitive and the three files arrive from different sources, so a
 * `fzxbsjw.ttf` on disk satisfies `FZXBSJW.TTF`.
 * @param bundled - font file names present in the toolkit.
 * @returns the missing entries of {@link EXPECTED_FONT_FILES}, in table order.
 */
export function missingFontFiles(bundled) {
  return EXPECTED_FONT_FILES.filter(
    (expected) => !bundled.some((font) => font.toLowerCase() === expected.toLowerCase())
  )
}

/**
 * Refuse a toolkit whose 公文 typefaces are incomplete.
 *
 * Without them LibreOffice substitutes whatever it finds, so the PDF renders in the wrong faces —
 * and nothing anywhere reports it, because every step succeeded. The official-document skill exists
 * to produce GB/T 9704—2012 pages, so a package built without the faces those pages are specified in
 * is a defect the build machine can still catch. `--allow-missing-fonts` states the intent out loud
 * for a build that genuinely does not need them.
 */
function assertFonts(fonts, allowMissingFonts) {
  const missing = missingFontFiles(fonts)
  if (missing.length === 0) return
  if (allowMissingFonts) {
    console.warn(`  ! not supplied: ${missing.join(', ')} — PDF output substitutes those typefaces`)
    return
  }
  fail(
    `the 公文 typefaces are incomplete: ${missing.join(', ')}\n` +
      `  Put the .ttf files in ${path.relative(DESKTOP_ROOT, FONTS_ROOT)} and re-run, or pass ` +
      '--allow-missing-fonts to build a package whose 公文 PDF renders in substituted faces.'
  )
}

function fail(message) {
  console.error(`fetch-convert-tools: ${message}`)
  process.exit(1)
}

/** Recursively find one file by name under `root`, returning its absolute path. */
async function findFile(root, name) {
  const wanted = name.toLowerCase()
  const stack = [root]
  while (stack.length > 0) {
    const directory = stack.pop()
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.toLowerCase() === wanted) return full
    }
  }
  return undefined
}

/** Hash a file without holding it in memory; the LibreOffice MSI alone is some 350 MB. */
async function sha256File(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

/**
 * Download to the cache unless it is already there, and check the digest.
 * @returns the cached file path and its sha256.
 */
async function download(tool, trustOnFirstUse) {
  const url = tool.url(tool.version)
  const cached = path.join(CACHE_ROOT, path.basename(new URL(url).pathname))

  if (!existsSync(cached)) {
    console.log(`  downloading ${url}`)
    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok) {
      fail(
        `${tool.id} ${tool.version} returned HTTP ${response.status}. ` +
          `Check the pinned version against ${tool.releases} and update WINDOWS_TOOLS.`
      )
    }
    // Written under a temporary name so an interrupted download cannot be mistaken for a cache hit.
    const partial = `${cached}.partial`
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
    await rename(partial, cached)
  } else {
    console.log(`  using cached ${path.basename(cached)}`)
  }

  const sha256 = await sha256File(cached)
  if (tool.sha256 === null) {
    if (!trustOnFirstUse) {
      fail(
        `${tool.id} has no pinned checksum. Its sha256 is ${sha256} — paste that into ` +
          `WINDOWS_TOOLS, or re-run with --trust-on-first-use to accept it for this build.`
      )
    }
    console.log(`  ! unpinned: sha256 ${sha256} — paste it into WINDOWS_TOOLS`)
  } else if (tool.sha256 !== sha256) {
    fail(`${tool.id} checksum mismatch: expected ${tool.sha256}, got ${sha256}`)
  }
  return { cached, sha256 }
}

/** Unpack an archive into a fresh directory and return it. */
async function unpack(tool, archivePath) {
  const target = await mkdtemp(path.join(tmpdir(), `dsh-${tool.id}-`))
  if (tool.archive === 'msi') {
    // An administrative install lays out the product's file tree without installing it: no service,
    // no registry, no elevation. msiexec parses its own command line, so the arguments are passed
    // verbatim with the quoting it documents rather than Node's.
    const result = spawnSync(
      'msiexec',
      [`/a "${archivePath}" /qn TARGETDIR="${target}"`],
      { windowsVerbatimArguments: true, stdio: 'inherit' }
    )
    if (result.status !== 0) {
      fail(`msiexec administrative install failed for ${tool.id} (exit ${result.status})`)
    }
  } else {
    // bsdtar reads zip archives and ships with Windows 10 1803+, macOS, and every Linux distro
    // that has tar — one extractor for every platform this table will grow to.
    const result = spawnSync('tar', ['-xf', archivePath, '-C', target], { stdio: 'inherit' })
    if (result.status !== 0) fail(`tar failed to unpack ${tool.id} (exit ${result.status})`)
  }
  return target
}

/**
 * Copy the directory that actually holds the tool into `build/tools/<id>`.
 *
 * The containing directory travels whole, never just the named executable: poppler's utilities need
 * the DLLs beside them, and LibreOffice needs `share/` beside `program/`.
 */
async function install(tool, unpacked) {
  const marker = await findFile(unpacked, path.basename(tool.locate))
  if (marker === undefined) {
    fail(`${tool.id}: ${tool.locate} is not in the archive — upstream changed its layout`)
  }
  // Walk back up by as many segments as `locate` has, so `program/soffice.exe` yields the install
  // root while a bare `pandoc.exe` yields the directory holding it.
  const depth = tool.locate.split('/').length
  const source = path.resolve(marker, ...Array.from({ length: depth }, () => '..'))
  const destination = path.join(TOOLS_ROOT, tool.id)
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, {
    recursive: true,
    filter: (entry) => path.extname(entry).toLowerCase() !== '.msi'
  })
  return destination
}

/**
 * Copy the GB/T 9704—2012 typefaces into the bundled LibreOffice so it can render 公文 to PDF.
 * @returns the font file names copied; the caller decides whether the set is complete enough to ship.
 */
async function installFonts() {
  const destination = path.join(TOOLS_ROOT, ...BUNDLED_FONT_DESTINATION)
  if (!existsSync(path.join(TOOLS_ROOT, 'libreoffice'))) return []
  if (!existsSync(FONTS_ROOT)) {
    console.warn(`  ! ${path.relative(DESKTOP_ROOT, FONTS_ROOT)} is missing`)
    return []
  }
  await mkdir(destination, { recursive: true })
  const fonts = (await readdir(FONTS_ROOT)).filter((name) =>
    ['.ttf', '.ttc', '.otf'].includes(path.extname(name).toLowerCase())
  )
  for (const font of fonts) {
    await cp(path.join(FONTS_ROOT, font), path.join(destination, font))
  }
  console.log(`  ${fonts.length} font file(s) → ${path.relative(DESKTOP_ROOT, destination)}`)
  return fonts
}

/** Assert every executable the runtime will look for is present, and report what is missing. */
function assertExecutables(manifest) {
  const missing = []
  for (const tool of manifest.tools) {
    for (const executable of tool.executables) {
      const full = path.join(TOOLS_ROOT, tool.id, ...executable.split('/'))
      if (!existsSync(full)) missing.push(path.relative(DESKTOP_ROOT, full))
    }
  }
  if (missing.length > 0) {
    fail(
      `the toolkit is incomplete:\n  ${missing.join('\n  ')}\n` +
        'Re-run without --verify to fetch it. Shipping an installer without these produces a ' +
        'client whose format conversion silently reports every route unreachable.'
    )
  }
}

async function verify(allowMissingFonts) {
  if (!existsSync(MANIFEST_PATH)) {
    fail(
      `${path.relative(DESKTOP_ROOT, MANIFEST_PATH)} is missing. ` +
        'Run `npm run tools:fetch` on a machine with network before packaging.'
    )
  }
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  assertExecutables(manifest)
  assertFonts(manifest.fonts ?? [], allowMissingFonts)
  console.log(
    `fetch-convert-tools: toolkit verified (${manifest.tools
      .map((tool) => `${tool.id} ${tool.version}`)
      .join(', ')})`
  )
}

async function fetchAll(trustOnFirstUse, allowMissingFonts) {
  if (process.platform !== 'win32') {
    fail(
      `the bundled toolkit is currently Windows-only, and this is ${process.platform}. ` +
        'Package on the Windows build machine, or add a table for this platform.'
    )
  }
  await mkdir(CACHE_ROOT, { recursive: true })
  await mkdir(TOOLS_ROOT, { recursive: true })

  const tools = []
  for (const tool of WINDOWS_TOOLS) {
    console.log(`${tool.id} ${tool.version}`)
    const { cached, sha256 } = await download(tool, trustOnFirstUse)
    const unpacked = await unpack(tool, cached)
    try {
      const destination = await install(tool, unpacked)
      console.log(`  → ${path.relative(DESKTOP_ROOT, destination)}`)
    } finally {
      await rm(unpacked, { recursive: true, force: true })
    }
    tools.push({
      id: tool.id,
      version: tool.version,
      url: tool.url(tool.version),
      sha256,
      executables: tool.executables
    })
  }

  console.log('fonts')
  const fonts = await installFonts()

  const manifest = { platform: 'win32', arch: 'x64', fetchedAt: new Date().toISOString(), tools, fonts }
  assertExecutables(manifest)
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`fetch-convert-tools: wrote ${path.relative(DESKTOP_ROOT, MANIFEST_PATH)}`)
  // Last, so the downloads and the manifest survive: supplying the fonts and re-running is then a
  // cache hit rather than a second 350 MB download.
  assertFonts(fonts, allowMissingFonts)
}

// Importable for tests: only a direct `node scripts/fetch-convert-tools.mjs` runs the script.
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2))
  const allowMissingFonts = args.has('--allow-missing-fonts')
  if (args.has('--verify')) await verify(allowMissingFonts)
  else await fetchAll(args.has('--trust-on-first-use'), allowMissingFonts)
}
