# Agent Note: Real WebUI authentication replaces the placeholder login

Status: implemented

English | [中文](2026-08-18-webui-auth-adoption.zh.md)

## Problem

[The placeholder login surface](../feature/2026-08-18-gajz-login-surface.md) delivered a front door and a client-side state machine, and said plainly what it was not: it granted nothing, `curl` bypassed it entirely, and its own Known Limitations listed the three obstacles a real implementation would hit. It was built that way because dsh has no authentication and building one badly looked worse than not building one.

That reasoning assumed the alternative was writing the host-side layer from scratch. It was not. `dsh-webui-auth` exists on npm (v0.3.0, six releases, MIT, zero dependencies) and is exactly the missing piece — which makes shipping a surface that protects nothing no longer defensible.

The deployment also moved from a browser-only product toward a desktop client, and a desktop user cannot read a host log. Whatever authenticates has to surface its first-run secret somewhere a person will see.

## Decision

Delete the placeholder package and mount `dsh-webui-auth` as the product's authentication.

**It gates what the placeholder could not.** The plugin wraps the `webServer` routes at runtime — no dsh source is patched, so a dsh upgrade cannot silently break it — and covers four surfaces: the SPA (302 to the login page), `/plugins` client bundles (302), `/api` (401), and both WebSocket upgrades (rejected). Those are exactly the surfaces the placeholder's Known Limitations named as unprotected. Behind them: scrypt password hashing, HttpOnly session cookies, sessions persisted across restarts, per-IP rate limiting, and a per-boot setup token that only the operator can read.

Verified by probe rather than by reading its README — all four refuse an unauthenticated request, and the same requests succeed with a session cookie.

**The plugin is consumed from a local clone, not from npm.** `dsh-webui-auth/` sits next to this checkout and the web bundle depends on it as `link:`, which is the maintainer mode the plugin's own README documents. The clone is byte-identical to the published 0.3.0 (verified by diff; only line endings differ), so this is a change of source, not of version.

That makes the 天枢 login page an ordinary source edit: brand blue, the two-column stage with the credential card left and the shield key art right, and 「欢迎回来」 as the heading. The page already read `--dsw-alias-*` theme tokens and honored the light/dark preference, so this is styling, not rework.

Working from the clone also removes a hazard the npm route had. Under a `link:` install the plugin keeps its data in its own directory rather than falling back to `$DSH_HOME` — and that directory is now a git working tree. The clone's `.gitignore` covers the credentials file and the audit log but **not** `sessions.jsonl` (live session tokens), `setup-token`, or `audit-hmac-key`, all written `0600`. This change adds them, so a `git add -A` in that project cannot commit live secrets.

**The desktop shell surfaces the setup token.** It scrapes the token from the child process's stdout and shows it in a dialog with a copy button, because the log it is printed to does not exist for a desktop user.

## What the design asked for and the backend cannot do

The reference design has a phone-number field and a 验证码登录 tab. `dsh-webui-auth` authenticates a username and password; it has no phone or verification-code concept at all. The patched page therefore asks for 账号, and there is no second tab.

Rendering the tab anyway was rejected: a control that cannot work is worse than an absent one, and the placeholder's own verification-code path — complete on the client, backed by nothing — is the mistake this change is correcting.

## Alternatives considered

**Keep the placeholder and add dsh-webui-auth behind it.** Rejected: two login screens in sequence, one of which is theatre. The user would sign in twice for one real check.

**Keep the placeholder for its exact design match and skip real auth.** The surface matched the reference closely and cost 28 tests to build. Rejected because matching a picture is not the requirement the login exists for, and the deployment is moving toward a desktop client that may not stay on loopback forever.

**Write the host-side layer in this repository instead of adopting one.** The seams are tractable and the previous note mapped them. Rejected on the same reasoning that note used — token minting, storage, rotation, an `unauthorized` error code, and the connection retry path are real product surface — with the difference that a reviewed implementation of exactly that now exists, so building a second one buys nothing.

**Fork the plugin rather than patch it.** A fork gives full freedom over the login page, at the cost of owning security-relevant code (scrypt parameters, session persistence, rate limiting) and re-merging upstream fixes by hand. Rejected: the customization is presentation plus one path resolution, which a patch expresses exactly, and the patch fails loudly on upgrade instead of silently diverging.

**Ask the plugin's data-directory question upstream instead of patching.** The right long-term move, and the patch is not a substitute for it. Taken as a patch here because the failure it prevents — losing the administrator account on the next install — is immediate.

## Consequences

The product now has authentication that actually holds, and the `--host 0.0.0.0` question becomes a real conversation rather than an automatic no. That refusal still stands in the CLI and this change does not lift it: the SPA, `/plugins`, the boot manifest, and the HMR endpoint are gated, but exposure to a network needs its own review of TLS, origin policy, and the trust fence.

The cost is a dependency on a package outside this repository for a security-critical path, held at one pinned version with a local patch. An upgrade must re-verify the four gated surfaces, not just that the patch still applies.

The login page no longer matches the reference design in two visible ways — no phone field, no verification-code tab — because the backend has neither. That is recorded above rather than papered over.

The placeholder package, its 28 tests, and its client-side `AuthClient` seam are deleted. The seam's shape was not wasted: it was designed for a real backend, and what replaced it is a real backend.

## Testing

There is no automated coverage of the gate: the plugin is a dependency, its tests are its own, and this repository has no lane that boots a server and probes it. The four surfaces were verified by probe against a live `dsh web`, unauthenticated and then with a session cookie, and the browser flow was driven end to end (redirect to login, sign in, land in the app). Re-run those probes on any upgrade of the plugin — the patch applying cleanly is not evidence the gate still holds.
