import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import { createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, posix, win32 } from 'node:path'
import type { RuntimePhase, RuntimeSnapshot } from '../../shared/contracts'

export interface HarnessRuntimeOptions {
  dshEntryPath: string
  nodeExecutablePath: string
  nodeEntryPath: string
  dshPatchPath: string
  dshHome: string
  logPath: string
  /**
   * Root of the bundled document-conversion toolkit, laid out as
   * {@link BUNDLED_CONVERT_TOOLS} expects. Undefined, or absent on disk, leaves the Harness with
   * whatever converters the machine itself has.
   */
  toolsDirectory?: string
  /**
   * The GB/T 9704—2012 typefaces as the desktop keeps them outside the toolkit — `build/fonts` in a
   * development run; a packaged build does not ship this directory. Used only when
   * {@link toolsDirectory} carries none.
   */
  fontsDirectory?: string
  launchProcess(
    executablePath: string,
    args: string[],
    options: SpawnOptionsWithoutStdio
  ): ChildProcessWithoutNullStreams
  startupTimeoutMs?: number
  onChanged(snapshot: RuntimeSnapshot): void
}

export function buildHarnessArguments(port: number, patchPath?: string): string[] {
  return [
    'web',
    ...(patchPath ? ['--patch', patchPath] : []),
    '--host',
    '127.0.0.1',
    '--port',
    String(port)
  ]
}

/**
 * Directory holding a LibreOffice `soffice` executable, or undefined when none of the known
 * installation locations has one.
 *
 * The Harness `document-convert-libreoffice` provider resolves the bare name `soffice` against PATH
 * and caches the answer once, at plugin apply. Neither the Windows installer nor the macOS
 * application bundle puts that binary on PATH, so on those platforms a user who HAS installed
 * LibreOffice still gets a registered-but-unusable converter — and every `write_official_document`
 * call taking the default `.docx` route fails with OFFICIAL_DOC_FORMAT_UNREACHABLE. Linux
 * distributions install to a PATH directory already, so nothing is probed there.
 */
export function libreOfficeDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): string | undefined {
  // The platform's own path flavour, not the host's: a Windows path joined with POSIX separators
  // would never match a real install, and it makes the branch untestable from Linux or macOS.
  const path = platform === 'win32' ? win32 : posix

  // Built from the environment rather than hardcoding C:\, so an install on another drive is found.
  const candidates =
    platform === 'win32'
      ? [environment['ProgramFiles'], environment['ProgramFiles(x86)']]
          .filter((root): root is string => Boolean(root))
          .map((root) => ({
            directory: path.join(root, 'LibreOffice', 'program'),
            binary: 'soffice.exe'
          }))
      : platform === 'darwin'
        ? [{ directory: '/Applications/LibreOffice.app/Contents/MacOS', binary: 'soffice' }]
        : []

  return candidates.find((candidate) =>
    existsSync(path.join(candidate.directory, candidate.binary))
  )?.directory
}

/**
 * Where each bundled converter keeps its executables, relative to the toolkit root, in the order
 * they are prepended to PATH. `scripts/fetch-convert-tools.mjs` writes this layout.
 */
export const BUNDLED_CONVERT_TOOLS = [
  { id: 'libreoffice', segments: ['libreoffice', 'program'] },
  { id: 'pandoc', segments: ['pandoc'] },
  { id: 'poppler', segments: ['poppler'] }
] as const

/**
 * The directories to prepend to the Harness process PATH so `document-convert-libreoffice`,
 * `-pandoc`, and `-poppler` resolve their binaries.
 *
 * The bundled toolkit comes first and each entry is admitted only if it exists, so a partially
 * fetched toolkit still contributes the converters it does have. The system LibreOffice probe runs
 * only when the toolkit has no LibreOffice of its own — in development, where nothing was fetched,
 * and on a machine whose user installed it themselves.
 *
 * @param toolsRoot - root of the bundled toolkit, or undefined when this build ships none.
 * @param platform - the platform to resolve for; defaults to the host's.
 * @param environment - the environment the install roots are read from; defaults to this process's.
 * @returns absolute directories, in PATH order, each one verified to exist.
 */
export function convertToolDirectories(
  toolsRoot: string | undefined,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): string[] {
  const path = platform === 'win32' ? win32 : posix
  const directories: string[] = []
  let bundledLibreOffice = false

  if (toolsRoot !== undefined) {
    for (const tool of BUNDLED_CONVERT_TOOLS) {
      const directory = path.join(toolsRoot, ...tool.segments)
      if (!existsSync(directory)) continue
      directories.push(directory)
      if (tool.id === 'libreoffice') bundledLibreOffice = true
    }
  }

  if (!bundledLibreOffice) {
    const installed = libreOfficeDirectory(platform, environment)
    if (installed !== undefined) directories.push(installed)
  }

  return directories
}

