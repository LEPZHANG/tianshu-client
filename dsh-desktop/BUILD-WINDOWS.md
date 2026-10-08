# Building the Windows installer

<a href="BUILD-WINDOWS.md">English</a> · <a href="BUILD-WINDOWS.zh.md">简体中文</a>

The Windows build carries an offline conversion toolkit, so it needs one machine with network access even though the machines it is deployed to have none. This is the checklist for that build.

## Who does what

| Machine | Network | Job |
| --- | --- | --- |
| Development machine (any OS) | yes | write code, run the repository gates, hand over the commercially licensed typefaces |
| **Build machine (Windows x64)** | **yes, for this build** | fetch the toolkit, package the installer |
| Deployment machine (Windows x64) | no | install the package and use it; never runs anything below |

The build machine and a deployment machine can be the same box. The fetch step cannot move to macOS or Linux: LibreOffice ships as an MSI, and the script expands it with `msiexec /a`, which only Windows has.

## What the deployment machine already provides

Where Microsoft Office or WPS is installed, the `msoffice` providers drive it through COM and serve these routes without any bundled tool:

- `doc`, `docx`, `rtf`, `txt` → `pdf`, `doc`, `docx`, `rtf`
- `xls`, `xlsx` → `pdf`, `xls`, `xlsx`
- `ppt`, `pptx` → `pdf`, `ppt`, `pptx`

The toolkit below is not redundant with that. Four groups of conversions are deliberately withheld from Office and require it: every OpenDocument edge (`odt`, `ods`, `odp`) — which includes **official-document PDF**, since that tool emits ODF; `html` in both directions; `txt` as a target; and `pdf` as a source.

## Prerequisites

- Node.js `^22.19` or `>=24`, git, and pnpm.
- The whole Harness repository, not this directory alone: the desktop app resolves `@deepseek-ai/dsh` and `@deepseek-ai/dsh-web-frontend` through `file:../apps/cli` and `file:../apps/web`.
- The three GB/T 9704—2012 typefaces (`FZXBSJW.TTF`, `仿宋_GB2312.ttf`, `楷体_GB2312.ttf` are the names the fetch script's own instructions use; any file name works, because packaging matches the family each font declares). They are commercially licensed and `.gitignore`d, so git does not carry them — copy them over by hand.

## Steps

```powershell
# 1. Build the Harness this app embeds. `npm run build` refuses to package without it.
git clone <repository>
cd tianshu-client
pnpm install
pnpm run build

# 2. Stage the typefaces git cannot carry.
#    → dsh-desktop\build\fonts\{FZXBSJW.TTF, 仿宋_GB2312.ttf, 楷体_GB2312.ttf}

# 3. Fetch the toolkit. This is the step that needs network.
cd dsh-desktop
npm install
node scripts\fetch-convert-tools.mjs --trust-on-first-use

# 4. Pin what step 3 printed: paste the three sha256 digests into the
#    WINDOWS_TOOLS table in scripts\fetch-convert-tools.mjs, so every later
#    build verifies instead of trusting.

# 5. Package.
npm run package:win
```

Step 3 downloads LibreOffice, pandoc, and poppler, lays them out under `build/tools/`, and copies the staged typefaces into the bundled LibreOffice's own `share/fonts/truetype`. `electron-builder` then copies `build/tools/` into the installer as `resources/tools/`, and at runtime `src/main/runtime/harness-runtime.ts` prepends each converter's directory to the Harness child process PATH and points `DSH_OFFICIAL_DOCUMENT_FONTS` at the font directory, which is what makes the official-document tool carry the typefaces inside each document it writes.

`npm run tools:verify` re-runs the same assertions without network, which is the cheapest way to confirm a toolkit on disk is still complete.

## When a step fails

| Message | Meaning |
| --- | --- |
| `the bundled toolkit is currently Windows-only` | The fetch is running somewhere other than Windows. |
| `<tool> <version> returned HTTP 404` | Upstream moved past the pinned version. Bump it in `WINDOWS_TOOLS`; the error carries the release index URL. |
| `<tool> has no pinned checksum` | A first fetch of that version. Re-run with `--trust-on-first-use`, then paste the digest in. |
| `the toolkit is incomplete` | An executable the runtime looks for is absent. Re-run the fetch. |
| `the 公文 typefaces are incomplete` | Step 2 was skipped. Supply the files, or state the intent with `npm run package:win:no-fonts` — that build's official-document PDF renders in substituted faces, and its documents carry no typefaces for the recipient either. |
| `the Harness CLI is not built` | Step 1 was skipped or only partly ran. |

## Checks that need real hardware

The following cannot be verified on a build machine alone. Run them on a deployment machine with Office installed, against the built installer:

1. `docx → pdf` served by Office rather than LibreOffice.
2. WPS detection, and confirmation of the method names its automation object exposes.
3. Which suite wins on a machine carrying both Office and WPS.
4. `pptx → pdf` on a machine with Word but not PowerPoint.
5. No orphan `WINWORD.EXE` after a cancelled conversion.
6. A macro-bearing `.docm` opens without running its macros.
7. An official document converts `docx → pdf` through LibreOffice in the correct typefaces.
8. That `.docx` opens in Microsoft Word with the three GB/T 9704—2012 faces correct and no missing-font prompt, on a machine that never installed them.
9. The same file in WPS. Whether WPS honours `w:embedTrueTypeFonts` and the `word/fonts/*.odttf` parts is unverified, and it is the assumption the embedding rests on.
10. The same file on a third machine that has never had this client installed — the case embedding exists for.
11. The file size the recipient actually receives. Whole fonts plus the faces LibreOffice substitutes for SimHei and SimSun can put a `.docx` near 40 MB; where an OA system caps attachments below that, the deployment turns `fontDirectory` off and accepts substitution.
