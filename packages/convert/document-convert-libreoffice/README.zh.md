# @deepseek-ai/dsh-document-convert-libreoffice

[English](README.md) | 中文

harness [文档转换 seam](../document-convert/README.md)（`ctx.documentConvert`）的 LibreOffice headless 转换提供方。它覆盖办公格式族：文档格式、电子表格格式、演示文稿格式，以及其中每一种到 PDF 的转换。

这是一个**实现**包。它向 `ctx.documentConvert` 注册提供方，不拥有该键，也不注册面向模型的工具。它是函数／命名空间插件（`inject: ['documentConvert', 'subprocess']`）。

## 路由表出自实测

`LIBREOFFICE_CONVERSIONS` 中的每一条都由实际转换验证得出，而不是从文档里读来的。做法是在每种源格式的 fixture（测试前置数据）中放入一个唯一标记，执行转换，再按目标格式所用的每种编码在输出中搜索该标记。

这套方法不是吹毛求疵。对若干它其实做不到的转换，`soffice` 照样以 0 退出，并写出一个结构合法的文件：

| 请求的目标 | 它实际写出的东西 |
|---|---|
| 文本 → `pptx` | 一份 2 KB、完全不含幻灯片的演示文稿 |
| 文本或 Writer 文档 → `odp` | 一份顶着 `.odp` 文件名的 ODF **文本**文档 |
| PDF → `odt` | 一份顶着 `.odt` 文件名的 ODF **图形**文档 |
| `ppt`/`pptx` → `html` | 一个丢掉了幻灯片文字的 XHTML 文件 |

这些都没有进入路由表。扩展该表时请沿用同一套方法：凡是输出未能以目标格式的真实类型承载源文档内容的候选项，一律拒绝。

## 过滤器显式指定，且取决于源格式族

每次转换传入的是 `<ext>:<filter>`，而不是裸扩展名。这是必需的，不是装点门面：对 HTML 源文件，裸写 `--convert-to docx` 会以 `Error: no export filter` 失败，而对同一份输入指明 `docx:Office Open XML Text` 就能成功。

过滤器取决于由哪个应用程序加载该文档：源文件来自 Writer 时，`html` 是 `HTML (StarWriter)`；来自 Calc 时则是 `HTML (StarCalc)`。HTML 源文件以 Writer/Web 方式加载，同样由 Writer 的过滤器服务，因此该格式族不需要单独的 Writer/Web 一列。

## 路由

- **文档族**：`doc`、`docx`、`odt`、`rtf`、`txt`、`html` 之间互转，并可转为 `pdf`。转*入* `txt` 的路由是 `lossy`（只有字符幸存，别无其他）；从它转*出*的路由是 `faithful`，因为纯文本已经没有更多可丢失的东西。
- **电子表格族**：`xls`、`xlsx`、`ods` 之间互转，并可转为 `html` 和 `pdf`。其文本导出走的是 CSV：只有一张工作表、只有值，因此是 `lossy`。
- **演示文稿族**：`ppt`、`pptx`、`odp` 之间互转，并可转为 `pdf`。只声明了 `odp → html`，因为 XHTML 导出能带出 Impress 原生文档的幻灯片文字，却会悄悄丢掉由 `ppt`/`pptx` 导入而来的文字；后两者改以 `odp` 为中转、按两步方案抵达 HTML，而不是走一条只对一种源格式有效、对其他源格式悄然失败的路由。
- **通往电子表格的桥**：`txt → ods`/`xlsx`/`xls`，做法是强制使用 Calc 的 CSV 导入过滤器。它们是文档族文件抵达电子表格族的唯一途径，并且按其构造必然是 `lossy`：文本被重新解释为带分隔符的数据，于是成段文字变成单独一列。
- **PDF 作为源**：只有 `pdf → html`，即先用 LibreOffice 的 Draw 导入、再用它的 HTML 导出。它取回文本并丢弃版面，这已是此处任何经 Draw 中转的 PDF 路由所能达到的上限。[`dsh-document-convert-poppler`](../document-convert-poppler/README.md) 做得更好，排序也在它之上。