/**
 * Where the bundled GB/T 9704—2012 typefaces sit, relative to the toolkit root. Must stay identical
 * to `BUNDLED_FONT_DESTINATION` in `scripts/fetch-convert-tools.mjs`, which is what puts them there;
 * `test/convert-tools.test.ts` holds the two together.
 */
const BUNDLED_FONT_SEGMENTS = ['libreoffice', 'share', 'fonts', 'truetype'] as const

/**
 * The directory the official-document tool reads the typefaces to embed from.
 *
 * The same files serve two purposes: the bundled LibreOffice renders with them, and the tool copies
 * them into each document it writes so a recipient's Word or WPS has them too. This returns a
 * directory only when the build actually fetched them — a `package:win:no-fonts` build carries none,
 * and the tool then writes documents that name the typefaces without carrying them.
 *
 * @param toolsRoot - root of the bundled toolkit, or undefined when this build ships none.
 * @param platform - the platform to resolve for; defaults to the host's.
 * @returns the absolute font directory, or undefined when this build has no bundled typefaces.
 */
export function bundledFontDirectory(
  toolsRoot: string | undefined,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  if (toolsRoot === undefined) return undefined
  const path = platform === 'win32' ? win32 : posix
  const directory = path.join(toolsRoot, ...BUNDLED_FONT_SEGMENTS)
  return existsSync(directory) ? directory : undefined
}

/**
 * The directory the official-document tool embeds typefaces from: the bundled toolkit's copy when it
 * has one, otherwise the desktop's own font directory.
 *
 * The fallback exists because a development run, or a build packaged before the toolkit was fetched,
 * has the fonts in `build/fonts` but no toolkit to hold them. Without it the tool writes documents that
 * only name the typefaces, and every reader without them sees substituted glyphs.
 *
 * @param toolsRoot - root of the bundled toolkit, or undefined when this build ships none.
 * @param fontsDirectory - the desktop's own font directory, or undefined when it has none.
 * @param platform - the platform to resolve for; defaults to the host's.
 * @returns the absolute font directory, or undefined when neither location exists.
 */
export function officialDocumentFontDirectory(
  toolsRoot: string | undefined,
  fontsDirectory: string | undefined,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const bundled = bundledFontDirectory(toolsRoot, platform)
  if (bundled !== undefined) return bundled
  return fontsDirectory !== undefined && existsSync(fontsDirectory) ? fontsDirectory : undefined
}

export function buildHarnessSpawnOptions(
  launchDirectory: string,
  dshHome: string,
  toolsRoot?: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  fontsDirectory?: string
): SpawnOptionsWithoutStdio {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...parentEnvironment } = environment
  const pathKey = platform === 'win32' ? 'Path' : 'PATH'
  const currentPath = environment[pathKey] ?? environment.PATH ?? ''

  // Derived from the platform argument, not node:path's host-dependent `delimiter`, so the
  // Windows branch stays testable from a POSIX machine.
  const pathDelimiter = platform === 'win32' ? ';' : ':'

  // Prepend the converters so each provider's PATH lookup finds them; skip any directory already
  // on PATH, so a restart cannot keep growing the variable.
  const existing = new Set(currentPath.split(pathDelimiter))
  const additions = convertToolDirectories(toolsRoot, platform, environment).filter(
    (directory) => !existing.has(directory)
  )
  const nextPath = [...additions, currentPath].filter(Boolean).join(pathDelimiter)

  // The official-document tool embeds these into every document it writes, so a recipient who never
  // installed the typefaces still sees them. Absent, the variable is left unset rather than empty:
  // the plugin treats a configured-but-unreadable directory as a hard failure.
  const fontDirectory = officialDocumentFontDirectory(toolsRoot, fontsDirectory, platform)

  return {
    cwd: launchDirectory,
    env: {
      ...parentEnvironment,
      DSH_HOME: dshHome,
      NO_COLOR: '1',
      ...(fontDirectory === undefined ? {} : { DSH_OFFICIAL_DOCUMENT_FONTS: fontDirectory }),
      // Both casings on Windows: the Harness reads `PATH` exactly and only falls back to a
      // case-insensitive lookup when it is absent, so writing `Path` alone would be shadowed.
      [pathKey]: nextPath,
      ...(platform === 'win32' ? { PATH: nextPath } : {})
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  }
}

