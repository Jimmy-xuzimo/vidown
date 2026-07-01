# Vidown —— 跨平台打包指南

本项目使用 PyInstaller 进行跨平台打包，并提供 GitHub Actions 自动构建。

## 产物概览

| 平台 | 格式 | 命令 |
|------|------|------|
| Windows | 单文件 `.exe` | `vidown.exe --version` |
| macOS (Intel) | 单文件 + `.app` | `./vidown` 或双击 `Vidown.app` |
| macOS (Apple Silicon) | 单文件 + `.app` | 同上，原生 arm64 |
| Linux | 单文件 + `AppImage` | `./vidown` 或 `./Vidown-x86_64.AppImage` |

## 本地打包

### 准备工作

```bash
# 1. 克隆与安装
git clone https://github.com/vidown/vidown.git
cd vidown
pip install -r requirements-dev.txt
pip install -e .

# 2. 安装 FFmpeg（必需，运行时外部依赖）
#    macOS:   brew install ffmpeg
#    Ubuntu:  sudo apt install ffmpeg
#    Windows: choco install ffmpeg
```

### 一键打包

```bash
# 默认：单文件 + 冒烟测试
python scripts/build.py --clean --verify

# macOS：额外生成 .app
python scripts/build.py --clean --verify --app

# Linux：额外生成 AppImage
python scripts/build.py --clean --verify --appimage

# 目录模式（调试用，体积更小）
python scripts/build.py --onedir --verify

# 不使用 UPX 压缩（避免某些杀软误报）
python scripts/build.py --no-upx --verify
```

### 手动指定 spec

```bash
# 完全使用 spec 文件
pyinstaller scripts/vidown.spec --noconfirm --clean

# onedir 模式（通过环境变量）
VIDOWN_ONEDIR=1 pyinstaller scripts/vidown.spec
```

### 验证产物

```bash
# macOS / Linux
./dist/vidown --version
./dist/vidown check
./dist/vidown gui --port 8765

# Windows
dist\vidown.exe --version
dist\vidown.exe check
dist\vidown.exe gui
```

## 打包结构

```
dist/
├── vidown                    # 单文件可执行（24 MB）
└── vidown/                   # onedir 模式
    ├── vidown                # 启动器
    └── _internal/            # 依赖与资源
        ├── configs/
        ├── vidown/
        │   ├── cli/
        │   ├── core/
        │   ├── engines/
        │   ├── postprocess/
        │   ├── data/
        │   ├── utils/
        │   └── gui/
        │       ├── templates/
        │       └── static/
        ├── yt_dlp/           # 主引擎
        ├── requests/
        ├── m3u8/
        └── ...
```

## 关键技术细节

### 入口脚本分离

`scripts/vidown_entry.py` 是 PyInstaller 的唯一入口。它专门设计为**不依赖相对导入**：

```python
# 1. 注入 sys.path
_setup_path()

# 2. 走包导入
from vidown.cli import main
```

为什么要单独写？因为 `vidown/__main__.py` 与 `vidown/cli/main.py` 内部使用 `from ..core...` 这类相对导入，而 PyInstaller 冻结后会丢失包结构。`vidown_entry.py` 通过 `sys.path` 注入后用绝对导入 `from vidown.cli import main`，绕开这个问题。

### Spec 文件

`scripts/vidown.spec` 集中管理：

- **数据文件**：configs、GUI 模板、静态资源
- **隐藏导入**：yt-dlp 的所有 extractor、you-get、gallery-dl
- **运行时 hook**：设置资源目录与用户配置目录
- **排除项**：tkinter、matplotlib、IPython 等

### PyInstaller Hooks

`scripts/pyinstaller_hooks/`：

- `hook-yt_dlp.py`：递归收集所有 extractor（1700+）
- `hook-vidown.py`：递归收集 vidown 子包
- `hook-browser_cookie3.py`：浏览器 Cookie 导入依赖
- `hook-m3u8.py`：HLS 加密流支持
- `runtime_hook.py`：冻结时设置 `sys._MEIPASS` 路径

## CI/CD（GitHub Actions）

`.github/workflows/build.yml` 在 push 与 tag 时自动：

