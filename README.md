# Vidown

> 通用视频下载器 —— 类 Downie4 的全能流媒体下载工具

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![yt-dlp](https://img.shields.io/badge/powered%20by-yt--dlp-red.svg)](https://github.com/yt-dlp/yt-dlp)

Vidown 是一个跨平台桌面应用，能够自动识别并下载用户提供的链接中的视频内容，支持 1700+ 主流流媒体平台、M3U8/HLS 直播流、DASH 流、HTTP 直链等。最终统一输出 H.264/AAC 编码的 MP4 文件。

## ✨ 特性

- **🎯 智能平台识别**：YouTube / Bilibili / 抖音 / TikTok / Twitter / Instagram / Facebook / Vimeo / Twitch / Netflix / 优酷 / 爱奇艺 / 腾讯视频……自动识别
- **🎬 多协议支持**：M3U8 / HLS / DASH / MPD / HTTP 直链 / RSS 源
- **🔄 多引擎 fallback**：yt-dlp（主）+ N_m3u8DL-RE（流媒体）+ 直链引擎 + you-get / lux / gallery-dl（备用）
- **📦 统一输出**：所有源最终封装为 **H.264 / AAC MP4**，最高 8K
- **🎨 现代 GUI**：Downie4 风格 Web 界面，实时进度推送、剪贴板监听、Cookie 导入
- **⚙️ 高度可配置**：CRF / 预设 / 代理 / 重试 / SponsorBlock / 字幕嵌入
- **📊 完整历史**：SQLite 存储，支持搜索、重新下载

## 📁 项目结构

```
vidown/
├── vidown/                       # 主包
│   ├── core/                     # 核心层：模型、配置、调度
│   │   ├── models.py             # 数据模型 (DownloadTask, VideoInfo, FormatInfo)
│   │   ├── config.py             # 配置加载 (JSON / YAML)
│   │   ├── scheduler.py          # 下载调度器 (并发/暂停/取消)
│   │   ├── platform_detect.py    # URL 平台分类
│   │   ├── format_selector.py    # 格式选择策略
│   │   ├── utils.py              # 工具函数 (ffmpeg 探测、文件名清理)
│   │   ├── exceptions.py         # 自定义异常体系
│   │   └── logger.py             # 统一日志
│   │
│   ├── engines/                  # 下载引擎层
│   │   ├── base.py               # 抽象基类 + 注册表
│   │   ├── ytdlp_engine.py       # yt-dlp 引擎（主）
│   │   ├── m3u8_engine.py        # M3U8 / DASH 引擎
│   │   ├── direct_engine.py      # HTTP 直链引擎
│   │   └── fallback_engines.py   # you-get / lux / gallery-dl
│   │
│   ├── postprocess/              # FFmpeg 后处理
│   │   ├── ffmpeg_pipe.py        # 转码/合并/拼接/嵌入
│   │   └── probe.py              # ffprobe 封装
│   │
│   ├── data/                     # 持久化层
│   │   ├── database.py           # SQLite 连接
│   │   ├── history.py            # 下载历史仓储
│   │   └── cookie_store.py       # Cookie 导入
│   │
│   ├── utils/                    # 辅助工具
│   │   ├── clipboard.py          # 剪贴板监听
│   │   ├── download_enhancer.py  # 页面 m3u8 自动发现
│   │   └── system.py             # 平台检测
│   │
│   ├── gui/                      # Web 图形界面
│   │   ├── server.py             # HTTP + SSE
│   │   ├── templates/index.html
│   │   └── static/{style.css, app.js, favicon.svg}
│   │
│   └── cli/                      # 命令行
│       └── main.py
│
├── configs/                      # 配置模板
│   ├── config.default.json
│   └── config.example.yaml
│
├── tests/                        # 单元测试 (pytest)
├── scripts/                      # 安装/构建/清理
│   ├── install.sh / install.bat
│   ├── build.py                  # PyInstaller 打包
│   └── clean.sh
│
├── docs/                         # 文档
├── requirements.txt              # 核心依赖
├── requirements-optional.txt     # 可选依赖
├── requirements-dev.txt          # 开发依赖
├── pyproject.toml
└── README.md
```

## 🚀 快速开始

### 1. 安装

#### macOS / Linux

```bash
git clone https://github.com/vidown/vidown.git
cd vidown
bash scripts/install.sh --with-optional
```

#### Windows

```cmd
git clone https://github.com/vidown/vidown.git
cd vidown
scripts\install.bat --with-optional
```

手动安装（任意平台）：

```bash
# 1. 系统依赖：FFmpeg（必需）
#    macOS:   brew install ffmpeg
#    Ubuntu:  sudo apt install ffmpeg
#    Windows: https://www.gyan.dev/ffmpeg/builds/

# 2. Python 依赖
pip install -r requirements.txt

# 3. 安装 Vidown
pip install -e .
```

### 2. 命令行使用

```bash
# 下载单个视频
vidown "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 下载并指定质量/编码
vidown -q 1080p -c h264 "https://www.bilibili.com/video/BV1xx"

# 批量下载（URL 列表文件）
vidown urls.txt

# 探测链接信息（不下载）
vidown probe "https://example.com/video"

# 查看历史
vidown history --limit 20
vidown history --search "machine learning"

# 检查依赖
vidown check
```

### 3. 启动 Web GUI

```bash
vidown gui
# 浏览器自动打开 http://127.0.0.1:8765
```

界面特性：
- **顶部 URL 输入框**：粘贴一个或多个链接（支持自动识别 m3u8、mpd）
- **中间下载队列**：缩略图 / 标题 / 实时进度 / 速度 / ETA / 暂停-恢复-取消
- **底部状态栏**：总速度 / 完成数 / SSE 连接状态
- **历史 Tab**：搜索 + 重新下载
- **设置 Tab**：下载目录 / 质量 / CRF / 编码 / 代理 / Cookie
- **剪贴板监听**：复制链接即自动加入队列

## ⚙️ 配置

Vidown 自动加载以下位置的配置（优先级从高到低）：

1. 命令行参数 `-c /path/to/config.json`
2. `~/.vidown/config.json`（用户配置）
3. 当前目录的 `config.yaml` / `config.yml` / `config.json`
4. 内置默认配置

完整配置参考 `configs/config.default.json` 与 `configs/config.example.yaml`。常用选项：

```json
{
  "general": {
    "download_dir": "~/Videos/Vidown",
    "max_concurrent_downloads": 3,
    "max_concurrent_fragments": 16,
    "enable_clipboard_watcher": true
  },
  "quality": {
    "preference": "best",
    "max_resolution": 4320,
    "force_codec": "h264",
    "video_crf": 18,
    "video_preset": "slow",
    "audio_codec": "aac",
    "audio_bitrate": "320k"
  },
  "network": {
    "proxy": "http://127.0.0.1:7890",
    "user_agent": "Mozilla/5.0 ...",
    "retry_max": 5,
    "use_sponsorblock": true
  },
  "engines": {
    "ytdlp": { "enabled": true },
    "m3u8dl": {
      "enabled": true,
      "binary_path": null,
      "threads": 16
    }
  }
}
```

修改配置后即可在 GUI 中点击「保存设置」，或在终端使用 `vidown config set --set quality.video_crf=20`。

## 🔧 核心模块说明

### 引擎调度

`vidown.core.scheduler.DownloadScheduler` 是核心调度器：

- 维护任务队列（`add_task` / `list_tasks`）
- 并发执行（基于 `ThreadPoolExecutor`）
- 暂停 / 恢复 / 取消
- 失败自动 fallback 到备用引擎
- 实时进度回调（on_progress / on_status / on_log）

```python
from vidown.core.config import load_config
from vidown.core.scheduler import DownloadScheduler

config = load_config()
sched = DownloadScheduler(config)

def on_done(task):
    print(f"完成: {task.output_path}")

sched.on_status(on_done)
task = sched.add_task("https://www.youtube.com/watch?v=abc")
sched.start()
sched.shutdown(wait=True)
```

### 引擎注册表

可自定义引擎实现 `BaseEngine` 并注册：

```python
from vidown.engines.base import BaseEngine, EngineCapability, EngineContext

class MyEngine(BaseEngine):
    name = "my_engine"
    capabilities = [EngineCapability.PROBE, EngineCapability.DOWNLOAD]
    def can_handle(self, url, platform, kind): ...
    def probe(self, url, ctx): ...
    def download_info(self, task, info, ctx): ...

# 在 build_default_registry 中加入
```

### FFmpeg 后处理

`vidown.postprocess.ffmpeg_pipe` 提供高层 API：

```python
from vidown.postprocess.ffmpeg_pipe import (
    merge_streams, transcode_to_h264, embed_thumbnail
)

# 合并视频+音频流
merge_streams("video.mp4", "audio.m4a", "output.mp4")

# 转码为 H.264
transcode_to_h264("source.mkv", "out.mp4", crf=18, preset="slow")

# 嵌入封面
embed_thumbnail("out.mp4", "cover.jpg")
```

## 🛠 高级用法

### Cookie 导入

解锁会员 / 年龄限制内容：

```python
from vidown.data.cookie_store import CookieStore
store = CookieStore()
cookies_file = store.import_from_browser("chrome")
# 然后在配置中设置 cookies.manual_cookies_file
```

或者在 GUI「设置 → Cookie」中点击「导入 Chrome / Firefox / Edge / Brave」。

### 自定义输出文件名

`configs/config.default.json` 中 `naming.template`：

```
%(title)s [%(uploader)s] %(resolution)s.%(ext)s
```

yt-dlp 支持的所有占位符都可以使用（`%(id)s` / `%(upload_date>%Y-%m-%d)s` 等）。

### M3U8 / DASH 深度处理

M3U8 引擎会：
1. 优先调用 `N_m3u8DL-RE`（更稳定，支持 SAMPLE-AES）
2. 退化为内置多线程 TS 下载器（AES-128 解密）
3. 通过 `ffmpeg -c copy` 拼接为 MP4

如果视频源是 HEVC / H.264 之外的编码，再走 `transcode_to_h264`。

### SponsorBlock (YouTube)

启用后会自动跳过赞助片段、自我推广、Intro/Outro。`configs/config.default.json`：

```json
{
  "network": {
    "use_sponsorblock": true,
    "sponsorblock_categories": ["sponsor", "intro", "outro", "selfpromo"]
  }
}
```

## 🧪 测试

```bash
pip install -r requirements-dev.txt
pytest tests/ -v
```

测试覆盖：
- 平台识别 / URL 提取
- 格式选择策略
- 配置加载 (JSON / YAML)
- 工具函数
- 调度器行为
- 数据库与历史
- CLI 冒烟测试

## 📦 打包可执行文件

### 跨平台产物

| 平台 | 格式 | 大小 |
|------|------|------|
| Windows | `vidown.exe`（单文件） | ~25 MB |
| macOS (Intel + Apple Silicon) | `vidown`（单文件）+ `Vidown.app` | ~25 MB |
| Linux | `vidown`（单文件）+ `Vidown-x86_64.AppImage` | ~25 MB |

### 本地打包

```bash
pip install -r requirements-dev.txt
python scripts/build.py --clean --verify
# Windows:  dist\vidown.exe
# macOS:    dist/vidown  和  app/Vidown.app
# Linux:    dist/vidown  和  dist/Vidown-x86_64.AppImage
```

### 自动发布（GitHub Actions）

```bash
git tag v0.1.0
git push origin v0.1.0
```

CI 会自动构建 4 个平台产物并创建 GitHub Release，含 SHA256SUMS。

完整打包指南见 [docs/BUILDING.md](docs/BUILDING.md)。

## 🐛 故障排查

| 错误 | 原因 | 解决 |
|------|------|------|
| `FFmpegNotFoundError` | 未安装 ffmpeg | `brew install ffmpeg` / `apt install ffmpeg` |
| `yt-dlp 未安装` | 缺少核心依赖 | `pip install -U yt-dlp` |
| `HTTP 429 Too Many Requests` | 站点反爬 | 启用代理、降低并发、增加 User-Agent |
| `该资源受 DRM 保护` | Widevine/PlayReady | 无法下载，需要合法授权 |
| M3U8 卡在「合并」 | TS 片段缺失 / 加密 | 安装 N_m3u8DL-RE 处理 SAMPLE-AES |
| 直链下载到一半失败 | 网络中断 | 自动断点续传（Range 头），重试 5 次 |

## 🗺 参考资料

- [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) — 主提取器，1700+ 站点支持
- [nilaoda/N_m3u8DL-RE](https://github.com/nilaoda/N_m3u8DL-RE) — M3U8 下载器标杆
- [iibyteCoder/StreamGrab](https://github.com/iibyteCoder/StreamGrab) — Tauri + M3U8DL GUI 参考
- [FFmpeg](https://ffmpeg.org/documentation.html) — 视频处理核心
- [Downie 4](https://software.charliemonroe.net/downie/) — UI 灵感来源

## 📄 许可证

MIT License. 详见 [LICENSE](LICENSE)。

## 🙏 致谢

本项目是对开源生态的整合之作，站在以下巨人的肩膀上：

yt-dlp、N_m3u8DL-RE、FFmpeg、you-get、lux、gallery-dl、browser-cookie3，以及所有社区贡献者。
