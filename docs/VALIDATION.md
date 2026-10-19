# 验证记录

## 官网首屏与统一时间轴（2026-10-19）

官网首屏调整为项目口号、下载／源码链接与真实应用截图；保留中英文、深浅主题和无 JavaScript 阅读。桌面与 Android 发行记录使用同一种原生折叠卡片，默认只显示平台、版本、日期和标题；宽窗口交错排列在同一根时间轴两侧，窄窗口使用左侧单轴。完整说明与原 Release 链接保留，没有更改应用版本或重新打包安装程序。

`node scripts/verify-site.mjs` 覆盖 18 种手机、平板、桌面横竖窗口尺寸，中英文与深浅主题共 72 组；检查首屏口号、操作链接和截图可见、页面及展开内容无横向溢出、所有记录默认收起且可展开、时间轴位置、键盘操作、移动菜单和无脚本阅读。截图人工复核与本机 Edge 浏览器自动化不等于所有真实设备实测。[本地报告](validation/website-redesign-2026-10-19-local.json)记录具体尺寸与检查结果。

[Pages 部署](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39205509090)成功后，对正式网址再次执行上述 72 组检查并全部通过；八条发行说明链接与 Android APK 链接均返回 HTTP 200，见[线上报告](validation/website-redesign-2026-10-19-deployed.json)。网页部署源码为 `830dfdf`，应用发行标签及安装包保持原样。

## 1.0.6 影片／单集与跨站点回归（2026-10-19）

桌面 [1.0.6 五平台发行运行](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39200094304)全部通过，包含 Windows x64、macOS Intel／Apple Silicon 和 Linux x64／ARM64 的实际打包载荷、受控下载、浏览器登录与清理检查。发行标签固定在 `7a67976`。此前 Linux 退出回归发现迟到的浏览器布局回调错误，已修复并增加退出压力检查；Windows 新标签测试的同名控件定位也已修正。安装包、对应源码和报告的线上 SHA-256 已核对，见[发行核验](validation/publication-1.0.6-preview6.json)。

Android 最终运行时为 `6902034`，独立发布 **0.1.0-preview.6**。[九种配置的完整矩阵](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39201219937)全部通过，每种 44 项受控测试与一项独立冷启动检查；覆盖 Android 14—17 的手机／平板和 16KB 环境。初轮 API 34 平板被 Pixel Launcher 系统 ANR 弹窗遮挡，日志和截图确认后仅重跑该作业并通过。此前两轮发现并修正键盘高度处理：根布局避让键盘、换页收起键盘，横屏导航不重复扣除 IME 高度。最终签名 APK 在 API 34 手机和 API 37.0 横屏平板分别完成分轨、登录、进程重启、鉴权下载、JNI 合并、MediaStore 与 ffprobe 检查；178 个原生库及 APK 映射通过 16KB 检查，签名与 preview.5 一致，AAB 校验通过。Lint 零错误、28 项警告。[完整 CI 证据](../android/verification/preview.6/github-ci.json)保留每种配置及失败尝试；[本轮过程](../android/verification/preview.6/attempts.json)保留初始缺陷与系统弹窗证据。真实会员完整全片和 ARM64 真机仍待验收。

两个新版发行后重新执行[官网线上检查](../android/verification/preview.6/website-deployed.json)：20 组尺寸／主题／语言与无 JavaScript 阅读通过，发行说明与 APK 下载链接均返回 HTTP 200。官网展示桌面与 Android 的独立更新历史。

本轮增加两端 PGC 单集适配，不将普通投稿解析器套用到电影／剧集。用户提供的 `ss231879` 正常影片接口列出潮汕话和普通话两个版本；选择对应单集后读取当前浏览器会话的播放接口。无账号公开测试只获得试看，因此界面明确提示试看，不作为会员全片证据。

桌面端对该影片页实际执行版本选择、单集规格展示及原始 CDN 部分字节读取；同时对普通投稿、X、YouTube 做格式解析与实际队列限量取流。抖音第一次隔离会话未返回资源，后续正常公开复测通过格式解析、4K 片段及短视频完整保存；Vimeo 公开样本要求登录，不能声明抽样全部通过。完整矩阵见[逐站点范围](SITE_SUPPORT.md)。长视频仅验证有界部分，不重复完整下载。

