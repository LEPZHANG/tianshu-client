# @deepseek-ai/dsh-document-convert-poppler

[English](README.md) | 中文

把 poppler 的 PDF 提取工具用作 harness [文档转换 seam](../document-convert/README.md)（`ctx.documentConvert`）的转换提供方：`pdftotext` 与 `pdftohtml`。

这是一个**实现**包。它向 `ctx.documentConvert` 注册提供方，不拥有该键，也不注册面向模型的工具。它是函数／命名空间插件（`inject: ['documentConvert', 'subprocess']`）。

## 为什么提取才是关键

没有提取，PDF 里的文字就取不回来。LibreOffice 读取 PDF 有两条路：一条是导入 Draw，而 Draw 只能导出一张由定位文本框构成的画布，要它输出 `odt` 时写出的是一份顶着 `.odt` 文件名的 ODF **图形**文档；另一条是经 `writer_pdf_import`，它确实产出一份真正的文档，但其中每一段文字都各自待在一个定位框里。两条都保住了页面，都丢掉了行文。poppler 则把文本取回来，seam 再为它接上第二步，抵达 poppler 自身写不出的格式：`pdf → txt → xlsx`、`pdf → txt → ods`，等等。

因此，正是本包让转换矩阵在两个方向上都能触及 PDF，而且它是从 PDF 通往电子表格族的唯一途径。它的两条路由很小，它们解锁的东西不小。

## 两个提供方，而不是一个

两个工具各自注册，因此装了 `pdftotext` 却没装 `pdftohtml` 的机器能保住自己服务得了的那条路由，而不是两条都丢。

| 提供方 id | 路由 | 调用方式 |
|---|---|---|
| `poppler-pdftotext` | `pdf → txt` | `-layout`，保持阅读顺序和大致的分栏结构 |
| `poppler-pdftohtml` | `pdf → html` | `-s`（输出单份文档，而不是逐页文件）、`-i`（跳过图片，否则它们会作为独立文件写在输出旁边）、`-noframes`（输出普通文档，而不是框架集） |

两条路由都是 `lossy`：被丢弃的正是 PDF 的版面。

与 LibreOffice 不同，这些工具严格写入交给它们的那个输出路径，因此一个步骤就是一次 spawn，不需要暂存目录，也不需要重命名。

## 提取为空即失败，而原因很重要

只装有扫描图像的 PDF 会以 0 退出并写出一个空文件。提供方拒绝这种结果，而不是把一个读起来像是转换成功的空白文件交回去；但只凭空结果本身说明不了什么，因为有两种截然相反的情形都会产生它：页面本就是图像，从来没有文本可供提取；或者 PDF 中确有文本，而 poppler 读不出来。

这两种情形需要调用方作出相反的应对，因此提供方用 `pdffonts` 把它们区分开。没有嵌入任何字体的 PDF 没有文本层：报 `CONVERT_SOURCE_SCANNED`，消息说明这些页面必须先由 OCR 识读。确实嵌入了字体的 PDF 则报 `CONVERT_PROVIDER_FAILED`，消息说明它要么受保护、禁止提取，要么其文本所用的编码 poppler 无法映射回字符。`pdffonts` 缺失或给不出答案时，消息会同时列出两种原因，而不是挑定其中一种：诊断不可用时，付出的代价是措辞不够精确，绝不会是这次转换。

只有在结果已经为空时才会运行这项检查，因此成功的提取从不为它付出代价；大于 `MAX_EMPTINESS_CHECK_BYTES`（4 MiB）的结果则跳过它：这么多输出已足以证明确实取回了内容。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `pdftotextBinary` | `pdftotext` | 裸 PATH 名称或绝对路径。 |
| `pdftohtmlBinary` | `pdftohtml` | 裸 PATH 名称或绝对路径。 |
| `pdffontsBinary` | `pdffonts` | 裸 PATH 名称或绝对路径。仅在解释一次一无所获的提取时才会用到；它缺失，付出的代价是这段解释，绝不会是这次转换。 |
| `priority` | `20` | 两条路由通用的裁决序位。默认值高于 LibreOffice 的 `10`，使 `pdf → html` 走到这里的文本提取，而不是 LibreOffice 经 Draw 中转的导出。 |
| `graceMs` | `3_000` | 提取被取消时从 SIGTERM 到 SIGKILL 的宽限期。 |

## 可用性

每个二进制程序都在插件 apply 时通过 `ctx.subprocess.resolveExecutable` 解析一次；`available()` 返回缓存的结果，因为 seam 要求它廉价且同步。没有装 poppler 的机器得到的是已注册但不可用的提供方，由 seam 绕开它们规划路由。

## 模型体验

通过 [`dsh-tool-document-convert`](../tool-document-convert/README.md) 间接影响；该工具在渲染进 `convert_document` 结果的执行路由中点出这些提供方，并写明由此得到的 `lossy` 判定；命令行参数与进程机制则不对外暴露。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

## 已知限制与暂缓事项

- **没有 OCR**：扫描件 PDF 没有文本层，因此提取理所当然地一无所获，转换随之失败。要识读这类文档而不是拒绝它，需要一个 OCR 引擎，那是另一种依赖，也是另一个提供方。
- **提取取回的是文本，绝不是结构**：`pdftotext -layout` 用空格近似还原分栏，`pdftohtml` 输出带定位的片段；两者都无法把标题、表格或列表按其本来面目还原出来。因此 `pdf → xlsx` 方案得到的电子表格，取决于 CSV 桥如何理解那些空格，这也正是每条经由本包的路由都是 `lossy` 的原因。
- **不处理加密 PDF**：受密码保护的文档会带着 poppler 自己的诊断失败；这些提供方不接受密码选项，因为模型无处获得密码。
- **只支持与宿主共享文件系统的执行**：这些提供方通过 `ctx.subprocess` spawn，处理的是 seam 提供的路径，因此它们服务于进程世界与 harness 文件系统同为一个的组合。
