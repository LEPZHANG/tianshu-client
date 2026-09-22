# @deepseek-ai/dsh-tool-official-document

English | [中文](README.zh.md)

The model-facing `write_official_document` tool. It takes the wording of a 党政机关公文 as structured fields, refuses the ones GB/T 9704—2012《党政机关公文格式》forbids, lays the rest out on the page the standard fixes, and writes the file.

This is the **second consumer** of the [document conversion seam](../document-convert/README.md). It writes one format itself — OpenDocument text, which is a ZIP of XML parts this package assembles — and reaches every other format by handing that file to `ctx.documentConvert`. It is a function/namespace plugin (`inject: ['tools', 'systemPrompt', 'documentConvert', 'fs']`).

## Why this is a tool and not a prompt

A prompt can teach a model to write like a 公文: pick the 文种, build the 标题 out of 发文机关 + 事由 + 文种, address the 主送机关, divide the 正文 into 一、/（一）/1./（1）. It cannot make the file be 三号仿宋 on a 156 × 225 mm 版心. The standard is a set of measurements — A4, a 37 mm 天头, a 28 mm 订口, 22 lines of 28 characters, a 0.35 mm red rule 4 mm under the 发文字号, page numbers 7 mm below the 版心 — and measurements are produced by code that writes them, not by text asking for them.

So the division is: the model writes the words, this tool sets the page.

## Arguments

`output_path`, `title`, and `body` are required; everything else is an element the standard admits and the document either carries or does not.

| Argument | Clause | Meaning |
|---|---|---|
| `output_path` | — | Where to write, resolved by the filesystem backend. |
| `title` | § 7.3.1 | 标题, normally 发文机关 + 事由 + 文种. |
| `body` | § 7.3.3 | 正文, one `{ level?, text }` per paragraph in order. The tool supplies each level's ordinal and typeface. |
| `format` | — | `docx` (default), `odt`, `doc`, `rtf`, `pdf`, `html`, `txt`. Defaults to the `output_path` extension when it names one this tool writes. |
| `copy_number` | § 7.2.1 | 份号, laid out as six digits. |
| `secrecy` | § 7.2.2 | 密级和保密期限 as `{ level, period? }`, laid out as 秘密★5年. |
| `urgency` | § 7.2.3 | 紧急程度, 特急 or 加急. |
| `issuer` | § 7.2.4 | 发文机关标志, set in red at the top of the page. |
| `doc_number` | § 7.2.5 | 发文字号 as 机关代字〔年份〕序号号. |
| `signer` | § 7.2.6 | 签发人. Its presence makes the document an 上行文 and moves the 发文字号 to the left of the same line. |
| `main_recipient` | § 7.3.2 | 主送机关; the tool joins them and adds the colon. |
| `attachments` | § 7.3.4 | 附件说明; one is written 附件：×××, several are numbered and hung under the first. |
| `signature` | § 7.3.5.2 | 发文机关署名, centred over the 成文日期. |
| `date` | § 7.3.5.4 | 成文日期 as `YYYY-MM-DD`, laid out as 2026年9月1日. |
| `note` | § 7.3.6 | 附注; the tool adds the round brackets. |
| `copy_to` | § 7.4.2 | 抄送机关, in the 版记. |
| `printer` | § 7.4.3 | 印发机关和印发日期 as `{ agency, date }`, the last line of the 版记. |
| `overwrite` | — | Replace the output if it exists. Defaults to false. |

## What the call does, in order

1. Resolve the standing file-effect policy — before any path is touched, because the call always produces a file.
2. Resolve `output_path` through `ctx.fs`, check it against the sandbox mode, and refuse an existing file unless `overwrite` was set.
3. Validate the document against the standard. A violation throws here, **before anything is written**.
4. Build the `.odt` in memory: `content.xml`, `styles.xml`, and the manifest, zipped with `mimetype` stored first and uncompressed.
5. Write it to the output path when `format` is `odt`; otherwise stage it in a temporary directory this tool owns and ask the seam to convert it into place, removing the staging copy either way.

## Where a document may be written

The seam is not a confinement boundary and this tool writes the `.odt` with `node:fs`, so the containment decision is made here, exactly as `convert_document` makes it — the two tools share one implementation of it, exported from [`tool-document-convert`](../tool-document-convert/README.md).

| Standing mode | Outcome |
|---|---|
| no sandbox policy mounted | No root-based limit; the composition confines nothing. |
| `read-only` | Every call is refused. There is no read-only form of writing a document. |
| `workspace-write` | The output must resolve inside the session's workspace root. |
| `danger-full-access` | No root-based limit, the mode having removed it. |

## Refusing a document the standard forbids

Several of the standard's rules are prohibitions on how a value is written: a 发文顺序号 carries no 第 and is not padded (§ 7.2.5), a date is Arabic with the year in full and no padded month (§ 7.3.5.4), an attachment title takes no punctuation after it (§ 7.3.4), a 份号 fits in six digits (§ 7.2.1), the 正文 numbers four levels and no more (§ 7.3.3). A document breaking one of these is not a slightly imperfect official document; it is not one.

So the call fails rather than laying out something that will not pass inspection, and the message names the clause. That is the point of naming it: a model told it broke § 7.2.5 corrects the field, while a model told only that the call failed resends the same value. Every violation is collected before throwing, so one round trip reports every field to fix. `OFFICIAL_DOC_FIELD_MISSING` means a required field was blank; `OFFICIAL_DOC_FIELD_INVALID` means a field that is present is written in a form the standard forbids.

