# @deepseek-ai/dsh-client-ui-deliverables

English | [中文](README.zh.md)

Produced-files and clickable-reference feature owner. The Node half registers final-response guidance with the system-prompt registry; the browser half registers the deliverables row a finished turn ends with into the chat view's `conversation.chat.turnTail` hole and links matching inline-code references in the closing prose. The shipped Web patch is the only composition that loads this package. Removing its one cordis.yml entry removes the guidance, row, and prose links together.

`deliverablesDefinition` folds each Turn's successful mutation calls into engine-published `DeliverablesTurnData`; `producedForClosing` reads that data with the closing Assistant seq. The vocabulary is the mutation tools' own follow-along `locations`, never the closing prose: a produced file is listed whether or not the model remembered to name it. A mutation is recognized by render intent, not tool name — a diff card, or a generic card whose `kind` is `edit` (the shape `str_replace_editor`'s insert presents) — so a new mutation tool joins by declaring what it does. Reads, deletes, and failed calls contribute nothing; a path appears once per Turn in first-seen order. The Conversation Location index owns Turn membership, so a Turn that mutates and then ends without content text cannot spill into the next Turn's row.

`ProducedFiles` renders the row between the closing message's body and its IconActions footer: a quiet label and one measured file lane. It shows the largest leading prefix that fits (up to six chips; basename text, full path as the `title`) while reserving the exact localized `+ N files` width, so the remainder stays visible without wrapping or horizontal scrolling. Each chip opens through the owner-supplied `openFile` — the same Host opener the tool rows use, with the chat view resolving relative paths against the session cwd. When files are hidden, a second-line **Show in folder** action opens the session workspace through that same owner path only while the page is loopback and the current Host handshake reports `canOpenPath`; direct remote Web and headless/container Linux Hosts omit the action by default. Design rationale: the [workspace file links Agent Note](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md).

The closing prose carries the same vocabulary in two tiers, because they carry different confidence. This plugin provides the `chatFileMentions` service the chat view consults per closing message. `producedFileMentions` first resolves an inline-code token against the turn's produced paths — by exact path, or by being exactly the basename of exactly one of them — and a basename two produced paths share stays inert rather than guessing, so a produced-file mention can never open the wrong file. Any other token falls to the path-spelling tier, which accepts a leading `/`, `~/`, `./`, `../`, drive letter, or UNC root, any token containing a separator, or a bare filename with a plausible extension, stripping a trailing `:line`, `:line:col`, or `#Lline` reference. That tier links files this turn only cited: the file may not exist and opening it is allowed to fail silently, which is the price of giving explanation the same affordance as production. Bare identifiers and URL schemes stay inert. A resolved mention keeps its code chip and takes the markdown sheet's link language — link-blue at rest, underlined on hover, exactly like URL-promoted inline code — with the full path as its `title`; mentions never render inside anchors or streaming text. Decision record: the [inline file mentions Agent Note](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md).

The Node half registers the static `ui:deliverable-file-references` system-prompt section. It asks the model to mention the primary files it successfully created or modified and to write those and any other changed-file references as Markdown inline code, using the exact file-tool path or a basename only when unique within the Turn. The guidance makes the renderer's accepted syntax explicit; it does not govern unrelated path discussions or widen the renderer's successful-mutation vocabulary.

## Model Experience

### Clickable file-reference guidance

#### What the model sees

One fixed paragraph instructs the model to name primary files from successful creation or modification calls in its final response and to format those and any other changed-file references as exact-path or unique-basename Markdown inline code, such as `out/report.html`.

#### Token effect

One fixed prompt paragraph whenever this package is loaded; no tool schema, tool result, or per-Turn context is added.

#### KV Cache effect

The section is static at order 190 for the lifetime of the package mount, so it remains in the reusable prompt prefix and does not change across Turns.

## Known Limitations and Deferred Work

- **Produced-file matching is exact path or unique basename only.** A suffix mention (`out/index.html` written as `index.html` resolves; `deep/out/index.html` written as `out/index.html` does not) misses that tier; widening the matcher is deferred until a real closing-message shape needs it. Such a token still reaches the path-spelling tier, which links it without knowing whether the file exists.
- **The path-spelling tier judges spelling, not existence.** It cannot separate a dotted identifier from a multi-part filename (`Object.prototype.hasOwnProperty` links exactly as `archive.tar.gz` does), and it links paths that were never written. Both cost one click that opens nothing, since the opener swallows Host/OS failures. Narrowing the rule would drop real filenames, so a false positive is preferred to a missing link; a real fix needs Host-side existence checking this surface does not have.
- **Files created indirectly by terminal commands remain outside the matching vocabulary.** Naming such a file in inline code does not make it clickable unless a successful mutation location also records that path.
- **Native folder handoff targets the Host desktop.** A browser reached through a non-loopback authority omits the action, as does a deployment reporting no native opener. SSH forwarding that makes a remote Host look loopback-local must set the gateway's `nativeOpen: false`; so must a headless macOS/Windows Host, a WSL deployment without working Windows interop, or any Linux desktop whose display/opener probe is a false positive. Identifying the operator-visible desktop remains deployment policy.