1. **测试矩阵**：Ubuntu / macOS / Windows × Python 3.10/3.11/3.12
2. **构建矩阵**：
   - Linux x86_64（单文件 + AppImage）
   - macOS x86_64（单文件 + .app）
   - macOS arm64（Apple Silicon 原生 + .app）
   - Windows x86_64（.exe）
3. **发布**：打 `v*` tag 时自动创建 GitHub Release 并上传所有产物 + SHA256SUMS

### 触发发布

```bash
git tag v0.1.0
git push origin v0.1.0
```

Release 页面会包含：

- `vidown-linux-x86_64.tar.gz`（含 AppImage + 单文件）
- `vidown-macos-x86_64.tar.gz`（含 .app + 单文件）
- `vidown-macos-arm64.tar.gz`
- `vidown-windows-x86_64.zip`
- `SHA256SUMS`

## 减小体积

默认产物约 24 MB。可通过以下方法进一步压缩：

```bash
# 1. 启用 UPX（默认启用）
pip install upx
python scripts/build.py

# 2. 排除更多模块（在 spec 中）
excludes=[
    "tkinter", "matplotlib", "IPython", "jupyter",
    "numpy.tests", "pandas.tests",
    "pytest", "black", "ruff", "mypy",
]

# 3. 使用 --onedir 模式（启动更快，但分发是目录）
python scripts/build.py --onedir
```

## 常见问题

### 1. 启动时 `ModuleNotFoundError: No module named 'vidown.xxx'`

**原因**：某些子模块未被 PyInstaller 自动发现。

**解决**：在 `scripts/vidown.spec` 的 `hiddenimports` 列表中添加该模块。

### 2. GUI 静态文件找不到

**原因**：spec 中 `datas` 路径错误。

**解决**：确认 `scripts/vidown.spec` 中的：

```python
datas = data(
    (PROJECT_DIR / "vidown" / "gui" / "templates", "vidown/gui/templates"),
    (PROJECT_DIR / "vidown" / "gui" / "static", "vidown/gui/static"),
)
```

`runtime_hook.py` 会将 `sys._MEIPASS` 加入 `sys.path`，让 `vidown/gui/server.py` 的相对路径查找能找到模板。

### 3. macOS 提示「无法验证开发者」

**原因**：未签名。

**解决**（开发者）：

```bash
# 自签名（本地测试）
codesign --force --deep --sign - app/Vidown.app

# 正式签名（需要 Apple Developer 账号）
codesign --force --deep --sign "Developer ID Application: Your Name" app/Vidown.app
```

**解决**（用户）：右键点击 `Vidown.app` → 打开 → 在弹窗中确认。

### 4. Windows Defender 报毒

**原因**：PyInstaller 产物经常被启发式扫描误报。

**解决**：

- 用户：在 Defender 中添加排除项 `dist/vidown.exe`
- 开发者：申请代码签名证书（EV 证书最有效），在 spec 中 `codesign_identity` 设置
- 也可使用 `--onedir` 模式（多文件模式降低误报概率）

### 5. Linux 提示「FUSE 错误」

**原因**：AppImage 需要 FUSE 支持。Ubuntu 22.04+ 默认不安装 `libfuse2`。

**解决**：

```bash
sudo apt install libfuse2
# 或直接解压运行：
./Vidown-x86_64.AppImage --appimage-extract-and-run
```

### 6. yt-dlp 提取器过时

打包后 yt-dlp 是固定版本，可能数月后 YouTube 等平台更新导致下载失败。

**解决**：

- 升级源码中的 `yt-dlp` 后重新打包：`pip install -U yt-dlp`
- 文档中提示用户安装独立版 yt-dlp（命令行）作为 fallback
- 未来可加入「运行时自动更新 yt-dlp」功能

## 调试技巧

```bash
# 1. 重新打包并保留中间产物
pyinstaller scripts/vidown.spec --noconfirm --clean
# build/vidown/ 中是解包后的目录结构

# 2. 使用 --log-level=DEBUG 查看 PyInstaller 详细日志
pyinstaller scripts/vidown.spec --log-level=DEBUG

# 3. 让运行时输出到控制台（查看错误）
./dist/vidown --verbose check

# 4. macOS 检查 .app 签名
codesign -dv --verbose=4 app/Vidown.app
spctl -a -t exec -vv app/Vidown.app
```
