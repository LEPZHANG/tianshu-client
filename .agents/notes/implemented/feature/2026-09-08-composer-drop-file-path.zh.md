# Agent Note: Composer drop inserts workspace-relative file paths on desktop

Status: implemented

[English](2026-09-08-composer-drop-file-path.md) | 中文

## Problem

聊天 composer 此前对「把 OS 文件拖进来」没有有用行为。每次 drop 都走图片加入，而在不带图片的 profile 上 drop 毫无可见反馈，用户便认为「没有拖拽功能」。用户把项目文件拖进 prompt 时想要的，是该文件的路径文本，并以相对会话工作区的形式表达，使其简短、可移植。

## Decision

把 OS 文件拖到 composer 上，会将其工作区相对路径作为纯文本插入，仅限桌面端；纯浏览器保留原有的图片拖放行为。

- **`packages/client/runtime` — `workspaceRelativePath(cwd, path)`**（新增，与 `resolveWorkspacePath` 并列）：路径解析的逆向。`path` 为根时返回 `'.'`，在根之下时返回其相对拼写，`cwd` 未知/空或 `path` 位于工作区之外时返回 `null`。分隔符规范化（`\\`→`/`），并按 `cwd/` 边界锚定匹配，因此共享前缀的兄弟目录（`/root/backend` 下的 `/root/backend2`）会被正确判为越界。经 `runtime/src/client/index.ts` 导出。
- **`dsh-desktop` preload — `dshDesktopFilePath` 桥**（独立仓库）：经 `contextBridge` 暴露一个冻结的 `{ forFile }`，其后端为 `webUtils.getPathForFile`。这是 renderer 得知拖入文件绝对路径的唯一途径——新版 Electron 移除了 `File.path`，且 `webUtils` 必须在 preload 中运行。
- **`ui-conversation` — `input/nativeFilePath.ts`**（新增）：`nativeFilePathResolver()` 将 `window.dshDesktopFilePath` 的读取局部化（沿用 `ui-directory-picker-native` 的 `resolvePick` 姿态），在纯浏览器中返回 `undefined`，使 composer 的渲染路径不掺入 Electron 细节。
- **`ui-conversation` — composer 注入面**：`ComposerBarInjected` 新增 `resolveDropPaths: ((files) => DropPathResolution) | undefined`（`DropPathResolution = { inside: readonly string[]; outside: number }`）。在 `apply.ts` 中，无会话或无原生桥时为 `undefined`；两者皆备时读取会话 cwd（`sessions.list.getSnapshot().byId[sessionId]?.cwd`），并经 `workspaceRelativePath` 对每个拖入文件归类。
- **`InputBar.tsx` drop 处理**：存在 `resolveDropPaths`（路径模式）时，一次 drop 经既有粘贴路径（`keyboard.pasteBegin` + `restoreCaret` + `keyboard.track`，一步 undo）在光标处插入以空格连接的内层路径，任何越界文件弹出一条计数汇总、会自动消散的 `Toast`。无桥时 drop 回退到不变的图片加入路径。拖放遮罩显示路径模式标签（`dropOverlayPathLabels`）。

运行环境按桥的存在与否分流，而非配置开关：`resolveDropPaths === undefined` 是区分桌面端与浏览器的唯一信号，因此不引入部署可变项，浏览器图片拖放路径也不受影响。越界文件汇总为一条计数提示，因为 composer 的 `Toast` 原语是单例，N 条堆叠会难以辨读。路径插入走粘贴机制，因为路径本就是文本，而该路径已自带光标处理与一步 undo。

## Alternatives considered

**隐藏 drop 入口，或让所有环境都走图片加入。** diff 最小，无需新桥。否决：产品决策是拖入的路径才是 prompt 里有用的东西，而让桌面端继续走图片加入会在无图片 profile 上留下「drop 无反应」的抱怨。

**用配置开关在 drop 时选择路径还是图片。** 作为无主的可变项否决:该选择完全由是否存在原生路径桥决定，因此桥的存在与否才是诚实的信号,且不增加部署面。

**每个越界文件弹一条 Toast。** 对逐文件反馈更忠实。否决:`Toast` 原语是锚定在 composer 卡片上的单例,逐文件 Toast 会互相覆盖或难以辨读地堆叠;单条计数才是可读的汇总。

**把插入的路径包成 `@` 引用 chip。** 否决:需求是把相对路径作为纯文本,而 chip 会带上用户并未要求的引用语义。粘贴走路径与文件夹递归同样不在范围内。

## Consequences

桌面端用户获得了路径插入,并正确处理多文件(空格分隔)与越界情形,而浏览器图片拖放路径与图片附件(两种界面上仍经 `+` 与粘贴)均无代价。本改动是纯客户端 UI 加一个 preload 桥:不改 wire/RPC,插入的文本是普通 draft,因此没有模型、token 或 KV 缓存影响。`dsh-desktop` preload 桥位于独立仓库、本仓无 Electron 测试道,故靠手工冒烟(构建 + 完整重启客户端)验证。

## Testing

- `runtime/tests/workspace-path.client.spec.ts`:双向——嵌套命中、等于根返回 `.`、兄弟前缀不误命中、越界返回 null、未知/空 cwd 返回 null、Windows 分隔符。
- `ui-conversation/tests/native-file-path.client.spec.ts`:浏览器中 resolver 缺席、`forFile` 非函数时拒绝、发布了 `forFile` 时进行包裹。
- `ui-conversation/tests/apply-inject.client.spec.tsx`:无桥/无会话时 `resolveDropPaths` 为 `undefined`;有桥时对会话 cwd 归类 inside/root/outside。
- `ui-conversation/tests/input-bar.client.spec.tsx`:路径模式 drop 插入相对路径、多文件以空格连接、越界文件弹提示且不插入、遮罩显示路径模式标题。全量 face 测试台(`input-bar`、`input-matrix`、`input-scenarios`、`skeleton`)带上新的必填键。

纯客户端拖放不经 ACP/headless 模型转录,因此验收由真组合组件测试(`input-bar.client.spec.tsx`)承担,与天枢套件页的处理口径一致;无需新增 keyless 转录快照。
