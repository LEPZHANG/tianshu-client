# Agent Note: A login surface with no authentication behind it

Status: implemented

English | [中文](2026-08-18-gajz-login-surface.zh.md)

> **Superseded.** The placeholder described here was removed: the product now authenticates through `dsh-webui-auth`. See [real WebUI authentication](../architecture/2026-08-18-webui-auth-adoption.md).

## Problem

The GAJZ deployment's design calls for a sign-in page, and the product needs one as its front door.

dsh has no authentication to put behind it. There is no user, no account, no token, no cookie, and no auth middleware anywhere in the tree — deliberately. Upstream records the deferral in four places, including [`packages/host/webserver/README.md`](../../../../packages/host/webserver/README.md)'s "No TLS, auth, or origin policy" and the [browser trust-boundary note](../architecture/2026-07-28-api-browser-trust-boundary.md), which rejected auth tokens explicitly because "token minting/storage/rotation is real product surface". What exists instead is reachability: loopback binding plus the confused-deputy fence in [`api-request-trust.ts`](../../../../packages/client/connection/src/api-request-trust.ts), whose own docstring says it "is not an auth layer".

`session.prompt` is not in `PRIVILEGED_METHODS`, because the default preset carries `bash` — anyone who can start a session already has RCE-equivalent access. So a browser-side login cannot be made meaningful by putting a form in front of it: `curl` bypasses it entirely.

The requirement is therefore a front door that is honest about being one, built so the real thing can be dropped in without rewriting it.

## Decision

Ship the surface and the client-side state machine; do not pretend either is a security boundary.

**The seam is shaped for the real backend, not for the placeholder.** `AuthClient.signIn` is async and returns a discriminated `SignInResult` rather than throwing, because a network implementation fails in ways the form must distinguish — a wrong password and an unreachable host need different messages. `SignInFailure` already carries `unreachable` and `serverError`; the placeholder never returns them, and the surface already renders both. Replacing `createLocalAuthClient` with a host-backed client is one line in `apply`; the component, the store, and the contract are unchanged.

Credential well-formedness stays client-side in both worlds. It decides when the submit button lights up, never whether access is granted.

**The gate mounts in `shell.overlay`.** That is the layout's additive, click-through frame-wide layer, currently with no other registrant. The gate stays mounted for the whole session and decides per render whether to paint; a signed-in user renders `null` and the layer stays click-through. Registration goes through `ctx.slots.inject` because apply order against ui-layout is unconstrained.

When it paints it reuses ui-primitives' `OnboardingSurface` — which portals to `document.body` and holds `#root` inert for exactly its own lifetime — rather than reimplementing that chrome.

**Sign-in state persists, and 「记住密码」 is honored on restore.** The store keeps the signed-in user under `dsh.gajz.auth`; no secret is written. Persistence is whole-value, so a session the user declined to remember reaches storage like any other; the surface therefore signs out a restored session whose `remember` is false on the first mount of a page load. The flag has to survive the write to be readable at restore, which is why it lives in state rather than gating the write.

## What this does not do

Stated here because the failure mode is someone reading the login page as protection:

- It grants and denies nothing. Every host RPC stays reachable without it.
- It must not be used to justify `dsh web --host 0.0.0.0`. The CLI's refusal of that flag is load-bearing and stays.
- Dismissing it via the design's close control hides it for the page load. This bypasses nothing, because nothing was gated.

## Alternatives considered

**Mount the gate in `AppRoot`, the shell's boot gate.** Attractive because it runs before plugins and would still paint if the plugin chain failed. Rejected: `AppRoot` is a pure kernel component under a documented shell-self-sufficiency rule forbidding any plugin dependency, so a login there would have no theme tokens, no locale, and no primitives — it would have to hard-code its own copy and colors. That constraint only earns its cost when authentication must precede plugin fetch, which requires the host-side layer that does not exist.

**Build the real host-side auth layer now.** The right end state, and the seams are unusually tractable — one `/api` route, one `registerDownlink`, one `postJson`, and `host.describe` already invites extension. Rejected for this change as scope: it needs token minting, storage and rotation, a new `unauthorized` RPC error code, a "stop retrying" path in `ConnectionController`, and cover for the static SPA, `/plugins`, the boot manifest, and the HMR endpoint, all of which sit outside the `/api` fence. Doing it badly would be worse than not doing it, because it would look like protection.

**Have the placeholder accept one hard-coded credential pair.** Considered because it reads more like a real login. Rejected as strictly worse: it grants exactly the same access, while implying a check that is not happening and inviting a shared password to be treated as one.

**Skip persistence and re-prompt on every load.** Simpler, and it avoids the whole-value-persistence wrinkle. Rejected because the restore path is the part most likely to be got wrong later, and building it now against a store is what makes a token drop into the same place.

## Consequences

The client half of authentication exists and is covered, so the follow-up that adds the host side is a backend change plus a one-line swap rather than a UI project. The three obstacles that work will hit are recorded in the package's Known Limitations: the bare `catch` in `ConnectionController` that cannot tell a 401 from a dropped socket, the unmounted `ConnectionBanner`, and the unauthenticated non-`/api` routes.

The deployment now shows a login page that stops nobody. That is a real hazard if it is mistaken for security, which is why the README leads with it, this note names it, and the `0.0.0.0` refusal is called out as load-bearing in both.

Two controls render without backends — 「获取验证码」 and 「忘记密码」. The verification-code path is otherwise complete: the field takes six digits and submits as `verificationCode`.

## Testing

`packages/client/ui-gajz-login/tests/` covers the validators and the placeholder's verdicts, the registration (overlay occupancy, the store seat, the injected callback, deferred registration before ui-layout declares the slot, teardown), and the surface: when it paints, the submit gate, digit stripping, the remember choice reaching the store, each failure verdict's message, a backend that rejects instead of resolving, a double submit while one is in flight, field guidance, and the tab swap clearing the secret. The package is at per-file 100%.

The store's `localStorage` persistence outlives a single test in one jsdom environment, so the surface spec clears it between tests; without that, a test that signs in restores its session into the next one.