What the tool does not check is what the standard leaves to judgement: whether the 文种 is the right one, whether the 标题 carries all three of its parts, whether the 主送机关 is the body that should receive this. Those belong to the author.

## The canonical value

```
{ path, format, fidelity, bytes, elements: ['§ 7.3.1 标题', ...], notes: [{ code, message }] }
```

`elements` names the clauses the finished document actually answers to, in the order § 7 arranges them. Code Mode reads this directly; the rendered text states the same facts in prose.

`notes` always opens with `OFFICIAL_DOC_FONTS_REQUIRED` — see the limitation below — and a converted format then appends whatever the conversion's own providers reported.

## Presentation

The pending call is a `generic` card with `kind: 'edit'`, which is how a produced file joins the deliverables row a finished turn ends with; `locations` names the output so an editor can follow along. The completed card is titled by the written file and marked `(lossy)` where that applies, from durable result metadata so replay reproduces it.

## Config

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `120_000` | The cooperative tool-call budget, enforced by [`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md). Writing the `.odt` costs milliseconds; every other format then pays for a cold LibreOffice start, which is where the budget actually goes. |

## Model Experience

### System prompt

#### What the model sees

One fixed paragraph, registered at order 113 whenever this package is loaded.

##### Official document guidance

```markdown
Use the write_official_document tool to produce a 党政机关公文 laid out to GB/T 9704—2012. Write the wording yourself — the 标题 as 发文机关+事由+文种, the 主送机关, and the 正文 divided into levels — and let the tool set the page. It refuses a document that breaks the standard and names the clause; fix that field and call again. Repeat its notes to the user rather than claiming the file is printable as it stands.
```

#### Token effect

One fixed paragraph per request, unchanged by which converters the host has installed and present even when a scoped restriction hides the tool's schema.

#### KV Cache effect

Static for the lifetime of the package mount, so it stays in the reusable prompt prefix; only mounting or unmounting the plugin changes it.

### Tool schema

#### What the model sees

The generated [`write_official_document` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-official-document). Every optional argument is described by the clause it satisfies, so the model chooses elements by what the standard calls them rather than by guessing from a field name. The `format` enum lists the seven formats an OpenDocument text file can reach, not the seam's thirteen, so the model cannot ask for a spreadsheet.

#### Token effect

Fixed schema cost per request. It is the largest of the convert family's schemas because the standard has sixteen elements and each one's description names its clause; a scoped restriction removes the schema while leaving the prompt section.

#### KV Cache effect

Prefix-stable: the schema is built from this package's own element list and its text does not vary with host state, so an unusable converter does not invalidate reuse.

### Results

#### What the model sees

One line naming the written path, the format, and its size in bytes; then the clauses the document answers to, so the model can tell the user which elements the file actually carries; then what the file does not deliver, always including the typefaces note and, for a converted format, whatever the conversion reported. A refusal names every violated clause at once, or — when the host cannot reach the requested format — says so and names `format: "odt"` as the way to get a file without a converter.

#### Token effect

A few short lines per successful call, proportional to the number of elements the document carries rather than to its length; the document bytes never enter the context. A refusal is proportional to the number of violated clauses.

#### KV Cache effect

Append-only: each result is appended after the call that produced it and no earlier request tokens are replaced.

## Known Limitations and Deferred Work

- **Fonts are named, not embedded.** GB/T 9704—2012 fixes its typefaces — 方正小标宋简体, 仿宋_GB2312, 黑体, 楷体_GB2312, 宋体 — and the file asks for them by name, which is correct on a machine that has them. No format can supply a machine's missing fonts, so a reader without them substitutes other faces and the glyphs stop being the standard's even though every measurement still is. Every result therefore carries the `OFFICIAL_DOC_FONTS_REQUIRED` note. Probing the host's fonts to warn more precisely needs a cross-platform font query this repository does not have.
- **Seals cannot be produced.** § 7.3.5.1 (加盖印章的公文) and § 7.3.5.3 (签发人签名章) require a red seal image, which is an artefact of the issuing body and not something a layout engine can synthesise. What this tool produces is § 7.3.5.2 — the unsealed form, 发文机关署名 centred over the 成文日期 — and a document that must bear a seal has to have it applied afterwards.
- **Every format except `odt` needs LibreOffice.** The default is `docx`, which reaches the file through `ctx.documentConvert` and therefore through `soffice`. On a host without it the call fails with `OFFICIAL_DOC_FORMAT_UNREACHABLE` naming `format: "odt"` as the format this tool writes by itself. The default was chosen for what recipients open, not for what every host can produce.
- **The 版记 flows rather than sitting at the foot of the last page.** § 7.4.1 puts it at the bottom of the last page; ODF text flows, and there is no paragraph property that pins a block to the bottom of whatever page it lands on. It is written last, so it is on the last page, but the gap above it is whatever the 正文 left. Fixing this needs a frame anchored to the page, which changes how every converter downstream handles the part.
- **The three special formats of chapter 10 are not implemented.** 信函格式, 命令（令）格式, and 纪要格式 each replace the 版头 with their own arrangement. Only the general format of chapters 5–9 is produced; a call that should have been a 纪要 gets a correct general-format document, which is the wrong document.
- **The overwrite check is not atomic.** Existence is tested before the document is built, so a file created at the destination in between is replaced anyway — the same gap, for the same reason, as `convert_document`.