export function buildNodeArguments(
  nodeEntryPath: string,
  dshEntryPath: string,
  port: number,
  patchPath?: string
): string[] {
  return [
    '--expose-internals',
    nodeEntryPath,
    dshEntryPath,
    ...buildHarnessArguments(port, patchPath)
  ]
}

export function updateReadyStability(
  readySince: number | undefined,
  healthy: boolean,
  now: number,
  stabilityWindowMs = 500
): { readySince: number | undefined; ready: boolean } {
  if (!healthy) return { readySince: undefined, ready: false }
  const stableSince = readySince ?? now
  return {
    readySince: stableSince,
    ready: now - stableSince >= stabilityWindowMs
  }
}

export class HarnessRuntime {
  private child?: ChildProcessWithoutNullStreams
  private logStream?: WriteStream
  private phase: RuntimePhase = 'idle'
  private message = 'Harness is not running.'
  private launchDirectory?: string
  private url?: string
  private readonly logLines: string[] = []

  constructor(private readonly options: HarnessRuntimeOptions) {}

  snapshot(): RuntimeSnapshot {
    return {
      phase: this.phase,
      message: this.message,
      launchDirectory: this.launchDirectory,
      url: this.url,
      logs: [...this.logLines]
    }
  }

  async start(launchDirectory: string): Promise<void> {
    await this.stop()
    this.launchDirectory = launchDirectory
    this.url = undefined

    if (!existsSync(this.options.dshEntryPath)) {
      this.setState('failed', `Harness entry was not found: ${this.options.dshEntryPath}`)
      return
    }
    if (!existsSync(this.options.nodeExecutablePath)) {
      this.setState('failed', `Bundled Node.js runtime was not found: ${this.options.nodeExecutablePath}`)
      return
    }
    if (!existsSync(this.options.nodeEntryPath)) {
      this.setState('failed', `Harness diagnostic entry was not found: ${this.options.nodeEntryPath}`)
      return
    }
    if (!existsSync(this.options.dshPatchPath)) {
      this.setState('failed', `DSH Desktop patch was not found: ${this.options.dshPatchPath}`)
      return
    }

    await mkdir(this.options.dshHome, { recursive: true })
    await mkdir(dirname(this.options.logPath), { recursive: true })
    this.logStream = createWriteStream(this.options.logPath, { flags: 'a' })

    const port = await reservePort()
    const url = `http://127.0.0.1:${port}`
    const args = buildNodeArguments(
      this.options.nodeEntryPath,
      this.options.dshEntryPath,
      port,
      this.options.dshPatchPath
    )
    const startupTimeoutMs =
      this.options.startupTimeoutMs ?? (process.platform === 'win32' ? 120_000 : 45_000)

    this.writeLog(`\n[desktop] starting ${new Date().toISOString()}`)
    this.writeLog(`[desktop] launch directory ${launchDirectory}`)
    this.writeLog(`[desktop] endpoint ${url}`)
    // The offline toolkit is the difference between a working and a silently degraded converter,
    // and a provider that finds nothing only reports it as an unreachable format much later.
    const toolDirectories = convertToolDirectories(this.options.toolsDirectory)
    this.writeLog(
      toolDirectories.length > 0
        ? `[desktop] document converters on PATH: ${toolDirectories.join(', ')}`
        : '[desktop] no document converters found; format conversion will be unavailable'
    )
    const fontDirectory = officialDocumentFontDirectory(
      this.options.toolsDirectory,
      this.options.fontsDirectory
    )
    this.writeLog(
      fontDirectory !== undefined
        ? `[desktop] official-document typefaces embedded from ${fontDirectory}`
        : '[desktop] no official-document typefaces found; 公文 files will name them without carrying them'
    )
    this.setState('starting', 'Starting DeepSeek Harness…')

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.options.launchProcess(
        this.options.nodeExecutablePath,
        args,
        buildHarnessSpawnOptions(
          launchDirectory,
          this.options.dshHome,
          this.options.toolsDirectory,
          process.platform,
          process.env,
          this.options.fontsDirectory
        )
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.writeLog(`[utility] launch failed: ${message}`)
      this.setState('failed', `Harness could not start: ${message}`)
      return
    }
    this.child = child

    child.stdout.on('data', (chunk: Buffer) => this.writeChunk('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => this.writeChunk('stderr', chunk))
    child.once('spawn', () => this.writeLog('[desktop] Bundled Node.js Harness process started'))
    child.once('error', (error) => {
      this.writeLog(`[node] ${error.stack ?? error.message}`)
      if (this.child !== child) return
      this.child = undefined
      this.setState('failed', `Harness could not start: ${error.message}`)
    })
    child.once('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : formatExitCode(code ?? -1)
      this.writeLog(`[node] Harness process exited (${detail})`)
      if (this.child !== child) return
      this.child = undefined
      const cause = extractFailureCause(this.logLines)
      this.setState(
        'failed',
        cause
          ? `Harness stopped unexpectedly (${detail}).
${cause}`
          : `Harness stopped unexpectedly (${detail}).`
      )
    })

    const startedAt = Date.now()
    const progressTimer = setInterval(
      () => this.writeLog(`[desktop] waiting for Harness (${Math.round((Date.now() - startedAt) / 1000)}s)`),
      10_000
    )
    const ready = await waitUntilReady(
      url,
      () => this.child === child && child.exitCode === null,
      startupTimeoutMs
    ).finally(() => clearInterval(progressTimer))

    if (this.child !== child) return
    if (!ready) {
      await this.stopChild(child)
      this.setState(
        'failed',
        `Harness did not become ready within ${Math.round(startupTimeoutMs / 1000)} seconds.`
      )
      return
    }

    this.url = url
    this.setState('ready', 'Harness is ready.')
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      this.closeLog()
      if (this.phase !== 'failed') this.setState('idle', 'Harness is not running.')
      return
    }

    this.setState('stopping', 'Stopping Harness…')
    this.child = undefined
    await this.stopChild(child)
    this.closeLog()
    this.url = undefined
    this.setState('idle', 'Harness is not running.')
  }

