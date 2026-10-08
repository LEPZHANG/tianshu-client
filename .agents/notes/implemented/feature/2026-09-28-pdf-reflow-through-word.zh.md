# Agent Note: 由 Word 自己把 PDF 变成可编辑的 Word 文档

Status: implemented

[English](2026-09-28-pdf-reflow-through-word.md) | 中文

本篇接续[保留页面的 PDF](2026-09-24-pdf-writer-import-and-output-collisions.md) 与 [Windows 上的 Office 转换](2026-09-24-windows-office-conversion.md)。它在装有 Microsoft Word 的机器上把 Word 加为 `pdf` 源；其他机器仍走 LibreOffice 的 Writer 导入。

## Problem

一位用户把一份 9 页、由 Chromium 打印出的 PDF 转成 Word，转了两次，两次的结果都被判为很差。

**第一次走的是 Writer 导入，结果全是文本框。**`convert_document` 按前一篇的决策选了 `writer_pdf_import`。产出的 `.docx` 没有 `<w:tbl>`、没有标题样式，却有 1,124 个文本框内容；在本机重新渲染时，表格只剩空网格线。更糟的是，11,222 个汉字里有 1,256 个是康熙部首码位——`方` 成了 `⽅` U+2F45，`一` 成了 `⼀` U+2F00——所以搜「方案选型」什么也搜不到。对同一份 PDF 跑 poppler 的 `pdftotext`，这类码位一个都没有，可见毛病出在 LibreOffice 的导入读取的是每个 Type 3 字形自带的映射，而不在 PDF 的文字本身。

**第二次是模型凭记忆重建了文档。**用户说「再转一下」，模型就凭它对前面某一轮的记忆重新写出 Markdown 源，用 headless Chrome 渲染图表，再跑 pandoc。文件结构是有了，但那是模型的文字，不是用户的文档，结果里也没有任何说明。

## Decision

### 装有 Word 的机器由 Word 重排 PDF

Word 2013 及以后的版本会把打开的 PDF 重建成一份 Word 文档：段落、标题、表格和图片都成为 Word 自己的对象。`officeRoutes()` 现在接收引擎参数，对文档族的 `msoffice` 以提供方的排序值加上 `pdf → doc`、`pdf → docx`、`pdf → rtf`。它们和 LibreOffice 的一样是单步路由，因此由 Word 更高的排序值决定。这几条路由是 `lossy`，每个结果都带 `PDF_REFLOWED_BY_WORD`，提示表格和图表需要核对。源文件经由与其他源相同的只读 `Documents.Open` 打开，其中 `ConfirmConversions = $false` 压掉了 Word 的重排提示。

WPS 不声明 `pdf` 源：它的 PDF 导入未经验证，而一条在每台 WPS 机器上都失败的路由会排在 LibreOffice 那条能用的路由之前。`pdf → odt` 留在 LibreOffice，因为 Office 路由表整体排除了 ODF。

### 文本框附注点明码位问题

`PDF_IMPORTED_AS_FRAMES` 现在会说明部分汉字可能被取成形似的部首符号、搜索可能漏词，这样模型转述时就会告诉用户这个问题，而不是等用户自己搜的时候才发现。

### 技能禁止凭记忆重写内容

`format-convert` 技能按附注代码描述 PDF 的两种结果，并加了一条规则：绝不凭记忆或对话上下文重新生成文件内容；源文件不在了就如实说，请用户重新提供。

## Testing

`tests/conversions.spec.ts` 断言三个重排目标、它们的 `lossy` 保真度，以及 WPS 和其他格式族都不会多出 `pdf` 源。`tests/provider.spec.ts` 断言 `pdf` 步骤返回 `PDF_REFLOW_CAVEAT`，且只有 Word 的提供方声明这些路由。`tests/plugin.spec.ts` 断言 seam 面对一条同为 LibreOffice 排序值的 `pdf → docx` 时选 `msoffice-word`，只装 WPS 时仍选 LibreOffice。`tests/real-office.spec.ts` 把一份 Word 自己写出的 PDF 往返转成 `rtf`，检查标记文字和附注；它只在装有 Word 的 Windows 上运行。

## Alternatives considered

**用 poppler 的文字框自建 PDF 重排引擎。**这能覆盖所有平台，但从画出来的线条还原表格、从行位置还原段落，是一个版面分析工程，复杂页面上的效果没有把握。Word 已经做到了，而这个产品的用户都在装有 Office 的 Windows 上。

**在 LibreOffice 导入之后把部首码位映射回汉字。**这能修好文本框导入里的搜索，但结果仍然是文本框；如果没有 Word 的机器变得重要，可以另外再做。

## Consequences

重排尚未在硬件上验证。Word 能否把这一份 PDF——带 Type 3 中文字体的 Chromium 输出——转出真正的表格，是最大的未决问题，应列入 Windows 验收清单。Word 重排一份大 PDF 可能要几十秒，仍在默认的工具预算之内。只装 WPS 或两者都没装的机器，拿到的仍是带码位问题的文本框导入。

## Related

- [保留页面的 PDF，以及已被占用的输出文件名](2026-09-24-pdf-writer-import-and-output-collisions.md)
- [Windows 上的 Office 转换](2026-09-24-windows-office-conversion.md)
- [文档转换能力 seam](../architecture/2026-09-15-document-conversion-capability-seam.md)
