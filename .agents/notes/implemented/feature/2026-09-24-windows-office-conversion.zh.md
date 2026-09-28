# Agent Note: 在用户真正使用的 Windows 机器上做文档转换

Status: implemented

[English](2026-09-24-windows-office-conversion.md) | 中文

## Problem

文档转换 seam 及其 LibreOffice 后端都已上线，而对本产品的用户来说，这两件事都不对：用户在 Windows 上，机器往往身处没有互联网的局域网中，而且这些机器上本来就装着定义了待转换格式的那个应用程序。

由此引出三个具体的失败。

1. **什么都没装。** LibreOffice、pandoc 和 poppler 都从 `PATH` 解析。一台崭新的 Windows 机器上它们一个都没有，于是每次转换都以「提供方不可用」失败，而错误里点出的那个可执行文件，用户根本无处下载。
2. **LibreOffice 不是 OOXML 的渲染器**，而是对它的再实现。一份带文本框、SmartArt、页码域或中文字体度量的 `.docx`，转出的 PDF 与 Word 显示的明显不同——而用户的 Word 就开在同一块屏幕上，随时可以对照。
3. **公文链路不能被重新排版。** [`tool-official-document`](../../../../packages/convert/tool-official-document/README.md) 把符合 GB/T 9704—2012 的页面组装成 ODF 再交给 seam。Word 的 ODF 导入会按自己的排版引擎重新回流文档，而这恰好会摧毁该工具存在的全部意义。

第 2 条和第 3 条的失败拉向相反的方向，这种张力正是整个设计要解决的问题：对 OOXML 更好的那个转换器，对公文链路产出的格式恰恰更差。

## Decision

### 随包工具包是下限

`scripts/fetch-convert-tools.mjs` 把 Windows x64 版的 LibreOffice、pandoc 与 poppler 下载到 `build/tools/`，安装包将它们放在 `resources/tools` 下随包分发，`harness-runtime.ts` 把这些目录前插进 Harness 子进程的 `PATH`。因此在一台从未联网、也没有任何办公套件的机器上，转换依然可用。

四款公文字体（方正小标宋简体、仿宋_GB2312、楷体_GB2312、黑体）备在 `build/fonts/` 下，而 `.gitignore` 排除了该目录——它们是商业授权字体，不得进入公开仓库。它们的 family name 是逐字与 `odf.ts` 中的常量核对过的，而不是假定的；后来[内嵌字体](2026-09-24-official-document-embedded-fonts.md)把这份一致性变成了运行时匹配，并让同一批文件多了第二个用途：客户端把它们所在的目录交给 Harness，由后者复制进它写出的每一份公文。工具包缺少 Windows 不自带的那三款时打包会被拒绝，因为 LibreOffice 替换字体时什么也不报：公文 PDF 以错误的字体排版，而每一步都成功。`npm run package:win:no-fonts` 是一次构建声明自己接受这种替换的方式。

### Office 与 WPS 是上限，作为独立的提供方包

`packages/convert/document-convert-msoffice` 注册六个提供方——Word、Excel、PowerPoint 与 WPS 文字、表格、演示——由一段 PowerShell 脚本通过 COM 驱动。是六个而不是两个，因为 `available()` 属于提供方，而 Office 是按应用程序分别安装的：一台有 Word、没有 PowerPoint 的机器得以保住 Word 的那些路由。

Microsoft Office 排 30，WPS 排 25，LibreOffice 排 10。seam 的规划器先比保真度、再比优先级，因此别的地方一处都不用改：Office 能服务的路由归 Office，它没有声明的路由则落给声明了的那一方。

**那些排除项是机制，不是缺口。** Office 在两个方向上都不声明 `odt`／`ods`／`odp` 边，这正是让公文链路留在 LibreOffice 上、而无需钉死任何一条路由的原因。它不声明 `html` 边（Word 的导出带着 MSO 专有标记，而作为*源*时 Word 会去解析远端 `<img>` URL——在离线机器上就是一次没有诊断信息的卡死），也不声明 `txt` 作为*目标*（Word 写出 UTF-16；Excel 的 UTF-8 CSV 成员需要 Office 2016 及以上，而回落到 `xlCSV` 写的是 ANSI 代码页，中文会变成乱码）。剩下的——13 条文档、4 条电子表格、4 条演示文稿路由——全都是应用程序同时拥有两端格式的边，因此它们都是 `faithful`，也都不带附注。

### 探测要读类服务器，因为 ProgID 会说谎

WPS 安装时常把自己注册成 `Word.Application`，而 seam 校验的是结果是否为目标类型的文件——不校验是哪个应用程序产出的。因此只查 ProgID 会让 `msoffice-word` 去驱动 WPS，同时报告跑的是 Microsoft Word，上面那套优先级排序也就成了虚构。

于是 apply 期的一次 PowerShell 运行为全部六个 ProgID 同时读出两项事实：`[Type]::GetTypeFromProgID` 通过注册表解析类而不启动应用程序（seam 要求 `available()` 廉价且同步，所以结论只采样一次并缓存），而 `HKCU:\SOFTWARE\Classes\CLSID` 及随后 `HKLM:` 下的 `LocalServer32` 给出 COM 真正会启动的命令行。`HKCU` 排在前面，因为按用户安装的 Click-to-Run 只在那里注册。

被占用的 ProgID 只禁用对应的那一个提供方，并按名记入日志——这台机器确实装了 Office，转换会悄悄回落到 LibreOffice，而这与根本没装 Office 无从分辨。`LocalServer32` 读不出来的 ProgID 则被拒绝而非启用，因为运行一个身份不明的转换器，正是这次探测要防的结果。

### 宏的执行是固定的不变式

