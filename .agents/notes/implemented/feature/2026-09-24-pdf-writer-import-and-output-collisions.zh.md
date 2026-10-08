# Agent Note: 保住页面的 PDF，与已被占用的输出文件名

Status: implemented

[English](2026-09-24-pdf-writer-import-and-output-collisions.md) | 中文

## Problem

一段会话记录、一个请求——通过 格式转换 技能把一份技术方案 PDF 转成 `.doc`——暴露出三处彼此独立的失败。

1. **工具调用返回了红色错误。**用户此前转过同一个文件，因此 `技术方案.doc` 已经存在，`convert_document` 以 `CONVERT_OUTPUT_EXISTS` 拒绝了本次调用。什么都没坏，什么都没有面临风险；用户看到的却是一张错误卡片。
2. **那份 `.doc` 是 38,400 字节的纯文字。**规划器当时从 PDF 通往文档族格式的唯一路由是 `pdf → txt → doc`：poppler 取回了字符，而等 LibreOffice 写出目标文件时，一份技术方案里的每一张示意图、截图和表格都已经不在了。
3. **重试跑了六分半。**在被告知效果不好之后，模型装了一个 Python PDF 库，开始自己写抽取程序——因为技能正文里没有任何一句话说这超出了边界。

这三者是相互独立的缺陷——一条策略、一条缺失的路由、一段没有边界的指令——但抵达用户时汇成了同一个印象：这个转换器不好用。

## Decision

### 输出文件名被占用时改名，而不是拒绝

`convert_document` 新增 `if_exists: 'rename' | 'overwrite' | 'refuse'`，默认 `rename`。它在已存在的文件旁边写出 `技术方案-1.doc`，绝不碰原文件，并把调用原本索要的路径作为 `renamed_from` 报出；渲染文本会要求模型把实际写出的名字告诉用户。`refuse` 为仍然需要旧行为的调用方保留了它，`overwrite` 则在明确要求下替换该文件。

那次拒绝读起来像一道安全提示，实际上不是。安全提示打断的是一个调用方可能并未预期其后果的动作；而这次打断的动作根本没有任何后果，因为工具早就决定不去碰已存在的那个文件。况且在模型尝试之前，没有任何东西告诉它某个路径已被占用：一次 `CONVERT_OUTPUT_EXISTS` 不是一个决策点，而是唯一可用的试探手段，用一次失败的工具调用去支付它，等于为一个工具本可以自行回答的问题，在用户面前摆上一张红卡片。

改名最多尝试 100 个备选名，之后以同一个错误码拒绝，因此一个满是同名文件的目录换来的是一句话，而不是无界的扫描。

### PDF 经 Writer 的导入抵达文档族格式

`document-convert-libreoffice` 声明了 `pdf → doc`、`docx`、`odt` 和 `rtf`，每一条都带 `importFilter: 'writer_pdf_import'`。页面看上去与原件相同，图片也带了过来。四条路由都是 `lossy`，并带有 `PDF_IMPORTED_AS_FRAMES`，把代价直说清楚：每一段文字都待在各自的定位框里，因此结果没有连贯的段落、没有真正的表格、也没有标题。`pdf → txt` 保持原样，仍是取回可编辑文字的那条路由。

规划器不需要任何改动。它优先取步数更少的方案，因此这些行一出现，一个已声明的单步路由就在这四对格式上顶掉了原来的两步抽取。

**这个导入过滤器是承重的，测试也按承重来对待它。**若听任 LibreOffice 自行其是，它会在 Draw 中打开 PDF，而一份 Draw 文档抵达文档族格式的结果要么是根本抵达不了——`pdf → docx` 会以 `Error Area:Io Class:Write Code:16` 失败——要么是一份顶着 `.odt` 名字的 ODF **图形**文档。在这里添加一行却不带 `writer_pdf_import`，得到的就是这两种失败之一披着一条已声明路由的外衣，因此 `provider.spec.ts` 在全部四行上断言该过滤器，而不是指望这张表自己保持正确。

### 技能正文规定了效果不佳时该怎么办

告诉模型这次转换是 lossy，和告诉它可以为此做什么，是两回事。格式转换 技能现在把应对方式限定为三种：换 `to`（文字才是要点时索要 `txt`）、换源文件（向用户索要原始 `.docx`，结构本来就在那里），或者如实说明这条路就是上限。它还写明 `convert_document` 是唯一的转换器——不装第三方库、不写解析脚本、不另外调一个命令行工具「手工再转一遍」——因为 LibreOffice、pandoc 和 poppler 本来就在它背后，临时拼出来的流程只会更慢、更差，而且无法复现。