  private async stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null) return
    const exitPromise = new Promise<boolean>((resolve) =>
      child.once('exit', () => resolve(true))
    )
    child.kill('SIGTERM')
    const exited = await Promise.race([
      exitPromise,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4_000))
    ])
    if (!exited && child.exitCode === null) child.kill('SIGKILL')
  }

  private setState(phase: RuntimePhase, message: string): void {
    this.phase = phase
    this.message = message
    this.options.onChanged(this.snapshot())
  }

  private writeChunk(source: 'stdout' | 'stderr', chunk: Buffer): void {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (line.length > 0) this.writeLog(`[${source}] ${line}`)
    }
  }

  private writeLog(line: string): void {
    this.logLines.push(line)
    if (this.logLines.length > 200) this.logLines.splice(0, this.logLines.length - 200)
    this.logStream?.write(`${line}\n`)
  }

  private closeLog(): void {
    this.logStream?.end()
    this.logStream = undefined
  }
}

function latestHarnessAttemptLogs(logLines: readonly string[]): readonly string[] {
  for (let index = logLines.length - 1; index >= 0; index -= 1) {
    if (logLines[index]?.trimStart().startsWith('[desktop] starting ')) {
      return logLines.slice(index + 1)
    }
  }
  return logLines
}

export function extractFailureCause(logLines: readonly string[]): string | undefined {
  const stderrLines: string[] = []
  let dshEntryError: string | undefined
  let uncaughtError: string | undefined

  for (const line of latestHarnessAttemptLogs(logLines)) {
    if (!line.startsWith('[stderr] ')) continue
    const text = line.slice(8)
    stderrLines.push(text)

    if (dshEntryError === undefined) {
      const m = text.match(/DSH entry failed:\s*(.+)/)
      if (m && m[1]) dshEntryError = m[1].trim()
    }

    if (uncaughtError === undefined) {
      const m1 = text.match(/uncaught exception:\s*(.+)/)
      if (m1 && m1[1]) {
        uncaughtError = m1[1].trim()
      } else {
        const m2 = text.match(/unhandled rejection:\s*(.+)/)
        if (m2 && m2[1]) uncaughtError = m2[1].trim()
      }
    }
  }

  if (dshEntryError) return dshEntryError
  if (uncaughtError) return uncaughtError

  for (let i = stderrLines.length - 1; i >= 0; i--) {
    const line = stderrLines[i]?.trim()
    if (!line) continue
    if (line.length < 200 && /\b(error|Error|ERROR|failed|Failed|FAILED)\b/.test(line)) {
      return line
    }
  }

  if (stderrLines.length > 0) {
    const last = stderrLines[stderrLines.length - 1]?.trim()
    if (last && last.length < 200) return last
  }

  return undefined
}

