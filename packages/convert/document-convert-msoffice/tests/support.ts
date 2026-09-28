/**
 * Shared fixtures for driving the Office providers without Windows: what a probe would have printed, and
 * where a scripted PowerShell run should write.
 * @module @deepseek-ai/dsh-document-convert-msoffice/tests/support
 */

import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { OutputPathDerivation } from '../../document-convert/tests/scripted-subprocess.ts'

/** `LocalServer32` as Microsoft Word registers it: a quoted path followed by the automation switch. */
export const WORD_SERVER = '"C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE" /Automation'

/** `LocalServer32` as a WPS installation registers it, including for Microsoft's own ProgIDs. */
export const WPS_WRITER_SERVER = '"C:\\Program Files\\WPS Office\\office6\\wps.exe" /Automation'

/**
 * The output of a probe that found exactly these ProgIDs.
 * @param registry - each resolvable ProgID mapped to its `LocalServer32` value.
 * @returns the tab-separated lines the probe script writes.
 */
export function probeStdout(registry: Readonly<Record<string, string>>): string {
  return Object.entries(registry).map(([progId, server]) => `${progId}\t${server}`).join('\n') + '\n'
}

/**
 * Where the conversion script would have written, read out of the script itself.
 *
 * Unlike every command-line converter, an Office provider passes no output path in its argv: the path is
 * a variable assignment inside the PowerShell script. Parsing it back out is also what proves the
 * provider put the path there in a form PowerShell would read as one literal.
 */
export const officeOutputPath: OutputPathDerivation = (spec: SubprocessSpawnSpec) => {
  const script = spec.argv[spec.argv.length - 1] as string
  const match = /^\$output = '((?:[^']|'')*)'$/m.exec(script)
  if (match?.[1] === undefined) throw new Error(`the script assigns no $output:\n${script}`)
  return match[1].replace(/''/g, "'")
}

/**
 * The PIDs the conversion script would have recorded, read out of the script's own `Set-Content` call.
 * @param spec - the spawn spec the provider built.
 * @returns the sidecar file's path.
 */
export function pidFilePath(spec: SubprocessSpawnSpec): string {
  const script = spec.argv[spec.argv.length - 1] as string
  const match = /Set-Content -LiteralPath '((?:[^']|'')*)'/.exec(script)
  if (match?.[1] === undefined) throw new Error(`the script records no PID file:\n${script}`)
  return match[1].replace(/''/g, "'")
}
