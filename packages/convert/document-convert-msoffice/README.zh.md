# @deepseek-ai/dsh-document-convert-msoffice

[English](README.md) | 中文

把 Microsoft Office 和 WPS Office 接成 harness [文档转换 seam](../document-convert/README.md)（`ctx.documentConvert`）的转换提供方，在 Windows 上通过 COM 驱动。它转换的正是这两套办公套件所定义的格式——OOXML、旧版二进制格式、RTF——以及每个格式族到 PDF 的转换，用的是拥有该格式的应用程序本身，而不是对它的再实现。

这是一个**实现**包。它向 `ctx.documentConvert` 注册提供方，不拥有该键，也不注册面向模型的工具。它是函数／命名空间插件（`inject: ['documentConvert', 'subprocess']`）。

本插件在所有平台上都会挂载。在非 Windows 平台上，以及在两套套件都没装的 Windows 机器上，六个提供方全部注册为不可用，seam 会绕开它们规划路线——与一台没装 LibreOffice 的机器是同一种结果。

## 六个提供方，而不是两个

`available()` 属于提供方而非路由，而 Office 是按应用程序分别安装的：一台机器可以只有 Word 而没有 PowerPoint。每套套件的每个应用程序各占一个提供方，正是这样的机器才能保住 Word 的那些路由，而不是全部失去。

| 提供方 | ProgID | `LocalServer32` 必须指向 | 优先级 |
|---|---|---|---|
| `msoffice-word` | `Word.Application` | `winword.exe` | 30 |
| `msoffice-excel` | `Excel.Application` | `excel.exe` | 30 |
| `msoffice-powerpoint` | `PowerPoint.Application` | `powerpnt.exe` | 30 |
| `wps-writer` | `KWPS.Application` | `wps.exe` | 25 |
| `wps-spreadsheets` | `KET.Application` | `et.exe` | 25 |
| `wps-presentation` | `KWPP.Application` | `wpp.exe` | 25 |

Microsoft Office 排在 WPS 之上，两者又都排在 [`dsh-document-convert-libreoffice`](../document-convert-libreoffice/README.md)（10）之上。两套套件都装的机器走 Microsoft Office，只装 WPS 的机器走 WPS，都没装则回落到 LibreOffice。三个排序值在每条路由上都互不相同，因此 seam 永远不会报出路由歧义。

## 路由，以及刻意排除的部分

