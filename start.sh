#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "========================================="
echo "   🚀 启动 Kimi Code 桌面版 (macOS Desktop)  "
echo "========================================="

# 开发者调试模式 (终端前台输出日志)
if [ "$1" = "--dev" ]; then
  echo "[模式] 开发者调试模式 (终端前台附着)..."
  npm run dev
  exit 0
fi

# 优先启动系统 Applications 目录下的独立桌面应用（完全脱离终端生命周期）
if [ -d "/Applications/Kimi Code.app" ]; then
  echo "[1/1] 启动 macOS 原生独立桌面应用..."
  open "/Applications/Kimi Code.app"
  echo "✅ Kimi Code 已成功启动！您可以直接关闭此终端，应用完全不受影响。"
  exit 0
fi

# 其次检查 release 编译产物
if [ -d "release/mac-arm64/Kimi Code.app" ]; then
  echo "[1/1] 启动独立桌面应用..."
  open "release/mac-arm64/Kimi Code.app"
  echo "✅ Kimi Code 已成功启动！您可以直接关闭此终端，应用完全不受影响。"
  exit 0
fi

# 兜底：构建并后台无感启动
if [ ! -f "dist/main/index.cjs" ]; then
  echo "[1/2] 正在编译桌面主进程..."
  node scripts/build.mjs
fi

echo "[2/2] 正在后台独立启动桌面客户端..."
nohup npx electron . >/dev/null 2>&1 &
echo "✅ Kimi Code 已在后台运行，您可以直接关闭此终端！"
