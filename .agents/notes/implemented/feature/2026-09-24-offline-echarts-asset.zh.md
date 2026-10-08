# Agent Note：把 ECharts 随交付它的包一起发出去

Status: implemented

[English](2026-09-24-offline-echarts-asset.md) | 中文

## 问题

数据可视化 skill 让模型围绕 `https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js` 拼图表页。本产品装在没有外网出口的局域网里，这个引用解析不到任何东西。

值得修而不是只写进文档的原因，在于它失败得毫无声息：模型成功了，文件写出来了，用户双击打开，得到一张白板。没有工具报错，对话记录看上去完全正确，页面上也没有任何字告诉用户缺的是一次网络请求。

它也是最后一处。在 `src/catalogue.ts` 里 grep `http` 只命中这一行；其余五个 skill 正文不把模型引向任何地方。

## 决策

### 库随安装该 skill 的那个包一起交付

`packages/skill/skill-suites/assets/echarts/` 里放 `echarts.min.js`（上游 `echarts@5.6.0` 的 `dist/echarts.min.js`，未作修改）和 `echarts-LICENSE.txt`。`package.json` 的 `files` 加了 `assets/**`，npm 包因此带上它们。

备选是给包加一个 `echarts` npm 依赖。否决的理由是它会把正要去掉的东西重新引进来：解析这个库变成一件「必须在某台能连上 registry 的机器上发生过」的事，而失败点会挪到没人会去看的地方。提交进仓库的字节对每一条安装路径都成立——桌面安装包、纯 CLI、隔离网络上的一次 clone——中间不需要任何步骤。

`vendor/` 这条路也走不通：`scripts/gen-third-party-notices.ts` 里的 `collectVendored()` 要求 `vendor/<dir>/package.json`，并对任何非 MIT 许可直接抛错，而 ECharts 是 Apache-2.0。

### 交付点是 skill 目录，因为模型本来就被告知了它

`BundledSkill` 新增可选的 `assets` 列表，`install()` 把每一项写进 skill 目录、与 SKILL.md 并列。不需要新的配置键，路径也从不必进入 skill 正文，因为机制早已存在：

`skill-filesystem` 把每个发现到的 skill 的目录报为 `resourceBase: { kind: 'directory', path }`（[`src/index.ts:217`](../../../../packages/skill/skill-filesystem/src/index.ts)），`dsh-skill` 据此向模型渲染 `Base directory for this skill: <path>`，随后是一句「把相对路径按基目录解析」的指示（[`src/index.ts:197`](../../../../packages/skill/skill/src/index.ts)）。因此正文里写 `echarts.min.js`，指的就是一个模型找得到的文件。

skill 正文现在产出一个文件夹——`<图表名>.html`、`echarts.min.js`、`echarts-LICENSE.txt`——页面加载 `./echarts.min.js`。这个文件夹可以整体拷到共享盘或发给同事，离线照样打开，而此前那个单文件离开网络就做不到。许可文本一同随行，因为把文件夹交给别人就是一次 Apache-2.0 代码的分发。

### 页面写的是可回落的字体栈，而不是某一款字体

技能要求 `font-family` 写成以通用族（`sans-serif`）收尾的栈，并禁止把某一款具体字体当作唯一字体。图表页会在收到它的那台机器上打开，而向一台没装该字体的机器索要它，结果并不是白板：浏览器静默替换、标签重新折行，什么都不会报——与随包库要避免的是同一类失败，只是换了一个属性。这条规则与「绝不引用 CDN」并排放在技能正文里，因为两者说的都是同一个问题：页面要能只靠随它一起发出去的东西活下来。

### 安装状态仍然只看目录是否存在

`list()` 原样不动。「目录就是记录」是写明的产品决策，升级这个场景不值得为它破例：被用户改过的正文绝不能被报成未安装，而基于内容的判定恰恰会这么做。代价记进包 README 的限制条目：在随包资源出现之前装过的 skill 会继续报为已安装，且目录里没有资源文件，直到该套件被再安装一次。

资源写入按字节比对做幂等，与既有的 SKILL.md `bodyHash` 判定同构。损坏的资源会在下一次安装时重写，完好的则不被触碰。

## 门禁

两条包内测试守住那条促成本轮改动的不变量：

- 任何随包 skill 正文都不匹配 `https?://`，CDN 引用因此无法借由某个将来的 skill 回来；
- 每个声明的资源都在磁盘上存在，并被那条必须复制它的正文点名，声明与文件因此无法各走各的。

`scripts/gen-third-party-notices.ts` 新增了 `BUNDLED_ASSETS` 表和一节 `## Bundled assets`。该文档的其余每一层都由某份清单推导而来，所以一个提交进包里的文件本来会无处披露；`collectBundledAssets()` 在某一行指向树里没有的文件时失败。

## 后果

仓库里从此有一个 1MB 的压缩文件，是仓库中最大的一个，超过 `pnpm-lock.yaml`。它逐字提交、从不就地修改：升版本时，文件、许可文本、以及 `THIRD_PARTY_NOTICES.md` 里记的版本号一起换。

一张图表现在是一个约 1MB 的文件夹，而不是单个 HTML 文件，被拷走或发出去的单位是这个文件夹。只把其中的 `.html` 单独拿出去的用户，又会得到本轮消除掉的那张白板。

已有的安装会继续报为已装，而目录里没有资源文件。再安装一次该套件即可拿到，届时凡字节与随包副本不符的资源都会被重写。

## 曾考虑的替代方案

- **用 shell 拼接把库内联进每个 HTML**。产出确实自包含，代价是每张图 1MB，且依赖一个各平台命令不同的 shell 工具。作为收益最小、最易碎的方案否决。
- **用绝对路径引用 skill 目录**。产出最小，但页面只能在制作它的那台机器上打开——而图表本来就是拿来发给别人的。
- **在 `dsh-desktop/scripts/fetch-convert-tools.mjs` 里随 LibreOffice、poppler 一起下载**。与其他离线工具一致，但只有桌面安装包够得着，且 skill 还需要一个配置路径才能找到它。
