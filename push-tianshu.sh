#!/usr/bin/env bash
# 把本地天枢代码推送到 https://github.com/LEPZHANG/tianshu-client.git
#
# 用法：
#   1. 先看一遍这个脚本（建议）
#   2. export GITHUB_TOKEN=你的token
#   3. bash push-tianshu.sh
#
# 做什么：把三份代码合成一个仓库、一个提交，推到 main 分支。
# 布局保持 dsh-desktop 的 file:../apps/cli 能解析的形状：
#
#   tianshu-client/
#     apps/  packages/  vendor/ ...   ← Harness 主体（含天枢改动）
#     dsh-desktop/                    ← Electron 客户端
#     dsh-webui-auth/                 ← 认证插件
#
# 不会包含：node_modules、.env、凭据文件（密码哈希/会话/审计密钥）
# 三份代码均为 MIT，各自 LICENSE 一并保留。

set -euo pipefail

SRC=/home/lep/agents/deepseek-harness
REMOTE=https://github.com/LEPZHANG/tianshu-client.git
STAGE=$(mktemp -d /tmp/tianshu-push.XXXXXX)

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "错误：请先 export GITHUB_TOKEN=你的token" >&2
  exit 1
fi

echo "==> 暂存目录：$STAGE"

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
} > "$STAGE/filelist.txt"

echo "==> 待推送文件数：$(wc -l < "$STAGE/filelist.txt")"

# ---- 2. 复制（逐文件，不展开目录）------------------------------------------
# 注意：不能用 tar -T，它遇到目录项会整个展开，会把 node_modules 和
# 凭据文件一起带进来（已实测踩过）。
mkdir -p "$STAGE/tree"
python3 - "$SRC" "$STAGE/tree" "$STAGE/filelist.txt" <<'PY'
import os, shutil, sys
src, dst, listfile = sys.argv[1], sys.argv[2], sys.argv[3]
copied = links = dirs = 0
deleted = []
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
    elif os.path.isfile(s):
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)
        copied += 1
    elif os.path.isdir(s):
        dirs += 1              # 嵌套 git 仓库的目录项：其中的文件各自处理
    else:
        # git 索引里仍有记录，但磁盘上已删除（例如本轮移除的手机配对功能
        # 与已退役的 patches/）。不复制是正确的，但要报出来而不是静默跳过。
        deleted.append(rel)
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
  echo "自检未通过，已中止。暂存目录保留：$STAGE" >&2
  exit 1
fi

# ---- 4. 建仓并推送 ----------------------------------------------------------
echo "==> 创建提交"
git init -q -b main
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-$(git -C "$SRC" config user.name || echo tianshu)}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-$(git -C "$SRC" config user.email || echo tianshu@local)}" \
    commit -q -m "天枢平台：基于 DeepSeek Harness 的桌面客户端

包含三部分：
- Harness 主体（apps/、packages/、vendor/），含天枢品牌与 UI 改动
- dsh-desktop/     Electron 桌面客户端
- dsh-webui-auth/  登录认证插件

三者均为 MIT 许可，各自 LICENSE 保留在对应目录。
上游：deepseek-ai/deepseek-harness、dataelement/dsh-desktop、Yuuz12/dsh-webui-auth"

echo "==> 推送到 $REMOTE"
git remote add origin "https://${GITHUB_TOKEN}@github.com/LEPZHANG/tianshu-client.git"
git push -u origin main --force

echo
echo "==> 完成：https://github.com/LEPZHANG/tianshu-client"
echo "==> 清理暂存目录：rm -rf $STAGE"
echo
echo "提醒：本次用过的 token 已出现在命令历史与 git remote 中。"
echo "      推送完成后请到 GitHub 撤销并重建。"
