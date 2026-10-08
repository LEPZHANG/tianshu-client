#!/usr/bin/env bash
# 一键推送到 https://github.com/LEPZHANG/tianshu-client.git 的包装脚本。
#
# 用法：
#   bash push-tianshu-run.sh [分支名]          # 分支名默认 demo0928
#   FORCE=1 bash push-tianshu-run.sh demo0928  # 覆盖远端该分支已有的历史
#
# 它做三件事：
#   1. 设置本机代理（直连 GitHub 不通，走 verge-mihomo 的 7897）
#   2. 安全地提示你粘贴 GitHub token（不回显、不写文件、不进 shell 历史）
#   3. 调用已有的 push-tianshu.sh（内含安全自检：凭据文件/node_modules/.env 不会被推）
#
# token 只存在于本进程内存，脚本结束即释放；push-tianshu.sh 经 GIT_ASKPASS
# 取用它，不写进 .git/config、也不出现在进程参数里。

set -euo pipefail

cd "$(dirname "$0")"

BRANCH="${1:-demo0928}"

if [ ! -f push-tianshu.sh ]; then
  echo "错误：当前目录找不到 push-tianshu.sh" >&2
  exit 1
fi

# ---- 1. 代理 ----------------------------------------------------------------
PROXY="${TIANSHU_PROXY:-http://127.0.0.1:7897}"
export https_proxy="$PROXY" http_proxy="$PROXY" ALL_PROXY="$PROXY"
echo "==> 使用代理：$PROXY"

# 探测代理是否可用（连不上就早点报错，别等 git push 超时）
if ! curl -sS -o /dev/null -x "$PROXY" --max-time 20 https://github.com; then
  echo "错误：通过代理 $PROXY 连不上 github.com。" >&2
  echo "     确认 verge-mihomo 在跑，或用 TIANSHU_PROXY=http://IP:端口 覆盖。" >&2
  exit 1
fi
echo "==> 代理连通 GitHub 正常"

# ---- 2. token（安全输入）----------------------------------------------------
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "==> 使用环境变量里已有的 GITHUB_TOKEN"
else
  # -s 不回显；读进变量不落盘、不进历史
  read -r -s -p "粘贴 GitHub token（输入不显示，回车确认）: " GITHUB_TOKEN
  echo
  if [ -z "$GITHUB_TOKEN" ]; then
    echo "错误：没有输入 token，已中止。" >&2
    exit 1
  fi
  export GITHUB_TOKEN
fi

# ---- 2.5 让 git 通过代理推大体量数据更稳 ------------------------------------
# GnuTLS 经 CONNECT 代理推大 body 时容易 "handshake failed / non-properly
# terminated"。用 GIT_CONFIG_* 注入配置（只影响本次子进程，不动全局 ~/.gitconfig）：
#   - http.version HTTP/1.1  ：避开 HTTP/2 over 代理的握手问题
#   - http.postBuffer 512MB  ：一次性推大提交不被截断
#   - lowSpeedLimit/Time     ：慢速时给足时间，别过早判失败
export GIT_CONFIG_COUNT=4
export GIT_CONFIG_KEY_0=http.version   GIT_CONFIG_VALUE_0=HTTP/1.1
export GIT_CONFIG_KEY_1=http.postBuffer GIT_CONFIG_VALUE_1=524288000
export GIT_CONFIG_KEY_2=http.lowSpeedLimit GIT_CONFIG_VALUE_2=0
export GIT_CONFIG_KEY_3=http.lowSpeedTime  GIT_CONFIG_VALUE_3=999999

# ---- 3. 调用真正的推送脚本（失败自动重试至多 3 次）--------------------------
echo "==> 开始执行 push-tianshu.sh（分支 $BRANCH）"
attempt=1
until bash push-tianshu.sh "$BRANCH"; do
  status=$?
  # 2 = 安全自检未过，3 = 远端拒绝。重跑结果一样，而每次重跑都要再复制一遍
  # 整棵工作树，所以只对网络类失败（1）重试。
  if [ "$status" -eq 2 ] || [ "$status" -eq 3 ]; then
    echo "==> 失败原因与网络无关（退出码 $status），不重试。" >&2
    exit "$status"
  fi
  if [ "$attempt" -ge 3 ]; then
    echo "==> 已重试 $attempt 次仍失败（退出码 $status），放弃。" >&2
    exit "$status"
  fi
  echo "==> 第 $attempt 次失败，5 秒后重试……" >&2
  attempt=$((attempt + 1))
  sleep 5
done

echo
echo "======================================================================"
echo "  推送流程结束。请立刻到 GitHub 撤销并重建刚才用过的 token："
echo "  Settings → Developer settings → Personal access tokens"
echo "======================================================================"
