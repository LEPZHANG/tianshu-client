#!/usr/bin/env bash
# 把本地天枢代码推送到 https://github.com/LEPZHANG/tianshu-client.git
#
# 用法：
#   1. 先看一遍这个脚本（建议）
#   2. export GITHUB_TOKEN=你的token
#   3. bash push-tianshu.sh [分支名]        # 分支名默认 demo0928
#
# 重推同一个分支需要覆盖已有历史时（本脚本每次都是全新的 orphan 提交），
# 显式加 FORCE=1：
#   FORCE=1 bash push-tianshu.sh demo0928
#
# 只想演练、看会推哪些文件而不推送时，加 DRY_RUN=1（不需要 token）：
#   DRY_RUN=1 bash push-tianshu.sh
#
# 做什么：把三份代码合成一个仓库、一个提交，推到指定分支。
# 布局保持 dsh-desktop 的 file:../apps/cli 能解析的形状：
#
#   tianshu-client/
#     apps/  packages/  vendor/ ...   ← Harness 主体（含天枢改动）
#     dsh-desktop/                    ← Electron 客户端
#     dsh-webui-auth/                 ← 认证插件
#
# 不会包含：node_modules、.env、凭据文件（密码哈希/会话/审计密钥），
#           以及 EXCLUDE_PREFIXES 列出的本地杂项（参考稿截图、备份、生成器残留）
# 三份代码均为 MIT，各自 LICENSE 一并保留。

set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
REMOTE=https://github.com/LEPZHANG/tianshu-client.git
BRANCH="${1:-demo0928}"

# 本地杂项：git 未跟踪、也未被 .gitignore 收编，因此 ls-files --others 会把它们
# 列出来。仓库是公开的，参考稿截图与备份文件不属于源码。前缀匹配。
EXCLUDE_PREFIXES=(
  'kangao/'
  'packages/client/ui-primitives/src/FishLogo-backup.tsx'
  'packages/typert/generator/tests/.generated-model-'
)

# 演练在推送之前就结束，用不到 token。
if [ -z "${GITHUB_TOKEN:-}" ] && [ "${DRY_RUN:-0}" != 1 ]; then
  echo "错误：请先 export GITHUB_TOKEN=你的token" >&2
  exit 1
fi

STAGE=$(mktemp -d /tmp/tianshu-push.XXXXXX)

# 暂存目录里会有一个带凭据上下文的 .git；无论成败都不留在磁盘上。
# 自检失败时保留内容供排查，但仍抹掉 .git。
cleanup() {
  rm -rf "$STAGE/tree/.git" 2>/dev/null || true
  if [ "${KEEP_STAGE:-0}" = 1 ]; then
    echo "==> 暂存目录保留（已抹去 .git）：$STAGE" >&2
  else
    rm -rf "$STAGE"
  fi
}
trap cleanup EXIT

echo "==> 暂存目录：$STAGE"
echo "==> 目标分支：$BRANCH"

# ---- 1. 收集要推送的文件 ----------------------------------------------------
# git ls-files 同时列出「已跟踪」和「未跟踪但未被忽略」的文件，
# 因此 .gitignore 里的凭据、node_modules、.env 自动被排除。
# core.quotePath=false 保证中文文件名不被转义成 \345\276\256 这种形式。
cd "$SRC"
{
  git -c core.quotePath=false ls-files --cached --others --exclude-standard \
    | sed 's|^|./|'
  git -C dsh-desktop -c core.quotePath=false ls-files --cached --others --exclude-standard \
    | sed 's|^|./dsh-desktop/|'
  git -C dsh-webui-auth -c core.quotePath=false ls-files --cached --others --exclude-standard \
    | sed 's|^|./dsh-webui-auth/|'
} > "$STAGE/filelist.all.txt"

# 剔除本地杂项。只在「未跟踪」集合里剔，已跟踪的同名路径不动 —— 否则
# .generated-model-* 这种上游 master 带进来的已跟踪文件会被误伤，推上去的树
# 就跟仓库对不上了。
: > "$STAGE/drop.txt"
for prefix in "${EXCLUDE_PREFIXES[@]}"; do
  git -c core.quotePath=false ls-files --others --exclude-standard \
    | grep -F "$prefix" | sed 's|^|./|' >> "$STAGE/drop.txt" || true
done
if [ -s "$STAGE/drop.txt" ]; then
  grep -vxF -f "$STAGE/drop.txt" "$STAGE/filelist.all.txt" > "$STAGE/filelist.txt"
else
  cp "$STAGE/filelist.all.txt" "$STAGE/filelist.txt"
fi
dropped=$(wc -l < "$STAGE/drop.txt")

