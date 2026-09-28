# @deepseek-ai/dsh-document-convert

[English](README.md) | 中文

文档转换能力 seam（`ctx.documentConvert`）：一份转换器提供方的注册表、一个以它们所声明的转换为基础的路由规划器，以及对所选方案的逐步执行。

这是**接口**包。它自己不运行任何转换器，也不知道任何厂商。提供方注册自己能做什么；`@deepseek-ai/dsh-tool-document-convert` 是面向模型的消费方。

## 该 seam 传递的是什么

是路径，不是字节。随附的提供方都是面向文件的外部程序，一份上百兆的演示文稿没有理由流经 harness 进程。`ConvertRequest` 给出提供方执行世界中的源路径和一个目标格式；结果则给出已写出的那个文件。

## 格式

十三种，构成一个封闭联合类型：`pdf`、`doc`、`docx`、`odt`、`rtf`、`txt`、`html`、`xls`、`xlsx`、`ods`、`ppt`、`pptx`、`odp`。每个 id 同时也是该格式的规范文件扩展名，`detectFormat` 据此读取源路径，`defaultOutputPath` 据此写出输出路径。新增一种格式会让每个对其做分支判断的消费方编译失败。

`formatFamily` 把格式归类为 `document`、`spreadsheet` 或 `presentation`。`pdf` 不属于任何一族：它是三个族共同导出的渲染目标，不归属于任何编辑器。

## 两个阶段，而非一个

`resolve(request)` 应用全部默认值并规划路由，`run(spec)` 负责执行。两者分开，调用方才能在任何内容写出之前就知道输出路径以及自己将要接受的保真度；默认值补全也因此集中在一个显式步骤里，而不是藏在执行过程中。

请求未声明源格式时，`resolve` 从路径扩展名读取；请求未指定输出路径时，它在源文件旁推导一个；随后规划路由。它选择抛错而非猜测：无法识别的扩展名报 `CONVERT_FORMAT_UNKNOWN`。

## 保真度，以及一条路由实际付出的代价

每条已声明的路由都说明自己保留什么：`faithful` 把结构和排版一并带过去，`lossy` 只带内容、不带版面。方案的保真度取各步骤中**最差**的那个，因此只要有一跳有损，整次转换就是有损的。这不是装饰：模型把转换后的文件交给用户时，需要知道版面是否幸存，而消费方会把这个判定渲染进结果文本。

保真度只说明路由有所损失，**备注**才说明损失了什么。每个步骤返回 `ConvertNote` 值（`{ code, message }`），结果会携带它们，按 `code` 去重并保持上报时的顺序。这个区别对唯一重要的那个读者才有意义：「lossy」告诉模型要留有余地，而「CSV 导出只保留第一张工作表的值，丢弃其余工作表和全部公式」才告诉它该向用户提醒什么。备注描述的是已经发生的转换；让结果无法使用的情况是 `ConvertError`，不是备注。

## 路由规划

一个方案包含一个或多个步骤。多个步骤不是一种优化，而是大多数跨族目标得以存在的唯一途径。没有任何转换器能把 PDF 变成电子表格，但 `pdf → txt → xlsx` 可以；把它报告为 `lossy` 是如实相告，而不是假装存在一条直达路由。

选择过程绝不依赖注册顺序：

1. 每个可用提供方所声明的路由成为图中的边。不可用的提供方（其二进制程序缺失）不贡献任何边，因此没有装该转换器的机器会绕开它规划路由。
2. 配置中的固定项把某条边限定到单个提供方。固定项指向的提供方不存在、不可用或并不服务该条边时，以 `CONVERT_ROUTE_CONFIGURED_MISSING` 失败：固定项是一项决定，不是建议。
3. 候选路径最多枚举到 `maxSteps` 跳，枚举顺序取本包自身的格式声明顺序，绝不取提供方注册顺序，并且绝不重复经过同一种格式。
4. 胜出者依次按步骤最少、最差情况保真度最优、最弱步骤优先级最高来选出。
5. 胜出方案中的每条边再解析到它最好的提供方：先看保真度更优，再看优先级更高。

**在胜出方案实际使用的边上**出现无法打破的提供方并列，报 `CONVERT_ROUTE_AMBIGUOUS`，消息中给出补救办法：在 `routes` 中固定该条边。本次转换不涉及的边上出现并列，不属于该调用方的问题，直接忽略。两条完整*路径*之间的并列则由确定的枚举顺序打破，而不报错，因为调用方没有任何配置开关能了结它。

## 执行

每个步骤都由方案为它选定的提供方执行。多步方案把中间产物写入一个暂存目录，无论转换成功还是失败都会删除该目录；只有最后一步写入调用方的输出路径，因此失败的转换不会在目标位置留下残缺文件。

