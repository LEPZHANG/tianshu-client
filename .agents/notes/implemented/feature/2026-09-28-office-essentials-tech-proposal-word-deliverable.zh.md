# Agent Note: the 技术方案 skill hands over a Word file, not only the body text

Status: implemented

[English](2026-09-28-office-essentials-tech-proposal-word-deliverable.md) | 中文

本篇扩展[格式转换技能](2026-09-15-office-essentials-format-convert-skill.md)——该技能加入的工具指引正是本篇要调用的东西——`office-essentials` 各注中的其余决定都仍然成立。

## 问题

技术方案技能规定了五段结构、语体规则和自检清单，却没说文档最终落在哪里。照它做的模型把内容全留在对话里：Markdown 标题、五段列表，架构一节给一段 Mermaid。这在会话里读得通，对文档真正要服务的流程却没用——技术方案要被评审、会签、归档、批注，而这些每一步都发生在 `.docx` 里。

能力其实早就在。`convert_document` 能到达这个格式，而 `html → docx` 是当前组合经由 pandoc、以 `faithful` 保真度提供的一条路由。缺的是指令，不是能力：技能描述了交付物的内容，却从没点名交付物本身。

## 决定

### 两件交付物，同一份内容

技能同时要求两者：一份 `.docx` 文件，以及对话里同样内容的 Markdown。对话里那份是用户打开文件之前先读的东西；文件才是离开这次会话的东西。

### Word 文件先用 HTML 写，再转换

技能要求模型用 `write` 写出 `.html`，再调 `convert_document { path, to: 'docx' }`。选 HTML 作为撰写格式，是因为 seam 的词汇表里没有 markdown——它的十三种格式在文字形态里止于 `html`，而 pandoc 读取的是 `docx`、`odt`、`rtf`、`html`——而 `html → docx` 被声明为 `faithful`，且在随包 pandoc 的桌面端上可达。

选型对比表必须是真正的 `<table>`，含 `<tr>`/`<th>`/`<td>`。这是全部格式指令里唯一一条由转换决定其分量的话：用空格画出来的表格、或用 Markdown 的 `|` 语法排出来的表格，到达时都是一段文字，下游没有任何东西能看出它本来是一张表。

### 架构一节在 Word 里不能依赖 Mermaid

对 seam 里的每一个转换器来说，Mermaid 代码块就是代码块，所以它到 Word 里只是源码文字。因此技能要求在 Word 那份里用文字配合列表或表格描述架构，而把 Mermaid 图留在对话那份里——那里有渲染器。

### 转换自己的报告要转述给用户

`lossy` 必须转述为具体的损失，被拒绝的转换绝不宣称完成，出现 `renamed_from` 就意味着实际写出的文件名要告诉用户。格式转换技能已经教过这项义务；本篇用一行重复它，因为现在发起调用的是这个技能。

## 测试

套件目录由 `packages/skill/skill-suites/tests/skill-suites.spec.ts` 断言其 id 与安装/卸载行为，而不断言正文；正文是模型读的指引，本仓库没有任何快照记录它。仓库能钉住的是这份指引所依赖的路由：`packages/convert/document-convert` 的测试覆盖 `html` 各条路由，而直接对一份带 `<table>` 的 HTML 跑 pandoc，产出的文档里正好有一张 `<w:tbl>`——这正是表格那条指令所立足的性质。

端到端验收是在客户端里真跑一次：安装套件、要一份技术方案，确认 `.docx` 落在 HTML 旁边、打开后表格完好。**这条路径没有无密钥快照覆盖**，因为技能改变的是模型的行为而不是工具的输出；这里把缺口写明，而不是用 mock 糊过去。

## 备选方案

**把 markdown 加进转换 seam，走 `md → docx`。** 那是最自然的撰写格式，也值得拥有：pandoc 原生读 markdown。本次改动否决它，是因为要动格式词汇表、`convert_document` 的 schema、生成的工具目录、输出校验表以及两个 SDK 的期望输出——那是一项产品能力，值得单独提案，而 HTML 这条路并不需要它。

**让模型通过 shell 直接调 pandoc 或 LibreOffice。** 否决：格式转换技能已经禁止手工另拼一遍转换；seam 存在的意义正是不让别处知道当前装了哪个转换器；而且并非每种组合都挂了 shell。

**只产出 Word 文件。** 用户否决：对话里的正文才是人们在决定是否打开附件之前先读的东西。

**技能保持原样，让用户自己去转。** 用户否决：产出文档正是这个技能的意义，而一个以转换步骤开头的评审流程，恰恰是这套工具要消掉的东西。

## 后果

每次技术方案调用现在都会产出文件，因此技能依赖 `write`、依赖能到达 `docx` 的宿主，也依赖文档转换器在场。三者都缺的宿主会拿到 Markdown 正文，以及一份「转换不可达」的如实报告——这正是 `convert_document` 本来就有的降级，只是现在落在一条技能默认会走的路径上。单份文档的成本增加一次 `write` 与一次 `convert_document` 调用。

套件摘要与客户端本地技能目录都会说明该技能产出 Word 文件，因此安装界面描述的就是调用实际会产生的东西。

已经装好的套件会保留旧正文：安装器只在自己的安装动作里重写，而[专家套件页面](2026-09-01-tianshu-suites-install.md)会一直把该套件报为「有更新」，直到用户重新装配。由随发行版正文装出、之后该正文又变更过的 skill 无法被卸载，因为它已经不等于随发行版交付的那一份。

## 相关

- [把格式转换技能加入随包办公套件](2026-09-15-office-essentials-format-convert-skill.md)
- [天枢套件安装面](2026-09-01-tianshu-suites-install.md)
- [文档转换能力 seam](../architecture/2026-09-15-document-conversion-capability-seam.md)
- [转换产物的校验与 pandoc 提供方](../architecture/2026-09-17-document-conversion-output-verification-and-pandoc.md)