echo "==> 待推送文件数：$(wc -l < "$STAGE/filelist.txt")（已剔除 $dropped 个本地杂项）"

# ---- 2. 复制（逐文件，不展开目录）------------------------------------------
# 注意：不能用 tar -T，它遇到目录项会整个展开，会把 node_modules 和
# 凭据文件一起带进来（已实测踩过）。
mkdir -p "$STAGE/tree"
python3 - "$SRC" "$STAGE/tree" "$STAGE/filelist.txt" "$STAGE/copied.txt" <<'PY'
import os, shutil, sys
src, dst, listfile, copiedfile = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
copied = links = dirs = 0
deleted = []
out = open(copiedfile, 'w', encoding='utf-8')
for line in open(listfile, encoding='utf-8'):
    rel = line.rstrip('\n')
    if rel.startswith('./'):
        rel = rel[2:]          # 只去掉前缀，不能用 lstrip('./')，
    if not rel:                # 那会把 .agents/ 的点也吃掉（已实测踩过）
        continue
    s = os.path.join(src, rel)
    d = os.path.join(dst, rel)
    if os.path.islink(s):
        os.makedirs(os.path.dirname(d), exist_ok=True)
        if os.path.lexists(d):
            os.remove(d)
        os.symlink(os.readlink(s), d)
        links += 1
        out.write(rel + '\n')
    elif os.path.isfile(s):
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)
        copied += 1
        out.write(rel + '\n')
    elif os.path.isdir(s):
        dirs += 1              # 嵌套 git 仓库的目录项：其中的文件各自处理
    else:
        # git 索引里仍有记录，但磁盘上已删除（例如本轮移除的手机配对功能
        # 与已退役的 patches/）。不复制是正确的，但要报出来而不是静默跳过。
        deleted.append(rel)
out.close()
print(f"    复制 {copied} 个文件、{links} 个符号链接，跳过 {dirs} 个嵌套仓库目录项")
if deleted:
    print(f"    另有 {len(deleted)} 个文件在 git 索引中但磁盘上已删除，未复制：")
    for rel in deleted[:5]:
        print(f"      {rel}")
    if len(deleted) > 5:
        print(f"      ...其余 {len(deleted) - 5} 个")
    print("    （若这些是你有意删除的，属正常；否则请先在对应仓库 git rm）")
PY

# ---- 3. 安全自检（推送前最后一道）------------------------------------------
echo "==> 安全自检"
cd "$STAGE/tree"

fail=0
for f in dsh-webui-auth/dsh-webui-auth.json \
         dsh-webui-auth/sessions.jsonl \
         dsh-webui-auth/audit-hmac-key \
         dsh-webui-auth/audit.jsonl; do
  if [ -e "$f" ]; then
    echo "    ✗ 凭据文件混入：$f" >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "    ✓ 四个凭据文件均未混入"

if find . -name node_modules -type d | grep -q .; then
  echo "    ✗ node_modules 混入" >&2
  fail=1
else
  echo "    ✓ 无 node_modules"
fi

if find . -name '.env' -not -name '.env.example' | grep -q .; then
  echo "    ✗ .env 混入" >&2
  fail=1
else
  echo "    ✓ 无 .env"
fi

for L in LICENSE dsh-desktop/LICENSE dsh-webui-auth/LICENSE; do
  [ -f "$L" ] || { echo "    ✗ 缺少 $L" >&2; fail=1; }
done
[ "$fail" -eq 0 ] && echo "    ✓ 三份 MIT LICENSE 齐全"

# 三份代码确实都在：只数 LICENSE 不够，客户端跑不跑得起来取决于
# 这几个文件。dsh-desktop 的 file:../apps/cli 还要求 apps/ 在根目录。
for f in dsh-desktop/package.json \
         dsh-desktop/package-lock.json \
         dsh-desktop/src/main/index.ts \
         dsh-desktop/scripts/verify-harness-checkout.mjs \
         dsh-webui-auth/index.js \
         dsh-webui-auth/lib/client.js \
         dsh-webui-auth/package.json \
         apps/cli/package.json \
         apps/web/package.json \
         pnpm-lock.yaml; do
  [ -f "$f" ] || { echo "    ✗ 缺少关键文件：$f" >&2; fail=1; }
done
if [ "$fail" -eq 0 ]; then
  echo "    ✓ 三份代码到位：Harness $(find . -path ./dsh-desktop -prune -o -path ./dsh-webui-auth -prune -o -type f -print | wc -l) 个文件、dsh-desktop $(find dsh-desktop -type f | wc -l) 个、dsh-webui-auth $(find dsh-webui-auth -type f | wc -l) 个"
fi

