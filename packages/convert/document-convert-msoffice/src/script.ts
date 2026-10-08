/**
 * The PowerShell script one conversion runs.
 *
 * Four things in it are not adjustable details, and each exists because of a way COM automation of a
 * desktop application differs from running a converter:
 *
 * - **`AutomationSecurity = msoAutomationSecurityForceDisable`.** Opening an untrusted `.doc` or `.docm`
 *   over COM *executes its macros*. This is the package's one security invariant, and the script asserts
 *   the setting took rather than assuming the assignment threw on an object model that lacks it.
 * - **The application may already be the user's.** Word and Excel start a second process, but PowerPoint
 *   is single-instance: `New-Object -ComObject PowerPoint.Application` attaches to the copy the user has
 *   open. Quitting that, or hiding its window, would destroy their work, so the window and alert settings
 *   are applied — and `Quit` is called — only when this run is what started the process.
 * - **The Office process is not a child of PowerShell.** It is a COM server, so killing the shell leaves
 *   `WINWORD.EXE` running with a document open. The script records the process ids it started, before it
 *   opens anything, in a file the provider reads to clean up after a cancelled conversion. A file rather
 *   than standard output because a killed process may never flush its pipes.
 * - **Failure must be an exit code.** The body is wrapped so that any terminating error writes its
 *   message to standard error and exits 1, which is what the provider classifies.
 * @module @deepseek-ai/dsh-document-convert-msoffice/script
 */

import type { DocumentFormat } from '@deepseek-ai/dsh-document-convert'
import { powershellLiteral } from './powershell.ts'
import { processName } from './programs.ts'
import type { OfficeProgram } from './programs.ts'

/** `msoAutomationSecurityForceDisable`: open documents with all macros disabled. */
const MSO_AUTOMATION_SECURITY_FORCE_DISABLE = 3

/** Everything one conversion script needs to name. */
export interface ConversionScriptRequest {
  /** The application to drive. */
  readonly program: OfficeProgram
  /** The document to open. */
  readonly sourcePath: string
  /** Its format, which selects the plain-text import parameters when it is `txt`. */
  readonly sourceFormat: DocumentFormat
  /** Where the application writes; a private scratch path, never the caller's destination. */
  readonly outputPath: string
  /** The format to write. */
  readonly targetFormat: DocumentFormat
  /** Where the script records the process ids it started, one line of space-separated numbers. */
  readonly pidFilePath: string
}

/**
 * The script converting one document through one Office application.
 * @param request - the application, both paths, both formats, and the process-id file.
 * @returns a complete PowerShell script, to be passed as a single `-Command` argument.
 */
export function buildConversionScript(request: ConversionScriptRequest): string {
  const { program } = request
  const settings = program.dialect.instanceSettings.map(line => `      ${line}`).join('\n')
  return String.raw`$ErrorActionPreference = 'Stop'
$source = ${powershellLiteral(request.sourcePath)}
$output = ${powershellLiteral(request.outputPath)}
$processName = ${powershellLiteral(processName(program))}
try {
  $before = @(Get-Process -Name $processName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $app = New-Object -ComObject ${powershellLiteral(program.progId)}
  $spawned = @(Get-Process -Name $processName -ErrorAction SilentlyContinue |
    ForEach-Object { $_.Id } | Where-Object { $before -notcontains $_ })
  Set-Content -LiteralPath ${powershellLiteral(request.pidFilePath)} -Value ($spawned -join ' ')
  $security = $app.AutomationSecurity
  $app.AutomationSecurity = ${MSO_AUTOMATION_SECURITY_FORCE_DISABLE}
  if ($app.AutomationSecurity -ne ${MSO_AUTOMATION_SECURITY_FORCE_DISABLE}) {
    throw 'this application does not honour AutomationSecurity, so opening the document would run its macros'
  }
  try {
    if ($spawned.Count -gt 0) {
${settings}
    }
    $doc = ${program.dialect.open(request.sourceFormat)}
    try {
      ${program.dialect.save(request.targetFormat)}
    } finally {
      ${program.dialect.close}
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($doc)
    }
  } finally {
    $app.AutomationSecurity = $security
    if ($spawned.Count -gt 0) { $app.Quit() }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
exit 0`
}

/**
 * The process ids a conversion script recorded.
 * @param contents - the process-id file's contents; empty when the conversion attached to an
 *   application the user already had open, which must not be killed.
 * @returns the recorded ids.
 */
export function parseSpawnedPids(contents: string): readonly number[] {
  return contents
    .split(/\s+/)
    .filter(token => /^[0-9]+$/.test(token))
    .map(Number)
}
