# 文档转换

[English](document-convert.md) | 中文

`ctx.documentConvert` 的词汇表与装配方式：什么是格式、提供方声明什么、如何跨提供方规划一条路线，以及一次完成的转换报告什么。归属包为 [`packages/convert`](../../packages/convert/README.md)。

## 格式

`DocumentFormat` 是十三个 id 的封闭联合，每个 id 同时也是它的规范文件扩展名：

| 家族 | 格式 |
|---|---|
| 文档 | `doc`、`docx`、`odt`、`rtf`、`txt`、`html` |
| 表格 | `xls`、`xlsx`、`ods` |
| 演示 | `ppt`、`pptx`、`odp` |
| 无 | `pdf` |

`formatFamily` 返回家族，对 `pdf` 返回 `undefined`：它是三个家族共同导出的渲染目标，不属于任何编辑器。机制依赖家族的提供方会读取它 —— LibreOffice 按加载该文档的家族选择导出 filter，因此 `html` 从 Writer 源出来是 `HTML (StarWriter)`，从 Calc 源出来是 `HTML (StarCalc)`。

`detectFormat(path)` 从路径扩展名读出格式（接受 `htm` 作为 `html`，忽略大小写，两种路径分隔符都处理）。`defaultOutputPath(path, format)` 则写出一个。两者都是纯字符串函数，不与文件系统或平台耦合，因为转换工具的重放 presenter 会在没有任何服务存在的地方调用它们。

## 提供方声明什么

```ts
import type {
  ConvertFidelity,
  ConvertNote,
  ConvertStepSpec,
  DocumentFormat,
} from '@deepseek-ai/dsh-document-convert'

interface DocumentConvertProvider {
  readonly id: string
  readonly routes: readonly ConvertRoute[]
  available(): boolean
  convert(step: ConvertStepSpec, signal?: AbortSignal): Promise<readonly ConvertNote[]>
}

interface ConvertRoute {
  readonly from: DocumentFormat
  readonly to: DocumentFormat
  readonly fidelity: ConvertFidelity   // 'faithful' | 'lossy'
  readonly priority: number
}
```

`routes` 是静态的：它描述该机制的能力，而不是当前这台机器的状况。二进制是否存在由 `available()` 回答，而后者必须廉价且同步 —— 随附的提供方在插件 apply 时对其二进制采样一次，之后返回缓存的答案。

一个提供方对应一种机制，实际上就是一个二进制。某个厂商发布两个可执行文件，就注册两个提供方，这样缺失第二个二进制只会损失它自己那条路线。

`convert` 恰好写出 `step.outputPath`，不写别的，并返回这一步让文档付出了什么代价。两端路径都位于该提供方的执行世界中。提供方不复查自己的结果：本 seam 会校验每一个写出的文件，因此提供方只负责汇报，不负责验证。

## 保真度与注记

`faithful` 表示这次转换把结构与格式一并带过去；`lossy` 表示内容存活，但版面、样式或结构没有。它是单条边的属性，而不是提供方的属性：LibreOffice 做 `docx → odt` 是 faithful，做 `docx → txt` 是 lossy。

一个计划的保真度取其各步中最差的那个。一跳 lossy 就让整次转换成为 lossy，并且模型可见的结果会这样说 —— 把转换后的文件交给用户的模型，需要知道版面有没有存活下来。

保真度说明一条路线丢了东西；`ConvertNote`（`{ code, message }`）说明丢的是什么。每一步返回自己的注记，结果按 `code` 去重后依汇报顺序携带它们。二者的区别在于读者："lossy" 让模型知道该留有余地，而"CSV 导出只保留第一个工作表的取值，丢弃其余工作表与全部公式"才告诉它该向用户提示什么。注记描述的是一次已经发生的转换；让结果不可用的情形是 `ConvertError`，不是注记。