本地受控回归继续覆盖鉴权、HLS 分轨／AES 密钥轮换／fMP4／字节范围、DASH、HDR／Hi-Res 源规格及暂停恢复；单元测试增加版本列表、DV 分轨、分数帧率、原始备用 URL、试看、权限与 DRM 拒绝。平台真实账号、完整全片与 macOS／Linux 的站点实测仍是独立门槛。

桌面 49 项单元／本地集成测试通过；11 组媒体、WebView2 会话／网页保存和界面回归通过。影片还通过实际下载队列限量取流。Android 新增适配器的生产入口回归，真实联网检查先后发现并修复缺失请求类型导入、流式响应短读及自定义结果未继承默认 User-Agent 的问题；分块 JSON、响应大小、来源请求头和权限判断均有回归。最终公开影片返回 HTTP 206；两个模拟器上的最终签名 APK 完成 HLS 分轨、登录后重启、鉴权下载、合并和系统存储发布。详见[桌面受控报告](validation/regressions-1.0.6.json)、[公开抽样](validation/sites-1.0.6.json)及 [Android 本轮证据](../android/verification/preview.6/attempts.json)。

## Android 预览版与 CI 回归（2026-10-19）

Android **0.1.0-preview.5** 使用独立测试与版本链路，不沿用下方桌面真实账号结论。完整记录见 [Android 验收表](../android/ACCEPTANCE.md)与[原始证据索引](../android/verification/index.json)。已完成受控协议、共享会话、独立轨道、原生处理和系统存储发布，以及公开 B 站样本的模拟器成品下载；真实会员最高规格、ARM64 真机和后台性能仍待验收。

主分支[运行 39157748209](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39157748209)在 API 37.2／16KB 平板中出现一次 `webpageBlobSavePublishesRealMedia` 的 60 秒超时，其余八个模拟器作业通过。本次失败发生在应用测试阶段，与先前已修复的 SDK／AVD 启动问题不同。

定位到测试存在网页就绪及触摸同步缺陷。媒体响应头不代表异步 blob 已准备好，Compose 空闲也不代表独立 Gecko 合成器已绘制完成。增加三秒准备延迟后，旧测试在本地复现超时；原 CI 未记录点击瞬间的 DOM 状态。第一轮修正仅等待 DOM 就绪，本地通过，但[云端重测](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39187745887)在 API 37 平板未收到保存点击确认，进一步定位到实际触摸阶段。该轮 API 35 平板另有系统镜像 ZIP 下载错误，尚未执行应用测试。

最终测试等待网页就绪与实际 Gecko 渲染帧，使用原生视图的屏幕坐标注入真实触摸，确认保存已触发后逐字节对比成品与源文件；同时保存点击前和失败时的截图。没有增加原有下载超时或自动重试失败测试。

本地 API 37.2／16KB 平板的 38 项受控测试、独立冷启动检查、三次慢速 blob 保存复测通过。[最终云端运行 39188787785](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39188787785)的九种配置均通过，每种 38 项受控测试加一项独立冷启动检查；JVM 测试通过，Lint 零错误、28 项警告，178 个原生 ELF 通过 16KB 对齐检查。

本轮云端 API 34 平板第一次被 [Pixel Launcher 无响应弹窗](../android/verification/regressions/launcher-anr-before-tap.png)遮挡，系统拒绝向其他 UID 窗口注入针对应用的触摸。日志与截图确认是系统启动器故障后，仅重跑该作业并通过；其余八个作业未重跑。精确结果和两轮定位过程见 [blob 回归记录](../android/verification/regressions/2026-10-19-blob-save.json)。原失败和此前通过记录分别保留。只修改测试与 fixture，应用代码、签名 APK、版本和发行标签保持原样，无需用户重新安装。

项目网站增加桌面／Android 独立更新历史。`node scripts/verify-site.mjs` 检查 320／390／768／1024／1440 px、中英文和深浅主题共 20 组，以及无 JavaScript 的展开阅读；检查未出现横向溢出、空翻译或脚本错误。本地和部署后的[线上检查](validation/website-history-2026-10-19.json)分别执行并通过，五个发行说明和 Android APK 的公开链接均返回 HTTP 200。[Pages 部署](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39188207354)成功。

## 1.0.5 抖音网页解析修复（2026-10-18，本地 Windows x64）

