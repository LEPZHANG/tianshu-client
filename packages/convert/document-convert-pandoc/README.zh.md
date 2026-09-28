# @deepseek-ai/dsh-document-convert-pandoc

[English](README.md) | 中文

把 pandoc 用作 harness [文档转换 seam](../document-convert/README.md)（`ctx.documentConvert`）的转换提供方。

这是一个**实现**包。它向 `ctx.documentConvert` 注册提供方，不拥有该键，也不注册面向模型的工具。它是函数／命名空间插件（`inject: ['documentConvert', 'subprocess']`）。

## 为什么需要第二个办公文档转换器

LibreOffice 与 pandoc 的转换机制正好相反，而各自的机制恰恰是对方的短板。

LibreOffice 用拥有该格式的应用程序打开文件，再经由那个应用程序自己的过滤器导出，因此 `.docx` 确实能以 `.docx` 的身份往返。但要它输出 HTML 时，同一套机制写出的是 Writer 排版引擎所看到的东西：一长串绝对定位的 `<p>` 元素，没有标题、没有列表、也没有表格。那份输出是页面的忠实写照，却是一份没用的文档。

pandoc 把源文件读入自己的文档模型（标题、列表、表格、脚注、行内样式），再把这个模型写出去。pandoc 产出的 HTML 就是那份文档；pandoc 产出的 `.docx` 则是一次重建，这正是本包中办公格式互转的边声明为 `lossy`、并在两者都已安装时把它们让给 LibreOffice 的原因。两个包都不知道对方存在：seam 把保真度排在优先级之前，因此仅凭各自的声明就能定出结果。

## 路由

pandoc 能读的每种格式，到它能写的每种格式，去掉源与目标相同的边，共 16 条。

| | → `docx` | → `odt` | → `rtf` | → `html` | → `txt` |
|---|---|---|---|---|---|
| `docx` → | — | lossy | lossy | **faithful** | lossy |
| `odt` → | lossy | — | lossy | **faithful** | lossy |
| `rtf` → | lossy | lossy | — | **faithful** | lossy |
| `html` → | **faithful** | **faithful** | **faithful** | — | lossy |

`pdf` 不作为目标出现，因为 pandoc 只能经由外部 LaTeX 引擎抵达它，那是一条独立的依赖链，也应当是一个独立的提供方。`pptx` 不出现，因为 pandoc 的演示文稿写入器会按标题凭空生成幻灯片，产出的是一份新文档，而不是对交给它的那份文档做转换。`txt` 不作为*源*出现，因为纯文本没有可供恢复的结构，所以每条 `txt →` 的边都留给 LibreOffice。

每条路由都上报一条备注，说明它让文档付出了什么代价：`HTML_REFLOWS`、`PAGE_SETUP_DEFAULTED`、`PLAIN_TEXT_ONLY` 或 `DOCUMENT_MODEL_REBUILD`。这些备注经由 `convert_document` 的结果抵达模型，这正是它们存在的意义。

## 调用方式

```
pandoc --from <reader> --to <writer> --standalone --resource-path <source dir> [--embed-resources] --output <out> <source>
```

- `--standalone`，因为区分完整文档与片段的那些写入器在不加它时只会输出片段：没有 `{\rtf1` 前导的 RTF，没有外层页面包裹的 HTML 主体。
- `--resource-path` 指向源文件自身所在的目录，因为 pandoc 解析源文件中的相对图片引用时，依据的是工作目录而不是源文件位置。
- `--embed-resources` 用于 HTML 目标，使图片变成 data URI。提供方必须恰好写出一个文件，而没有它时，pandoc 会输出指向图片文件的引用，那些文件并不会出现在输出旁边。

pandoc 严格写入交给它的那个输出路径，因此一个步骤就是一次 spawn，不需要暂存目录，也不需要重命名。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `binary` | `pandoc` | 裸 PATH 名称或绝对路径。 |
| `priority` | `20` | 所有路由通用的裁决序位。默认值高于 LibreOffice 的 `10`，由此定下 HTML 与纯文本方向的边；办公格式互转的边因声明为 `lossy`，无论如何都仍归 LibreOffice。 |
| `graceMs` | `3_000` | 转换被取消时从 SIGTERM 到 SIGKILL 的宽限期。 |

## 可用性

插件在 apply 时向已安装的 pandoc 询问一次它能做什么：

1. `ctx.subprocess.resolveExecutable(binary)`：无法解析的二进制程序不注册任何东西。
2. `pandoc --version`：主版本低于 `3` 时不注册任何东西，因为 `--embed-resources` 到 pandoc 3.0 才出现（取代 `--self-contained`），而 HTML 目标缺了它，产出的结果看起来像是转换好了，实则不然。
3. `pandoc --list-input-formats` 与 `--list-output-formats`：上面的路由会被过滤到该构建版本所报告的读取器与写入器范围内。

有些问题本包不该靠版本号推算来回答，比如某个构建版本是否带 RTF 读取器，直接询问才能定论。无法回答的 pandoc 被当作不存在，而不是假定它具备能力，这样 `available()` 就能按 seam 的要求保持廉价且同步。此后才安装或升级的 pandoc，在插件重新挂载之前都不可见。

## 模型体验

通过 [`dsh-tool-document-convert`](../tool-document-convert/README.md) 间接影响；该工具在渲染进 `convert_document` 结果的执行路由中点出本提供方，并转达该路由的备注；命令行参数与进程机制则不对外暴露。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

## 已知限制与暂缓事项

- **没有 PDF 目标**：`--to pdf` 需要 LaTeX 引擎（`pdflatex`、`xelatex`、`tectonic`），这个依赖比 pandoc 本身大一个数量级。每条 `→ pdf` 的边都由 LibreOffice 服务，因此这处缺口目前不构成代价；想要 pandoc 排版能力的组合，需要另一个声明该工具链的提供方。
- **不支持电子表格与演示文稿格式**：pandoc 没有 `xlsx`、`ods`、`ppt`、`pptx` 的读取器，而它的 `pptx` 写入器是用标题拼出幻灯片，而不是转换一份演示文稿。这两个格式族仍归 LibreOffice。
- **办公格式互转的边是为只有 pandoc 的机器准备的**：在装有 LibreOffice 的地方，它们声明的是 `lossy`，而对面是 `faithful`，因此永远不会被选中。仍然声明它们，是为了让只带 pandoc 的容器依然能做 `docx → odt`，代价就是备注所说明的那些。
- **只支持与宿主共享文件系统的执行**：本提供方通过 `ctx.subprocess` spawn，处理的是 seam 提供的路径，因此它服务于进程世界与 harness 文件系统同为一个的组合。