保真度还决定两个提供方都声明的同一条边归谁服务，其权重高于 `priority`。pandoc 与 LibreOffice 正是这样在互不知情的前提下分掉办公格式：pandoc 把自己的办公格式互转边声明为 `lossy`，因为它是用自己的模型重建文档而不是在文件格式之间往返，而 LibreOffice 把这些边的 priority 压得更低。抵达或离开 HTML 的边则相反 —— pandoc 把它们声明为 `faithful`，因为 LibreOffice 的 HTML 导出是一串被绝对定位的 `<p>` 元素。

## 请求、spec、结果

转换分为两个显式阶段。

```ts
import type {
  ConvertOutcome,
  ConvertRequest,
  ConvertSpec,
} from '@deepseek-ai/dsh-document-convert'

interface DocumentConvertRuntime {
  resolve(request: ConvertRequest): ConvertSpec
  run(spec: ConvertSpec, signal?: AbortSignal): Promise<ConvertOutcome>
}
```

`resolve` 是本 seam 唯一的 defaulting 步骤：请求未声明源格式时从路径扩展名读取，未指定输出路径时在源文件旁派生一个，并规划路线。把它与 `run` 分开，调用方就能在任何东西被写出之前，知道输出路径以及自己即将接受的保真度。

`ConvertOutcome` 报告写出的路径、两端格式、计划的保真度、实际执行的步骤、字节大小，以及这些步骤汇报的注记。

跨越本 seam 的是路径而非字节：随附的提供方都是面向文件的外部程序，一份大型演示文稿没有理由穿过 harness 进程。

## 规划

一个计划包含一步或多步。多于一步不是优化 —— 它是绝大多数跨家族目标得以存在的唯一途径。没有哪个转换器能把 PDF 变成表格，但 `pdf → txt → xlsx` 可以，而把它报告为 `lossy` 就是如实陈述，而不是假装存在一条直达路线。

选择绝不依赖注册顺序：

1. 每个可用提供方的路线成为边；不可用的提供方不贡献任何边。
2. 配置中的钉选把一条边限定给一个提供方。无法兑现的钉选以 `CONVERT_ROUTE_CONFIGURED_MISSING` 失败 —— 钉选是决定，不是建议。
3. 候选路径在 `maxSteps` 跳以内枚举，顺序取自 `dsh-document-convert` 自己的格式声明顺序，绝不取自提供方注册顺序，且绝不重复经过同一格式。
4. 胜出者按步数最少、最差保真度最好、最弱一步的 priority 最高依次选出。
5. 胜出计划的每条边再解析到它最好的提供方：先比保真度，再比 priority。

胜出计划所使用的某条边上出现无法打破的提供方平局，即 `CONVERT_ROUTE_AMBIGUOUS`，并在消息中点名能了结它的 `routes` 钉选。未被触及的边上的平局会被忽略。两条完整路径之间的平局由确定性的枚举顺序打破，而不是报错，因为调用方没有任何旋钮能了结它。

## 执行

每一步都通过它所规划的提供方运行。多步计划把中间产物写入一个临时目录，无论转换成功或失败都会移除它；只有最后一步写入调用方的输出路径，因此失败不会在目的地留下残缺文件。

每一步之后，本 seam 都检查文件本身，而不是信任提供方的汇报，因为退出码说明的是程序结束了，而不是它写出了一份文档。文件必须存在（`CONVERT_OUTPUT_MISSING`），且必须确实是目标格式（`CONVERT_OUTPUT_UNUSABLE`）：`verifyConvertedBytes` 寻找该格式据以被识别的东西 —— PDF 的 trailer、复合文件头、OOXML 中点名应用程序的那个 part、ODF 的 `mimetype` 条目、HTML 页面中的可见文本。LibreOffice 对一次没写出任何页面的 PDF 导出会以 0 退出，对一份导出为 HTML 却没有任何幻灯片文本的演示文稿会以 0 退出，对一个内里是 Writer 文档的 `.odp` 也会以 0 退出。大于 `maxVerifyBytes`（64 MiB）的结果跳过内容检查 —— 它显然已经产出了一份文档。

