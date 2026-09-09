/**
 * Convert a durable failure into copy that is safe to expose in the GUI.
 * @param failure - Failure value preserved by the session event.
 * @returns Display-safe copy for client projections.
 */
export function displayFailureMessage(failure: unknown): string {
  if (failure === null || typeof failure !== 'object') return String(failure)
  const record = failure as { code?: unknown; message?: unknown }
  // Provider AUTH messages may echo a masked or partially preserved credential.
  // Keep the raw diagnostic in the session log, but never project it into UI state.
  if (record.code === 'AUTH') return 'API key is invalid'
  // QUOTA and FORBIDDEN both arrive with a working key, so the provider's own
  // wording ("403", "access denied") reads as a broken credential and sends the
  // user to re-enter one. These name the actual remedy instead. The provider
  // text is dropped rather than appended: it is the part that misleads, and it
  // remains in the session log for diagnosis.
  if (record.code === 'QUOTA') {
    return 'Your account has insufficient quota or balance. Please add credits or check your provider\'s usage limits.'
  }
  if (record.code === 'FORBIDDEN') {
    return 'The model provider denied this request. Check your account permissions, region, or quota.'
  }
  return typeof record.message === 'string' ? record.message : JSON.stringify(failure)
}
