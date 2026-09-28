#!/usr/bin/env bash
# 一句话启动天枢桌面客户端（开发模式 / 热重载）。
#
# 用法：
#   bash start-client.sh
#
# 做的事：
#   1. cd 到 dsh-desktop（脚本放在 deepseek-harness 根目录，位置无关）
#   2. 自动修复 Electron 的 chrome-sandbox（需 setuid-root，否则渲染进程沙箱拒绝启动）
#      —— 没配好就自动 sudo 修一次；修复要输你的密码
#   3. 清掉 ELECTRON_RUN_AS_NODE —— 本机全局设了 =1，不清 Electron 会当纯 Node 跑、不开窗口
#   4. electron-vite dev（现编译 + 热重载，改代码即时生效）

set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")" && pwd)/dsh-desktop"

if [ ! -f "$DESKTOP_DIR/package.json" ]; then
  echo "错误：找不到 $DESKTOP_DIR/package.json" >&2
  exit 1
fi

# ---- 1. chrome-sandbox 自检与自动修复 --------------------------------------
# 开发模式用 node_modules/electron/dist/ 里的 Electron；它的 chrome-sandbox 必须
# 属主 root + 权限 4755，否则报 "SUID sandbox helper ... not configured correctly"
# 并整个退出。npm install / 重装 electron 会把它冲回 lep:755，所以每次起都自检。
SANDBOX="$DESKTOP_DIR/node_modules/electron/dist/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  owner="$(stat -c '%U' "$SANDBOX")"
  mode="$(stat -c '%a' "$SANDBOX")"
  if [ "$owner" != "root" ] || [ "$mode" != "4755" ]; then
    echo "==> chrome-sandbox 未正确配置（当前 $owner:$mode，需 root:4755），自动修复……"
    echo "    （需要 sudo，请输入你的密码）"
    sudo chown root:root "$SANDBOX"
    sudo chmod 4755 "$SANDBOX"
    echo "==> chrome-sandbox 已修复"
  fi
fi

# ---- 2. 启动 ----------------------------------------------------------------
cd "$DESKTOP_DIR"
echo "==> 启动客户端（开发模式）：$DESKTOP_DIR"
exec env -u ELECTRON_RUN_AS_NODE npm run dev