const CORE_BUNDLES = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket'])
const PACKAGE_REFERENCE_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i

function isPackageReference(value: string): boolean {
  const candidate = value.trim()
  if (!candidate || candidate.includes(':')) return false
  return PACKAGE_REFERENCE_PATTERN.test(candidate)
}

function isActionablePluginReference(value: string): boolean {
  const candidate = value.trim()
  return (
    isPackageReference(candidate) &&
    !CORE_BUNDLES.has(candidate) &&
    !candidate.startsWith('@deepseek-ai/')
  )
}

function extractPluginReferences(
  logLines: readonly string[],
  accepts: (value: string) => boolean
): string[] {
  const plugins = new Set<string>()

  for (const line of latestHarnessAttemptLogs(logLines)) {
    if (!line.startsWith('[stderr] ')) continue
    const text = line.slice(8)

    const m1 = text.match(/failed to apply loader entry [^\s]+ \((@[^)]+|[^)]+)\)/i)
    if (m1 && m1[1] && accepts(m1[1])) {
      plugins.add(m1[1].trim())
    }

    const m2 = text.match(/cannot resolve profile bundle ["']([^"']+)["']/i)
    if (m2 && m2[1] && accepts(m2[1])) {
      plugins.add(m2[1].trim())
    }

    const m3 = text.match(/profile bundle ["']([^"']+)["'] declares no dsh\.bundle/i)
    if (m3 && m3[1] && accepts(m3[1])) {
      plugins.add(m3[1].trim())
    }

    const m4 = text.match(/failed to import loader entry [^\s]+ \((@[^)]+|[^)]+)\)/i)
    if (m4 && m4[1] && accepts(m4[1])) {
      plugins.add(m4[1].trim())
    }

    const m5 = text.match(/plugin\(s\) failed to load:\s*([a-zA-Z0-9@/_-]+)/i)
    if (m5 && m5[1] && accepts(m5[1])) {
      plugins.add(m5[1].trim())
    }

    const bootFailureLines = text.split(/\r?\n/).map((value) => value.trim())
    const bootFailureTitle = bootFailureLines.findIndex((value) => value === 'Failed to load plugins')
    if (bootFailureTitle >= 0) {
      for (const candidate of bootFailureLines.slice(bootFailureTitle + 1)) {
        if (accepts(candidate)) plugins.add(candidate)
      }
    }
  }

  return [...plugins]
}

export function extractPluginFailureReferences(logLines: readonly string[]): string[] {
  return extractPluginReferences(logLines, isPackageReference)
}

export function extractOffendingPlugins(logLines: readonly string[]): string[] {
  return extractPluginReferences(logLines, isActionablePluginReference)
}

export function extractDuplicateLoaderEntryId(
  logLines: readonly string[]
): string | undefined {
  for (const line of latestHarnessAttemptLogs(logLines)) {
    if (!line.startsWith('[stderr] ')) continue
    const match = line.slice(8).match(/duplicate loader entry id:\s*["']?([^\s"']+)["']?/i)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

export function extractSlotConflictName(
  logLines: readonly string[]
): string | undefined {
  for (const line of latestHarnessAttemptLogs(logLines)) {
    if (!line.startsWith('[stderr] ')) continue
    const match = line.slice(8).match(/single slot\s+["']([^"']+)["']\s+already has a registration/i)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

export function extractOffendingPlugin(logLines: readonly string[]): string | undefined {
  return extractOffendingPlugins(logLines)[0]
}

export function formatExitCode(code: number): string {
  const unsigned = code >>> 0
  const hexadecimal = `0x${unsigned.toString(16).padStart(8, '0').toUpperCase()}`
  if (unsigned === 0xffff7003) {
    return `exit code ${unsigned} (${hexadecimal}, Crashpad handler unavailable)`
  }
  return `exit code ${code} (${hexadecimal})`
}

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Could not reserve a local port.'))
        return
      }
      const { port } = address
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function waitUntilReady(
  url: string,
  isAlive: () => boolean,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const stabilityWindowMs = 500
  let readySince: number | undefined
  while (Date.now() < deadline && isAlive()) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1_000) })
      const stability = updateReadyStability(
        readySince,
        response.status >= 200 && response.status < 500,
        Date.now(),
        stabilityWindowMs
      )
      readySince = stability.readySince
      if (stability.ready) return true
    } catch {
      // The server is expected to reject connections while it is booting.
      readySince = updateReadyStability(readySince, false, Date.now()).readySince
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}
