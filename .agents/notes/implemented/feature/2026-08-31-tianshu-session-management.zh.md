# 会话管理成为管理界面：集合、取消归档、回收站

Date: 2026-08-31
Status: implemented
Scope: feature

[English](2026-08-31-tianshu-session-management.md) | 中文

## 改动内容

会话管理页面（`ui-tianshu-brand/TianshuPages.tsx`）此前只是一份只读的标题列表；侧边栏的归档动作是一扇单向门（任何地方都没有取消归档的 RPC），而删除会话从客户端约定直到 SQLite 后端都不存在。本次改动让会话界面具备平台能够诚实提供的每一个生命周期动作，横跨三层：

- **宿主注册表**（`workspace/workspace`）：领域状态新增 `collections`（有序的具名会话分组）与 `deletedSessionIds`（软删除集），两者都带默认值，因此既有存储介质解析不变。领域版本仍为 `2`，因为 storage-domain 在打开时会拒绝版本不一致，而仅仅追加带默认值的字段不值得付出这个代价。新增动作：`unarchiveSession`、集合的增删改查及成员关系、`deleteSession`／`restoreSession`。软删除会把会话移出归档集和每一份集合账目，但保留其工作区席位，因此恢复会让会话回到原位。
- **协议层**（`host/apiproxy` + `client/runtime`）：新增九个 `workspace.*` RPC、两个宿主帧（`host/collections-changed`、`host/deleted-sessions-changed`），以及同时携带两个集合的 `workspace.list` 快照。`WorkspaceListState` 新增两个必填字段。
- **UI**（`ui-tianshu-brand`）：会话页面现在由两条轴构成：文件夹在左侧轨道上导航（含一个「未归类」伪文件夹），归档状态在 chip 行上筛选；进入某个文件夹后，全局 chip 退场，让位给文件夹内的范围条，其子筛选按文件夹内计数。每一行都支持打开、重命名、归档／取消归档、归入文件夹、删除到回收站与恢复。

## 这些决策的理由

- **把文件夹做成第二条正交的轴**，而不是复用工作区：工作区成员关系表达的是「这个会话在哪个项目目录里工作」，而像「季度汇报」这样的归档概念不应当要求用户发明一个目录。集合与归档集一样按注册表全局存储，且从不参与「单一归属」的账目不变式。
- **只做软删除**：会话持久化没有删除行的 seam（`create/readFrom/appendBatch/list/readRaw`），因此彻底清除将是一次横跨四个包的改动（定义 + jsonl + sqlite + 协调器）。回收站负责恢复；它刻意不提供清除或清空按钮，而不是摆出一个注定失败的控件。
- **六处状态构造点把新字段带了下去**：注册表在创建／删除／恢复／引导时逐字段重建全局状态；新字段只要在其中任何一处被漏掉，就会在一次无关的工作区写入中悄悄抹掉用户的文件夹。TypeScript 的 excess-precision 让每一处在处理之前都拒绝编译，一项回归测试钉住了这种保留行为。

## 不变式与测试

- 注册表：59 项测试（新增 12 项），包括两个新字段在工作区创建／删除时的保留，以及既有存储介质的升级。
- 协议层／客户端：`apiproxy`、`runtime`、`connection`、`test-support` 套件共 1314+ 项全绿；客户端用例钉住全量集合回显的安装、两个帧，以及失败时投影保持不变。
- UI：`ui-tianshu-brand` 中 45 项测试，覆盖两条轴的范围、分桶语义（「已删除」绝不混入「全部」）、文件夹范围下全局 chip 的退场、菜单流程、对话框确认，以及「打开即关闭页面」的行为。

## 延后事项

- 硬删除（`sessionPersistence.remove` seam 加各后端）：回收站的清除／清空操作等待它。
- 冗余的 `listCollections`／`listDeletedSessions` 客户端动作（同一批集合随列表快照一同到达）；移除它们是一次横跨各个 fake 的后续清理。
- 会话页面上的搜索、排序与批量选择；`sessions.search` 在协议层上已经存在。
