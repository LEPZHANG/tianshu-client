# Agent Note: 把格式转换 skill 加入随发行版交付的办公套件

Status: implemented

[English](2026-09-15-office-essentials-format-convert-skill.md) | 中文

## 问题

[文档转换能力 seam](../architecture/2026-09-15-document-conversion-capability-seam.md) 给了 harness 一个真正可用的 `convert_document` 工具，但产品里没有任何东西告诉模型该怎么用好它。有两项判断决定一次转换是否有用，而工具自己做不了这两项判断：

- **哪些格式对是存在的。** 族内转换和导出为 PDF 是齐全的；`xlsx → pptx` 这类跨族格式对则不是，工具会拒绝它们。把拒绝当成偶发失败的模型会绕道而行，最后产出一个用户打不开的文件。
- **`fidelity` 带来什么义务。** `lossy` 的结果意味着内容保住了、版式没保住。工具负责报出它，而只有模型能把它讲给用户。

`office-essentials` 套件正是产品教授此类判断的地方——它把高频办公交付物对应的 skill（技能）打包在一起。转换应当与它们并列，而不是另设一处独立入口。

## 决策

把 `format-convert`（格式转换）作为 `office-essentials` 的第五个 skill 加入，套件标题改为办公五件套。`FORMAT_CONVERT` 技能体写明工具的四个参数、按格式族划分的可达格式对、跨族目标的拒绝规则，以及把 `lossy` 转述为具体损失而不是一句免责提醒的义务。

这个 skill 教模型用好工具，但不对它设门槛。`convert_document` 由 base bundle 中的 [`dsh-tool-document-convert`](../../../../packages/convert/tool-document-convert/README.md) 注册，无论套件是否安装都可用——安装套件增加的是指导，从不增加能力。

两份目录同步改动，这是[移除 image-creation skill](../simplification/2026-09-08-remove-image-creation-skill.md) 确立的做法：一份是 [`skill-suites/src/catalogue.ts`](../../../../packages/skill/skill-suites/src/catalogue.ts) 中随发行版交付的表，另一份是天枢 UI 本地的 `BUILTIN_SKILLS` 回退表——当前没有会话时，由它顶替 Host 那个按会话寻址的 `skill.list`。该 skill 的 UI 分类是 `doc`。

## 曾考虑的替代方案

**改为把这些指导放进工具的系统提示词分节。** 不予采用：那个分节是无条件的，于是每个部署的每次请求都会带上它。格式族可达性和 lossy 转述规则的篇幅足够长，会让从不做转换的会话也付出请求前缀的代价。skill 是按需加载的，这正是这部分内容应得的待遇。

**作为独立套件发布。** 不予采用：只含一个 skill 的套件，就是一张用户为单个文件去安装的卡片，而套件这一层是产品的粗粒度分组。转换和另外四项一样，同样是一种办公交付物。

**在技能体里用一张表写死可达的格式对。** 不予采用：路由表在各个提供方手里，新增提供方或缺少某个可执行文件时它就会变。抄一份到 SKILL.md 里会悄无声息地过时，而工具本来就会拒绝它做不到的事。这个 skill 只按格式族说明规则，其余交给拒绝行为。

## 后果

全新安装 `office-essentials` 会写入五个 `SKILL.md` 文件，`/format-convert` 是其中之一。安装状态即文件存在，卸载只移除哈希仍与打包技能体一致的目录，因此已有的四技能安装在重装时会得到第五个文件，不需要任何迁移。

模型可见文本位于安装好的 SKILL.md 中，而不在请求前缀里，因此本次改动不带来任何默认提示词或 KV Cache 上的影响；套件列表 RPC 多出一行 `SuiteSkillView`。`skill-suites` 中的目录断言与天枢技能页的计数（五行，三个 `doc`，两个 `data`）随该表一同改动。