修复精选页 `modal_id` 链接未被提取器识别，以及普通视频链接在详情接口返回空结果时误报需要新 Cookie 的问题。现在通过内置浏览器正常加载目标视频，读取网页返回的对应视频规格；不会将预加载的相邻视频当成下载目标。清除浏览器数据、关闭标签会使缓存失效，超过两分钟的规格缓存重新加载页面后提取。

新增 `npm run verify:douyin`，使用隔离档案访问真实公开网页，无需个人账号。Windows 的 WebView2 与 Chromium 均验证工作台粘贴链接和浏览器当前页解析。用户样本 `7666811827413601586` 返回 19 个规格，最高 3840×2160 HEVC；仅传输前 16 MiB、无损生成约 5 秒片段，ffprobe 确认包含 4K 视频和 44.1 kHz AAC 音频，未完整下载约 31 分钟的长视频。另一个样本 `6961737553342991651` 通过实际任务队列完整下载，约 19.735 秒、6,281,834 字节，音视频和时长检查通过。

类型／生产构建和 44 项单元／本地集成测试通过，另有 WebView2 7 组和 Chromium 网页保存 14 组回归通过。新建 URL、长整数 ID、邻居视频过滤、真实规格、备用 CDN、受保护内容拒绝及签名地址隐藏包含在自动化检查内。

已生成本地 `Vidown-Setup-1.0.5.exe`，从 NSIS 安装包提取实际应用载荷，核对核心程序、app.asar、WebView2 宿主和四个媒体工具的 SHA-256，再运行提取出的程序。其版本确认为 1.0.5，重复上述真实解析、片段下载、短视频完整任务、当前页解析和清理失效检查均通过。详见[脱敏报告及安装包校验值](validation/douyin-windows-1.0.5.json)。这不等同于安装向导或干净系统安装验收。

本轮未读取或清理用户的应用档案，也没有更新其正在运行的 1.0.4。须退出旧版并安装本地 1.0.5 修复包后才会生效。本节记录发行前的本地验收；跨平台发行结果以对应 Release 的运行器报告为准。分享短链、真实登录／私密内容、macOS／Linux 的抖音网站实测仍待验证。网站验证、删除、账号权限与地域限制不能由这些公开样本测试排除。

### 1.0.5 多平台发行结果

