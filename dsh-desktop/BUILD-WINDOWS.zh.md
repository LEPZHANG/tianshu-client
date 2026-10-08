# 构建 Windows 安装包

<a href="BUILD-WINDOWS.md">English</a> · <a href="BUILD-WINDOWS.zh.md">简体中文</a>

Windows 构建包含一套离线转换工具包，因此即便部署机没有外网，构建本身仍需要一台能联网的机器。本文是那次构建的清单。

## 谁做什么

| 机器 | 外网 | 职责 |
| --- | --- | --- |
| 开发机（任意系统） | 有 | 写代码、跑仓库门禁、把商业授权字体交出去 |
| **构建机（Windows x64）** | **本次构建需要** | 抓取工具包、打出安装包 |
| 部署机（Windows x64） | 无 | 装包使用；下面任何一步都不跑 |

构建机和某台部署机可以是同一台。抓取这一步挪不到 macOS 或 Linux：LibreOffice 以 MSI 分发，脚本用 `msiexec /a` 展开它，而这个命令只有 Windows 有。

## 部署机自己已经提供的能力

装有 Microsoft Office 或 WPS 的机器上，`msoffice` 这组提供方经 COM 驱动它，不依赖任何随包工具即可服务这些路由：

- `doc`、`docx`、`rtf`、`txt` → `pdf`、`doc`、`docx`、`rtf`
- `xls`、`xlsx` → `pdf`、`xls`、`xlsx`
- `ppt`、`pptx` → `pdf`、`ppt`、`pptx`

下面的工具包与之并不重复。有四类转换是刻意不交给 Office 的，只能由它承担：全部 OpenDocument 边（`odt`、`ods`、`odp`）——**公文转 PDF 也在其中**，因为公文工具产出的就是 ODF；两个方向的 `html`；作为目标的 `txt`；以及作为源的 `pdf`。

## 前提

- Node.js `^22.19` 或 `>=24`、git、pnpm。
- 整个 Harness 仓库，而不只是本目录：桌面应用经 `file:../apps/cli` 和 `file:../apps/web` 解析 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-web-frontend`。
- 三款 GB/T 9704—2012 字体（`FZXBSJW.TTF`、`仿宋_GB2312.ttf`、`楷体_GB2312.ttf` 是抓取脚本自身提示里用的名字；文件名随意，打包校验的是每款字体声明的字族）。它们是商业授权字体且被 `.gitignore` 排除，git 不会带过去——手工拷贝。

## 步骤

```powershell
# 1. 先建出本应用内嵌的 Harness。缺了它 `npm run build` 会拒绝打包。
git clone <仓库>
cd tianshu-client
pnpm install
pnpm run build

# 2. 放好 git 带不过来的字体。
#    → dsh-desktop\build\fonts\{FZXBSJW.TTF, 仿宋_GB2312.ttf, 楷体_GB2312.ttf}

# 3. 抓取工具包。需要外网的就是这一步。
cd dsh-desktop
npm install
node scripts\fetch-convert-tools.mjs --trust-on-first-use

# 4. 把第 3 步打印出来的三个 sha256 粘进 scripts\fetch-convert-tools.mjs
#    的 WINDOWS_TOOLS 表，此后每次构建都是校验而不是信任。

# 5. 打包。
npm run package:win
```

第 3 步下载 LibreOffice、pandoc 和 poppler，按约定布局摆进 `build/tools/`，并把备好的字体拷进随包 LibreOffice 自己的 `share/fonts/truetype`。随后 `electron-builder` 把 `build/tools/` 作为 `resources/tools/` 拷进安装包，运行时由 `src/main/runtime/harness-runtime.ts` 把各转换器目录前插进 Harness 子进程的 PATH，并把 `DSH_OFFICIAL_DOCUMENT_FONTS` 指向字体目录——公文工具正是凭这一点把字体带进它写出的每一份公文。

`npm run tools:verify` 不联网地重跑同一套断言，是确认磁盘上工具包是否仍然完整的最省事办法。

## 某一步失败时

| 报错 | 含义 |
| --- | --- |
| `the bundled toolkit is currently Windows-only` | 抓取跑在了非 Windows 的机器上。 |
| `<tool> <version> returned HTTP 404` | 上游已越过钉住的版本。在 `WINDOWS_TOOLS` 里升版本号；报错中带有发布索引地址。 |
| `<tool> has no pinned checksum` | 该版本第一次抓取。加 `--trust-on-first-use` 重跑，再把摘要粘进表里。 |
| `the toolkit is incomplete` | 运行时要找的某个可执行文件不在。重跑抓取。 |
| `the 公文 typefaces are incomplete` | 第 2 步被跳过了。补上文件，或用 `npm run package:win:no-fonts` 明说意图——那样打出的包，公文 PDF 会以替换字体渲染，写出的公文也不为收文方携带任何字体。 |
| `the Harness CLI is not built` | 第 1 步被跳过或只跑了一半。 |

## 需要真机的验收项

以下几项在构建机上验不了。请在装有 Office 的部署机上，针对打出的安装包执行：

1. `docx → pdf` 由 Office 而非 LibreOffice 承担。
2. WPS 能被探测到，并确认其自动化对象暴露的方法名。
3. 同时装有 Office 和 WPS 的机器上最终由谁胜出。
4. 只装 Word 未装 PowerPoint 的机器上的 `pptx → pdf`。
5. 转换被取消后没有残留的 `WINWORD.EXE`。
6. 带宏的 `.docm` 打开时不执行其中的宏。
7. 公文以正确字体经 LibreOffice 完成 `docx → pdf`。
8. 该 `.docx` 在一台从未安装过这三款字体的机器上用 Microsoft Word 打开，三款 GB/T 9704—2012 字体显示正确，且不提示缺字体。
9. 同一文件在 WPS 中打开。WPS 是否认 `w:embedTrueTypeFonts` 与 `word/fonts/*.odttf` 条目尚未验证，而整个内嵌方案正压在这个假设上。
10. 同一文件在第三台从未安装过本客户端的机器上打开——内嵌功能正是为这种情形而存在。
11. 收文方实际收到的文件体积。整字体，再加上 LibreOffice 为 SimHei 与 SimSun 所替换的字面，可能使 `.docx` 逼近 40 MB；OA 系统附件上限低于此数时，该部署关掉 `fontDirectory`，接受字体替换。
