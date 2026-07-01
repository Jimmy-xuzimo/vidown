#!/usr/bin/env bash
# Vidown 一键安装脚本 —— 安装系统依赖 + Python 包
# 用法：  bash scripts/install.sh [--with-optional]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

WITH_OPTIONAL=false
for arg in "$@"; do
  case $arg in
    --with-optional) WITH_OPTIONAL=true ;;
    --with-dev) INSTALL_DEV=true ;;
    *) ;;
  esac
done

echo "==> Vidown 安装脚本"
echo "    Python:    $(python3 --version 2>/dev/null || echo '未安装')"
echo "    平台:      $(uname -s)"

# ---- 1. 系统依赖 ----
echo ""
echo "==> 1/4 安装系统依赖 (ffmpeg/ffprobe)"

install_ffmpeg() {
  case "$(uname -s)" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        brew install ffmpeg
      else
        echo "  ! 未检测到 Homebrew，请手动安装 ffmpeg: https://brew.sh"
        return 1
      fi
      ;;
    Linux)
      if command -v apt >/dev/null 2>&1; then
        sudo apt update && sudo apt install -y ffmpeg
      elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y ffmpeg
      elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --noconfirm ffmpeg
      else
        echo "  ! 未知 Linux 发行版，请手动安装 ffmpeg"
        return 1
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "  ! Windows 请从 https://www.gyan.dev/ffmpeg/builds/ 下载"
      echo "    并将 ffmpeg.exe / ffprobe.exe 加入 PATH"
      ;;
  esac
}

if ! command -v ffmpeg >/dev/null 2>&1; then
  install_ffmpeg || echo "  ! ffmpeg 安装失败，请手动处理"
else
  echo "  ✓ ffmpeg:   $(ffmpeg -version | head -n1)"
fi

# ---- 2. Python 依赖 ----
echo ""
echo "==> 2/4 创建/激活 Python 虚拟环境"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate || true

python -m pip install --upgrade pip wheel setuptools

echo ""
echo "==> 3/4 安装核心 Python 依赖"
pip install -r requirements.txt

if [ "$WITH_OPTIONAL" = true ]; then
  echo ""
  echo "==> 安装可选依赖"
  pip install -r requirements-optional.txt
fi

if [ "$INSTALL_DEV" = true ]; then
  echo ""
  echo "==> 安装开发依赖"
  pip install -r requirements-dev.txt
fi

# ---- 4. 安装 Vidown ----
echo ""
echo "==> 4/4 安装 Vidown"
pip install -e .

echo ""
echo "==> 验证安装"
vidown check || true

echo ""
echo "==> 安装完成！"
echo "    启动 GUI:   vidown gui"
echo "    下载视频:   vidown <URL>"
echo "    查看帮助:   vidown --help"
