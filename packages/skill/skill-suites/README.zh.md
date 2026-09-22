# @deepseek-ai/dsh-skill-suites

[English](README.md) | 中文

内置专家套件目录：每个套件是一组 skill（技能），安装时会把随包分发的 SKILL.md 正文写入用户 skill 根目录。

## 模型

- 套件表是随包交付的常量（`src/catalogue.ts`）；套件没有远程来源（产品决策）。
- 安装会把每个随包分发的 skill 写入 `$DSH_HOME/skills/<name>/SKILL.md`。**安装状态就是文件是否存在**：不另存记录，因此手动删掉目录即等于卸载，重新安装也是幂等的。
- 卸载只删除其中 SKILL.md 的哈希仍与随包正文一致的目录；被用户编辑过的 skill 得以保留。
- 本包从不触碰 skill 注册表：文件系统提供方（`dsh-skill-filesystem`）在下一次扫描时发现已安装的 skill，与手写 skill 走的是同一条路径。

## 模型体验

与实时请求无关：安装或卸载套件只是在用户 skill 根目录下写入或删除文件，因此不存在任何请求前缀或 KV Cache 影响。

## 已知限制与暂缓事项

- 安装不会强制提供方重新扫描：composer 的 `/` 菜单按提供方自身的扫描节奏反映新安装的 skill，而不是立即反映。
- 目前只交付一个套件（`office-essentials`，含六个 skill）；套件表是新增套件的唯一位置。
