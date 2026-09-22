# Agent Note: 天枢「发送到对话」经带外输入事件预填组合器

Status: implemented

[English](2026-09-08-tianshu-send-to-composer-prefill.md) | 中文

## Problem

天枢技能目录的「发送到对话」在用户往组合器里输入过任何内容之后就失效了。`sendSkillToComposer` 当时派发 `slash/input-insert-text`，携带跨度 `{ start: 0, end: 0, draftRev: 0 }`，误以为 `draftRev` 为 `0` 表示「无条件应用」。

`insertText` 是拾取时刻的编辑器：它把调用方的 `span.draftRev` 与当前草稿修订号做比较并交换（CAS），不一致就返回 `false`——因为跨度的偏移只有相对候选被拾取时的那一份确切草稿才有意义。`draftRev` 从 `0` 起，每次草稿变更递增，因此哨兵值 `0` 只匹配从未编辑过的原始组合器。任何一次按键之后，该插入都静默变为空操作。`{ start: 0, end: 0 }` 跨度还指向草稿开头，而非光标处。

这个按钮根本没有拾取时刻——它从另一个界面注入固定的 `/name ` 记号——所以它从来就没有可提交的合法 `draftRev`，任何跨度 CAS 都无法服务于它。

## Decision

方案 A：一条不携带跨度的专用带外预填路径，而非让品牌插件去读取输入机的当前修订号（下文方案 B）。

`ui-input-trigger` 声明新的作用域 bail 事件 `slash/input-prefill-text(request: { text }): true | undefined`，与既有的 insert/reference/consume 事件并列。`SessionInput` 新增 `prefillText(text)`：读取当前快照，在准入事务被锁定（`adjudicating`/`submitting`）时拒绝，否则把文本追加到当前草稿末尾。`InputHub` 在每个会话作用域上与其他输入变更监听器并列挂接该监听器，由会话自己的 shell 打上当前修订号——调用方从不指定修订号。

`sendSkillToComposer` 解析当前会话的绑定，在该作用域的上下文上以 `{ text: `/${name} ` }` bail `slash/input-prefill-text`，返回事件是否已应用。发送被拒绝时，天枢技能页保持打开，而不是把记号丢失。

同一改动从内置技能目录移除了 `image-creation`（图像创作）条目；`creative` 分类及其标签仍为回退到它的宿主列出技能保留。

## Alternatives considered

**方案 B——品牌插件读取当前 `draftRev` 并打上一个 insert-text 跨度。** 否决：它会把输入机的比较并交换修订语义越过插件边界泄漏到一个无关的品牌界面，而对一个既无拾取时刻、也无光标可供编辑的注入来说，跨度偏移只是无谓的仪式。

**复用 `slash/input-insert-text` 加一个哨兵 `draftRev`。** 否决：没有哪个哨兵能在不削弱合法拾取时刻插入所依赖的守卫的前提下绕过 CAS。这两个操作在种类上不同——一个编辑被拾取的跨度，一个带外追加——所以它们是两个事件。

**在光标处而非草稿末尾插入。** 否决：该操作从一个独立的管理界面触发，没有光标上下文可读。对带外注入而言，追加到末尾是唯一有明确定义的落点。

## Consequences

预填始终追加到草稿末尾，且在提交或裁定事务占用组合器时拒绝——此时页面保持打开，而不是丢弃记号。这条路径是纯客户端草稿变更：插入的 `/name ` 是一份普通草稿，仍由用户编辑并发送，在提交之前不产生任何模型请求、token 或 KV 缓存影响。新事件补全了输入能力接缝既有的 Provider/Consumer 角色；不新增宿主或线协议界面。

## Verification

`prefillText` 有 facade 单测（在非原始草稿上追加、在原始草稿上应用、在锁定的准入阶段下拒绝）。`InputHub` 监听器有经真实会话作用域派发的作用域 bail 测试。`sendSkillToComposer` 的真实注入面有 apply 级测试：在解析出的绑定上 bail 该事件、汇报应用结果、无当前会话或无可解析绑定时拒绝、并把被拒绝的 bail 汇报为未发送。天枢页目录测试现断言四个内置技能且 `Creative0`。
