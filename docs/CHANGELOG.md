# 更新历史

按已公开的应用 Release 记录，桌面与 Android 使用独立版本。日期采用北京时间。资料 Release 不是额外应用版本；未单独公开发行的中间预览不列为发行版本。

## Android 0.1.0-preview.6 · 2026-10-19

- 新增抖音视频长链、精选页与正常跳转的分享链接探测，读取当前网页返回的数据，严格匹配目标视频；保留原始地址、规格和备用 CDN。
- 新增 B 站影片／剧集版本与单集选择，通过同一浏览器会话解析音视频轨道。试看会明确标注，账号权限、地区限制和 DRM 不会被当成普通解析错误。
- 导航保持常驻，竖屏居中在底部、横屏居中在左侧；使用 Compose 原生横向分页，支持滑动切换、页面状态保存和关闭界面动效。
- 扩充受控回归及公开站点抽样，公开抽样受网络、登录和源是否开放影响；不代表全部站点或会员内容已验证。

[APK](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-v0.1.0-preview.6) · [源码与材料](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-materials-v0.1.0-preview.6)

## 桌面 1.0.6 · 2026-10-19

- 修复退出应用时迟到的浏览器展示回调报错；增加收尾请求回归，保持新任务在退出期间被拒绝。

- 新增 B 站影片页、番剧／剧集单集和移动链接解析；多个配音版本或单集先由用户选择，不批量抓取整季。
- 使用内置浏览器登录会话请求正常网页播放接口，展示可用的分离视频／音频，保留原始备用 CDN；明确提示试看、权限不足和 DRM。
- 修正未知分辨率的合轨视频被标成“音频”的规格文案；新增单集、杜比轨道、帧率、试看、权限及 DRM 回归和公开站点抽样。

[安装包](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.6) · [源码与材料](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.6-materials)

## Android 0.1.0-preview.5 · 2026-10-19

- 修复 Gecko 覆盖普通 Referer 请求头的问题，下载请求通过原生来源页面接口保留防盗链所需上下文。
- 跨 CDN 跳转保留 Range 和来源站点，移除来源页面的路径、查询参数及私有授权头。
- 新增请求头实收、跨域隔离、登录鉴权与备用 CDN 完整文件对比回归，重新生成签名通用 APK。
- 真实大会员账号与 ARM64 真机仍待用户设备验收，不将受控测试等同于全部网站可下载。

[发行说明与 APK](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-v0.1.0-preview.5) · [源码与校验材料](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-materials-v0.1.0-preview.5)

## Android 0.1.0-preview.4 · 2026-10-19

- 发布独立原生 Kotlin／Compose／Material 3 应用，一个签名 APK 覆盖 ARM64、x86_64，最低 Android 14。
- 链接输入优先，竖屏底部、横屏左侧的悬浮导航；四套深浅配色、可关闭的 Compose 动效，浏览器默认桌面模式。
- 修复 B 站提取默认请求头、移动跳转和 HTML 误识别；归一化 BV／AV／移动／短链，保留分 P 与备用 CDN，分别选择音视频。
- 浏览器与提取器共享 Gecko 会话，接入 Media3 下载、JNI 无损合并与检查、MediaStore／SAF 保存、UIDT 队列、历史和清理。
- 受控协议与公开样本已验收；真实会员账号、ARM64 真机、后台性能和 Play 上架仍待验证。完整迁移计划尚未全部完成。

[发行说明与 APK](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-v0.1.0-preview.4) · [源码与校验材料](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-materials-v0.1.0-preview.4) · [验收范围](../android/ACCEPTANCE.md)

## 桌面 1.0.5 · 2026-10-18

- 修复抖音精选页 `modal_id` 与视频长链解析，使用网页正常返回的对应视频规格，不选择预加载的相邻内容。
- 保留真实参数与备用 CDN；关闭标签、清理数据、缓存过期后不再复用旧规格。
- 五个平台的原生构建和受控下载通过后统一发布。抖音真实网页测试限于记录中的 Windows 公开样本。

[发行说明与安装包](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.5) · [详细说明](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.5)

## 桌面 1.0.4 · 2026-10-17

- 增加浏览器数据、下载记录分别或同时清理；旧资源和登录备份随浏览器清理失效，默认保留成品与外观设置。
- 修复关闭剪贴板监听后仍发生的延迟读取；移除已知漏洞依赖链，改进浏览器异常处理和发行来源约束。
- 主 Release 精简为五个应用安装包，源码、校验和报告放独立资料页。

[完整发行说明](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.4)

## 桌面 1.0.3 · 2026-10-17

- 新增 Windows x64、macOS Intel／Apple Silicon、Linux x64／ARM64 的原生 Actions 构建与发布。
- 每个平台执行实际打包应用的受控下载验证，全部通过后才公开附件；对应源码、测试报告和校验值独立保存。
- 当时包含便携 EXE 和 Linux DEB；现行发行附件已在 1.0.4 精简，不把历史格式当作最新下载承诺。

[完整发行说明](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.3)

## 桌面 1.0.2 · 2026-10-17

- 以 TypeScript 桌面工程替换旧 Python 项目，保留 Git 历史；Windows 网页使用 WebView2。
- 修复浏览器工具栏、固定高度标签、自动补全协议、缩放与柔和新标签页；加入主题、历史管理、剪贴板填入和统一会话下载。
- 移除外部 Cookie 导入及导出扩展、鼠标微光，改写 README、指南与项目网站。
- 此版本仅公开源码，尚未附可执行安装包。

[完整发行说明](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.2)
