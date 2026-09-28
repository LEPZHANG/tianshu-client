# dsh-webui-auth

English | [中文](README.md)

A persistent WebUI authentication plugin for DeepSeek Harness. Once you create an account/password in **Settings → 身份认证 (Authentication)** or via the first-run login page, **unauthenticated browsers cannot load any WebUI resource, call any API, or open any realtime connection** — authentication is enforced at the HTTP/transport layer and cannot be bypassed through browser devtools.

Supports **multiple users with two role tiers** (administrator / regular user): the first account created automatically becomes an administrator; admins manage accounts in **Settings → 用户管理 (User Management)** — create/delete users, reset passwords, change roles — while regular users never see that page and can only change their own password on the Authentication page.

## Architecture

Authentication is enforced in four layers, all implemented by **wrapping the webServer routes at runtime — no DSH core package source is modified**:

| Layer | Mechanism | Unauthenticated behavior |
|---|---|---|
| WebUI resources (index.html, /assets/*, SPA routes) | Plugin registers a `prefix ''` catch-all route; after session validation it hands off to frontend-static | 302 → login page |
| Plugin bundles (/plugins/*) | Wraps the `/plugins` prefix route handler at runtime | 401 |
| /api RPC surface | Wraps the `/api` prefix route handler at runtime | 401 |
| WebSocket (/api/events.mux, /api/events.host) | Wraps the upgrade route handlers at runtime | 401 upgrade rejected |

- **No core patching**: a DSH upgrade never overwrites patches and never leaves `/api` exposed after an upgrade. Every startup re-wraps the route tables, with a 2s→10s rescan loop that catches late-registered routes.
- **Fail-closed**: if the expected routes are missing (DSH internals changed so wrapping can't apply), `setup`/`configure` **refuse to enable authentication** and the problem is reported both in the host log and on the settings page — better unusable than "login enabled with an unprotected /api".
- **Privileged methods behind a reverse proxy / LAN**: after the session check the plugin hands authenticated requests to the core in a "loopback shape", so the core's **loopback-pinned privileged methods** (settings/credentials/agentPreset/llm.discoverModels) work in proxied deployments — the session-cookie gate is a strictly stronger identity proof than the Host-header heuristic it replaces.
- **WebSocket and `trustedHosts`**: the WS upgrade handshake still goes through the core's own `isTrustedApiRequest`, so **in reverse-proxy / LAN deployments (non-loopback Host) you must also add the public hostname to `client-connection.trustedHosts` in the DSH config**, otherwise even authenticated upgrades are rejected.

Sessions are **server-side and persisted to disk** (`sessions.jsonl`, survive a DSH restart, expire server-side), carried by an `HttpOnly; SameSite=Lax` cookie (`dsh_wua_session`) that JS cannot read; changing a password **revokes that user's other sessions**. A session stores only the username; the role is read live from the credentials file on each request, so a role change takes effect immediately (the affected user's WebUI re-renders for the new role after they log in again).

## Multiple users and two role tiers

| Role | 身份认证 (Authentication) page | 用户管理 (User Management) page |
|---|---|---|
| Administrator (admin) | change own password, edit own nickname, set the global session lifetime, disable authentication entirely, log out | Visible: create/delete users, reset any user's password, change roles |
| Regular user (user) | change own password, log out — only | Not visible (the nav item does not appear) |

- **First account is an admin**: the first `setup` account is created with `role: 'admin'`.
- **Last administrator is protected**: the last admin cannot be deleted or demoted; an admin also cannot delete their own account.
- **Kicked off**: deleting a user, or resetting a user's password, immediately invalidates all of that user's sessions; a self-service password change only revokes the user's other devices and keeps the current session.
- **Usernames are immutable**: set by an admin (or the first `setup`) at creation; rename via delete + re-create.

## Installation

This plugin is a standard **bundle**, published on npm — the official `dsh plugin` command is the recommended way to install it. The manual method is kept as a fallback. Prerequisite: pnpm on the machine (Node ships corepack — run `corepack enable pnpm` to activate it).

### Method 1: npm install (recommended)

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-webui-auth
```

Pulls the prebuilt package from the npm registry (plain JS — no prepare script, no build authorization), adds the dependency and appends it to the `dsh.profile.bundles` list; the plugin row is inserted automatically via the bundle layer.

### Method 2: GitHub install

```sh
npx @deepseek-ai/dsh plugin --profile web add github:Yuuz12/dsh-webui-auth
```

Fetches the repository source (works directly — no build step either). Prefer Method 1 when the network to GitHub is unreliable.

### Method 3: manual (fallback)

1. Put the `dsh-webui-auth` directory into `profiles/web/node_modules/`
2. Add one row to the `insert` list in `profiles/web/cordis.patch.yml`:

```yaml
    - id: dsh-webui-auth
      name: 'dsh-webui-auth'
```

> Maintainer dev mode: `dsh plugin --profile web add ./dsh-webui-auth` from a local source checkout (`link:` install) — edit code, restart DSH, done; no reinstall needed.

### Common to all methods

**No core-package patches are needed** (no `[dsh-webui-auth patch]` markers, no `node_modules` edits) — just restart DSH. On startup the host log prints `[dsh-webui-auth] started, credentials file: ...`; if the route wrapping is incomplete it prints `ROUTE GATE INCOMPLETE` and authentication cannot be enabled (fail-closed).

## Uninstallation

### Method 1: `dsh plugin` command (for method-1 installs)

1. `npx @deepseek-ai/dsh plugin --profile web remove dsh-webui-auth` (removes both the dependency and the bundle layer)
2. Restart DSH

### Method 2: manual (for method-2 installs)

1. **Delete the plugin directory** `profiles/web/node_modules/dsh-webui-auth/` (the credentials file `dsh-webui-auth.json` goes with it)
2. **Remove the mount row** from `profiles/web/cordis.patch.yml`:

```yaml
    - id: dsh-webui-auth
      name: 'dsh-webui-auth'
```

   This step is required — otherwise the loader fails at startup because the package is missing.
3. **Restart DSH**

With either method, after the restart authentication is fully disabled (**no core sources to restore** — the plugin never modified core files). To also clear persisted sessions, delete `sessions.jsonl` in the data directory. If you previously used the older pre-hardening build, the leftover `dsh-webui-auth.session` key in browser localStorage is harmless and may be removed optionally.

## Usage

- **First enable (setup token required)**: while no credentials exist, authentication is off (all requests pass), but creating the **first administrator account** requires a **per-boot setup token** — open WebUI → Settings → 身份认证 (Authentication), or visit `/dsh-webui-auth/login`, enter the token printed in the startup log as `[dsh-webui-auth] setup token (...)` (or read the `setup-token` file in the data directory, mode 0600), then create an account/password (≥8 characters, must include uppercase, lowercase, digit and special character). That account automatically becomes an administrator. The token is regenerated on every boot and deleted once setup succeeds, preventing someone from claiming the administrator account in the "exposed before configured" window.
- **Username rule**: 3-32 characters of letters, digits, underscore or hyphen (enforced on create/change; legacy accounts are unaffected and can still log in).
- **Afterwards**: any unauthenticated visit to any path redirects to the login page; after login you stay signed in for the chosen **session lifetime** (browser session / 1 hour / 12 hours (default) / 1 day / 3 days), enforced server-side by expiry. **Sessions are persisted to disk — after a DSH restart logged-in devices stay signed in** (the expiry still applies). "Browser session" mode: the 30-minute window slides with activity, and closing the browser logs you out.
- **Manage users (admin)**: Settings → 用户管理 → create user (username + initial password + role), reset password, change role (admin/regular), delete user.
- **Change your own password (any user)**: Settings → 身份认证 → enter the current password + a new one; this kicks your other devices offline and keeps the current one signed in.
- **Session lifetime / disable authentication (admin only)**: Settings → 身份认证; the session lifetime is a global setting, and "disable authentication" is a global kill switch (verifies the admin's own current password; all sessions are revoked once disabled).
- **Forgot password**: delete `dsh-webui-auth.json` in the data directory — a background check every minute disables authentication within at most 1 minute (no restart needed), then create the first administrator account again with a fresh setup token.

## HTTP endpoints

The settings pages call these via same-origin `fetch` (the session cookie is sent automatically). All require a valid session except login/setup; endpoints marked "admin" return 403 to non-admin callers.

| Endpoint | Method | Access | Purpose |
|---|---|---|---|
| `/dsh-webui-auth/login` | GET/POST | public | login page / submit login |
| `/dsh-webui-auth/setup` | POST | setup token | create the first administrator |
| `/dsh-webui-auth/status` | GET | logged-in | auth state + current user `role` (drives per-role rendering) |
| `/dsh-webui-auth/whoami` | GET | any | username / nickname / role for the greeting |
| `/dsh-webui-auth/nickname` | POST | logged-in | change own nickname |
| `/dsh-webui-auth/change-password` | POST | logged-in | change own password (verifies current, kicks own other sessions) |
| `/dsh-webui-auth/logout` | POST | logged-in | log out |
| `/dsh-webui-auth/audit` | GET | logged-in | recent audit entries |
| `/dsh-webui-auth/configure` | POST | admin | set the global session lifetime |
| `/dsh-webui-auth/disable` | POST | admin | disable authentication entirely (verifies own password) |
| `/dsh-webui-auth/users` | GET | admin | user list (no hashes) |
| `/dsh-webui-auth/users/create` | POST | admin | create a user |
| `/dsh-webui-auth/users/delete` | POST | admin | delete a user (guards: not self / not the last admin) |
| `/dsh-webui-auth/users/reset-password` | POST | admin | reset any user's password (kicks all their sessions) |
| `/dsh-webui-auth/users/set-role` | POST | admin | change a role (guard: cannot demote the last admin) |

## Where data files live (depends on install mode)

Credentials and security data are stored in the **runtime data directory**: for local link / source installs (`dsh plugin add ./dsh-webui-auth`) that is the plugin source directory (removed with the plugin, managed with the repo); for npm / GitHub / tarball installs (the pnpm store is read-only, so the module directory cannot be written) it automatically falls back to `$DSH_HOME/dsh-webui-auth/` (default `~/.dsh/dsh-webui-auth/`).

Files in the data directory:

| File | Purpose | Permissions |
|---|---|---|
| `dsh-webui-auth.json` | Credentials (scrypt hash, v4 multi-user format; a legacy v3 single-user file is upgraded transparently on read and its account becomes an admin) | — |
| `audit.jsonl` | Audit log (IPs pseudonymized, see "Audit log") | — |
| `sessions.jsonl` | Persisted sessions (restart recovery) | 0600 |
| `audit-hmac-key` | HMAC key for audit-IP pseudonymization (auto-generated once) | 0600 |
| `setup-token` | First-run setup token (deleted after setup succeeds) | 0600 |

The plugin probes writability at startup and picks one location; the "forgot password", audit and session paths above refer to that data directory.

## Audit log

Security events — login success/failure/rate-limit, setup, configure (lifetime), disable, logout, and user-management events (`user_created`, `user_deleted`, `password_reset`, self-service `password_changed`, `user_role_changed`, `nickname_changed`) — are **appended as JSONL to `audit.jsonl`** in the data directory (timestamp, username, IP, user-agent, detail). **Client IPs are pseudonymized with HMAC-SHA256** (e.g. `hmac:5151e752|203.0.113.0/24`, with the /24 (IPv4) or /64 (IPv6) network prefix kept in cleartext for aggregation); raw addresses are never written to disk. Two ways to view:

- **CLI** (recommended): run `node index.js audit [--limit N]` (last 20 entries by default; run from the module path):
  ```sh
  node index.js audit --limit 50
  ```
- **Settings page** (admin only): Settings → 身份认证 → "最近登录记录" (Recent activity) shows the last 8 entries (hidden from regular users; `/dsh-webui-auth/audit` returns 403 to non-admins).

Audit write failures never block authentication (only a host-log warning).

## Appearance

Both the login page and the "Settings → 身份认证 (Authentication)" settings page follow DSH's **built-in appearance setting** (Settings → General → Appearance: Light / Dark / System); no separate appearance switch is provided. The settings page lives inside the WebUI and consumes DSH's theme tokens directly, so it tracks light/dark automatically. The login page is a standalone page: the server reads the current appearance preference (settings `ui-theme.preference`), injects it into the page, and the page mirrors DSH's boot logic — `System` resolves via `prefers-color-scheme` and reacts live to OS changes. The login response is served with `cache-control: no-store`, so a refresh picks up any appearance change immediately.

## What to do after upgrading DSH

**Nothing.** The plugin never modifies core packages — after a DSH upgrade the runtime route wrapping is re-applied automatically on startup. If the wrapping is incomplete (DSH internals changed), the host log prints `ROUTE GATE INCOMPLETE`, the settings page shows a red warning, and `setup`/`configure` refuse to enable authentication (fail-closed).

## Data & Security

- Passwords are hashed with **scrypt** (Node's built-in memory-hard KDF — GPU/ASIC resistant, zero dependencies) and stored in `dsh-webui-auth.json` in the data directory (location depends on install mode, see above); plaintext is never written to disk. Credentials format is **v4** (multi-user `{ v:4, ttl, users:[{username, hash, role, nickname?}] }`); a legacy **v3 single-user** file `{ v:3, username, hash, ttl, nickname? }` is upgraded to v4 transparently on read, with that account becoming the sole administrator — no manual migration and no lockout of an existing account. **Since 0.2.0 only scrypt hashes are accepted**: 0.1.x SHA-256 credentials can no longer be verified — delete the credentials file and recreate the account (see "Forgot password").
- Login rate limiting: **per client IP**, at most 5 failures per minute — a single attacker can no longer lock out other users (or the operator). Behind a reverse proxy the client IP is taken from `CF-Connecting-IP` / the leftmost `X-Forwarded-For`, and the proxy headers are trusted **only when the socket peer is loopback** (local caddy/cloudflared) — remote callers cannot spoof them. Failed verifications also run a dummy scrypt pass so "unknown account" and "wrong password" take the same time, defeating username enumeration via response timing.
- First-run setup requires a **per-boot setup token** (128-bit, printed to the host log and written to `setup-token` in the data directory, mode 0600), preventing account claiming in the "exposed before configured" window.
- Audit log: `audit.jsonl`, client IPs pseudonymized with HMAC (see "Audit log").
- Persisted sessions: `sessions.jsonl` (0600), restored on restart; a write failure never affects authentication — the settings page just warns that a restart will require re-login.
- Security headers on the login page and API responses: strict CSP, `nosniff`, `DENY` framing, `no-referrer`, `noindex`, `no-store`.
- Cookie `HttpOnly + SameSite=Lax`: not readable by JS, not sent on cross-site requests.
- The login/setup endpoints are intentionally public (the entry point of authentication): `/dsh-webui-auth/login` and `/dsh-webui-auth/setup` (the latter protected by the setup token).

## Known limits

- **Inherent runtime-wrapping window**: between a route-object replacement (service hot-reload) and the next rescan (≤10s) there is an unprotected window; the fail-closed check on enabling covers the "initially exposed" case, so this window only affects hot-reload during runtime.
- **WebSocket and `trustedHosts`**: in reverse-proxy / LAN deployments (non-loopback Host), WS downlinks need the public hostname added to `client-connection.trustedHosts` in the DSH config (see "Architecture").
- **Proxy on a different host**: if the reverse proxy is not on the same machine as DSH (non-loopback peer), the proxy headers are not trusted and rate limiting aggregates per proxy IP (degrades to a global bucket).
- **Limits of audit pseudonymization**: the HMAC key lives in the same data directory (0600); a local attacker who can read it can brute-force the IP space — pseudonymization protects against "plaintext IPs at rest", not against an attacker with file access.
- Sessions live in `sessions.jsonl`: they survive restarts (expiry unchanged); uninstalling/disabling the plugin does not affect credentials.
- Threat model is "browser/network clients": local processes that can read/write the host's memory or files are out of scope.
