# Agent Note: converting documents on the Windows machines the users actually have

Status: implemented

English | [中文](2026-09-24-windows-office-conversion.zh.md)

## Problem

The conversion seam and its LibreOffice backend shipped, and for this product's users they were wrong on both counts: the users are on Windows, the machines are routinely on a local network with no internet, and the machines already have the application that defines the formats being converted.

Three concrete failures follow from that.

1. **Nothing was installed.** LibreOffice, pandoc, and poppler were resolved from `PATH`. On a fresh Windows machine none of them is there, so every conversion failed with a provider-unavailable error naming a binary the user cannot download.
2. **LibreOffice is not the renderer for OOXML.** It is a reimplementation of it. A `.docx` with text boxes, SmartArt, page-number fields, or CJK font metrics converts to a PDF that differs visibly from what Word shows — and the user has Word open on the same screen to compare against.
3. **The 公文 chain must not be re-laid-out.** [`tool-official-document`](../../../../packages/convert/tool-official-document/README.md) assembles GB/T 9704—2012 pages as ODF and hands the file to the seam. Word's ODF import re-flows the document against its own layout engine, which would destroy exactly the property that tool exists to guarantee.

Failures 2 and 3 pull in opposite directions, and that tension is the whole design problem: the better converter for OOXML is the worse converter for the format the 公文 chain produces.

## Decision

### The bundled toolkit is the floor

`scripts/fetch-convert-tools.mjs` downloads Windows x64 LibreOffice, pandoc, and poppler into `build/tools/`, the installer ships them under `resources/tools`, and `harness-runtime.ts` prepends those directories to the Harness child process's `PATH`. Conversion therefore works on a machine that has never been online and has no office suite at all.

Four 公文 typefaces (方正小标宋简体, 仿宋_GB2312, 楷体_GB2312, 黑体) are staged in `build/fonts/`, which `.gitignore` excludes — they are commercially licensed and must not enter a public repository. Their family names were verified byte-for-byte against the constants in `odf.ts` rather than assumed, and [embedded typefaces](2026-09-24-official-document-embedded-fonts.md) later made that agreement a runtime match and gave the same files a second job: the client hands their directory to the Harness, which copies them into every 公文 it writes. Packaging refuses a toolkit missing the three Windows does not ship, because LibreOffice substitutes faces without reporting anything: the 公文 PDF is laid out in the wrong typefaces while every step succeeds. `npm run package:win:no-fonts` is how a build states that it accepts the substitution.

### Office and WPS are the ceiling, as a separate provider package

`packages/convert/document-convert-msoffice` registers six providers — Word, Excel, PowerPoint and WPS Writer, Spreadsheets, Presentation — driven over COM from a PowerShell script. Six rather than two because `available()` belongs to a provider and Office is installed per application: a machine with Word and no PowerPoint keeps the Word routes.

Microsoft Office ranks 30, WPS 25, LibreOffice 10. The seam's planner ranks fidelity first and priority second, so nothing else had to change: a route Office serves goes to Office, and a route it does not declare falls to whoever does.

**The exclusions are the mechanism, not a gap.** Office declares no `odt`/`ods`/`odp` edge in either direction, which is what keeps the 公文 chain on LibreOffice without a single pinned route. It declares no `html` edge (Word's export carries MSO-private markup, and as a *source* Word resolves remote `<img>` URLs — on an offline machine, a stall with no diagnostic), and no `txt` *target* (Word writes UTF-16; Excel's UTF-8 CSV member needs Office 2016+, and the `xlCSV` fallback writes the ANSI code page, turning Chinese into mojibake). What remains — 13 document, 4 spreadsheet, 4 presentation routes — is every edge where the application owns both formats, so all of them are `faithful` and none carries a note.

### Detection reads the class server, because a ProgID lies

A WPS installation routinely registers itself as `Word.Application`, and the seam verifies that a result is a file of the target's type — not which application produced it. A ProgID check alone would therefore let `msoffice-word` drive WPS while reporting Microsoft Word, and the priority ordering above would be fiction.

So one apply-time PowerShell run reads both facts for all six ProgIDs: `[Type]::GetTypeFromProgID` resolves the class through the registry without starting the application (the seam requires `available()` to be cheap and synchronous, so the verdict is sampled once and cached), and `LocalServer32` under `HKCU:\SOFTWARE\Classes\CLSID` then `HKLM:` gives the command line COM would actually launch. `HKCU` comes first because a per-user Click-to-Run installation registers only there.

A hijacked ProgID disables that one provider and logs it by name — the machine does have Office, conversions silently fall back to LibreOffice, and that is otherwise indistinguishable from no Office at all. A ProgID whose `LocalServer32` cannot be read is refused rather than used, because running an unidentified converter is the outcome the probe exists to prevent.

### Macro execution is a fixed invariant

