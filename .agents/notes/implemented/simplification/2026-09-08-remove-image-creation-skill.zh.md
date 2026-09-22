# Agent Note: 从内置办公套件移除「图像创作」技能

Status: implemented

[English](2026-09-08-remove-image-creation-skill.md) | 中文

## Problem

`office-essentials` 套件原本内含五个技能，其中「图像创作」（`image-creation`）只是把模糊需求扩写成文生图提示词，再交给外部绘画工具。本 harness 没有任何图像生成工具，因此该技能在产品内没有通往结果的路径：它教了一套 `/image-creation` 调用约定，终点却只是一段用户得拿到别处去用的提示词——读起来像是产品具备、实则并不具备的能力。

先前的[「发送到对话」预填改动](../bug-fix/2026-09-08-tianshu-send-to-composer-prefill.md)已从天枢 UI 的本地内置目录里去掉了 `image-creation`，但服务端可安装的套件（[`skill-suites/src/catalogue.ts`](../../../../packages/skill/skill-suites/src/catalogue.ts)）仍带着它——安装仍会把它的 `SKILL.md` 写到磁盘，文件系统 provider 仍会发现它。两份目录不一致。

## Decision

从 `BUILTIN_SUITES` 中彻底移除 `image-creation`：`IMAGE_CREATION` 技能体常量与套件里的该技能条目一并删除。`office-essentials` 现为四个技能——`data-visualization`、`weekly-report`、`data-analysis`、`tech-proposal`——标题改为「办公四件套」，描述列表同步更新。两份目录（天枢 UI 本地表与服务端套件）现对同样这四个达成一致。

## Alternatives considered

**保留它，但标记为不支持或藏到开关后面。** 否决：内置常量套件没有按技能的可见性开关，为压掉单一条目而新增一个，代价大于这个条目本身的价值。一个产品无法兑现的技能，比它不存在更糟。

**服务端套件继续带着它，只在 UI 里隐藏。** 否决：无论 UI 如何，安装都会把每个打包的 `SKILL.md` 写进 `$DSH_HOME/skills/<name>/`，文件系统 provider 下次扫描即会发现。套件表是「一个套件包含什么」的唯一来源，因此移除必须发生在这里，而非表现层。

## Consequences

全新安装 `office-essentials` 现写入四个 `SKILL.md`。安装状态即文件存在，卸载只移除套件仍在打包的那些文件，因此早先安装写下的 `image-creation/SKILL.md` 现成了孤儿：卸载不再触碰它，用户需像删除任何手动添加的技能那样手工删掉该目录。无 wire、RPC 或 schema 界面变更——这是一次目录内容移除。套件名断言与「保留用户编辑」的卸载用例（原先编辑的是 `image-creation`）现改用 `tech-proposal`；`skill-suites` README 的技能数从五个改为四个。