## 错误

`ConvertError` 携带一个机器可路由的开放字符串 `code`，以及链式的 `cause`。

| Code | 触发条件 |
|---|---|
| `CONVERT_CONFIG_INVALID` | 步数上限不是正整数。 |
| `CONVERT_ROUTE_KEY_INVALID` | 某个 `routes` 键格式错误，或点名了未知格式。 |
| `CONVERT_FORMAT_UNKNOWN` | 源格式既未声明，也无法从路径读出。 |
| `CONVERT_SAME_FORMAT` | 源与目标是同一种格式。 |
| `CONVERT_ROUTE_UNSUPPORTED` | 在上限以内没有可用的提供方链能抵达目标。 |
| `CONVERT_ROUTE_AMBIGUOUS` | 所选计划建立在一个无法打破的提供方平局之上。 |
| `CONVERT_ROUTE_CONFIGURED_MISSING` | 钉选点名的提供方不存在、不可用，或不服务该边。 |
| `CONVERT_DUPLICATE_PROVIDER` | 该提供方 id 已被注册。 |
| `CONVERT_PROVIDER_UNAVAILABLE` | 已规划的提供方在执行时已不再可用。 |
| `CONVERT_PROVIDER_FAILED` | 某个转换器失败，或产出了不可用的东西。由提供方拥有。 |
| `CONVERT_OUTPUT_MISSING` | 某一步汇报成功却没有产出它的文件。 |
| `CONVERT_OUTPUT_UNUSABLE` | 某一步产出的文件并不是它目标格式的文件。 |
| `CONVERT_SOURCE_DAMAGED` | 源是一个转换器会拒绝的容器 —— 其中的条目对自己所存数据声称没有校验和。由提供方拥有。 |
| `CONVERT_SOURCE_SCANNED` | PDF 没有嵌入任何字体，说明它的页面都是图像，没有文本可抽取。由提供方拥有。 |
| `CONVERT_CANCELLED` | 调用方的 signal 已触发。 |

`convert_document` 这一消费方另外为它自己拥有的情形补充了 `CONVERT_SOURCE_MISSING`、`CONVERT_SOURCE_NOT_FILE`、`CONVERT_OUTPUT_EXISTS` 与 `CONVERT_SANDBOX_DENIED`。

## 公文格式：本 seam 的第二个消费方

`write_official_document`（[`packages/convert/tool-official-document`](../../packages/convert/tool-official-document/README.md)）把结构化内容按 GB/T 9704—2012《党政机关公文格式》排版 —— A4 纸、156 × 225 mm 的版心（每面 22 行、每行 28 字）、三号仿宋正文、红色分隔线、一、/（一）/1./（1）各级层次序数、版记 —— 并写出文件。

它是消费方而不是提供方，也不新增格式。版面以 OpenDocument 文本产出，由该包自己把 `content.xml`、`styles.xml` 和一份 manifest 组装成 ZIP；`odt` 本就是那十三个之一，因此封闭联合没有变化。该工具提供的其余每一种格式，都是把那份 `.odt` 暂存到工具自己拥有的目录里、再请本 seam 把它就地转换过去而抵达的 —— `odt → docx` 与 `odt → pdf` 是 LibreOffice 早已声明的边，因此把一份公文产出为 `.docx`，跑的就是普通规划器在普通提供方之上的那一套。默认值是 `docx`，因为收件人打开的就是它；于是没有 LibreOffice 的宿主只能抵达 `odt`，工具会用点名 `format: "odt"` 的 `OFFICIAL_DOC_FORMAT_UNREACHABLE` 把这件事说出来，而不是含混地失败。

本 seam 当初就是为这种安排而建的：第二个消费方需要一种新的输出格式时，它靠写出一个现有提供方本就能读的文件来得到它，而不是扩展格式联合或注册一个转换器。

