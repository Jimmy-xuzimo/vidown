# M0 验证记录

测试日期：2026-10-17（Asia/Shanghai）。环境：Windows x64，Electron 44.8.0，FFmpeg／ffprobe 9.0.2，N_m3u8DL-RE v0.6.0-beta，yt-dlp 2026.08.19。本记录描述已执行的测试，不表示 M0 或完整重建计划已全部完成。

## 自动化与实际引擎

| 验证                   | 结果                | 范围                                                                                                                                                                                                                                |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查及生产代码构建 | 通过                | `npm run build`                                                                                                                                                                                                                     |
| 单元／本地集成测试     | 28 项通过，6 个文件 | 格式转换与组合、备用源、X 未知编码、DASH Period、规格拒绝、停滞超时、缓存清理；数据库升级、阶段顺序、无效状态迁移拒绝、事件写入失败时事务回滚及高版本数据库保护；过期 Cookie 备份拒绝恢复、新版 Cookie 优先、重复保存不延长备份期限 |
| 实际引擎受控媒体       | 10 项通过           | HLS 分离音频、AES-128 密钥轮换、fMP4、Byte Range、DASH 模板／时间线、生成 HDR10＋FLAC、直链暂停恢复、源验证器变化、HLS 停进程恢复且 5 个已完成片段不从源重取、清单变化拒绝续接                                                      |
| 已打包 Windows 应用    | 5 项通过            | 无需 Telegram 原生 API 配置；沙箱浏览器登录／捕获；分片完成前真实接收字节及速度；跨源 Cookie 的界面→工作进程→合并→检查；界面无运行时错误且无请求机密暴露                                                                            |
| 协议边界真实媒体       | 2 项通过            | HLS 时间戳重置的 discontinuity；相同轨道与实际编码配置的两个连续 DASH Period，完整解码及总时长正确；中文／引号路径                                                                                                                  |
| 备用源隔离             | 通过                | 主源保留部分故意损坏的字节后发生 503；即使备用源 ETag 相同，也从零开始、不继承 Authorization，源文件字节哈希一致                                                                                                                    |
| 下载中正常关闭         | 通过                | 真实 N_m3u8DL-RE 子进程退出，源请求停止，重启状态 interrupted；未覆盖操作系统强制杀进程                                                                                                                                             |
| 桌面任务控制           | 3 项通过            | 并发 1 的排队取消、实际下载暂停后停止源请求、恢复后完整成品、终态不能重新入队、阶段事件持久化、重启隐藏无效继续入口                                                                                                                 |
| 生产 npm 依赖审计      | 0 个已知漏洞        | `npm audit --omit=dev`；构建工具链仍有 8 项中等严重性通告，正式发行前处理，不对其作“零漏洞”声明                                                                                                                                     |

Windows 便携 EXE 直接启动后执行相同桌面检查，包含自解压启动、包内工具、跨源 Cookie 与音视频合并。最终结果见 [便携版报告](validation/windows-portable.json) 及 [预览包大小与 SHA-256](validation/windows-preview-artifact.json)。这是未签名的本地实验预览包。

上述媒体测试由本地 FFmpeg 生成真实片段，通过真实 HTTP 服务、N_m3u8DL-RE、FFmpeg、ffprobe 执行，不使用下载成功的模拟返回值。对应 [协议报告](validation/controlled-media.json)、[Windows 打包报告](validation/windows-packaged.json)、[组件版本与 SHA-256](validation/tools-windows-x64.json)。受控套件内的真实平台条目标为 pending，真实平台结果单独记录于下节。

运行时代码提交 `cca0962` 的 Windows 2025、macOS 15、Ubuntu 24.04 源码 CI 均通过，执行格式检查、生产构建、类型检查和 28 项测试；[CI 记录](validation/source-ci.json) 包含对应运行链接。源码检查没有替代三端打包及实机验收。

额外验证见 [时间轴和多 Period](validation/protocol-edges.json)、[跨源检查点隔离](validation/mirror-isolation.json)、[正常关闭和重启](validation/windows-shutdown.json)。最初多 Period 样本只有前半段被引擎保存；新增平台／清单完整时长检查先阻止了错误成功，再改为每 Period 交由成熟引擎下载、核对实际编码配置、FFmpeg 无损拼接，12 秒成品完整解码通过。轨道缺失、编码变化或时间范围有间隔会明确拒绝，不能扩展成所有 MPD 均已验证。