- **文档族**：源为 `doc`、`docx`、`rtf`、`txt`；目标为 `pdf`、`doc`、`docx`、`rtf`（13 条路由）。Microsoft Word 另外把 `pdf` 作为源，转成 `doc`、`docx`、`rtf`（再加 3 条路由；见 [Word 的 PDF 重排](#pdf-reflow-through-word)）。
- **电子表格族**：源为 `xls`、`xlsx`；目标为 `pdf`、`xls`、`xlsx`（4 条路由）。
- **演示文稿族**：源为 `ppt`、`pptx`；目标为 `pdf`、`ppt`、`pptx`（4 条路由）。

应用程序自有格式之间的每一条边都是 `faithful`，也都不带附注：它们都是应用程序在自己拥有的格式上原生完成的转换。有三组边被排除在外，每一次排除都是为了不让这个排序更高的提供方，抢走一条它会比原本承担者做得更差的路由。

- **OpenDocument（`odt`、`ods`、`odp`），作为源和作为目标都不做。** Word 的 ODF 导入是一次转换、不是一次读取：它会按自己的排版引擎重新回流文档。[公文工具](../tool-official-document/README.md)把符合 GB/T 9704—2012 的页面组装成 ODF 再交给本 seam，因此一条 Office 的 `odt` 边恰恰会悄悄重排那些以版面为要害的文档。所有 ODF 边都留给 LibreOffice，它是该格式的参考实现。
- **`html`，作为源和作为目标都不做。** Word 的 HTML 导出带着一堆别的消费方都不想要的 Office 专有标记。作为*源*更糟：Word 打开文档时会去解析 `<img src="http://…">`，在离线机器上这是一次没有任何诊断信息的卡死。[`dsh-document-convert-pandoc`](../document-convert-pandoc/README.md) 正是为这条边而安装的，而且做得更好。
- **`txt` 作为目标。** Word 的 `wdFormatUnicodeText` 写出的是 UTF-16，而 Excel 的 UTF-8 CSV 成员需要 Office 2016 及以上——回落到 `xlCSV` 写的是系统 ANSI 代码页，中文直接变成乱码。LibreOffice 对每个格式族的文本导出都是 UTF-8，所以这条边留在那里。`txt` 仍然可以作为*源*：Word 会以显式的 UTF-8 编码（`wdOpenFormatEncodedText` 配代码页 65001）读取它，而不是从字节里猜代码页。

<a id="pdf-reflow-through-word"></a>

## Word 的 PDF 重排

Word 2013 及以后的版本打开 PDF 时，会把它重建成一份 Word 文档（PDF Reflow）：段落、标题、表格和图片都成为 Word 自己的对象。这是唯一能产出「用户可以接着编辑的文档」的 PDF 导入方式。LibreOffice 的 [`writer_pdf_import`](../document-convert-libreoffice/README.md) 则把每一段文字放进各自的定位文本框；遇到 Chromium 打印出的 PDF，它还会把大约九分之一的汉字取成康熙部首码位（`方` 变成 `⽅` U+2F45），因为它读的是字形自带的映射，而不是 poppler 解析出的 Unicode 文字。所以在装有 Word 的机器上，`pdf → doc`/`docx`/`rtf` 归 Word，在步数相同的情况下排在 LibreOffice 的文本框导入之前。

这几条路由是 `lossy`，每个结果都带 `PDF_REFLOWED_BY_WORD`：重建出来的是 Word 对页面的估计，换行、表格边框和间距可能与原件不同，复杂的页面仍可能部分变成文本框。文档经由与其他源相同的 `Documents.Open` 调用以只读方式打开，因此 Word 的「是否转换此 PDF？」提示被 `ConfirmConversions = $false` 压掉，不会卡住转换。

WPS 文字不声明 `pdf` 源。它的对象模型能否打开 PDF 尚未验证，而一条在每台 WPS 机器上都失败的路由会排在 LibreOffice 那条能用的路由之前；只装了 WPS 的机器仍走 LibreOffice 的导入。

## 探测读的是类服务器，而不只是 ProgID

apply 期的一次 PowerShell 运行同时回答选路所需的两个问题，而第二个问题正是这次探测存在的理由。

1. **装了没有？** `[Type]::GetTypeFromProgID($id)` 通过注册表解析 ProgID，*不会启动应用程序*，这正是探测负担得起的原因：seam 要求 `available()` 廉价且同步，所以每个提供方在这里采样一次，之后返回缓存的结论。
2. **真正应答的会是哪套套件？** WPS 安装时常把自己注册成 `Word.Application`，而 seam 只校验一次转换产出了目标类型的文件——不校验是哪个应用程序产出的。因此探测会读取该类的 `LocalServer32`，也就是 COM 将要启动的命令行，先查 `HKCU:\SOFTWARE\Classes\CLSID`、再查 `HKLM:`（按用户安装的 Click-to-Run 只在 `HKCU` 注册，只查机器配置单元会把它误判为拒绝使用）。没有这一步，整个优先级排序就只是猜测，`msoffice-word` 会去驱动 WPS，同时报告跑的是 Microsoft Word。

ProgID 被另一套套件占住时，对应提供方会被禁用并按名记入日志，因为这台机器确实装了 Office，而转换仍会回落到 LibreOffice——否则这与根本没装 Office 无从分辨。ProgID 能解析、但 `LocalServer32` 读不到时同样拒绝：运行一个身份不明的转换器，正是这次探测要防的结果。

## 宏不会执行

`$app.AutomationSecurity = 3`（`msoAutomationSecurityForceDisable`）在打开任何文档之前设置，并由脚本自己断言——应用程序没有接受该设置时脚本以非零退出。否则用 COM 打开一个不受信任的 `.doc` 或 `.docm` **会执行其中的宏**。这是本包唯一的安全不变式，因此它是固定的，不可配置。

## 本提供方固化的四条 COM 自动化特性

1. **Office 进程不是该 shell 的子进程。** `WINWORD.EXE` 是一个 COM 服务器：杀掉 PowerShell 并不会结束它。脚本在打开文档*之前*把自己启动的进程 id 写入一个 sidecar 文件——用文件而不是 stdout，因为被杀死的进程可能还没有 flush。提供方在 `finally` 里读这个文件，仅当运行没有干净退出时才对这些 id 执行 `taskkill /T /F /PID`，因此用户原本开着的应用程序绝不会被碰到。
2. **用户原本开着的应用程序不得被重新配置。** 所有窗口与提示设置，以及 `Quit()` 本身，都只在本次转换启动了该进程时才施加。
3. **PowerPoint 的驱动方式与另外两个不同。** 它拒绝 `Application.Visible = $false`，改为用 `WithWindow = msoFalse` 打开演示文稿来实现无界面驱动；它的 `DisplayAlerts` 取 `PpAlertLevel`，其中「不提示」的成员是 `ppAlertsNone = 1`，而不是那个用来让 Word 闭嘴的 `0`。Excel 则根本无法通过 `SaveAs` 写 PDF——`XlFileFormat` 没有 PDF 成员——所以 PDF 走 `ExportAsFixedFormat`。
4. **一个应用程序一次只转换一份文档。** 每个提供方各持一条队列；针对同一应用程序的并发 `convert()` 调用会被串行化。

输出先写进一个私有临时目录，之后再移动到调用方指定的路径，因此失败的运行不会在目的地留下半个文件。报告成功却没有产出文件的运行按失败处理。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `shellBinary` | `powershell` | 裸 PATH 名称或绝对路径。默认取 Windows PowerShell 5.1，因为 Office COM 互操作在它上面经过最充分的实践，且它在每一个 Windows 安装中都存在，而 PowerShell 7 属于可选安装。脚本以单个 `-Command` 参数传入，不受执行策略限制，因此禁止运行脚本文件的域管机器同样可用。 |
| `workDir` | `os.tmpdir()` | 每次转换所创建的临时目录的父目录。 |
| `msofficePriority` | `30` | Microsoft Office 路由的排序值，数值大者胜出。 |
| `wpsPriority` | `25` | WPS Office 路由的排序值。必须与 `msofficePriority` 不同：两套套件以相同保真度声明相同的边，所以相等的排序值会让同时装有两套套件的机器陷入 seam 会以 `CONVERT_ROUTE_AMBIGUOUS` 拒绝的平局。本插件在加载时就拒绝这种配置，而不是等用户的某次转换去发现它。 |
| `graceMs` | `3_000` | 转换被取消时 SIGTERM→SIGKILL 的宽限期。 |

## 模型体验

通过 [`dsh-tool-document-convert`](../tool-document-convert/README.md) 间接影响；该工具在渲染进 `convert_document` 结果的执行路由中点出选中的提供方；COM 对象模型、探测过程和进程机制则不对外暴露。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

## 已知限制与暂缓事项

- **WPS 方言未在真实安装上验证**：WPS 以自己的 ProgID 再实现了 Microsoft 的那几套对象模型，而这里采用的导出方法名与格式常量，取的是它自称与 Office 兼容的那一套——并未在硬件上确认。名称不对时会以 `CONVERT_PROVIDER_FAILED` 暴露，并带上 COM 的错误文本，其中会点出那个不存在的方法。WPS 是否认 `AutomationSecurity` 同样未经确认，因此不应把只装了 WPS 的机器视为落实了上文那条宏安全不变式。
- **需要交互式 Windows 桌面会话**：以 Windows 服务身份运行时，Office 的 COM 自动化会失败。harness 作为桌面应用的子进程运行，因而继承了可用的会话；无界面部署或服务部署得到的是六个不可用的提供方，并回落到 LibreOffice。
- **没有按引擎的开关**：想在装有 WPS 的机器上无视 WPS 的管理员，必须在 seam 上钉住受影响的路由；本包没有「禁用 WPS」这样的键，因为只有 WPS 一套套件的机器，正是 WPS 提供方存在的理由。
- **路由表是声明出来的，不按文档逐份度量**：一条 `faithful` 边说的是该应用程序在这两种格式之间原生转换，而不是某一份具体文档完好通过了这次往返。
- **PDF 重排未在硬件上验证**：这几条路由、它们排在 LibreOffice 之前的顺序以及那条附注，都在 Linux 上对着脚本化的 PowerShell 做了覆盖；但 Word 重排某一份 PDF——尤其是带 Type 3 中文字体、由 Chromium 打印出的 PDF——得到的是真表格还是文本框，只能在装有 Word 的 Windows 机器上检查。`tests/real-office.spec.ts` 会把一份 Word 自己写出的 PDF 往返一遍，它只在那里运行。
- **只支持与宿主共享文件系统的执行**：本提供方通过 `ctx.subprocess` spawn，并用 `node:fs` 移动文件，因此它服务于进程世界与 harness 文件系统同为一个的组合。远端执行世界需要自己的提供方。
