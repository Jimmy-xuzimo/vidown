# Architecture

Vidown 的整体架构图：

```
┌─────────────────────────────────────────────────────────────┐
│                      GUI 前端层 (Web/Tauri/Wails)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ URL 输入  │ │ 下载队列  │ │ 格式选择  │ │   设置面板    │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST + SSE
┌──────────────────────▼──────────────────────────────────────┐
│                   核心调度引擎 (Python)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              DownloadScheduler                       │   │
│  │  - 任务队列 / 并发池 / 暂停-恢复-取消                │   │
│  │  - 引擎注册表 (EngineRegistry)                       │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────┐  ┌────▼─────┐  ┌──────────┐  ┌────────┐ │
│  │  yt-dlp 引擎  │  │M3U8/DASH │  │ 直链下载  │  │备用引擎 │ │
│  │ (1700+ 站点) │  │  处理器   │  │          │  │(lux等) │ │
│  └──────────────┘  └────┬─────┘  └──────────┘  └────────┘ │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │              FFmpegPostProcessor                     │   │
│  │  合并 → 转码(H.264) → 嵌入元数据 → 输出 MP4          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. `vidown.core` —— 核心层
- `models.py`：数据模型（`DownloadTask`、`VideoInfo`、`FormatInfo`、`TaskProgress`）
- `config.py`：配置加载（JSON/YAML 双向）
- `scheduler.py`：任务调度核心
- `platform_detect.py`：URL 平台识别
- `format_selector.py`：格式选择策略
- `utils.py`：通用工具（FFmpeg 探测、文件名清理等）
- `exceptions.py`：异常体系
- `logger.py`：统一日志

### 2. `vidown.engines` —— 下载引擎
所有引擎继承自 `BaseEngine`：
- `ytdlp_engine.py`：主引擎，1700+ 站点
- `m3u8_engine.py`：M3U8/HLS/DASH 引擎
- `direct_engine.py`：HTTP 直链引擎
- `fallback_engines.py`：you-get / lux / gallery-dl

### 3. `vidown.postprocess` —— FFmpeg 后处理
- `ffmpeg_pipe.py`：转码 / 合并 / 拼接 / 嵌入
- `probe.py`：ffprobe 媒体信息

### 4. `vidown.data` —— 持久化
- `database.py`：SQLite 连接管理
- `history.py`：下载历史仓储
- `cookie_store.py`：Cookie 导入（支持浏览器）

### 5. `vidown.gui` —— Web 图形界面
- `server.py`：嵌入式 HTTP Server + SSE
- `templates/index.html`：前端页面
- `static/`：CSS / JS

### 6. `vidown.cli` —— 命令行
- `main.py`：argparse 入口

### 7. `vidown.utils` —— 辅助工具
- `clipboard.py`：跨平台剪贴板监听
- `download_enhancer.py`：页面 m3u8 自动发现
- `system.py`：系统平台检测

## 数据流

```
用户输入 URL
    ↓
[URL 解析] classify_url → (Platform, MediaKind)
    ↓
[任务入队] DownloadScheduler.add_task
    ↓
[引擎选择] EngineRegistry.select(URL)
    ↓
[探测] engine.probe() → VideoInfo + Formats
    ↓
[格式选择] format_selector.select_formats(VideoInfo, QualityConfig)
    ↓
[下载] engine.download_info() → raw file
    ↓
[后处理] FFmpegPostProcessor → H.264 MP4
    ↓
[完成] HistoryRepository.upsert_task
    ↓
[SSE 推送] progress / status → Web GUI
```
