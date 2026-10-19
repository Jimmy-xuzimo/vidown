# Vidown 1.0.6

新增影片／剧集解析：粘贴 B 站 `ss`、`ep`、`md` 或移动链接，影片有多个单集或配音版本时先选择一项，再分别选择网页实际提供的视频与音频规格。不会批量下载整季。

- 使用内置浏览器的当前登录会话读取正常网页播放接口，保留源编码、动态范围与原始备用 CDN。
- 明确提示试看、会员／购买权限、地区限制和 DRM。试看不是全片；登录也不保证媒体可保存。
- 修复退出应用时迟到的浏览器布局／隐藏回调产生未处理错误的问题，增加退出回归。
- 修正规格列表中未知分辨率的合轨视频被标为“音频”的文案。
- 增加版本选择、分轨、分数帧率、杜比轨道、备用源、试看和受保护内容的回归测试。

Windows 公开测试中，用户提供的影片 `ss231879` 能列出两种配音版本、解析选中单集并读取实际媒体数据。没有使用会员账号，获取的是有明确提示的试看，**未验证会员完整全片**。普通投稿、X、YouTube 的公开样本通过格式解析和限量队列取流。抖音的部分隔离会话遇到网页验证／登录要求，Vimeo 样本要求登录；不宣称所有平台抽样全部通过。见[站点范围](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/SITE_SUPPORT.md)和[测试记录](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/VALIDATION.md)。

主 Release 仅提供 **5 个应用安装包**：Windows x64 EXE、macOS Intel／Apple Silicon 各一个 DMG、Linux x64／ARM64 各一个 AppImage。五个原生运行器的打包下载与清理检查全部通过后统一发布。

[SHA-256、测试报告与第三方对应源码](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.6-materials)放在独立资料页。Android **0.1.0-preview.6** 的抖音、影片解析和滑动导航使用[独立 APK 与版本](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-v0.1.0-preview.6)。

无需另装 Python、Node.js、.NET 或媒体工具。Windows 需要系统已有 Evergreen WebView2 Runtime，缺失时尚不自动安装。macOS 15+；Linux 在 Ubuntu 24.04 构建。Windows 未签名；macOS 只有 ad-hoc 签名，没有 Developer ID 或公证。升级前请正常退出旧版。真实账号、干净系统安装和各网站最高规格需要分别验收。

[使用指南](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/USER_GUIDE.md) · [更新历史](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/CHANGELOG.md) · [项目介绍](https://jimmy-xuzimo.github.io/vidown/)
