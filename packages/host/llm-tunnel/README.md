# @deepseek-ai/dsh-host-llm-tunnel

English | [中文](README.zh.md)

SSH port-forward tunnels that surface remote-GPU OpenAI-compatible model endpoints on localhost.

One configured host becomes one `ssh -N -L <localPort>:<remoteHost>:<remotePort> user@host` child process owned by the subprocess seam, plus the tunnel's live projection over Typert RPC. Model requests themselves ride the ordinary `llm-pi-ai` provider path: a tunnel's provider row (written into the `llm-pi-ai` settings namespace at `providers.<route>` with `baseURL: http://127.0.0.1:<localPort>/v1`) is a hand-declared route like any other, so the composer's model picker, model discovery, and the Models settings UI work unchanged and never learn a tunnel exists.

## Configuration

The `llm-tunnel` settings namespace carries one map of host id to its connection:

```yaml
llm-tunnel:
  hosts:
    my-gpu:
      host: gpu.example        # or a ~/.ssh/config alias
      sshPort: 22
      user: ops
      remoteHost: 127.0.0.1    # model endpoint as seen from the SSH server
      remotePort: 8000         # e.g. vLLM's default
      localPort: 18000
```

Every effective change reconciles the live set: new hosts start, removed hosts stop, and an untouched host's child keeps running so in-flight requests survive an unrelated edit.

## RPC surface

`snapshot` reports every tunnel's phase (`connecting` / `connected` / `failed`, derived from the child's liveness) and its local base URL; `restart` re-spawns one tunnel; `probe` fetches `/v1/models` through the forward and returns the listing, proving the whole chain in one round trip.

The browser entry point is the Models settings page's "Add a remote GPU" card (in `ui-settings-models`): it writes one host row here plus the `llm-pi-ai` provider row pointing at the forwarded port, and its test button rides `probe`.

## Model Experience

None: the tunnel carries no prompt content and changes no model-facing inputs. The provider row it serves is the model-facing surface, and it is an ordinary `llm-pi-ai` route.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Key-based SSH auth only (milestone 1).** The child runs with `BatchMode=yes`, so a password-only server fails fast with the ssh diagnostic in the status row. One-time key provisioning (the ssh-copy-id gesture, with the password held in the credentials store) is the planned next milestone; the ssh2 fallback tunnel (no system ssh required) after that.
- **No automatic port allocation.** A `localPort` collision with an unrelated listener surfaces as a tunnel failure (ssh exits with "bind: Address already in use" in the detail); the user picks another port.
- **No reconnect backoff.** A tunnel that dies reports `failed` and stays there until the user restarts it or a settings change re-syncs; ssh's own `ServerAliveInterval` covers transient network blips inside a live child.