## alpha.2 浏览器与登录共享修复

在打包后的 Windows alpha.2 中验证：1000×640、1400×900、1920×1000，以及 1280×800 窗口配合 125% 应用界面缩放，主界面无外层横／纵溢出，原生网页区域与布局边界一致。手动 75% 网页缩放、资源栏收起以及网站缩放偏好重启保留均通过。

受控网站设置临时会话 Cookie 后关闭应用；只删除隔离测试档案的 Chromium Cookie 数据库，验证加密备份确实能恢复鉴权。重启后不打开任何浏览器标签，直接在工作台粘贴受保护 HLS 地址，完成音视频下载、合并和检查。手动清除登录并再次重启后，请求返回 403，旧备份不会恢复。共 4 项专项检查，见 [浏览器与会话报告](validation/browser-session.json)。用户普通档案未被删除或覆盖。

使用用户此前留在本机的隔离 B 站登录档案，关闭再启动 alpha.2，确认浏览器标签为零，再通过实际工作台表单输入 BV1NGZtBwELa。返回 4K 杜比视界、三种普通 4K 编码及杜比音轨，默认选择 2160p 杜比视界。见 [工作台登录共享报告](validation/workbench-login.json)。本项验证登录共享、格式可用性和默认选择，未重复下载整片；完整高规格保存证据见下文此前测试。

登录可被网站主动使失效；本地保存不保证平台长期授权。当前真实账号专项仅验证 B 站，其他站点不能从此推断为已完成账号验收。

## 用户提供的 B 站真实样本