用 COM 打开一个不受信任的 `.doc` 或 `.docm` **会执行其中的宏**。脚本在打开任何东西之前设置 `$app.AutomationSecurity = 3`（`msoAutomationSecurityForceDisable`），并在脚本内部断言它，应用程序没有接受就以非零退出。它不是 Config 字段：不存在哪种部署会认为「执行被转换文档里的宏」是正确的。

### Office 进程不是该 shell 的子进程

`WINWORD.EXE` 是一个 COM 服务器，杀掉 PowerShell 会把它留在那里继续运行。脚本在打开文档*之前*把自己启动的进程 id 写入一个 sidecar 文件——用文件而不是 stdout，因为被杀死的进程可能还没有 flush——提供方在 `finally` 里仅当运行没有干净退出时才对这些 id 执行 `taskkill /T /F /PID`。用户原本开着的应用程序不会被记录任何 id，因此绝不会被碰到、重新配置或退出。

## Testing

`registerOfficeProviders(ctx, { platform, … })` 把平台作为参数传入，而不是去读 `process.platform`，正是这一点让 Linux CI 机器能够走通唯一真正有事发生的那条代码路径。在它之上还有：证明 Office 胜出、只有 WPS 时 WPS 胜出、只装 Word 的机器在 `pptx` 上回落、以及三个 Microsoft 应用程序全在时 `odt → pdf` 仍留在 LibreOffice 的选路用例；探测的 WPS 劫持用例；对全部六个应用程序的宏安全断言；失败时与取消时基于 PID 的收尾，以及干净退出后不做收尾；还有针对同一应用程序的并发转换被串行化。

脚本化的 subprocess 后端看不到本提供方的输出路径，因为那是 `-Command` 脚本内部的一次变量赋值，而不是一个 argv 元素。`officeOutputPath` 从脚本里把 `$output = '…'` 解析回来，这同时也证明了该路径是作为一个 PowerShell 字面量、并把其中的引号成对加倍后写出的。

`tests/real-office.spec.ts` 跑的是真东西，除非探测到已安装的文字处理程序否则整块跳过，因此除了装有办公套件的 Windows 机器，它在别处都是空操作。

## Alternatives considered

**用 Office 取代 LibreOffice。** 因第 3 条失败而否决：公文链路的 ODF 会被 Word 重新排版，而没有任何办公套件的机器则会彻底失去转换能力。LibreOffice 留作兜底，并保有全部 ODF 边。

**让公文直接产出 OOXML，好让 Office 能服务它。** 否决：这是另一件量级大得多的改动——要重写 `odf.ts`——而一旦 Office 不声明任何 ODF 边，它也就没有必要。

**声明 ODF 边，并在 bundle 配置里钉住 `routes` 把它们留给 LibreOffice。** 否决：钉住属于部署配置，用户自己的 cordis.yml 可以把它去掉，从而悄悄把重新排版放回来。不声明这条边则是包自身的性质。

**先只支持 Microsoft Office，等 WPS 的 COM 方言能在硬件上确认后再加。** 这曾是我的建议；用户选择在同一轮里一并支持 WPS。因此 WPS 的导出方法名与格式常量都是记录为未经验证的种子值，名称不对时会以 `CONVERT_PROVIDER_FAILED` 失败并带上 COM 的错误文本，其中会点出那个不存在的方法。

**每套套件一个提供方，由 `available()` 按路由作答。** 做不到：seam 把 `available()` 定义在提供方上。对于应用程序各自独立安装的厂商，六个提供方正是 seam 自己规定的答案。

**PowerShell 7（`pwsh`）。** 否决：Windows PowerShell 5.1 在每一个 Windows 安装中都存在，且它的 Office COM 互操作经过最充分的实践。脚本以单个 `-Command` 参数传入，不受执行策略限制，因此域管机器同样可用。

**把 `Get-Process` 的前后差异写到 stdout，而不是 sidecar 文件。** 否决：真正需要这些 id 的情形恰恰是 shell 被杀死的情形，而被杀死的进程的 stdout 可能永远不会送达。

## Consequences

随包工具包在安装包里约占 400 MB，而三个被钉住的工具版本号是未经验证的种子值——本机没有网络，因此 `fetch-convert-tools.mjs` 必须在 Windows 构建机上以 `--trust-on-first-use` 跑一次，把真实校验和记录下来。

有七项检查只能在 Windows 硬件上做，此处没有做：由 Office 选中的 `docx → pdf`；WPS 的探测*以及*方法名的确认；双套件并存时的劫持判定；只装 Word 时 `pptx → pdf` 的回落；取消之后没有残留的 `WINWORD.EXE`；带宏的 `.docm` 不执行其中的宏；以及公文的 `docx → pdf` 走 LibreOffice 且字体正确。

harness 以 Windows 服务身份运行的部署会得到六个不可用的提供方，因为 Office 的 COM 自动化在交互式桌面会话之外会失败。这是正确的结果，也不是回退——它就是已经上线的「只有 LibreOffice」的行为——但这意味着桌面应用的进程模型对本包是承重的。

没有按引擎的开关。想在装有 WPS 的机器上无视 WPS 的管理员，必须在 seam 上钉住受影响的路由，因为只有 WPS 的机器正是 WPS 提供方存在的理由。

## Related

- [seam 本身](../architecture/2026-09-15-document-conversion-capability-seam.md)：路由规划器「先保真度、后优先级」的排序，使本轮成为一次纯声明式的改动。
- [产出校验与 pandoc](../architecture/2026-09-17-document-conversion-output-verification-and-pandoc.md)：为什么提供方的退出码不算证据——这也是本包以产出的文件来判定一次运行的原因。
- [公文工具](2026-09-21-official-document-gb-t-9704.md)：那些排除项所保护的、产出 ODF 的生产者。