[发行工作流](https://github.com/Jimmy-xuzimo/vidown/actions/runs/39134988029)在 Windows x64、macOS x64／arm64、Linux x64／arm64 原生运行器完成构建与验证。Windows 首次在读取 PyPI 源码信息时遇到连接重置；仅重跑失败任务后通过，随后统一发布，未跳过检查。

五个平台均通过协议媒体、时间轴边界、备用源、打包应用下载及数据清理测试。Windows 额外通过 7 组 WebView2 和便携运行／安装包载荷检查；macOS／Linux 检查实际包内文件与可执行权限。真实账号和干净系统安装验收仍独立于这些受控测试。

[v1.0.5](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.5) 已设为最新正式版，主 Release 恰好 5 个应用包。测试报告、SHA-256 和第三方对应源码存放在[独立资料页](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.5-materials)，发布后核对公开附件摘要与运行器校验值一致，源码标签指向全部构建验证的同一提交。见[发行核对记录](validation/release-1.0.5.json)。

## 1.0.4 本地数据清理

新增 `npm run verify:data-cleanup`。Windows 本机分别使用 WebView2、Chromium 和独立测试档案验证 5 组行为：空选择及暂停任务保护；取消确认与仅清理记录；设置页清理浏览器时保留文件、记录和偏好；重启后两个网站的 Cookie、LocalStorage、SessionStorage、IndexedDB、CacheStorage、HTTP 缓存与登录备份不恢复；同时及重复清理。数据库中的旧加密下载计划一并失效。

类型／生产构建和 39 项单元／本地集成测试通过；Windows WebView2 原有 7 组受控登录、鉴权下载与文件验证通过，Chromium 网页保存 14 组回归通过；完整 npm audit 为 0。上述为本地源码运行结果。发行工作流还必须在五个平台的实际打包程序上通过数据清理、受控下载及原有协议／载荷检查，报告随版本的独立资料 Release 保存。

本轮不读取或删除个人浏览器资料；不代表真实网站账号、干净系统安装／卸载或磁盘取证级擦除通过验收。

## 1.0.3 多平台发行验证

[发行工作流](https://github.com/Jimmy-xuzimo/vidown/actions/workflows/release.yml)在五个原生运行器构建 Windows x64、macOS x64／arm64、Linux x64／arm64。每组包含 34 项单元／本地集成测试、11 项受控媒体／独立提取器测试、2 项时间轴边界、6 项备用源断言，以及打包应用的 6 组浏览器→鉴权下载→合并→成品验证。Windows 另有 7 组原生 WebView2 检查、便携 EXE 的 6 组实际闭环与 22 项载荷比较。

macOS 实际展开 ZIP、只读挂载 DMG，Linux 实际展开 AppImage、DEB 与 tar.gz，对照应用目录检查核心程序、app.asar、四种媒体工具及锁定清单的哈希，同时检查可执行权限。之后桌面测试使用 ZIP／AppImage 中实际解出的程序，非仅检查文件存在。安装向导和干净系统卸载仍不在此范围。

**本轮完成情况以 [v1.0.3 验证资料](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.3-materials) 中五份 `verification.json` 和对应 Actions 链接为准。** 发布作业只在全部构建和测试成功后运行。SHA-256 与第三方对应源码／构建材料保存在主 Release 链接的独立资料页；应用源码对应同一不可变标签。不能把下面 1.0.2 的旧包哈希或旧启动时间套用于新包。

当前构建从固定源码生成 FFmpeg／x264 与独立 yt-dlp，移除测试夹具对额外 HEVC 编码器的要求：HDR10 测试采用固定的自有合成片段，仍执行真实合并、解码与参数校验。新增独立提取器读取受控 Cookie、请求鉴权 HTTP 媒体的测试；没有用真实账号数据进入云端构建。

真实会员／私有账号、目标系统干净安装／卸载、更多 Linux 发行版、HDR 硬件播放、Developer ID／公证和 Windows 发布者签名仍待验收。跨平台打包与受控闭环通过不等于全部网站或完整原路线图已完成。

## 1.0.2 历史回归（2026-10-17）

本轮删除外部浏览器 Cookie 导入：设置卡片、浏览器工具栏入口、文件选择器、IPC、档案发现与解密逻辑、配套扩展及其专项脚本均已移除。界面与暴露 API 另有缺失断言。内置 WebView2 登录、会话持久化、工作台共享登录和清除登录继续通过受控验证。

发现并修复本地传输桥的偶发 `bad port`：系统动态分配可能落到 Fetch／Chromium 禁止的低端口，现改为直接绑定回环私有高端口，并对占用冲突（EADDRINUSE）及 Windows 保留端口（EACCES）重试；不先释放占位端口。8 个并行监听的真实 HTTP 测试、错误序列回归与修复后完整协议样本通过。Windows 云端运行器首次检查暴露了 EACCES，修复后重新执行三端 CI。

[回归汇总](validation/regression-1.0.2.json)中的当前自动化检查没有失败或跳过，不能据此推断下文待验收的真实账号或系统环境已经通过。

| 检查                                 | 结果与报告                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型、生产构建、格式与单元／本地集成 | 34 项通过；含本地传输监听与 Windows 保留端口重试检查                                                                                                                          |
| 受控真实协议与保真                   | [10 项](validation/controlled-media-1.0.2.json)：HLS 分轨、AES-128 轮换、fMP4、字节范围、DASH、生成 HDR10／Hi-Res、暂停续传、源变化和分片复用                                 |
| 时间轴与备用源                       | [2 项协议边界](validation/protocol-edges-1.0.2.json)、[6 项备用源断言](validation/mirrors-1.0.2.json)；含中文／引号路径与跨源凭据隔离                                         |
| Windows WebView2                     | [7 项](validation/webview2-1.0.2.json)：**真实 OS 剪贴板未跳过**、柔和欢迎页、实际原生窗口坐标、900px／125% 界面缩放、沙箱、登录重启、鉴权下载、站点存储、blob 哈希与清除登录 |
| 界面与记录                           | [7 组](validation/interface-1.0.2.json)：版本、外观持久化、固定 38px 标签、自动补全、删除确认、真实回收站、批量清理保护和微光移除；同时检查 Cookie 导入 UI／API 不存在        |
| 打包桌面闭环                         | [6 项](validation/desktop-1.0.2.json)：浏览器发现、实际进度、HLS 音视频合并、验证和失败状态、传输中外观设置；远程页面无应用 API／Node                                         |
| 任务与正常退出                       | [3 项](validation/tasks-1.0.2.json)、[4 项退出断言](validation/shutdown-1.0.2.json)；真实请求停止、重启中断状态，不显示虚假的继续                                             |
| 其他浏览器／网页适配                 | [4 项 Chromium 会话](validation/browser-session-1.0.2.json)、[14 项受控网页保存](validation/web-downloads-chromium-1.0.2.json)；这些不是原生 WebView2 的真实私有账号验收      |
| 便携包                               | [6 项实际闭环](validation/portable-1.0.2.json)；原生网页的隔离通过受控页面向本地服务报告能力类型，不把 WebView2 当作 Electron CDP 标签                                        |
| 安装与便携载荷                       | [22 项文件比较](validation/artifacts-1.0.2.json)，覆盖 EXE、app.asar、图标、原生宿主、下载引擎和许可说明；两种包的完整 app-64.7z 哈希一致                                     |
| 介绍网页                             | [4 组](validation/website-1.0.2.json)，390／768／1440px 无横向溢出，图片和锚点有效，减少动态效果和无运行时错误；部署是否成功需另查 GitHub Pages                               |

### 当前公开链接解析

[未登录格式提取](validation/public-formats-1.0.2.json)使用隔离档案和本机代理，不读取个人浏览器凭据、不下载整段视频，也不输出签名链接。

- 用户提供的 B 站链接：12 条视频轨道、3 条音频轨道，最高 1080p。
- 用户提供的 X 链接：4 条视频轨道、3 条音频轨道，最高 1080p。
- YouTube 公共测试样本：37 条视频轨道、12 条音频轨道，最高 2160p。

这些结果证明当前链接提取链路工作，不代表付费、私有、账号最高规格或所有格式的完整成品已经验收。

### 启动与发行边界

[当前应用目录版启动](validation/startup-1.0.2.json)两次为 468／381 ms；[便携包启动](validation/portable-startup-1.0.2.json)为 9800／9880 ms。均为本机预热缓存与新隔离档案，包含自动化连接开销，不是冷启动承诺。便携包每次额外自解压，推荐安装版日常使用。

没有执行安装向导覆盖用户现有环境，干净系统安装／卸载、签名、操作系统强制终止、macOS／Linux 应用实机，以及新后端真实会员／私有账号仍未验收。Windows 安装版和便携版在本地生成；第三方完整对应源码与构建材料核验尚未完成，公开二进制附件暂不发布，源码与网页可以独立发布。

以下为历史对应版本的证据，不能将其全部视作 1.0.2 当前浏览器后端的真实平台结果。

## 历史 M0 验证记录

测试日期：2026-10-17（Asia/Shanghai）。环境：Windows x64，Electron 44.8.0，FFmpeg／ffprobe 9.0.2，N_m3u8DL-RE v0.6.0-beta，yt-dlp 2026.08.19。本记录描述已执行的测试，不表示 M0 或完整重建计划已全部完成。

## 自动化与实际引擎

| 验证                   | 结果                | 范围                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查及生产代码构建 | 通过                | `npm run build`                                                                                                                                                                                                                                                       |
| 单元／本地集成测试     | 32 项通过，7 个文件 | 格式转换与组合、备用源、X 未知编码、DASH Period、规格拒绝、停滞超时、缓存清理；数据库升级、阶段顺序、无效状态迁移拒绝、事件写入失败时事务回滚及高版本数据库保护；过期 Cookie 备份拒绝恢复、新版 Cookie 优先、重复保存不延长备份期限；网址补全、历史删除与活动任务保护 |
| 实际引擎受控媒体       | 10 项通过           | HLS 分离音频、AES-128 密钥轮换、fMP4、Byte Range、DASH 模板／时间线、生成 HDR10＋FLAC、直链暂停恢复、源验证器变化、HLS 停进程恢复且 5 个已完成片段不从源重取、清单变化拒绝续接                                                                                        |
| 已打包 Windows 应用    | 6 项通过            | 无需 Telegram 原生 API 配置；沙箱浏览器登录／捕获；分片完成前真实接收字节及速度；跨源 Cookie 的界面→工作进程→合并→检查；界面无运行时错误且无请求机密暴露；外观修改不中断传输                                                                                          |
| 协议边界真实媒体       | 2 项通过            | HLS 时间戳重置的 discontinuity；相同轨道与实际编码配置的两个连续 DASH Period，完整解码及总时长正确；中文／引号路径                                                                                                                                                    |
| 备用源隔离             | 通过                | 主源保留部分故意损坏的字节后发生 503；即使备用源 ETag 相同，也从零开始、不继承 Authorization，源文件字节哈希一致                                                                                                                                                      |
| 下载中正常关闭         | 通过                | 真实 N_m3u8DL-RE 子进程退出，源请求停止，重启状态 interrupted；未覆盖操作系统强制杀进程                                                                                                                                                                               |
| 桌面任务控制           | 3 项通过            | 并发 1 的排队取消、实际下载暂停后停止源请求、恢复后完整成品、终态不能重新入队、阶段事件持久化、重启隐藏无效继续入口                                                                                                                                                   |
| 生产 npm 依赖审计      | 0 个已知漏洞        | `npm audit --omit=dev`；构建工具链仍有 8 项中等严重性通告，正式发行前处理，不对其作“零漏洞”声明                                                                                                                                                                       |

alpha.4 Windows 便携 EXE 直接启动后执行相同桌面检查，包含自解压启动、包内工具、跨源 Cookie 与音视频合并。最终结果见 [便携版报告](validation/windows-portable.json)；alpha.5 安装包见 [大小与 SHA-256](validation/windows-preview-artifact.json)。这是未签名的本地实验预览包。

上述媒体测试由本地 FFmpeg 生成真实片段，通过真实 HTTP 服务、N_m3u8DL-RE、FFmpeg、ffprobe 执行，不使用下载成功的模拟返回值。对应 [协议报告](validation/controlled-media.json)、[Windows 打包报告](validation/windows-packaged.json)、[组件版本与 SHA-256](validation/tools-windows-x64.json)。受控套件内的真实平台条目标为 pending，真实平台结果单独记录于下节。

运行时代码提交 `031099c` 的 Windows 2025、macOS 15、Ubuntu 24.04 源码 CI 均通过，执行格式检查、生产构建、类型检查和 32 项测试；[CI 记录](validation/source-ci.json) 包含对应运行链接。源码检查没有替代三端打包及实机验收。

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

## alpha.4 Telegram Web K 解析 502 修复

用户截图中 webk.telegram.org 已登录且正在播放，资源栏的 video/mp4 被旧路由当成普通 HTTP 媒体。旧版只识别 web.telegram.org，无法通过独立请求保留 Telegram 页面 service worker 的客户端上下文，实际报“媒体请求返回 502”。本次补齐官方客户端域名、按候选所属标签选择网页适配器，禁止重放内部播放地址；消息链接沿用现有 A／K 客户端，不强制切换导致丢失网页登录上下文。

Web K 通过可见消息 DOM 或当前视频查看器定位媒体，只点击网页已提供且可用的保存操作；视频地址或页面指纹变化时停止。未提供保存权限、未加载媒体、网页结构变化、网页另要求选择档位会分别说明。新解析会清除旧成功通知；保存触发失败也会把错误返回界面。

受控 Web A／K 集成测试共 14 项，包含截图同类的 video/mp4 资源入口、解析期间零额外内部地址重放、原文件与成品 SHA-256 一致、旧资源与新视频不匹配拒绝、禁止保存明确报错、旧类名／新字形按钮识别和粘贴私有消息链接保留 Web K origin。使用隔离 profile、生成 MP4 与仿真 DOM，**不代表真实账号或该私有消息已经下载通过**。未关闭或修改用户正在使用的 alpha.3 登录资料；需使用 alpha.4 对当前消息实测。

互操作结构参考 [Web K media viewer](https://github.com/morethanwords/tweb/tree/master/src/components/mediaViewer)、[消息菜单](https://github.com/morethanwords/tweb/blob/master/src/components/chat/contextMenu.ts)及[网页下载流程](https://github.com/morethanwords/tweb/blob/master/src/lib/appDownloadManager.ts)，独立实现 DOM 适配，不复制其业务代码。三端源码 CI 以单独的提交和报告为准。

## alpha.5 桌面交互与启动

运行时代码提交 `031099c`。移除侧栏的阶段标语与硬编码版本，显示单一项目口号和实际包版本。

- 浏览器标签固定 38 px，标题单行显示开头、末尾省略，关闭按钮不被挤出；加号紧邻已有标签。浏览器与工作台接受不带协议的网址，公网地址默认 HTTPS，localhost／回环地址默认 HTTP，保留显式 HTTP／HTTPS。
- 记录支持单条删除和全部清理；确认框默认仅删记录，可勾选将存在的成品文件移至回收站。暂停和执行中的任务不被清理，目录／符号链接拒绝作为成品删除，失败保留相应记录。
- 提供跟随系统／深色／浅色、鸢尾／海蓝／青玉／玫瑰配色、舒适／紧凑密度和动效／微光开关，验证重启保留。微光只由指针事件触发，在静止、失焦和隐藏时不循环请求动画帧；未进行全平台 CPU 基准测试。
- 启动先显示本地界面，会话初始化与之并行；远程访问及变更操作等待初始化。下载工作进程在首次使用时启动；仅修改外观不会重置浏览器网络连接。下载中切换主题后仍完成鉴权 HLS、分轨合并和成品检查。

真实 Electron 打包版的 [7 项界面验证](validation/interface.json)、[6 项桌面闭环](validation/windows-packaged.json)、[4 项会话和缩放验证](validation/browser-session.json)、[14 项受控网页保存验证](validation/web-downloads.json) 及 [下载中关闭](validation/windows-shutdown.json) 通过。测试使用隔离本地档案，回收站操作只针对生成的测试文件，没有清除用户账号。

Windows 交付改为 NSIS 常规安装包，安装后通过快捷方式直接启动，避免每次启动重新解压 Chromium 与媒体工具。[安装包载荷检查](validation/windows-installer.json) 确认包内 EXE 与 app.asar 的 SHA-256 与已实测应用一致；未执行安装向导或覆盖用户正在运行的旧版。安装／卸载界面与干净 Windows 实机仍待验收。保留产品档案名称，卸载默认不删除本机登录数据；应用仍采用 Electron，没有宣称已完成原生 WinUI／C++ 重写。

[启动测量](validation/windows-startup.json)：旧 alpha.4 便携包两次为 8706／8370 ms，新 alpha.5 应用目录版为 360／351 ms。均为本机预热缓存、隔离新档案、包含自动化连接的测量，差异包含便携解压开销；不是冷启动、真实旧账号档案或纯代码性能对比。界面 JS 从约 539 kB 缩小至 217 kB，启动不再预先创建闲置媒体工作进程。

## alpha.6 系统 WebView2、剪贴板与双版本

应用运行时代码提交 `eb48e18`。Windows 网页由系统 Evergreen WebView2 承载，原生 C#／WinForms 宿主作为 HWND 子窗口嵌入；Electron 继续承载本地界面和协议下载传输会话。不是整体 WinUI 重写，也没有把另一套 WebView2 浏览器运行时装进包中。宿主自带 .NET 8.0.32，用户无需安装 .NET；缺少系统 WebView2 时提供安装提示。其他系统保留原浏览器实现。

- [6 项系统 WebView2 受控检查](validation/webview2-alpha6.json)：实际子窗口和 Edge UA、远程网页无应用 API／Node、窗口缩放和 75% 网页缩放、切回工作台隐藏网页、Cookie 跨重启并直接完成鉴权 HLS 分轨合并、Local Storage／IndexedDB 持久化、原生 blob 保存且文件 SHA-256 相同，以及退出登录后原生与传输会话均失去鉴权。
- [7 项打包界面检查](validation/interface-alpha6.json) 和 [6 项桌面闭环](validation/desktop-alpha6.json) 通过。固定紧凑密度、移除密度选择器；应用自有提示和入口使用通用站点文案。新标签创建期间暂不提交导航，避免异步创建导致重复空白标签。
- 剪贴板默认监听链接，保留 query／hash，填入工作台后由用户解析；复制不会自动访问或下载。设置开关验证通过，非链接和危险协议被忽略。
- 新原创城市暮色渐变图标包含蓝紫、玫瑰、暖橙、城市剪影与下载符号，Windows ICO 为 16／20／24／32／40／48／64／96／128／256 像素透明 RGBA。已从应用主 EXE、安装 EXE 和便携 EXE 提取图标，显示像素与源一致；[包内载荷检查](validation/artifacts-alpha6.json) 核对两种包的应用代码、图标、宿主和 WebView2 许可，共 17 项比较通过。
- [正常关闭检查](validation/shutdown-alpha6.json) 确认实际下载子进程退出、源请求停止、重启显示中断状态。
- [三端源码 CI](validation/source-ci-alpha6.json) 在 Windows 2025、macOS 15、Ubuntu 24.04 通过格式、生产构建和 32 项测试；Windows 另通过锁定依赖的原生宿主编译。这不替代三端应用实机验收。

[启动测量](validation/startup-alpha6.json) 为本机预热缓存、隔离新档案：应用目录版两次为 391／394 ms，便携版约 10 秒，详见 [便携启动报告](validation/portable-startup-alpha6.json)。包含自动化连接开销，不能作为冷启动保证。推荐安装版避免每次自解压。安装向导未执行，以免覆盖用户正在运行的旧版；干净系统安装／卸载仍待验收。

旧 Chromium 完整网站存储不能自动迁移到 WebView2，旧档案保留，部分网站升级后需要重新登录一次。WebView2 档案保存原生站点存储；Cookie 通过可信本地进程管道同步至单独 Electron 传输分区，解析前刷新同步。不能用受控登录成功推断所有真实站点的最高规格均已通过。此前 B 站／X 的真实平台证据属于旧浏览器版本；新后端真实账号和私有消息仍待复验。

共享网页 DOM 适配器的 14 项回归另外显式运行在 Chromium 后端，不能作为 WebView2 的真实 Telegram 验收。一次新后端桌面测试曾在首次传输返回泛化的 `fetch failed`，单独诊断和再次完整桌面测试均通过，尚未定位该次瞬态失败根因，未声称已修复所有网络异常。

## 1.0.0 本地 Windows 交付（2026-10-17）

本轮按照用户要求仅修改与打包本地工程，没有推送、修改远端 PR、删除 Release 或部署 Pages。产品显示名称改为 Vidown，版本为 1.0.0；正常运行时明确沿用 `%APPDATA%/Vidown Preview` 资料目录，保留既有账号与记录。版本号不意味着初始全量里程碑全部完成，早期平台样本的证据仍属于其原测试版本。

浏览器遮挡来自原生子窗口与 Electron 内容区域的坐标基准差异。移除 Windows 默认开发菜单，统一边界；测试通过 Win32 `GetWindowRect`／`ClientToScreen` 读取实际屏幕位置，与 Electron 内容原点和 DOM 内容区比较，覆盖 900×600、1000×640、1400×900 窗口及 125% 应用界面缩放，而不是只检查设置过的尺寸。原生网页限制在工具栏下方；本地欢迎页采用静态浅紫／浅蓝背景与口号，空白标签时隐藏原生窗口。微光开关、事件监听和绘制样式已移除，保留普通按钮反馈与可关闭过渡。

- `npm run check`：类型检查、生产构建和 37 项测试通过；格式检查通过。本轮未触发远端 CI。
- [7 项 WebView2 检查](validation/webview2-1.0.0.json)：实际坐标对齐、欢迎页、网页缩放、隔离、登录跨重启、鉴权 HLS 成品与原生 blob 文件一致性。
- [7 项界面检查](validation/interface-1.0.0.json)、[6 项下载闭环](validation/desktop-1.0.0.json)、[下载中正常退出](validation/shutdown-1.0.0.json)通过；原有删除记录／回收站、外观设置和账号数据均使用隔离测试档案，不触碰用户正在运行的旧版会话。
- [安装版与便携版载荷检查](validation/artifacts-1.0.0.json)：两种包的 app-64.7z SHA-256 一致，主 EXE、app.asar、图标、原生宿主 EXE／DLL 与第三方说明逐项匹配实测应用目录。未执行安装向导或覆盖用户旧安装；干净 Windows 安装／卸载与签名仍未验收。
- [应用目录版启动](validation/startup-1.0.0.json)两次 424／413 ms；[便携版启动](validation/portable-startup-1.0.0.json)两次 11065／9715 ms，均报告 1.0.0。测量使用本机预热缓存和新隔离档案，包含自动化连接开销；便携版额外自解压，不能作为冷启动保证。

本轮没有重新使用真实会员账号或私有消息进行平台全量验收。X 登录、真实私有消息、其他最高规格组合、macOS／Linux 实机、跨重启安全续传等未完成项继续保留在能力边界内。
