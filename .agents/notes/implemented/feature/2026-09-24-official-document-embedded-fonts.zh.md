# Agent Note: 把公文字体随文档一起带走

Status: implemented

[English](2026-09-24-official-document-embedded-fonts.md) | 中文

本篇推翻 [GB/T 9704—2012 公文工具](2026-09-21-official-document-gb-t-9704.md)记下的一条后果——没有哪种格式能补上一台机器缺失的字体——并把 [Windows 转换那一轮](2026-09-24-windows-office-conversion.md)备好的字体用在第二个用途上。两篇里的其余决策一概不变。

## Problem

GB/T 9704—2012 规定了五款字体，其中三款是 Windows 自己不带的：方正小标宋简体、仿宋_GB2312、楷体_GB2312。工具只把这些名字写进文件，并在每次结果里说明：缺少这些字体的机器会替换成别的字体。对本产品的用户来说，这不是一条注意事项，而是常态：他们在一台从未见过这些字体的机器上用 Word 或 WPS 打开文件，而替换是静默发生的——版面精确到毫米，字形却是错的，链路上每一步都报告成功。

在一台未安装这三款字体的机器上实测，同一份公文分别以嵌入和不嵌入两种方式转出：对照组的 PDF 经 `pdffonts` 只列出 `NotoSansCJKsc-Regular` 与 `NotoSerifCJKsc-Regular`，一款替换字体顶替了标准点名的全部五款。

上一篇把这件事称为做不到。它做得到，而那条断言从未被验证过：OpenDocument 以包内条目携带字体文件，OOXML 以混淆过的 `word/fonts/*.odttf` 条目携带字体文件，而 LibreOffice 会把前者翻译成后者。

## Decision

### 字体来自部署点名的一个目录

这些字体是商业授权字体，不能进入公开仓库——`dsh-desktop/.gitignore` 已排除 `build/fonts/`——因此插件在 apply 时从磁盘读取它们。`tool-official-document` 新增 Config 字段 `fontDirectory`，默认为空；base bundle 沿用仓库既有的 `!!js` 写法把 `DSH_OFFICIAL_DOCUMENT_FONTS` 喂进去，而桌面客户端的 `buildHarnessSpawnOptions()` 把该环境变量设为 `bundledFontDirectory()`——也就是它自己安装包里早已存在的那些字体，位于随包 LibreOffice 的 `share/fonts/truetype` 之下。同一批文件如今有两个用途：随包 LibreOffice 用它们渲染，每份公文再带走一份副本。

安装包里不另存第二份。`fontDirectory` 为空时，工具写出的字节与本次改动之前逐字节相同；对于阅读方都装有这些字体的部署，这才是正确的行为。

### 整字体，不做子集化

子集只含公文已经用到的那些字。它能把 `.docx` 从约 8.5 MB——也就是此处实测的 14.6 MB 减去[集合与重复字体](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md)现已移除的重复部件——压到约 1.0 MB，而收文方在 Word 里新打的第一个不在子集内的字就会以替换字体呈现——等于把缺陷重新引入，且正好引入在用户最容易看见的地方。用户选择承担体积而不接受这个边界，因此工具从不做子集化。

### 安装包不碰系统字体库

只嵌入，不安装：没有管理员提权，卸载不留残留；而最重要的一条是，文档转发给从未安装过本客户端的同事时，字形依然正确。

### 由 `fsType` 判定，Restricted 一律拒绝

字体的 OS/2 表声明了它的授权允许怎样嵌入。`readFontEmbedding()` 以 `0x000f` 取出权限位：`0x0002`（Restricted）被拒绝、在结果备注里点名，该字族退回只写名称。三款公文字体分别是 `0x0008`（Editable）与 `0x0000`（Installable），因此三款都能随文档走。这是一条可机械校验的不变式，测试里有合成字体作反例，而不是对构建机上恰好存在的那几个文件的假设。

### 匹配的是字体自称的名字

`loadEmbeddableFonts()` 读取每个文件的 `name` 表（nameID 1 与 16），把其声明的字族与 `metrics.ts` 写进样式的那五个名字相匹配，完全不看文件名——`FZXBSJW.TTF` 之所以被找到，是因为它声明自己是方正小标宋简体。上一轮靠人工核对的这份一致性，如今每次启动都会被检查。目录条目按排序读取，同一字族取第一个文件，因此同一个目录始终产出相同的字节。写进文档的是中文族名，而 WPS 正是按中文名解析嵌入字面的——见[命名决定](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md)。

`.ttf` 与 `.ttc` 都会被读取。集合中的字族会被重建成单字体面，因为写进文档的 `ttcf` 文件没有任何阅读器能解析——这一条由[集合与重复字体](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md)加入，而标准五款字体之一的 SimSun 正以集合形式分发。带 CFF 轮廓的字体（`OTTO`）无论在集合内外，都在 sfnt 版本处即被拒绝，因为下游的 OOXML 嵌入路径承载它们并不可靠。

### 包里装了什么

