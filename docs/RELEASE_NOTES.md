# Vidown 1.0.5

修复抖音网页版视频链接解析。支持从工作台粘贴带 `modal_id` 的精选页链接、视频长链接，或在内置浏览器中打开视频后提取当前页。

- 从网页正常返回的详情响应和公开页面数据读取视频规格，避免直接提取器报 `Unsupported URL` 或在空响应后误报 Cookie 问题。
- 严格匹配目标视频编号，避免选中网页预加载的相邻视频；保留真实分辨率、码率和备用 CDN，不虚构未知的编码或音频参数。
- 关闭标签和清理浏览器数据时清除相关规格缓存；缓存过期后重新加载页面获取规格。
- 保留统一浏览器会话及下载传输链路，不新增站点登录入口或外部 Cookie 导入。

Windows 本地 WebView2／Chromium 验收中，用户提供的公开视频返回 19 个规格，最高 3840×2160 HEVC；实际下载并验证了带 AAC 音频的约 5 秒片段，没有完整下载约 31 分钟的长视频。另一个约 20 秒短视频完成实际队列下载、合并和成品验证。44 项自动化测试及 21 组浏览器回归通过。详见[测试记录](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/VALIDATION.md)。

真实登录／私密内容、分享短链和各平台的抖音网站实测范围仍需分别验收。网站要求的登录、验证、权限和地域限制不会被绕过；公开样本通过不代表全部视频可下载。

主 Release 仅提供 **5 个应用包**：Windows x64 安装 EXE、macOS Intel／Apple Silicon 各一个 DMG、Linux x64／ARM64 各一个 AppImage。便携 EXE、DEB 和其他重复格式不作为公开下载附件。

[SHA-256 校验、测试报告与第三方对应源码](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.5-materials)单独保存。五个原生运行器均执行打包应用的受控下载与数据清理测试，全部通过后才发布。

无需另外安装 Python、Node.js、.NET 或媒体工具。Windows 浏览器仍需系统已有的 Evergreen WebView2 Runtime，缺失时尚不自动安装。macOS 要求 15+；Linux 在 Ubuntu 24.04 构建。Windows 未签名，macOS 只有 ad-hoc 签名，没有 Developer ID 或公证。

升级前请正常退出旧版再安装。干净系统安装／卸载、真实账号与所有网站最高规格仍需分别验收。

[使用指南](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/USER_GUIDE.md) · [测试记录](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/VALIDATION.md) · [项目介绍](https://jimmy-xuzimo.github.io/vidown/)
