# B 站实现参考与复用边界

2026-10-17 检查以下公开代码；仅记录与当前重建直接相关的结论。没有把参考工程的业务代码复制进新应用。

| 参考                                                                                                       | 检查版本                                                         | 结论及当前用途                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DownKyiCore](https://github.com/crazysmile-PhD/downkyicore)                                               | `64f5c372d48f28d9000ac9804c0ed01e2d7b5c07`，GPL-3.0              | `VideoStreamApi.cs` 使用 `fourk=1`、`fnval=4048` 与 WBI；网页发现和 API 补充是独立步骤。`PlayUrlDashVideo.cs` 保留 `backup_url`。`BuiltinRangeDownloader.cs` 验证 Content-Range、资源身份及保留区段，设置读取停滞超时。用于审核我们的格式覆盖、备用 CDN 和恢复边界；已独立实现网页备用地址补充和跨源检查点隔离，仍需扩大恢复场景。 |
| [BBDown](https://github.com/nilaoda/BBDown/tree/259a5558cee0a349a7ebb60bd31e40c88e5bc1ed)                  | 历史 master 提交 `259a5558cee0a349a7ebb60bd31e40c88e5bc1ed`，MIT | `Parser.cs` 分开提取 `dash.audio`、`dash.dolby.audio`、`dash.flac.audio`，保留主备地址并选择 CDN。仓库当前默认分支为 `DELETED`，因此不把历史代码当作持续维护的依赖。                                                                                                                                                               |
| [yt-dlp Bilibili extractor](https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/yt_dlp/extractor/bilibili.py) | `2026.08.19`，源码 Unlicense，打包二进制另含 GPL 组件            | 实际复用其独立进程：登录会话提取到 4K、杜比视界和 EC-3；轨道统一转换为 Vidown 自有类型。此版本的 `extract_formats` 只保留主媒体 URL，Vidown 因此独立从同一登录页面补充备用地址。                                                                                                                                                   |

当前实测证明了：用户在内置浏览器登录后，yt-dlp 能为提供的样本返回 4K Dolby Vision 与 Dolby Atmos 音轨；真实失败发生在 Chromium 跨域 Referer 策略，而非高规格接口。已通过设置任务媒体请求的 `referrerPolicy` 修复，并用不同页面／媒体源端口的桌面测试回归。此设置只用于已登记的媒体传输，不改变远程页面的浏览器权限。

已验证备用 CDN：从同一登录页面的 JSON 播放信息按完整媒体路径与编码匹配，只登记对应轨道的 HTTPS 地址。真实测试主动阻断主 CDN，完整杜比音轨从备用源下载成功；各源使用独立检查点，即使 ETag 相同也不拼接旧字节。所有备用地址保持在私有计划中。后续增强优先级：缺失规格时区分账号权限与源未提供；从已观察的播放响应补充音频采样率与位深；过期后按内容、轨道与源身份重新匹配。不得用高码率猜测 FLAC／Hi-Res，也不得跨 CDN 无条件续接旧字节。

如果后续直接引入 GPL 工程的受保护代码，必须保留出处、版权与许可证，并重新确认组合代码的许可；不能把直接复制的 GPL 实现标成 MIT。MIT 代码也必须保留原版权和许可。当前通过独立 yt-dlp 可执行文件复用成熟能力，未复制 DownKyiCore、BBDown 或猫抓的源码。

## Android 原生组件与设计参考

- [Material 3 / Compose](https://developer.android.com/develop/ui/compose/designsystems/material3)：应用原生界面与组件。
- [Compose 动画](https://developer.android.com/develop/ui/compose/animation/quick-guide)与[自适应布局](https://developer.android.com/develop/ui/compose/layouts/adaptive)：有边界的动效和窗口适配。
- [GeckoView WebExtensions](https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html)：随 APK 提供的请求发现扩展，原生消息与同一浏览器会话。
- [Media3](https://developer.android.com/media/media3)：Android HLS／DASH 解析与缓存下载，不复制桌面 N_m3u8DL-RE 二进制。
- [用户主动数据传输任务](https://developer.android.com/develop/background-work/background-tasks/uidt)、[Android 存储](https://developer.android.com/training/data-storage)：下载执行和 MediaStore／SAF 系统授权。
- [16KB 页面兼容](https://developer.android.com/guide/practices/page-sizes)：APK 及嵌套 Python 原生库的验收要求。
- [Seal](https://github.com/JunkFood02/Seal)：独立原生界面与下载流程的设计参考，已查阅源码和安装包。Seal 及其 youtubedl-android 分支采用 GPLv3；Vidown 没有复制其代码、资源或二进制，详见 [参考审阅记录](../android/REFERENCE_REVIEW.md)。Android 使用随包 Chaquopy 与固定 yt-dlp，不沿用桌面独立可执行文件方式。

第三方代码保留各自许可；Android FFmpeg 使用源码构建的 LGPL 配置。Android 与桌面的依赖材料分开保存，不能用桌面对应源码代替 APK 的精确源码材料。
