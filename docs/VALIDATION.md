# M0 验证记录

测试日期：2026-10-17（Asia/Shanghai）。环境：Windows x64，Electron 44.8.0，FFmpeg／ffprobe 9.0.2，N_m3u8DL-RE v0.6.0-beta，yt-dlp 2026.08.19。本记录描述已执行的测试，不表示 M0 或完整重建计划已全部完成。

## 自动化与实际引擎

| 验证                   | 结果                | 范围                                                                                                                                                                                             |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 类型检查及生产代码构建 | 通过                | `npm run build`                                                                                                                                                                                  |
| 单元／本地集成测试     | 14 项通过，3 个文件 | 格式转换与组合、机密字段隔离、HLS／DASH 元数据、DRM／直播识别、成品参数拒绝、缓存与重定向凭据范围、SQLite 中断状态                                                                               |
| 实际引擎受控媒体       | 11 项通过           | HLS 分离音频、AES-128 密钥轮换、fMP4、Byte Range、DASH 模板／时间线、生成 HDR10＋FLAC、直链暂停恢复、源验证器变化、HLS 停进程恢复且 5 个已完成片段不从源重取、清单变化拒绝续接、TDLib 原生库查询 |
| 已打包 Windows 应用    | 4 项通过            | 包内 TDLib 加载；真实沙箱浏览器登录和请求发现；跨源页面／媒体端口＋HttpOnly Cookie 的界面→工作进程→下载→合并→成品检查；界面无运行时错误且无请求机密暴露                                          |
| 生产 npm 依赖审计      | 0 个已知漏洞        | `npm audit --omit=dev`；构建工具链仍有 8 项中等严重性通告，正式发行前处理，不对其作“零漏洞”声明                                                                                                  |

Windows 便携 EXE 也已直接启动并通过同样 4 项完整桌面检查，包含自解压启动、包内 TDLib／工具、跨源 Cookie 与音视频合并；已检查字节统计包含两轨。见 [便携版报告](validation/windows-portable.json) 及 [预览包大小与 SHA-256](validation/windows-preview-artifact.json)。这是未签名的本地实验预览包。

上述媒体测试由本地 FFmpeg 生成真实片段，通过真实 HTTP 服务、N_m3u8DL-RE、FFmpeg、ffprobe 执行，不使用下载成功的模拟返回值。对应 [协议报告](validation/controlled-media.json)、[Windows 打包报告](validation/windows-packaged.json)、[组件版本与 SHA-256](validation/tools-windows-x64.json)。受控套件内的真实平台条目标为 pending，真实平台结果单独记录于下节。

## 用户提供的 B 站真实样本

链接：[BV1NGZtBwELa](https://www.bilibili.com/video/BV1NGZtBwELa/)，标题「【4K限免】你的新设备能顶住吗？影视飓风年度样片」，时长 218.592 秒。用户在本机内置浏览器完成登录，未导出账号凭据到报告。

- 未登录公开提取最高返回 1080p；登录后返回 3840×2160 杜比视界、AVC／HEVC／AV1 多种 4K 轨道，以及 EC-3 与 AAC 音轨。
- 已实际下载和无损合并 4K HEVC Main 10，30000/1001 fps，BT.2020、HLG 底层，Dolby Vision Profile 8、Level 7、RPU present、compatibility ID 4。
- 音频成品为 Dolby Digital Plus＋Dolby Atmos，48 kHz、5.1、768 kbps。
- 输出为 MKV，成品与源轨的参数／时长检查通过。完整 Annex-B HEVC 码流 SHA-256 相同，完整音频码流 SHA-256 相同，因此本样本的编码码流（含带内 RPU）未改变；DOVI 配置记录单独检查相同。
- 该样本没有返回 8K 或 FLAC／Hi-Res，不据此声明这些真实平台规格已验收。具有杜比能力的硬件／播放器播放验收仍待执行。

详见 [脱敏格式清单](validation/bilibili-formats.json) 和 [完整码流哈希及媒体参数](validation/bilibili-preservation.json)。源媒体与成品仅保存在用户本机，没有加入仓库。

此样本发现并修复了真实跨域 Referer 导致的 `net::ERR_BLOCKED_BY_CLIENT`。修复前提取成功但下载失败；修复后使用同一登录会话实际下载完成。回归夹具采用不同页面／媒体源端口，不再只测同源情况。

## 尚未通过的验收

B 站真实 8K、独立 HDR10、FLAC／Hi-Res、番剧会员权限及试看边界；X 公开／登录、多视频；Telegram 真实应用身份、登录、私有消息、取消及限流；Dolby 硬件播放；更多 HLS 时间轴／DASH 多 Period／异常网络与磁盘场景；跨重启自动续传；macOS／Linux 实机与独立运行时；干净 Windows 虚拟机和正式安装包／签名／完整源码分发材料。

已打包程序在当前 Windows 机器上通过测试，并不等同于干净系统、三端及所有平台验收。应用目前是本地 M0 实验预览，发行状态以 [路线图](ROADMAP.md) 为准。

## 复现

```powershell
npm ci
npm run setup
npm run check
npm run verify:media
npm run pack
$env:VIDOWN_VERIFY_EXECUTABLE = (Resolve-Path 'release/win-unpacked/Vidown Preview.exe').Path
npm run verify:desktop
```

真实 B 站验证：`npm run verify:platform -- https://www.bilibili.com/video/BV1NGZtBwELa/`，在打开的应用中登录；另一终端执行 `npm run verify:platform-download`、`npm run verify:preservation`。后两条是当前 Dolby 样本的开发验收工具，不是通用的自动最高规格批量下载入口。登录档案在被 Git 忽略的 `work/platform-verification/profile` 内，不能随报告上传。