链接：[BV1NGZtBwELa](https://www.bilibili.com/video/BV1NGZtBwELa/)，标题「【4K限免】你的新设备能顶住吗？影视飓风年度样片」，时长 218.592 秒。用户在本机内置浏览器完成登录，未导出账号凭据到报告。

- 未登录公开提取最高返回 1080p；登录后返回 3840×2160 杜比视界、AVC／HEVC／AV1 多种 4K 轨道，以及 EC-3 与 AAC 音轨。
- 已实际下载和无损合并 4K HEVC Main 10，30000/1001 fps，BT.2020、HLG 底层，Dolby Vision Profile 8、Level 7、RPU present、compatibility ID 4。
- 音频成品为 Dolby Digital Plus＋Dolby Atmos，48 kHz、5.1、768 kbps。
- 输出为 MKV，成品与源轨的参数／时长检查通过。完整 Annex-B HEVC 码流 SHA-256 相同，完整音频码流 SHA-256 相同，因此本样本的编码码流（含带内 RPU）未改变；DOVI 配置记录单独检查相同。
- 该样本没有返回 8K 或 FLAC／Hi-Res，不据此声明这些真实平台规格已验收。具有杜比能力的硬件／播放器播放验收仍待执行。

详见 [脱敏格式清单](validation/bilibili-formats.json) 和 [完整码流哈希及媒体参数](validation/bilibili-preservation.json)。源媒体与成品仅保存在用户本机，没有加入仓库。

此样本发现并修复了真实跨域 Referer 导致的 `net::ERR_BLOCKED_BY_CLIENT`。修复前提取成功但下载失败；修复后使用同一登录会话实际下载完成。回归夹具采用不同页面／媒体源端口，不再只测同源情况。

## 新增 B 站 8K、HDR10 与备用 CDN

另行找到公开短样本 [BV1KG4y1V7WN](https://www.bilibili.com/video/BV1KG4y1V7WN/)，使用用户此前留在本机的登录会话，分别下载完整 167.113 秒媒体：

| 独立选择      | 成品                                                                      | 结果                                                                             |
| ------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 8K SDR＋AAC   | HEVC，7680×4320，BT.709，8-bit；AAC 44.1 kHz 双声道；MP4                  | 完整视频／音频编码码流 SHA-256 分别与源一致，开头／中间／末尾解码通过            |
| 4K HDR10＋AAC | HEVC，3840×2160，10-bit，BT.2020、SMPTE ST 2084；AAC 44.1 kHz 双声道；MP4 | 完整码流哈希一致；首帧 Mastering display／Content light 元数据保留；三处解码通过 |

这是两个独立规格，未声称 8K HDR10 同时可用。提取器报告的帧率与成品 ffprobe 的平均帧率可能不同；报告保留实际源／成品检查值，没有按视频标题推断参数。详见 [8K 保真报告](validation/bilibili-8k-preservation.json) 和 [HDR10 保真报告](validation/bilibili-hdr10-preservation.json)。

同一登录环境还对原 Dolby 样本进行了备用 CDN 测试：主动取消第一个媒体源的请求，应用从登记的另一个 CDN 下载并保存完整 21,018,205 字节杜比音轨。见 [真实备用 CDN 报告](validation/bilibili-backup-cdn.json)。主备地址来自播放页面 JSON，按完整媒体路径和编码匹配；不使用他人的账号或接口身份，所有原始地址保持私有。

## 用户提供的 X 公开长视频

链接：[AlanShao111 / 2108406850727076182](https://x.com/AlanShao111/status/2108406850727076182/video/1)。源时长 15749.336 秒，约 4 小时 22 分钟；此次无需登录。首次接口连接超时，重试成功，未归因为权限问题。

- 桌面应用提取到 1080p／720p／360p／270p HLS 与 HTTP 变体，以及 32／64／128 kbps 音轨。修复了编码名称缺失时音轨、HTTP 变体被丢弃的问题；未知编码不靠猜测填充。
- 在已打包的应用内选择 1922×1080 HLS 与 128 kbps 音轨，视频通过 Chromium 会话桥及 N_m3u8DL-RE 实际传输。停止前保留 4591 个完整视频片段，3054743802 字节；只统计完整片段，不包含缓存副本。
- 用户认为视频过长，要求确认能下载即可，因此主动取消任务，任务状态为 `cancelled`。未将其标为完成，未验证整个长视频或桌面任务第二条音轨的完整下载。
- 从实际桌面下载保留的前三个视频片段，加上使用 FFmpeg 限时获取的公开 HLS 音频，生成约 9 秒 MP4：H.264 High、1922×1080、30 fps；AAC-LC、44.1 kHz、双声道、约 128 kbps。无损合并、参数检查及整个短样本的音视频解码通过。这是有限样本检查，音频限时获取没有经过桌面任务传输桥。

见 [格式清单](validation/x-formats.json) 与 [有界下载检查报告](validation/x-download-smoke.json)。没有对完整 X 成品、登录内容或单帖多视频作通过声明。原始提取结果与媒体留在本机忽略目录，不随报告上传。

## 新增 X 完整短视频与 B 站 FLAC

从 yt-dlp 的公开测试列表选择 [CaptainAmerica / 719944021058060289](https://x.com/CaptainAmerica/status/719944021058060289)。使用全新本地档案，无需账号，实际通过已打包桌面应用、Chromium 传输桥与 N_m3u8DL-RE 保存完整约 3.18 秒 HLS 音视频：1280×720 H.264、AAC 48 kHz 双声道。这个源的音频内嵌于视频清单，没有伪称为独立音轨测试。完整视频／音频编码码流哈希各自与源相同，整个成品解码通过。见 [完整下载报告](validation/x-complete.json) 和 [保真报告](validation/x-complete-preservation.json)。这补充了公开短视频完整成品证据，不改变用户长视频的 cancelled 状态，也没有验证登录 X。

通过 [JiJiDown/Tracker 公开问题中的样本](https://github.com/JiJiDown/Tracker/issues/3) 找到 [BV1J8411F7QG](https://www.bilibili.com/video/BV1J8411F7QG/)。只使用公开 BV 号及用户已有的本机登录会话，没有使用他人日志中的账号凭据或签名地址。当前实际返回 FLAC **48 kHz、24-bit、双声道**，完整时长约 353 秒；为专门验证音轨，搭配 360p AVC 视频，无损封装为 MKV，源与输出的完整音视频编码码流哈希一致，开头／中间／末尾解码通过。另建纯音频任务，完整保存 `.flac`，编码音频哈希一致且全曲解码通过。见 [视频＋FLAC 保真](validation/bilibili-flac-preservation.json) 和 [纯 FLAC 报告](validation/bilibili-flac-only.json)。没有把它扩大为真实 96 kHz 或所有高规格组合均已验收。

任务生命周期的实际桌面检查见 [任务控制报告](validation/task-controls.json)。数据库版本由早期无版本迁移至 user_version=1，任务、加密计划和设置保留；任务状态与阶段事件在同一事务内写入。恢复前已完成阶段不会因为旧事件回退，已完成／取消任务不能原地重新排队；跨重启安全续传仍未实现。

## 尚未通过的验收

B 站其他真实 FLAC 采样率组合、番剧会员权限及试看边界；X 登录内容、单帖多视频；Telegram 真实网页登录、私有消息、网页结构变化及限流；Dolby 硬件播放；更多 HLS 时间轴／DASH 多 Period 变体／异常网络与磁盘场景；跨重启自动续传；macOS／Linux 实机与独立运行时；干净 Windows 虚拟机和正式安装包／签名／完整源码分发材料。早期站内 Hi-Res 搜索收到平台 412 后未反复请求，后来通过公开项目问题记录找到并验证上述 FLAC 样本。

已打包程序在当前 Windows 机器上通过测试，并不等同于干净系统、三端及所有平台验收。应用目前是本地 M0 实验预览，发行状态以 [路线图](ROADMAP.md) 为准。

## 复现

```powershell
npm ci
npm run setup
npm run check
npm run verify:media
npm run verify:mirrors
npm run verify:protocol-edges
npm run pack
$env:VIDOWN_VERIFY_EXECUTABLE = (Resolve-Path 'release/win-unpacked/Vidown Preview.exe').Path
npm run verify:desktop
npm run verify:shutdown
npm run verify:tasks
npm run verify:browser-session
npm run verify:workbench-login # 需要此前用户在本机留下的登录档案
npm run verify:web-downloads # 受控网页与真实 blob 保存，不代表 Telegram 账号验收
npm run verify:x-complete
npm run verify:bilibili-flac # 需要此前用户在本机留下的登录档案
```

真实 B 站验证：`npm run verify:platform -- https://www.bilibili.com/video/BV1NGZtBwELa/`，在打开的应用中登录；另一终端执行 `npm run verify:platform-download`、`npm run verify:preservation`。这些是指定音视频分轨样本的开发验收工具，不是通用的自动最高规格批量下载入口。保真脚本支持 HTTP 或 HLS 保留源文件，校验平台完整时长、H.264／HEVC 完整码流哈希及开头／中间／结尾各 3 秒解码；Dolby 样本额外检查 DOVI 配置。登录档案在被 Git 忽略的 `work/platform-verification/profile` 内，不能随报告上传。

X 开发验收使用 `VIDOWN_PLATFORM_ROOT=work/x-verification` 隔离报告与档案；本次手动取消后执行 `node --import tsx scripts/verify-x-smoke.ts`，仅使用已完成的前三个视频片段与限时音频验证。该脚本明确依赖此次任务保留的分片目录结构，不能视为通用下载功能。

## alpha.3 统一登录与网页文件保存

按用户要求，所有网站只使用统一浏览器登录和工作台链接表单。移除 Telegram 专属入口、API ID／Hash 输入和 TDLib 工作进程及运行依赖；新标签页使用空白页，不默认打开某个站点。临时 Cookie 的加密备份之外，真实 Chromium 的 Local Storage 与 IndexedDB 跨重启保存检查通过；不能仅凭 Cookie 判断 Telegram 网页登录是否保留。

Telegram 自动解析以官方 Web A 的消息 DOM 和允许的下载菜单为基础，使用网页自身提供的保存操作，支持 Chromium 的 blob 下载接收；不读取网页内部密钥。受控测试使用隔离协议页面、与 Web A 相同的消息／菜单 DOM 契约以及真实生成 MP4，完成粘贴消息链接、显示选项、加入任务、保存及 ffprobe／首尾解码检查，原文件与成品 SHA-256 相同。禁止保存的消息及伪装为 MP4 的无效内容未成为成功任务。具体范围见 [网页下载报告](validation/web-downloads.json)。这是受控集成证据，不是实网 Telegram 登录、私有消息或 Web K 验收。上游网页结构变化时必须明确失败，不能下载另一条消息。

Telegram Web A 路由参考其 [tgaddr 参数](https://github.com/Ajaxy/telegram-tt/blob/master/src/util/routing.ts)、[消息定位属性](https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/message/Message.tsx)和[下载菜单](https://github.com/Ajaxy/telegram-tt/blob/master/src/components/middle/message/MessageContextMenu.tsx)，只实现网页互操作，不引入其源代码。
