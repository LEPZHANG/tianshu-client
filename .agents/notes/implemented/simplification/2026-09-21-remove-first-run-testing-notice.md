# Agent Note: Remove the restored first-run testing notice

Status: implemented

English | [中文](2026-09-21-remove-first-run-testing-notice.zh.md)

## Problem

Every GUI first launch still opened on an internal-testing notice (内测声明) before the credential step. Its copy is entirely about "DeepSeek Harness 0.1" being an internal testing build, which this product's shell does not present. The step was the restoration described in [shared-modal product onboarding](../feature/2026-08-13-shared-modal-product-onboarding.md), itself the successor of the notice deleted by [remove the first-run beta notice](2026-08-13-remove-first-run-beta-notice.md).

## Decision

Delete the notice from the product rather than unregistering it or rewording it, reversing the notice half of the shared-modal restoration. `ui-settings-models` keeps its Models page and its `deepseek-official` credential step; the `WelcomeNotice` component and stylesheet, the `WelcomeNoticeStore`, the `onboarding-copy.ts` copy-and-version owner, the five `welcome*` locale keys on both language sides, the two package tests, the remote acknowledgement e2e, and its aria golden are gone. `settings.onboarding` stays a slot with one shipped occupant, and the shell still mounts the first incomplete entry.

**The Host keeps the `ui-onboarding` namespace registered**, for the reason the 2026-08-13 removal gave: existing settings documents already carry the section, and the settings seam validates stored documents against registered namespaces. `welcomeNoticeVersion` therefore stays in the `ui-settings-general` schema with no shipped writer, and both READMEs say so.

## Alternatives considered

**Unregister the step and leave the code in place.** Rejected: the component, store, copy owner, and locale keys would all become unreferenced exports, which `knip` reports and which leaves the next reader unable to tell a retired step from a broken one.

**Reword the copy for this product.** Rejected: the user asked for the notification to be gone, and a mandatory first-run interstitial with no material statement is pure friction — the same judgement the 2026-08-13 removal made.

**Deregister the `ui-onboarding` namespace with it.** Rejected again, unchanged: stored documents carrying the section would stop validating.

## Consequences

First launch now opens directly on the credential dialog, so `onboarding-deepseek-config.e2e.ts` asserts the takeover chrome on that dialog's own `aria-label` and no longer needs a pre-acknowledgement scaffold state. The scaffold's `welcomeNoticePending` option and its mirrored welcome constants are deleted; those constants were the only surviving example of the Host/Client mirroring rule in [remote event delivery](../architecture/2026-08-10-remote-event-delivery.md), so `apps/web/tests/README.md` keeps the rule and drops the citation. `welcome-store.ts` leaves the per-file coverage exclusion list in `vitest.config.ts`.

`OnboardingModal` loses its `focusTitle` prop with its only caller: the credential step focuses its key input instead, so the option had no current owner and its branch had no test.

A future versioned first-run step registers through the unchanged `settings.onboarding` seam and reaches `welcomeNoticeVersion` through the existing public settings API; nothing about the backend contract changed.