每个步骤结束后，seam 都会检查提供方承诺产出的那个文件，而不是信任提供方自己的报告。共两项检查，因为转换器有两种失败方式：

- 文件必须存在，否则报 `CONVERT_OUTPUT_MISSING`。`soffice` 对自己并未执行的转换也会以 0 退出。
- 文件必须确实属于目标格式，否则报 `CONVERT_OUTPUT_UNUSABLE`。退出码只说明程序结束了，不说明它写出了一份文档：导出的 PDF 一页未写、导出为 HTML 的演示文稿不含任何幻灯片文字、名为 `.odp` 而内容实为 Writer 文档，LibreOffice 在这些情况下都以 0 退出。`verifyConvertedBytes` 会读取字节，寻找该格式赖以识别的标志：PDF 的文件尾、复合文件头、指明应用程序的 OOXML 部件、ODF 的 `mimetype` 条目、HTML 页面中的可见文本；错误消息会指出缺失的是哪一项。

大于 `maxVerifyBytes` 的结果跳过内容检查：写出了六十四兆字节的转换器显然产出了一份文档，再读一遍只会耗费内存而一无所获。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `maxSteps` | `2` | 一个方案最多可串联的转换器步骤数。一跳覆盖单个转换器能完成的全部转换，第二跳则经由中间格式抵达目标。继续调高只会换来越来越可疑的转换链。 |
| `routes` | `{}` | 按边固定提供方，写法为 `{ 'docx->html': 'pandoc' }`。它既是 `CONVERT_ROUTE_AMBIGUOUS` 失败所指出的补救办法，也是组合对某一对格式有主张时覆盖排序的方式。 |
| `tempDir` | `os.tmpdir()` | 每次转换所建暂存目录的父目录。 |
| `maxVerifyBytes` | `64 MiB` | 为内容检查而回读的结果大小上限。超过该值时，转换器显然写出了一份文档，再读只会耗费内存而一无所获。 |

格式错误的 `routes` 键在加载时即失败，因为键的语法和格式名称是自包含的。被固定的提供方是否存在则不是自包含的，要等规划过程用到那条边时才检查。

## 错误

`ConvertError` 携带一个可供机器路由的 `code`。seam 拥有 `CONVERT_CONFIG_INVALID`、`CONVERT_ROUTE_KEY_INVALID`、`CONVERT_FORMAT_UNKNOWN`、`CONVERT_SAME_FORMAT`、`CONVERT_ROUTE_UNSUPPORTED`、`CONVERT_ROUTE_AMBIGUOUS`、`CONVERT_ROUTE_CONFIGURED_MISSING`、`CONVERT_DUPLICATE_PROVIDER`、`CONVERT_PROVIDER_UNAVAILABLE`、`CONVERT_OUTPUT_MISSING`、`CONVERT_OUTPUT_UNUSABLE` 和 `CONVERT_CANCELLED`。提供方把自身的机制性失败归类为 `CONVERT_PROVIDER_FAILED`，并以 `CONVERT_SOURCE_DAMAGED` 或 `CONVERT_SOURCE_SCANNED` 指明转换器无法使用的源文件；消费方则为自己拥有的情况添加 code。code 字符串是开放的：消费方必须容忍自己不认识的取值。

## 模型体验

通过 [`dsh-tool-document-convert`](../tool-document-convert/README.md) 间接影响；该工具把本 seam 的结果（已写出的路径、实际执行的路由及其保真度判定）渲染进 `convert_document` 的结果，并拥有模型所见的全部提示词与 schema。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由具名消费方负责。

## 已知限制与暂缓事项

- **这道 seam 不是隔离边界**：它的提供方把 argv 交给 `ctx.subprocess`，因此转换器以 harness 进程自身的权限写文件，它与目标位置之间没有任何文件系统后端把守。`convert_document` 工具会通过 `ctx.fs` 解析两端路径，并拒绝会话沙箱模式不允许的输出，但进程内直接调用 `ctx.documentConvert` 的调用方完全绕过这一层。沙箱化的提供方（即 `dsh-bash-sandbox` 那套做法，用 `ctx.sandbox` 包装 argv）暂缓。
- **暂存文件使用 harness 进程自身的文件系统**：`run` 用 `node:fs` 而非 `ctx.fs` 创建多步方案的中间目录，因此执行世界在远端的提供方，在 `tempDir` 并非该世界可读路径的组合中只能服务单步方案。
- **提供方的可用性只采样一次**：随附的提供方在 apply 时解析各自的二进制程序并缓存结果，因为 `available()` 必须廉价且同步。harness 启动之后才安装的转换器，在其插件重新挂载之前始终不可见。
- **方案不做缓存**：每次 `resolve` 都依据当前提供方重建路由图。该图只有几十条边，目前无需度量；注册了大量提供方的组合则会需要一份带版本号的缓存。
