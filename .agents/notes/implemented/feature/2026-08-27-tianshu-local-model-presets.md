# Agent Note: Local model onboarding presets on the custom provider card

Status: implemented

English | [中文](2026-08-27-tianshu-local-model-presets.zh.md)

## Problem

The product is extending beyond internet API-key providers: the owner will deploy models on a local GPU, and LAN-reachable GPU servers are in scope. The harness's model layer already serves both — `llm-pi-ai` speaks OpenAI-compatible protocols, and the settings Models page already has a hand-declared-provider card (`CustomProviderCard`) that accepts any base URL and discovers models at `{baseURL}/models`.

The gap is knowledge, not capability: a user deploying Ollama, vLLM, or llama.cpp locally has to know the conventional port for their runtime and type a five-field declaration by hand. That is friction on a path the product now wants to promote.

## Decision

The custom-provider card leads with three one-click preset chips — Ollama (`http://127.0.0.1:11434/v1`), vLLM (`http://127.0.0.1:8000/v1`), llama.cpp (`http://127.0.0.1:8080/v1`). A click is a **fill gesture, not a state and not a submit**: it sets the route id, display name, and base URL; everything already required (at least one model, optional key) still gates the create button exactly as before. A chip whose route stem is already taken disables itself rather than inventing a suffixed id the user did not choose — the taken-id rule then names the conflict through the existing field-level hint.

LAN GPUs need no dedicated affordance: the same card with the server's address pasted as the base URL is the documented flow, and the README now states it.

No model-layer or settings-schema change rides along. The presets live entirely in the client card (`LOCAL_PRESETS` constant); the provider profile they produce is byte-identical to a hand-typed declaration, so the adapter, credential, and discovery paths never learn a preset existed.

## Consequences

A user with a local runtime clicks one chip, adjusts at most the port, fetches models, and creates the provider. A LAN GPU user pastes `http://<host>:<port>/v1` and follows the same flow.

The preset list is deliberately three entries, not an extensibility surface: the ports are conventions of those runtimes' default installs, and a runtime that does not follow its convention is still served by manual entry. Adding a preset later is a constant plus two locale keys.

The SSH-tunnel capability for password-auth remote GPUs is deliberately **not** in this change: it is a host-side plugin (tunnel lifecycle, one-time key provisioning, credential storage) designed separately. This note covers only the zero-infrastructure paths.

## Alternatives considered

**A dedicated "local provider" card type.** Rejected: it would fork the declaration surface for a difference that is only field values. The card already validates everything a local declaration needs; a second card would drift from the first.

**Auto-detecting a running local runtime.** Rejected: probing ports at card open is a side-effecting network scan in a settings form, and a runtime that is not running yet (the common case when a user is pre-configuring) would report "not found" and read as an error.

**Probing on chip click.** Rejected for the same reason: the click must stay a pure fill, and the existing "fetch available models" button already probes the endpoint on demand with real error reporting.

## Testing

`provider-form.client.spec.tsx` gains a `local runtime presets` block: one case drives the vLLM chip and asserts the route/display-name/base-URL fields filled (and that nothing was submitted); one case asserts a taken stem disables exactly that chip while its sibling stays enabled. Package suites pass at 231 tests; `typecheck` is clean; the client bundle was rebuilt (`lib/client.js` serves the running web app).
