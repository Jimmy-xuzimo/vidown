# 发行说明 (Changelog)

## [0.1.0] - 2026-07-01

### 新增

- 跨平台桌面视频下载器，基于 Python 3.10+ 与 PyInstaller 打包
- 智能链接识别：支持 14+ 主流流媒体平台（YouTube、Bilibili、抖音、TikTok、Twitter/X、Instagram、Facebook、Vimeo、Twitch、Netflix、优酷、爱奇艺、腾讯视频等）
- 多协议支持：HLS / M3U8 / DASH / MPD / HTTP 直链
- 多引擎 fallback 架构：
  - **yt-dlp**：1700+ 站点的主引擎
  - **N_m3u8DL-RE**：M3U8/HLS/DASH 流媒体处理（外部二进制）
  - **直链引擎**：HTTP 单文件下载（断点续传）
  - **you-get**：中文站点备用
  - **lux / gallery-dl**：可选备用
- 统一输出 H.264/AAC MP4（CRF 18 / preset slow），最高支持 8K
- Web GUI：Downie4 风格的单页应用
  - 实时进度推送（SSE）
  - 剪贴板监听（macOS / Linux / Windows）
  - 批量链接添加
  - 完整历史记录与搜索
  - 浏览器 Cookie 导入（Chrome / Firefox / Edge / Brave）
- 任务调度：并发下载、暂停 / 恢复 / 取消、状态回调
- 持久化：SQLite 历史与配置
- 跨平台：Windows .exe / macOS .app + 单文件 / Linux AppImage + 单文件

### 修复

- 暂无（首次发布）

### 安全

- Cookie 文件本地存储于 `~/.vidown/cookies/`
- 配置文件 `~/.vidown/config.json` 权限 0600

## 后续版本路线图

### 0.2.0

- [ ] Tauri 桌面壳（替换 Web GUI 为原生窗口）
- [ ] 内置播放器预览
- [ ] 字幕翻译（调用本地 LLM / 翻译 API）
- [ ] SponsorBlock 自定义类别
- [ ] yt-dlp 运行时自动更新

### 0.3.0

- [ ] 浏览器扩展（Chrome / Firefox 一键发送到 Vidown）
- [ ] 移动端 App（iOS / Android via Tauri）
- [ ] 队列脚本 DSL（批量任务脚本化）
- [ ] 云同步（可选）
