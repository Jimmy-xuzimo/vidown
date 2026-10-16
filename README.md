# Vidown · 全量重建验证版

基于 Electron、React 和 TypeScript 从零编写的本地视频下载器。旧 Python 工程未复用，历史保留在 Git 中。默认保留源编码，视频和音频分别选择，可靠时封装 MP4，否则使用 MKV。

**当前交付阶段是 M0，不是完成全部计划的 1.0。** 已验证受控媒体、Windows 应用闭环，B 站真实 4K 杜比视界＋Atmos、8K SDR、独立 4K HDR10、48 kHz／24-bit FLAC，以及备用 CDN。X 公开短视频已完整下载并验证保真；用户提供的长视频按要求停止，仅验证实际传输及短样本。X 登录、Telegram 私有内容等仍待验收。详见 [验证记录](docs/VALIDATION.md) 和 [后续里程碑](docs/ROADMAP.md)。

![Windows 重建工作台](docs/images/workbench.png)

## 已验证

- 内置 Chromium 浏览器：登录会话、标签页、真实媒体请求捕获、HLS／DASH 及无扩展名媒体类型识别。
- 浏览器会话传输桥：保留 HttpOnly Cookie、必要请求头及 Range，媒体请求仍通过 Chromium 发出。
- 真实 HLS 视频／音频分轨、AES-128 密钥轮换、fMP4 初始化片段、字节范围，以及 DASH 模板／时间线分轨下载与合并。
- HLS 时间戳重置后的 discontinuity；轨道 ID 和实际编码配置不变的连续 DASH 多 Period。缺轨、规格变化或时间轴有空档时明确停止。
- 直链暂停／继续：检查 ETag 与 Content-Range；源身份变化时重新下载，避免错误追加。
- HDR10 10-bit 视频＋96 kHz／24-bit FLAC 的生成样本无损封装；首帧 HDR 元数据及成品参数检查。
- 用户提供的 B 站 4K Dolby Vision Profile 8＋Dolby Atmos 5.1 实际下载；源／成品完整编码码流哈希一致。真实平台能力以该样本范围为准。
- 另一个 B 站短样本的 7680×4320 SDR＋AAC、3840×2160 10-bit HDR10＋AAC，均完成完整下载、无损合并和码流哈希检查；这是两种独立组合。
- B 站主 CDN 被主动阻断后，完整杜比音轨从备用源下载成功；不同源的检查点与保留字节隔离。
- X 公开长视频的 1080p HLS 实际分片下载；9 秒 H.264＋AAC 样本无损合并与解码。缺少编码字段的音轨和 HTTP 变体仍可选择，未知参数明确显示。
- 独立公开 X 短视频完整下载、全片音视频解码及码流哈希一致；B 站真实 48 kHz／24-bit FLAC 与视频无损封装为 MKV。
- SQLite 任务记录、历史搜索、独立下载工作进程、失败诊断；已知中断不会假装完成。
- 任务状态迁移约束、阶段事件与单调版本号、原子数据库升级；重启缺少计划的任务明确要求重新探测。
- 分片下载的实际接收字节／速度、传输停滞超时，以及正常关闭时终止下载子进程。

## 接入但仍待实测

- B 站其他高规格组合、X 登录内容与单帖多视频。
- TDLib 1.8.67 原生库和独立工作进程、登录界面、私有消息权限检查及文件下载路径。
- 其他真实 FLAC／Hi-Res 采样率组合、番剧会员权限，以及杜比硬件播放。

Chrome／Edge 扩展、自动刷新失效签名、跨重启安全续传、引擎更新回滚与正式跨平台发行尚未实现。当前重启后需重新探测。没有直播录制、合集／频道抓取，也不处理 DRM 绕过。

## 开发运行（Windows x64）

需要开发工具 Node.js 24 和 Git；**最终用户使用验证包无需安装这些工具**。

```powershell
npm ci
npm run setup
npm run dev
```

`setup` 获取并校验固定版本的 Electron、yt-dlp、N_m3u8DL-RE 和配套 FFmpeg／ffprobe。所有文件存放在项目内，不修改系统 PATH。组件来源和校验值记录在 `resources/tools/tools.lock.json`。

```powershell
npm run check            # 类型检查、构建及自动化测试
npm run verify:media     # 生成真实分片，使用下载引擎完成协议与保真测试
npm run verify:desktop   # 启动真实 Electron，执行浏览器登录到保存成品的界面测试
npm run verify:protocol-edges # 时间轴切换、多 Period、中文及引号路径
npm run verify:mirrors   # 跨源检查点隔离和备用地址
npm run verify:shutdown  # 下载中关闭应用及重启状态
npm run verify:tasks     # 真实暂停、恢复、排队取消与重启事件顺序
npm run pack             # 生成 Windows 应用目录
npm run dist             # 生成 Windows 便携验证包
```

运行验证包后，粘贴链接并探测；需要登录时进入「浏览器探测」，在网页内登录并播放，选择资源，再分别选择视频和音频。Telegram 应用身份和验证码只在本地设置页面输入，不要发到 Issue、日志或聊天中。

仓库提供 Windows／macOS／Linux 的源码检查 CI；其通过与否应以实际运行结果为准，不代表三端应用实机验收。当前工具准备脚本仍会拒绝为 macOS／Linux 打包未经验证的 FFmpeg。

## 代码结构

- `src/core`：协议元数据、进程适配、传输桥、源质量策略和成品检查。
- `src/main`：浏览器、会话、任务协调及独立媒体／Telegram 工作进程。
- `src/preload`：仅对本地界面暴露的窄 IPC 接口。
- `src/renderer`：工作台、资源列表、轨道选择、历史与账号设置。
- `scripts`、`tests`：固定组件准备、真实媒体验证与回归测试。

自有代码使用 [MIT](LICENSE)。第三方二进制与原生库遵循各自许可，详见 [第三方组件说明](THIRD_PARTY_NOTICES.md)。

B 站方案另外检查了 DownKyiCore 和 BBDown 的高规格、备用 CDN 与续传设计，见 [参考记录与代码复用边界](docs/REFERENCES.md)。