COM-opening an untrusted `.doc` or `.docm` **executes its macros**. The script sets `$app.AutomationSecurity = 3` (`msoAutomationSecurityForceDisable`) before opening anything and asserts it in-script, exiting non-zero if the application did not take it. It is not a Config field: there is no deployment for which running a converted document's macros is correct.

### The Office process is not a child of the shell

`WINWORD.EXE` is a COM server, so killing PowerShell leaves it running. The script writes the process ids it started to a sidecar file *before* opening the document — a file rather than stdout, because a killed process may not have flushed — and the provider `taskkill /T /F /PID`s those ids in `finally` only when the run did not exit cleanly. An application the user already had open records no ids and is never touched, reconfigured, or quit.

## Testing

`registerOfficeProviders(ctx, { platform, … })` takes the platform as a parameter instead of reading `process.platform`, which is what lets a Linux CI machine exercise the only code path that does anything. On top of it: route-selection cases proving Office wins, WPS wins alone, a Word-only machine falls back for `pptx`, and `odt → pdf` stays with LibreOffice even with all three Microsoft applications present; the probe's WPS-hijack case; a macro-security assertion for all six applications; PID-based cleanup on failure and on cancellation, and no cleanup after a clean exit; and serialization of concurrent conversions against one application.

The scripted subprocess backend cannot see this provider's output path, because it is a variable assignment inside the `-Command` script rather than an argv element. `officeOutputPath` parses `$output = '…'` back out of the script, which simultaneously proves the path was written as one PowerShell literal with its quotes doubled.

`tests/real-office.spec.ts` runs the real thing and skips itself unless the probe finds an installed writer, so it is a no-op everywhere except a Windows machine with an office suite.

## Alternatives considered

**Replace LibreOffice with Office.** Rejected on failure 3: the 公文 chain's ODF would be re-laid-out by Word, and a machine with no office suite would lose conversion entirely. LibreOffice stays as the fallback and keeps every ODF edge.

**Make 公文 emit OOXML directly, so Office could serve it.** Rejected as a different and much larger change — it rewrites `odf.ts` — and unnecessary once Office declares no ODF edge.

**Declare the ODF edges and pin `routes` in the bundle config to keep them on LibreOffice.** Rejected: a pin is deployment configuration that a user's own cordis.yml can drop, silently reintroducing the re-layout. Not declaring the edge is a property of the package.

**Support only Microsoft Office first, and add WPS once its COM dialect could be confirmed on hardware.** This was the recommendation; the user chose to ship WPS in the same round. WPS's export method names and format constants are therefore seeds documented as unverified, and a wrong name fails as `CONVERT_PROVIDER_FAILED` carrying the COM error text, which names the method that does not exist.

**One provider per suite, with `available()` answering per route.** Not possible: the seam defines `available()` on the provider. Six providers is the seam's own prescribed answer for a vendor whose applications install independently.

**PowerShell 7 (`pwsh`).** Rejected: Windows PowerShell 5.1 is present on every Windows installation and its Office COM interop is the most exercised. Scripts pass as a single `-Command` argument, which the execution policy does not restrict, so a domain-managed machine is still served.

**Read `Get-Process` diffs into stdout instead of a sidecar file.** Rejected: the case that needs the ids is the case where the shell was killed, and a killed process's stdout may never arrive.

## Consequences

The bundled toolkit costs roughly 400 MB in the installer, and the three pinned tool versions are unverified seeds — this machine has no network, so `fetch-convert-tools.mjs` must be run once on the Windows build machine with `--trust-on-first-use` to record real hashes.

Seven checks can only be made on Windows hardware and are not made here: Office-selected `docx → pdf`; WPS detection *and* method-name confirmation; the dual-install hijack verdict; a Word-without-PowerPoint fallback for `pptx → pdf`; no orphan `WINWORD.EXE` after a cancellation; a macro-bearing `.docm` not executing its macros; and a 公文 `docx → pdf` going through LibreOffice with the correct typefaces.

A deployment where the harness runs as a Windows service gets six unavailable providers, because Office COM automation fails outside an interactive desktop session. That is the correct outcome and not a regression — it is the LibreOffice-only behavior that already shipped — but it means the desktop application's process model is load-bearing for this package.

There is no per-engine toggle. An administrator who wants WPS ignored on a machine that has it must pin the affected routes on the seam, because a WPS-only machine is the case the WPS providers exist for.

## Related

- [The conversion seam itself](../architecture/2026-09-15-document-conversion-capability-seam.md) — the route planner whose fidelity-then-priority ranking makes this a declaration-only change.
- [Output verification and pandoc](../architecture/2026-09-17-document-conversion-output-verification-and-pandoc.md) — why a provider's exit code is not evidence, which is why this package judges a run by the file it produced.
- [The 公文 tool](2026-09-21-official-document-gb-t-9704.md) — the ODF producer whose layout the exclusions protect.