该工具拥有自己的错误码 —— 文档违反该标准时的 `OFFICIAL_DOC_FIELD_MISSING` 与 `OFFICIAL_DOC_FIELD_INVALID`、`OFFICIAL_DOC_OUTPUT_EXISTS`、`OFFICIAL_DOC_FORMAT_UNREACHABLE` —— 以及自己的注记码 `OFFICIAL_DOC_FONTS_REQUIRED`，每个结果都会携带它，因为一个文件可以点名该标准规定的字体，却无法把这些字体提供给一台没有它们的机器。

## 围栏

本 seam 不是围栏边界。它的提供方把 argv 交给 `ctx.subprocess`，因此转换器以 harness 进程自身的权限写入，没有任何文件系统后端挡在它与目的地之间。两个消费方都通过 `ctx.fs` 解析自己的输出，并拒绝会话 sandbox 模式所不允许的那一个 —— `write_official_document` 写出自己的 `.odt` 时同样用的是 harness 进程自身的权限，因此它在碰任何路径之前就做出这个判定 —— 而两者共用同一份实现，由 `dsh-tool-document-convert` 导出。在进程内直接调用 `ctx.documentConvert` 的调用方会绕过它。遵循 `dsh-bash-sandbox` 那种做法、通过 `ctx.sandbox` 包裹 argv 的沙箱化提供方属于延后项。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocumentconvert--documentconvertruntime"></a>

### `ctx.documentConvert` — `DocumentConvertRuntime`

The document conversion service. Registered as `ctx.documentConvert` (one instance per context).

Usage is two explicit phases: resolve applies every default and plans the route, failing loud when the request cannot be served; run executes the resolved plan. Keeping them apart lets a caller learn the output path and the fidelity it is about to accept before anything is written.

```ts cordis-catalog
/**
 * Register a conversion provider. Throws {@link ConvertError} `CONVERT_DUPLICATE_PROVIDER` if its id is
 * already registered. Returns a disposer; disposed with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: DocumentConvertProvider): () => void

/**
 * Apply every default to a request and plan its route. This is the seam's only defaulting step: the
 * source format comes from the source path's extension when unstated, the output path is derived
 * beside the source when unstated, and the route is chosen from the currently usable providers.
 *
 * @param request - the source path, target format, and any explicit overrides.
 * @returns the fully-resolved conversion, including the plan and its fidelity.
 * @throws {@link ConvertError} `CONVERT_FORMAT_UNKNOWN` when the source format is neither stated nor
 *   readable from the path, plus any planning failure from `planRoute`.
 */
resolve(request: ConvertRequest): ConvertSpec

/**
 * Execute a resolved conversion. Each step runs through its planned provider; a multi-step plan writes
 * its intermediates into a scratch directory that is removed whether the conversion succeeds or fails,
 * and only the final step writes `spec.outputPath`.
 *
 * Every step's result is checked against its target format before the next step reads it, so a
 * converter that reported success without producing a usable document fails here rather than handing
 * back a file that opens empty. A rejected file is deleted, including at the destination.
 *
 * @param spec - the resolved conversion from {@link resolve}.
 * @param signal - optional cancellation signal, checked between steps and forwarded to providers.
 * @returns what was written: the path, the executed steps, the fidelity, the byte size, and the notes
 *   the steps reported about what the document lost.
 * @throws {@link ConvertError} `CONVERT_CANCELLED` when the signal fires, `CONVERT_PROVIDER_UNAVAILABLE`
 *   when a planned provider is no longer registered, `CONVERT_OUTPUT_MISSING` when a step reports
 *   success without producing its file, or `CONVERT_OUTPUT_UNUSABLE` when it produces one that is not a
 *   document of the format it promised.
 */
async run(spec: ConvertSpec, signal?: AbortSignal): Promise<ConvertOutcome>
```

Source: [`packages/convert/document-convert/src/index.ts:107`](../../packages/convert/document-convert/src/index.ts)
<!-- END GENERATED cordis-surface -->
