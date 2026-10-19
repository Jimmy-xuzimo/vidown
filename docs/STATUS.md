# 当前状态

当前桌面版为 **1.0.6**，Android 为 **0.1.0-preview.6**。两端独立版本和发行标签，不互相覆盖测试声明。已公开版本的变化见[更新历史](CHANGELOG.md)。

桌面 Actions 在 Windows x64、macOS Intel／Apple Silicon、Linux x64／ARM64 原生运行器构建并验证，主 Release 保留五个应用包。1.0.5 修复抖音网页解析；真实公开样本测试限于记录中的 Windows 环境。源码、校验和报告放独立资料页。

Android 是原生 Kotlin／Compose／Material 3 与 GeckoView 工程，最低 Android 14，一个签名 APK 包含 ARM64 和 x86_64。已实现浏览器会话共享、音视频选择、受控协议下载、无损合并、系统存储保存、队列、历史、主题和清理；公开 B 站样本已完成模拟器下载。完整迁移尚未全部验收，真实会员权限、ARM64 真机、后台／续航／温控仍待验证。使用、构建与证据分别见 [Android 指南](ANDROID.md)、[工程说明](../android/README.md)和[验收记录](../android/ACCEPTANCE.md)。尚未命名稳定版或上架 Play。

两端均无外部浏览器 Cookie 导入与配套导出扩展，统一使用内置浏览器登录和本机会话保存。桌面 Windows 网页使用 WebView2，macOS／Linux 使用 Chromium，Android 使用 GeckoView。

完整能力边界以 [README](../README.md)、[测试记录](VALIDATION.md)、[多平台构建](BUILDING.md) 和 [路线图](ROADMAP.md) 为准。CI 桌面启动和真实受控下载不代替干净系统安装／卸载、真实会员／私有账号、全部 Linux 发行版或人工 HDR 播放验收。
