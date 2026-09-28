# Agent Note: 公文层次字体只落在标题上，开发版也携带字体

Status: implemented

[English](2026-09-28-official-document-level-faces-and-dev-fonts.md) | 中文

本篇接续[把公文字体带进工具写出的文档](2026-09-24-official-document-embedded-fonts.md)与 [GB/T 9704—2012 公文工具](2026-09-21-official-document-gb-t-9704.md)。它改变的是第一层、第二层段落的排法，以及桌面客户端到哪里找字体；这两篇里的其余决策全部不变。

## Problem

一位用户在桌面客户端里生成了一份公文，反馈版式不统一、有的字体根本不对。会话日志和文件本身显示出两个互不相关的原因。

**一款字体都没带进去。**结果里带的是 `OFFICIAL_DOC_FONTS_REQUIRED`，而不是 `OFFICIAL_DOC_FONTS_EMBEDDED`。那是一次开发版运行：`build/fonts` 里三款字体都在，但 `build/tools` 从没抓取过，而客户端只从 `<tools>/libreoffice/share/fonts/truetype` 推出 `DSH_OFFICIAL_DOCUMENT_FONTS`。于是这个变量没有设置，`fontDirectory` 为空，渲染结果的 `pdffonts` 只列出 `NotoSerifCJKsc-Regular` 和 `NotoSansCJKsc-Regular`：仿宋变成了衬线体，黑体变成了无衬线体，同样是正文却在两者之间来回切换。

**整段都用了层次字体。**模型把每个第二层条目写成 `（一）依赖专家知识，使用门槛较高。传统算法以细节点比对为主，……`——同一段里先是标题，后面接好几句正文。工具给整段套 `BodyLevel2` 样式，于是这一段的每句话都是楷体，而前后的普通段落是仿宋。这份公文三十九个段落里有二十三个是这样排的，即使字体都对，用户看到的也正是这种不统一。

## Decision

### 退回到桌面端自己的字体目录

`officialDocumentFontDirectory(toolsRoot, fontsDirectory)` 在工具集的字体目录存在时返回它，否则返回 `fontsDirectory`；客户端把后者设为 `desktopResourcePath('fonts')`，开发版里就是 `build/fonts`。运行时日志现在会写明从哪个目录嵌入字体，或说明一个都没找到，这样下一次静默降级会出现在 `harness.log` 里，而不是出现在用户的公文里。打包版不带 `resources/fonts`；那里和以前一样只有工具集这一份来源，缺字体的工具集照旧拒绝打包。

### 只有标题用层次字体

§ 7.3.3 规定层次序数用黑体或楷体；标题之后的句子属于正文，§ 5.2.2 规定正文用仿宋。第一层、第二层段落在第一个 `。`、`！`、`？`、`；`、`：` 或换行处切开——[放宽后的切分](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md)取代了本篇交付的「只认『。』」规则，而那正是本篇在下文提出并否决的备选：后面接有正文时，排成一个 `Body` 段落，只有标题是 `Level1Heading`（黑体）或 `Level2Heading`（楷体）文本段。第一个标点之后没有内容的段落，是单独成行的标题，仍用 `BodyLevel1` 或 `BodyLevel2`。第三层、第四层整段都是仿宋，不做切分。

## Testing

`tests/content.spec.ts` 断言两个层次的切分、不切分的独立标题，以及保持整段的第三层段落；`tests/odf.spec.ts` 断言两个文本段样式的东亚字体。`dsh-desktop/test/convert-tools.test.ts` 覆盖退回路径、工具集那份优先，以及两个目录都不存在时变量保持未设置。用户原来的那次调用已经用改后的代码、对着真实字体重放过一遍：`pdffonts` 列出 `FZXBSJW--GB1-0`、`FangSong_GB2312` 和 `KaiTi_GB2312`，每个第二层条目只有标题是楷体。

## Alternatives considered

**让模型把标题和正文分开写。**技能可以这样要求，但只要模型没照做，工具仍会把混排段落排错；排版归工具管，§ 7 的其他规则也都是如此。

**在任意一种句末标点处切分。**这样以「？」「！」结尾的标题也能切开，但开头恰好带这类标点的正文同样会被切开。实践中层次标题以「。」结尾，README 写明了这个限制。该备选已于 2026-09-28 落地，边界集合收缩为标题可以收尾的标点、并排除逗号；[放宽后的切分](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md)记录了此处点名的风险为何可以接受。

**把 `build/fonts` 也打进 `resources/fonts`。**这样打包版也能用上退回路径，代价是 11 MB 要打包两份；[前一篇](2026-09-24-official-document-embedded-fonts.md)正是出于同一理由否决了它。

## Consequences

第一层、第二层标题若首个标点是逗号、后面又接着正文，整段仍留在层次字体里；README 写明了这一点。[放宽后的切分](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md)补上了其余缺口。`BodyLevel1` 与 `BodyLevel2` 样式照旧输出，也照旧用于独立标题，所以本来就把标题单列的公文逐字节不变。

## Related

- [把公文字体带进工具写出的文档](2026-09-24-official-document-embedded-fonts.md)
- [GB/T 9704—2012 公文工具](2026-09-21-official-document-gb-t-9704.md)
- [Windows 上的 Office 转换](2026-09-24-windows-office-conversion.md)