## 本提供方固化的三条 `soffice` 特性

1. **headless 运行需要自己的用户配置文件**：共用默认配置文件的第二个实例会拒绝启动，因此每次转换都传入指向私有目录的 `-env:UserInstallation`。没有它，并发转换会以不确定的方式失败。
2. **输出文件名无法指定**：`--convert-to` 把 `<source stem>.<ext>` 写入 `--outdir`，且不提供命名参数，因此每次运行都转换到一个私有暂存目录，随后再把结果复制到调用方给出的路径。这同时也让失败的运行不会在目标位置留下残缺文件。
3. **退出码不可信**：一次运行成功与否，由预期输出文件是否存在来判断，而不是只看退出状态。

## 损坏的容器在转换器看到之前就被拒绝

`.docx`、`.xlsx`、`.pptx` 和 OpenDocument 文件都是 ZIP；由跳过校验和的工具写出的这类文件，其中的条目明明存有数据，却声称 CRC 为零。Word 打开这种文件毫无怨言；LibreOffice 则拒绝它，并报告一个既不指出条目、也不指出原因的笼统失败，于是调用方会不断重试一次不可能成功的转换。

因此，趁自己掌握的信息仍多于转换器的诊断所能给出的，提供方先读取容器并指明损坏：报 `CONVERT_SOURCE_DAMAGED`，并列出有问题的条目（先列前三个，再给出总数）。该预检最多只读取源文件的 `MAX_PREFLIGHT_BYTES`（64 MiB）；更大的文件直接交给转换器，由转换器自身的失败来指明它。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `binary` | `soffice` | 裸 PATH 名称或绝对路径。macOS 上把 `soffice` 保留在应用程序包内的安装方式需要写 `/Applications/LibreOffice.app/Contents/MacOS/soffice`。 |
| `workDir` | `os.tmpdir()` | 每次转换所创建的私有用户配置文件目录和输出目录的父目录。 |
| `priority` | `10` | 与其他以相同保真度提供同一条路由的提供方并列时的裁决序位；数值越大越优先。 |
| `graceMs` | `3_000` | 转换被取消时从 SIGTERM 到 SIGKILL 的宽限期。 |

## 可用性

二进制程序在插件 apply 时通过 `ctx.subprocess.resolveExecutable` 解析一次；`available()` 返回缓存的结果，因为 seam 要求它廉价且同步。因此，没有装 LibreOffice 的机器得到的是一个已注册但不可用的提供方，由 seam 绕开它规划路由，而不是一次启动失败。

## 模型体验

通过 [`dsh-tool-document-convert`](../tool-document-convert/README.md) 间接影响；该工具在渲染进 `convert_document` 结果的执行路由中点出本提供方；过滤器、配置文件目录和进程机制则不对外暴露。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

## 已知限制与暂缓事项

- **路由表只是某一代 LibreOffice 的快照**：它是在 Linux 上针对 LibreOffice 25.8 验证的。过滤器名称或某个格式族的导出集合可能在版本之间变化，而构建过程察觉不到这一点：已声明的路由一旦失效，只会在转换时以 `CONVERT_PROVIDER_FAILED` 的形式暴露。抬高所支持的 LibreOffice 最低版本时，请用上述方法重新验证。
- **保真度按路由声明，而非按文档度量**：一条 `faithful` 边说的是该过滤器总体上保留结构，而不是某一份具体文档完好通过了它。文档若用到目标格式无法表达的功能，这些功能会丢失，而结果不会说明这一点。
- **冷启动是开销的大头**：一个进程中的第一次转换要承担 LibreOffice 的启动时间，量级是秒而不是毫秒；多步方案每一步都要再付一次，因为每个步骤都是独立的一次 `soffice` 运行。常驻监听（`--accept`）可以把这笔开销摊薄，但暂缓；它还会重新引入私有配置文件本就是为了避免的共享配置文件争用。
- **只支持与宿主共享文件系统的执行**：本提供方通过 `ctx.subprocess` spawn，并用 `node:fs` 移动文件，因此它服务于进程世界与 harness 文件系统同为一个的组合。远端执行世界需要自己的提供方。
