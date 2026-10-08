# Agent Note: SSH tunnel host plugin for remote-GPU models

Status: implemented

English | [中文](2026-08-27-tianshu-llm-tunnel-host.zh.md)

## Problem

The product needs models that do not live on the public internet: local GPUs (served by the custom-provider presets landed the same day) and remote GPU servers reachable only through SSH, where the model endpoint binds the server's own localhost. The model layer itself already speaks OpenAI-compatible protocols through `llm-pi-ai`; what does not exist is the layer that makes a remote endpoint locally reachable.

The owner's GPU servers use password login, and local-model deployment is also planned — both facts shaped the staging.

## Decision

A new host plugin, `@deepseek-ai/dsh-host-llm-tunnel`, owns the tunnel layer and nothing else. One configured host is one `ssh -N -L` child under the subprocess seam (tree-scoped termination, disposal cleanup) plus a Typert RPC surface (`snapshot` / `restart` / `probe`).

**Tunnels carry no model traffic of their own.** The provider row a tunnel serves is written into the `llm-pi-ai` settings namespace as a hand-declared route with `baseURL: http://127.0.0.1:<localPort>/v1` — the sanctioned path the Models UI already renders. Requests, discovery, and the picker work unchanged; nothing in the model layer knows a tunnel exists.

**Phase is derived, not commanded.** `ssh` is connected exactly while its child lives, so the status is child liveness plus the last stderr line when it died. There is no port-polling timer: `probe` answers "does the endpoint actually work" on demand with a `/v1/models` fetch that proves ssh, the forward, and the server in one round trip.

**Reconciliation, not lifecycle commands.** The `llm-tunnel` settings namespace is the single truth: every effective change (user edit, composition base, provider detach) re-syncs the live set — new hosts start, removed hosts stop, and an untouched host's child keeps running so unrelated edits never drop in-flight requests. Config-shape changes (a moved port) restart that host's child because its forward is stale.

**Auth stays with the system ssh binary.** The child runs `BatchMode=yes` with `StrictHostKeyChecking=accept-new`, so existing keys, the agent, and `~/.ssh/config` aliases work unchanged.

## Consequences

What has shipped is the host plugin and the browser card below it; key-based SSH auth is all either serves, so a password-only server fails fast with the ssh diagnostic in the status row. That is the owner's stated login mode, so two pieces are staged behind it: one-time key provisioning (the ssh-copy-id gesture, password held in the credentials store) and the ssh2-library fallback tunnel. The design leaves room for them deliberately — the manager's spawn is one method, and the RPC surface does not change when either lands.

Local-port collisions surface as tunnel failures (ssh reports the bind error); no port allocation yet.

Typert brought its constraints to the wire types: RPC payloads must be JSON-shaped, so `detail` is `string | null`, never `undefined` — the generator rejects non-JSON boundary types at build time, which is the seam doing its job.

## Alternatives considered

**An adapter inside llm-pi-ai that tunnels per request.** Rejected: it would put process lifecycle inside the model adapter, the one place it cannot be observed (a model request is the wrong place to discover a dead tunnel), and every provider would inherit the complexity.

**A dedicated llm adapter for tunnel routes.** Rejected: the provider row already names an ordinary route; a second adapter would fork the protocol handling that `llm-pi-ai` already owns.

**The apiproxy dispatch-row RPC path.** Rejected in favor of `TypertRemoteService`: no per-method schema/dispatch wiring host-side, the same `/api` carrier and auth fence, and generated client artifacts.

## Testing

`tunnel.spec.ts` assembles Loader + a memory settings provider + a fake subprocess seam + the real service: the pinned ssh argv, connecting→failed phase transitions with the stderr diagnostic, the untouched-host survival under an unrelated settings change, honest probe failures, and restart of unknown hosts. The invariant companion suite covers registration/disposal. 7 tests, green; `tsc -b` clean; host and client faces both build (typert artifacts generated). `test:gui` shows no new failures — the two remaining red files predate this work.

## The browser card

`RemoteGpuCard` (in `ui-settings-models`) is the third add-flow entry beside "add provider" and "add a custom provider". One create writes two settings rows: the host under `llm-tunnel` (the plugin above reconciles a child into existence within the settings change) and the provider row under `llm-pi-ai` pointing at the forwarded port — the model layer then serves the GPU as an ordinary declared route. A provider-write revision race rolls the tunnel row back (`op: 'unset'`), so a retried create is never half-declared. The "test connection" button rides `llmTunnel.probe` through the generated remote namespace mounted by api/remotes, and splices the tunnel's diagnostic into the localized failure copy (the footer-grade `t` has no interpolation seat). The face is injected as `ctx.remote.llmTunnel` directly — the branded `TunnelHostId` boundary is crossed with one `as never` at the card's call site, since the card's id is the settings key the host owns.

Package tests grew to 235 (the card: field gating, the two-row write, rollback on revision race, probe diagnostics, taken-id refusal); every existing `ModelsSection` mount gained a probe stub since the section now requires the face. Both faces and the client bundle were rebuilt.
