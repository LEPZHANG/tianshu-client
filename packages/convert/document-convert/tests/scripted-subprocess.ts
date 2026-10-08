import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { detectFormat } from '@deepseek-ai/dsh-document-convert'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import { documentFixture } from './fixtures.ts'

/**
 * A subprocess backend that records what a conversion provider asked to run and performs a scripted
 * effect instead of running it.
 *
 * Substituting the subprocess seam rather than the provider keeps the provider's real argv
 * construction, filter selection, output discovery, and result checking under test, while removing the
 * dependency on an installed converter. Provider packages pair this with a skip-guarded suite against
 * the real binaries.
 * @module @deepseek-ai/dsh-document-convert/tests/scripted-subprocess
 */

/** What the scripted backend should do when a provider spawns a conversion. */
export interface ScriptedRun {
  /** Exit code to report; 0 unless stated. */
  exitCode?: number
  /** Terminating signal to report instead of an exit code. */
  signal?: NodeJS.Signals
  /** Text the scripted process writes to stderr. */
  stderr?: string
  /** Text the scripted process writes to stdout, for a tool a provider reads an answer from. */
  stdout?: string
  /** Whether to create the file the real tool would have produced. */
  produce?: boolean
  /**
   * Contents of that file, overriding the fixture the target format would otherwise get. An empty string
   * models a tool that reported success and produced nothing usable.
   */
  contents?: string
}

/** Where a faked tool writes, given the argv the provider built. */
export type OutputPathDerivation = (spec: SubprocessSpawnSpec) => string

/**
 * `soffice --convert-to <ext>:<filter> --outdir <dir> <source>` writes `<source stem>.<ext>` into the
 * output directory; the name cannot be chosen, which is why the provider converts into a scratch
 * directory and moves the result afterwards.
 */
export const sofficeOutputPath: OutputPathDerivation = (spec) => {
  const argv = [...spec.argv]
  const outDir = argv[argv.indexOf('--outdir') + 1] as string
  const target = (argv[argv.indexOf('--convert-to') + 1] as string).split(':')[0] as string
  const source = argv[argv.length - 1] as string
  const start = Math.max(source.lastIndexOf('/'), source.lastIndexOf('\\')) + 1
  const name = source.slice(start)
  const dot = name.lastIndexOf('.')
  return join(outDir, `${dot > 0 ? name.slice(0, dot) : name}.${target}`)
}

/** Poppler's tools take the source path then the output path as their final two arguments. */
const trailingOutputPath: OutputPathDerivation = spec => spec.argv[spec.argv.length - 1] as string

/** `pandoc --output <path>` names its output explicitly, anywhere among the other arguments. */
export const pandocOutputPath: OutputPathDerivation = spec =>
  spec.argv[spec.argv.indexOf('--output') + 1] as string

/**
 * What a scripted tool writes by default: a real file of the format the output path names. The seam
 * checks every result against its target format, so a backend that wrote a placeholder string would fail
 * every test for a reason none of them is about.
 */
function producedFixture(path: string): Buffer {
  const format = detectFormat(path)
  return format === undefined ? Buffer.from('produced', 'utf8') : documentFixture(format)
}

/** The scripted subprocess seam backend. Mount it in place of the local runtime. */
export class ScriptedSubprocess extends SubprocessRuntime {
  /** Every spawn spec a provider handed to the seam, in order. */
  readonly spawns: SubprocessSpawnSpec[] = []
  /** The effect the next spawn performs, unless the command has its own entry below. */
  script: ScriptedRun = { produce: true }
  /**
   * Per-command effects, keyed by the executable's final path segment. A provider that runs a second tool
   * to diagnose a failure spawns two different commands in one conversion, and only this distinguishes
   * them.
   */
  scriptByCommand: Record<string, ScriptedRun> = {}
  /**
   * Chooses the effect from the whole spawn spec, taking precedence over both fields above. A provider
   * that runs the same command several ways in one conversion — asking its version, then its formats,
   * then converting — is distinguished only by its arguments.
   */
  scriptOf: ((spec: SubprocessSpawnSpec) => ScriptedRun | undefined) | undefined = undefined
  /** Whether `resolveExecutable` finds the requested command. */
  resolvable = true
  /** Commands `resolveExecutable` fails for even when it resolves everything else. */
  resolvableExcept: readonly string[] = []
  /** How the faked tool names its output file. */
  outputPathOf: OutputPathDerivation = trailingOutputPath
  /**
   * Whether to answer with no collected readers. `SubprocessCollectedOutputs` declares both readers
   * optional, so a provider reading diagnostics must tolerate their absence.
   */
  omitReaders = false
  /** Called once a spawn is under way, for a test that cancels mid-run. */
  onSpawn: ((spec: SubprocessSpawnSpec) => void) | undefined = undefined

  resolveExecutable(command: string): Promise<string> {
    return this.resolvable && !this.resolvableExcept.includes(command)
      ? Promise.resolve(`/usr/bin/${command}`)
      : Promise.reject(new Error(`not found: ${command}`))
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const command = (spec.argv[0] as string).split('/').pop() as string
    const script = this.scriptOf?.(spec) ?? this.scriptByCommand[command] ?? this.script
    const done = (async (): Promise<SubprocessOutcome> => {
      this.onSpawn?.(spec)
      if (script.produce !== false) {
        const path = this.outputPathOf(spec)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, script.contents ?? producedFixture(path))
      }
      return {
        exitCode: script.signal !== undefined ? null : script.exitCode ?? 0,
        signal: script.signal ?? null,
      }
    })()
    return {
      pid: 1234,
      stdin: undefined as Writable | undefined,
      stdout: undefined as Readable | undefined,
      stderr: undefined as Readable | undefined,
      collected: this.omitReaders ? {} : {
        stdout: { readFrom: () => ({ text: script.stdout ?? '', nextOffset: 0, lossy: false }) },
        stderr: { readFrom: () => ({ text: script.stderr ?? '', nextOffset: 0, lossy: false }) },
      },
      done,
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }

  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    throw new Error('the scripted backend allocates no terminals')
  }
}