if [ "$fail" -ne 0 ]; then
  echo "自检未通过，已中止。" >&2
  KEEP_STAGE=1
  exit 2          # 2 = 不可重试：重跑一次结果一样
fi

# ---- 4. 建仓并推送 ----------------------------------------------------------
echo "==> 创建提交"
git init -q -b "$BRANCH"
# -f：合并成单仓后根 .gitignore 会同时作用到 dsh-desktop/ 与 dsh-webui-auth/，
# 把它们各自仓库里本来已跟踪的文件吃掉（实测：根规则 lib/ 吃掉
# dsh-webui-auth/lib/client.js，而那是客户端登录必需的文件）。哪些文件该进树
# 已经在第 1、2 步决定完了，这里不该再过一遍忽略规则。
git add -A -f

# 对账：实际进入索引的，必须与实际复制出来的逐一相等。
git -c core.quotePath=false ls-files | sort > "$STAGE/got.txt"
sort "$STAGE/copied.txt" > "$STAGE/want.txt"
missing=$(comm -23 "$STAGE/want.txt" "$STAGE/got.txt")
if [ -n "$missing" ]; then
  echo "    ✗ 有文件复制出来了却没进提交：" >&2
  printf '%s\n' "$missing" | head -20 >&2
  echo "      （共 $(printf '%s\n' "$missing" | wc -l) 个）" >&2
  KEEP_STAGE=1
  exit 2
fi
echo "    ✓ 复制出的 $(wc -l < "$STAGE/want.txt") 个文件全部进入提交"

if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "==> DRY_RUN=1：到此为止，不创建提交也不推送。"
  exit 0
fi

git -c user.name="${GIT_AUTHOR_NAME:-$(git -C "$SRC" config user.name || echo tianshu)}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-$(git -C "$SRC" config user.email || echo tianshu@local)}" \
    commit -q -m "天枢平台：基于 DeepSeek Harness 的桌面客户端（$BRANCH）

包含三部分：
- Harness 主体（apps/、packages/、vendor/），含天枢品牌与 UI 改动
- dsh-desktop/     Electron 桌面客户端
- dsh-webui-auth/  登录认证插件

本快照包含：
- 办公六件套：格式转换（LibreOffice / pandoc / poppler / Microsoft Office / WPS）
  与 GB/T 9704—2012 公文生成（字体内嵌、层次字体只落在标题上）
- PDF 转 Word：装有 Microsoft Word 时由 Word 重排为可编辑文档，
  否则走 LibreOffice 的版面导入；输出文件名冲突时自动改名
- 离线工具包、ECharts 本地化、Windows 打包流程

三者均为 MIT 许可，各自 LICENSE 保留在对应目录。
上游：deepseek-ai/deepseek-harness、dataelement/dsh-desktop、Yuuz12/dsh-webui-auth"

echo "==> 推送到 $REMOTE（分支 $BRANCH）"
# token 只经由 GIT_ASKPASS 从环境变量取，既不写进 .git/config，也不进 argv。
cat > "$STAGE/askpass.sh" <<'ASKPASS'
#!/bin/sh
case "$1" in
  Username*) echo x-access-token ;;
  *)         printf '%s' "$GITHUB_TOKEN" ;;
esac
ASKPASS
chmod 700 "$STAGE/askpass.sh"

git remote add origin "$REMOTE"
push_args=(origin "HEAD:refs/heads/$BRANCH")
if [ "${FORCE:-0}" = 1 ]; then
  echo "    FORCE=1：将覆盖远端 $BRANCH 已有的历史"
  push_args+=(--force)
fi
set +e
GIT_ASKPASS="$STAGE/askpass.sh" GIT_TERMINAL_PROMPT=0 \
  git push "${push_args[@]}" 2>&1 | tee "$STAGE/push.log"
push_status=${PIPESTATUS[0]}
set -e

if [ "$push_status" -ne 0 ]; then
  if grep -qiE 'rejected|non-fast-forward' "$STAGE/push.log"; then
    echo >&2
    echo "推送被拒。本脚本每次都生成全新的 orphan 提交，与远端 $BRANCH 没有共同祖先，" >&2
    echo "所以只要该分支已存在就会被拒。确认要覆盖它，就重跑：" >&2
    echo "    FORCE=1 bash push-tianshu-run.sh $BRANCH" >&2
    exit 3        # 3 = 不可重试：网络通，是远端拒绝
  fi
  echo "推送未完成（网络或代理问题），可以重试。" >&2
  exit 1
fi

echo
echo "==> 完成：https://github.com/LEPZHANG/tianshu-client/tree/$BRANCH"
echo
echo "提醒：token 未落盘，但仍建议用完到 GitHub 撤销并重建。"
