# Agent Note: 移除被恢复的首启测试阶段声明

Status: implemented

[English](2026-09-21-remove-first-run-testing-notice.md) | 中文

## 问题

GUI 每次首启仍然会在凭据步骤之前先显示一份内测声明。它的文案通篇讲的是「DeepSeek Harness 0.1」是一个内部测试版本，而本产品的外壳并不这样呈现自己。这个步骤就是[共用弹窗的产品引导](../feature/2026-08-13-shared-modal-product-onboarding.md)中描述的那次恢复，而那次恢复本身又接续了[移除首次启动内测声明](2026-08-13-remove-first-run-beta-notice.md)删掉的那份声明。

## 决策

把这份声明从产品中删除，而不是注销它或改写它，等于撤回共用弹窗那次恢复中属于声明的那一半。`ui-settings-models` 保留它的 Models 页面和 `deepseek-official` 凭据步骤；`WelcomeNotice` 组件及其样式表、`WelcomeNoticeStore`、承载文案与版本的 `onboarding-copy.ts`、两个语言侧的那五个 `welcome*` locale 键、两项包测试、远程确认的 e2e 用例及其 aria golden 全部消失。`settings.onboarding` 仍是一个 slot，随发行版交付的占位只剩一个，外壳也仍然只挂载第一个未完成的条目。

**Host 保留 `ui-onboarding` namespace 的注册**，理由与 2026-08-13 那次移除给出的一致：既有设置文档已经包含该分节，而设置 seam 会用已注册的 namespace 校验存储文档。因此 `welcomeNoticeVersion` 继续留在 `ui-settings-general` 的 schema 里，且没有任何随发行版交付的写入方，两份 README 都写明了这一点。

## 曾考虑的替代方案

**注销该步骤，代码原地保留。** 不予采用：组件、store、文案所有者和 locale 键都会变成无引用的导出，`knip` 会把它们报出来，也会让下一个读代码的人分不清这是一个已退役的步骤，还是一个坏掉的步骤。

**按本产品改写文案。** 不予采用：用户要的是这条通知消失，而一个没有实质内容的强制首启插页只剩下打扰——这与 2026-08-13 那次移除作出的判断相同。

**连 `ui-onboarding` namespace 一起注销。** 再次不予采用，理由未变：包含该分节的存储文档会无法通过校验。

## 后果

首启现在直接打开凭据弹窗，因此 `onboarding-deepseek-config.e2e.ts` 改为基于该弹窗自己的 `aria-label` 断言接管界面框架，不再需要一个处于确认之前的 scaffold 状态。scaffold 的 `welcomeNoticePending` 选项及其镜像的 welcome 常量一并删除；那些常量是[Remote 事件投递](../architecture/2026-08-10-remote-event-delivery.md)中 Host／Client 镜像规则仅存的示例，因此 `apps/web/tests/README.md` 保留该规则，去掉那处引用。`welcome-store.ts` 退出了 `vitest.config.ts` 中的逐文件覆盖率排除清单。

`OnboardingModal` 随着它唯一的调用方一起失去了 `focusTitle` prop：凭据步骤改为聚焦自己的密钥输入框，因此这个选项没有了当前的归属方，它那条分支也没有测试。

未来的版本化首启步骤可以通过保持不变的 `settings.onboarding` seam 注册，并经既有的公开 settings API 访问 `welcomeNoticeVersion`；后端约定没有任何变化。
