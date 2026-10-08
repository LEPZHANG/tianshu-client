/**
 * PowerShell quoting for the generated COM scripts.
 * @module @deepseek-ai/dsh-document-convert-msoffice/powershell
 */

/**
 * One value as a PowerShell single-quoted literal. Single quotes suppress every form of expansion, so
 * doubling the quote character is the only escape the form has.
 * @param value - the text to embed, routinely a filesystem path.
 * @returns the quoted literal, including its surrounding quotes.
 */
export function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}