## Testing

- `tool.spec.ts` 覆盖五种冲突结果：改名及其文字说明、在首个备选名也被占用时继续往下数、所请求路径空闲时不提改名、`refuse`、以及 `overwrite`。
- `provider.spec.ts` 在全部四行 `pdf` 路由上断言导入过滤器与那条 caveat。旧的「`pdf → odt` 不存在」断言已经删除——它记录的是只有 Draw 时的现实，现在已经过时。
- `real-converters.spec.ts` 对着真实的 `soffice` 运行：`pdf → docx` 的方案是一步 LibreOffice 转换并报出 `PDF_IMPORTED_AS_FRAMES`，写进源文件的标记也熬过了这一趟往返。第二个测试通过 LibreOffice 把结果读回来，而不是解压它，因为标记落在一个文本框里，要紧的是文档能把它渲染出来，而不是包里哪个成员存着它。
- 在真实安装上对四种目标格式逐一手工验证：`file(1)` 报出的是目标格式的真实类型（那份 `odt` 是 OpenDocument **文本**文档，不是图形文档），源文件的唯一标记都在，图片也都还在——`.doc` 是靠把它再转回 `odt`、找到 `Pictures/` 条目确认的。

## Alternatives considered

- **继续拒绝，并教会模型先自己检查。**没有可教的检查动作。模型得在每次转换前用另一个工具去 stat 那个路径，调用更多、延迟更高，而且照样有竞态。
- **默认覆盖。**它会毁掉一个用户从未交出来的文件，而且毁得无声无息——这是唯一比一张多余的错误卡片更糟的失败方式。
- **先抽取，再把图片插回去。**没有谁掌握版面位置。`pdftoimages` 能取回位图，取不回它们该在哪里，而一份只有文字的 `.doc` 里也没有可供它们归位的锚点。
- **引入 OCR 或版面分析提供方。**对「既要可编辑的文字、又要原有的结构」而言这是个真正的答案，但超出本轮范围：它意味着新的依赖、新的模型和一整套新的失败方式，而面对的是一条已声明路由就能解决的抱怨。

## Consequences

- 用户现在从 PDF 得到的 `.doc` 看起来就是那份 PDF，但不是可以接着改的行文。对于常见请求（「把这个给我弄成 Word」）这更好，对于「让我重写这份东西」则更差——这正是技能必须提供 `txt` 的原因，也是四条路由每一条都带着那条 caveat 的原因。
- Writer 的导入会把每一段文字在 `word/document.xml` 里存两遍，形式是一对 `mc:AlternateContent`：一个 DrawingML `mc:Choice` 和一个 VML `mc:Fallback`。因此对整个包做朴素的文字抽取会看到两份文字；阅读器只渲染一份。那条 caveat 有意不声称存在可见的重复，因为并不存在。
- [`tool-official-document`](../../../../packages/convert/tool-official-document/README.md) 仍然使用 `overwrite: boolean`。这处不对称是有意为之，并且严格限定在本轮所作的决定范围内；统一它属于下一次触碰那个工具的改动。
- 冲突检查仍然不是原子的——存在性在转换开始之前就已检测——这与它所替换的那道覆盖防护完全一样。堵上这个缺口需要一次独占创建握手，而 seam 的输出路径约定还表达不了它。

## Related

- [格式转换技能](2026-09-15-office-essentials-format-convert-skill.md)：本轮为之划定边界的技能正文，写成时 `pdf → txt → doc` 还是从 PDF 出来的唯一路由。
- [转换 seam 本身](../architecture/2026-09-15-document-conversion-capability-seam.md)：优先取步数更少的排序规则，正是它让新增的路由无需改动规划器就顶掉了旧方案。
- [输出校验与 pandoc](../architecture/2026-09-17-document-conversion-output-verification-and-pandoc.md)：为什么一条路由要由它产出的文件来证明——排除经 Draw 中转的 `pdf → odt` 靠的就是这一条。
- [Windows 上的 Office 转换](2026-09-24-windows-office-conversion.md)：这些路由所处的提供方排序；Office 没有声明任何以 PDF 为*源*的边，因此在任何地方服务这一对格式的都是 Writer 导入。