`buildOdtPackage(document, fonts)` 为每款随行字体增加一个 `Fonts/<字族>.ttf` 条目、一个把 `EmbedFonts` 置为 true 的 `settings.xml`——没有它，那些条目就是死重——以及对应的 `application/x-font-ttf` manifest 条目。`buildStyles(fonts)` 让每个随行字族的 `<style:font-face>` 经 `<svg:font-face-uri>` 指向它的条目。只在 `styles.xml` 里声明就已足够；`content.xml` 本就不含字体声明，也不需要补。

那段标记所需的两个命名空间 `xlink` 与 `loext`，**只在确有字体随行时才声明**。不含字体的包与嵌入功能出现之前工具产出的字节逐字节相同，这一点有断言直接守住，也正是被记录的 ACP 转写仍然有效的原因。

### 失败语义

配置了却读不了的目录在 apply 期失败，并点名该目录以及该怎么处理——配置错误要响亮地失败，而不是静默写出看起来成功、实则不含字体的公文。目录在、却没有某个字族，这是常态（黑体与宋体由 Windows 自带），按降级处理：该字族只写名称，结果备注在 `OFFICIAL_DOC_FONTS_EMBEDDED` 之下说明哪些字体随行、哪些没有。

## Alternatives considered

**由安装包把字体装进系统字体库。** 被用户否决：它需要管理员权限、卸载后留下残留、改动了产品并不拥有的机器，而且对一位不运行本客户端的收文方依然毫无帮助。

**对嵌入的字体做子集化。** 同上，被用户否决。机制是现成的——LibreOffice 自己的 PDF 导出就在做子集化——若文件体积在现场被证明不可接受，可以按上述代价重新考虑。

**引入 `fontkit` 之类的字体库。** 被否决：这里读的是一个稳定、已发布格式中两张表的两个字段。`src/fonts.ts` 约 130 行且无依赖；换成解析库，则要为了回答「它叫什么」和「我可以嵌入吗」而引入字形轮廓、文字排布整形，外加一条第三方声明条目。

**直接产出 OOXML 的嵌入标记，而不经由 LibreOffice。** 以原篇拒绝直接产出 `.docx` 的同一理由否决：那将是同一套版面的第二份实现。LibreOffice 本来就会把 ODF 的字体条目翻译成带 `w:fontKey` 的 `w:embedRegular`，而它写出的混淆条目反混淆后与源文件逐字节相同。

**探测阅读方已装的字体，给出更精确的警告。** 仍然暂缓，[原篇](2026-09-21-official-document-gb-t-9704.md)已记下这一点——但如今大体上已无意义：把字体带走，比更准确地警告「没带走」是更好的答案。

**在 ODF 标记里显式声明粗体字面，以抑制下文所述的重复。** 试过，不成：无论 `loext:font-weight` 声明什么，LibreOffice 都会用同一个常规字重文件写出 `w:embedBold`。这份重复无法从 ODF 一侧抑制。

## Consequences

**文件很大，而且比最初估计的还要大。** 整字体使 `.odt` 约 6.9 MB、`.docx` 约 14.6 MB，因为 LibreOffice 会为每个字族用同一个文件同时写出 `embedRegular` 与 `embedBold`；[集合与重复字体](2026-09-28-official-document-heading-split-collections-and-repeat-fonts.md)移除了这些重复，实测的一页公文因此降到约 8.5 MB。若目录里另外提供了黑体与宋体——部署方可以补的那两款——`.odt` 约 21 MB、`.docx` 约 23 MB，因为这两款比另外三款加起来还大。除此之外：`EmbedFonts` 打开后，LibreOffice 还会把**它为解析不到的字体所替换的那些字面**一并嵌入。在 Linux 构建机上，这多出八个 Noto 条目、约 3.2 MB；在 Windows 机器上，替换字体就是真正的 SimHei 与 SimSun，约 9.75 MB 与 15.3 MB，那里的 `.docx` 在移除重复之前可能逼近 40 MB、之后约为一半。部分 OA 系统的附件大小上限低于这个数字；撞上上限的部署关掉 `fontDirectory`，接受字体替换。

**没有任何快照能覆盖这件事。** 真字体进不了仓库，因此每个测试夹具都是 `tests/font-fixtures.ts` 合成的最小 sfnt，被记录的 ACP 转写走的是未配置的那条路。嵌入改由端到端实测来证明：对着真字体，`pdffonts` 列出 `FZXBSJW--GB1-0`、`FangSong_GB2312` 与 `KaiTi_GB2312` 均已嵌入，而对照组只列出 Noto；`.docx` 携带 `<w:embedTrueTypeFonts/>`；每个 `.odttf` 反混淆后与其源文件逐字节相同。

**WPS 尚未验证。** WPS 是否认 `w:embedTrueTypeFonts` 与 `.odttf` 条目，在这里无法测试，是本轮最大的未决假设；它应当与「在 Word 本身打开」以及「在一台从未安装本客户端的第三台机器上打开」并列，进入 Windows 真机验收清单。

**有三处文档陈述了相反的事实**——工具的 README、原篇的 Consequences，以及工具自己的 `FONT_NOTE`——三处均已订正。`FONT_NOTE` 现已改为 `fontNote(scan)`，报告实际随行的是什么；未配置情形下的措辞保持不变，因此被记录的转写仍然吻合。
