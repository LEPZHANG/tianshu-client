/**
 * Which provider failures get replacement copy, and which keep their own text.
 *
 * The three substituted codes share one reason: the provider's own wording
 * misdirects the user about the remedy. Everything else is passed through,
 * because the provider knows the failure better than a generic phrase does.
 */
import { describe, expect, it } from 'vitest'
import { displayFailureMessage } from '../src/client/sessions/failure-display.ts'

describe('failure display copy', () => {
  it('replaces AUTH provider copy that may echo the credential', () => {
    expect(displayFailureMessage({ code: 'AUTH', message: 'invalid key sk-abc…xyz' }))
      .toBe('API key is invalid')
  })

  it('names quota rather than the key, which is working', () => {
    expect(displayFailureMessage({ code: 'QUOTA', message: 'HTTP 403: access denied' }))
      .toBe('Your account has insufficient quota or balance.'
        + ' Please add credits or check your provider\'s usage limits.')
  })

  it('names the refused request rather than the key, which is working', () => {
    expect(displayFailureMessage({ code: 'FORBIDDEN', message: 'HTTP 403: Forbidden' }))
      .toBe('The model provider denied this request.'
        + ' Check your account permissions, region, or quota.')
  })

  it('keeps provider copy for every other code', () => {
    // The provider diagnosed this better than a generic phrase could.
    expect(displayFailureMessage({ code: 'SERVER', message: 'upstream unavailable' }))
      .toBe('upstream unavailable')
    expect(displayFailureMessage({ message: 'no code at all' })).toBe('no code at all')
  })

  it('renders a failure carrying no usable message', () => {
    // A durable failure is whatever the session log preserved; a projection
    // that threw here would lose the error entirely.
    expect(displayFailureMessage({ code: 'SERVER' })).toBe('{"code":"SERVER"}')
    expect(displayFailureMessage(null)).toBe('null')
    expect(displayFailureMessage('bare string')).toBe('bare string')
  })
})
