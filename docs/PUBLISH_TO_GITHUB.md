# 发布到 GitHub —— Windows 完整指南

> 目标：把 `vidown` 推送到 `https://github.com/Jimmy-xuzimo/vidown`，并发布 `v0.1.0` Release。
>
> 你的 PowerShell 报错说明：**没有装 git**，并且 PowerShell 自带的 `curl` 是 `Invoke-WebRequest` 的别名，不能用。本指南从**装 git** 开始讲。

---

## 第一步：安装 Git for Windows

1. 打开 <https://git-scm.com/download/win>
2. 下载 64-bit Git for Windows Setup（文件名类似 `Git-2.45.2-64-bit.exe`）
3. 双击运行 → 一路 **Next**（推荐勾选 *"Add Git to PATH"* 这一项，默认就会勾）
4. 装完**关掉旧的 PowerShell 窗口，重新打开一个新的**（PATH 不会自动应用到旧窗口）

验证安装：

```powershell
git --version
# 期望看到：git version 2.45.2.windows.1 （或类似版本号）
```

> 不需要装 GitHub CLI（`gh`），本指南用 `git` + PowerShell 的 `Invoke-RestMethod` 完成所有操作。

---

## 第二步：生成 Personal Access Token（PAT）

1. 浏览器打开 <https://github.com/settings/tokens/new>
2. **Note** 填：`vidown-publish`
3. **Expiration** 选：`No expiration`（或 `90 days`）
4. **Scopes** 只勾选 **`repo`** 这一项就够
5. 点页面最下方绿色按钮 **Generate token**
6. 立即复制显示的 `ghp_xxxxxxxxxxxxxxxxxxxx`（**关掉页面就再也看不到**）

把 token 保存到本机一个**普通文本文件**里（例如 `D:\vidown-token.txt`），后面要用 —— 这样不用每次重新生成。文件内容就是 token 本身（一行字符串），**不要**提交到任何 git 仓库。

---

## 第三步：把代码搬到本机

在 TRAE 沙箱里，文件都在 `/workspace/vidown`。两种方式搬出来：

### 方式 A：通过 TRAE 文件树下载

1. 在 TRAE 左侧文件树里展开 `workspace/vidown`
2. 选中 `vidown` 整个目录 → 右键 → **Download**（如果支持）
3. 浏览器会下载一个 zip，解压到本机 `D:\projects\vidown`

### 方式 B：在 PowerShell 里手动重建（最稳）

**只在沙箱里执行下面命令**，把整个仓库打包成一个自解压的 PowerShell 脚本：

```bash
cd /workspace/vidown
# 在沙箱里把整个仓库打包成 base64
tar -czf - --exclude=__pycache__ --exclude=build --exclude=dist --exclude=.git . | base64 -w0 > /tmp/vidown.tar.b64
```

然后用 TRAE 的文件查看器把 `/tmp/vidown.tar.b64` 打开 → 全选复制。**注意：内容会很大（几 MB）**，但能一次到位。

到本机 `D:\projects\` 下执行：

```powershell
mkdir D:\projects\vidown
cd D:\projects\vidown

# 把上面复制的一大段 base64 粘到 $B64 变量里
$B64 = '...一大段base64...'

# 解码并解压
[IO.File]::WriteAllBytes('vidown.tar.gz', [Convert]::FromBase64String($B64))
tar -xzf vidown.tar.gz
del vidown.tar.gz
```

> 嫌 base64 太大？更省事的 B 方案是直接用 TRAE 提供的"下载工作区"功能，下载整个 `/workspace/vidown` 目录。

---

## 第四步：初始化本地 Git 仓库

打开 **PowerShell**（不是 CMD）：

```powershell
cd D:\projects\vidown

# 确认这里是仓库根（应该看到 pyproject.toml、README.md、vidown/ 等）
dir
```

**如果第三步搬过来时 `.git` 也一起搬了**（包含隐藏的 `.git` 目录），直接跳到第五步。

**如果 `.git` 没搬过来**（目录里没有 `.git`），重新初始化：

```powershell
cd D:\projects\vidown

# 1) 初始化
git init -b main

# 2) 配置身份（用你 GitHub 已验证的邮箱，commit 才会显示绿勾）
git config user.name  "Jimmy-xuzimo"
git config user.email "your-verified-email@example.com"

# 3) 清理掉搬过来时残留的 __pycache__ / build / dist（这些本来就不该进 git）
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue `
  (Get-ChildItem -Recurse -Directory -Filter "__pycache__" | % { $_.FullName })
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue build, dist

# 4) 全量提交
git add -A
git commit -m "feat: initial release v0.1.0"
```

---

## 第五步：在 GitHub 创建空仓库

浏览器打开 <https://github.com/new>：

- **Owner**：`Jimmy-xuzimo`
- **Repository name**：`vidown`
- **Description**：`通用视频下载器 —— 类 Downie4 的全能流媒体下载工具`
- **Public / Private**：按需
- ❌ **不要勾选** `Add a README` / `Add .gitignore` / `Add a license`（会和本地冲突）
- 点 **Create repository**

---

## 第六步：推送代码

回到 PowerShell：

```powershell
cd D:\projects\vidown

# 1) 关联远程仓库
git remote add origin https://github.com/Jimmy-xuzimo/vidown.git

# 2) 推送（PowerShell 会弹窗或提示输入凭据）
git push -u origin main
```

**凭据输入：**

- **Username**：`Jimmy-xuzimo`
- **Password**：粘贴第二步生成的 PAT（**不是 GitHub 登录密码**）

> **避免每次输入密码**（推荐）：用 Windows 凭据管理器
> ```powershell
> git config --global credential.helper manager
> ```
> 第一次 push 后，Windows 会弹窗让你确认把 PAT 存进凭据管理器。以后就不用再输了。

### 验证

```powershell
git log --oneline -3
# 应该看到：
# d7851aa docs: add PUBLISH_TO_GITHUB manual checklist  （如果有搬过来）
# 3d57d7b feat: initial release v0.1.0
```

打开 <https://github.com/Jimmy-xuzimo/vidown> 应能看到 78 个文件。

---

## 第七步：发布 v0.1.0 Release

### 7.1 在本地打 tag

```powershell
cd D:\projects\vidown

git tag -a v0.1.0 -m "v0.1.0 - 首次发布

Vidown - 通用视频下载器类 Downie4 的全能流媒体下载工具。

- 1700+ 站点支持（yt-dlp 主引擎）
- M3U8/HLS/DASH 流媒体处理
- 统一输出 H.264/AAC MP4（CRF 18 / preset slow）
- Web GUI（Downie4 风格，单页 + SSE 实时进度）
- 跨平台：Linux 单文件 / macOS .app / Windows .exe"

git push origin v0.1.0
```

### 7.2 把 token 读进来

```powershell
# 从文件读取 token（不写入 git）
$env:VIDOWN_GH_TOKEN = Get-Content "D:\vidown-token.txt" -Raw
$env:VIDOWN_GH_TOKEN = $env:VIDOWN_GH_TOKEN.Trim()

# 确认
Write-Host "Token length: $($env:VIDOWN_GH_TOKEN.Length)"   # 应该是 40
```

### 7.3 上传二进制（dist/vidown 是 24 MB 的 Linux 版本）

> ⚠️ **重要提示**：沙箱里构建的 `dist/vidown` 是在 **Linux** 上跑 PyInstaller 出来的，**不能在 Windows 上运行**。它上传到 Release 后是给 Linux 用户下载的。
>
> 如果你希望 Windows 用户也能用，需要在 Windows 上重新跑 `scripts\build.py` 打包，得到 `dist\vidown.exe` 后再上传。下面以**先上传 Linux 版本**为例，Windows 版本的步骤会单列在 7.5。

```powershell
cd D:\projects\vidown

# 0) 把 Linux 版的 dist 拷贝过来
Copy-Item "D:\path\to\vidown" "D:\projects\vidown\dist\vidown-linux-x86_64"

# 1) 计算 SHA256
$Hash = (Get-FileHash "dist\vidown-linux-x86_64" -Algorithm SHA256).Hash.ToLower()
"  $Hash  vidown-linux-x86_64" | Out-File -Encoding ascii dist\SHA256SUMS
Get-Content dist\SHA256SUMS
# 输出形如：
#   a1b2c3...  vidown-linux-x86_64

# 2) 准备 release notes
$Notes = Get-Content CHANGELOG.md -Raw
$JsonNotes = $Notes | ConvertTo-Json -Depth 5

# 3) 创建 release
$Body = @{
    tag_name         = "v0.1.0"
    target_commitish = "main"
    name             = "v0.1.0 - 首次发布"
    body             = $Notes
    draft            = $false
    prerelease       = $false
} | ConvertTo-Json -Depth 5

$Headers = @{
    "Authorization" = "token $env:VIDOWN_GH_TOKEN"
    "Accept"        = "application/vnd.github+json"
    "User-Agent"    = "vidown-publish-script"
}

$Release = Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.github.com/repos/Jimmy-xuzimo/vidown/releases" `
    -Headers $Headers `
    -ContentType "application/json" `
    -Body $Body

Write-Host "Release created: $($Release.html_url)"

# 4) 取 upload URL（去掉 `{?name,label}` 模板）
$UploadUrl = $Release.upload_url -replace '\{.*\}', ''

# 5) 上传 vidown 二进制
Invoke-RestMethod -Method Post `
    -Uri "$UploadUrl?name=vidown-linux-x86_64" `
    -Headers $Headers `
    -ContentType "application/octet-stream" `
    -InFile "dist\vidown-linux-x86_64"

# 6) 上传 SHA256SUMS
Invoke-RestMethod -Method Post `
    -Uri "$UploadUrl?name=SHA256SUMS" `
    -Headers $Headers `
    -ContentType "text/plain" `
    -InFile "dist\SHA256SUMS"

Write-Host "Done: https://github.com/Jimmy-xuzimo/vidown/releases/tag/v0.1.0"
```

### 7.4 验证 Release

打开 <https://github.com/Jimmy-xuzimo/vidown/releases/tag/v0.1.0>，应能看到两个资产：
- `vidown-linux-x86_64`（24 MB）
- `SHA256SUMS`（校验和）

### 7.5 同时发布 Windows 版本（可选）

如果你想在 Windows 上自己打包一个 `.exe`：

```powershell
# 安装 PyInstaller
pip install -r requirements.txt
pip install pyinstaller

# 用仓库自带的 spec 构建
cd D:\projects\vidown
pyinstaller scripts\vidown.spec --clean --noconfirm

# 产物在 dist\vidown\vidown.exe（onedir 模式）或 dist\vidown.exe（onefile 模式）
# 把产物拷贝到发布脚本能识别的地方，重跑 7.3 即可（修改文件名为 vidown-windows-x86_64.exe）
```

---

## 第八步：常见问题排查

### 报错 `fatal: 'origin' does not appear to be a git repository`

→ 还没执行 `git remote add origin ...`，回到第六步开头。

### 报错 `Permission denied` / `403 Forbidden`

- 检查 PAT 是否勾选了 `repo` scope
- Username 必须是 `Jimmy-xuzimo`（不是你的注册邮箱）
- Password 字段粘贴的是 **PAT**，不是 GitHub 登录密码

### 报错 `release not found` / 404

→ 第七步里 `git push origin v0.1.0` 还没成功。回 7.1 末尾。

### Commit 旁边显示"unverified"

→ 你 `git config user.email` 填的不是 GitHub 账号下已验证的邮箱。改用已验证邮箱后执行：

```powershell
git commit --amend --reset-author --no-edit
git push --force-with-lease
```

### PowerShell 报 `curl` 找不到

→ PowerShell 自带的 `curl` 是 `Invoke-WebRequest` 的别名，**用不了**。本指南全程用 `Invoke-RestMethod`，不要直接打 `curl`。

### 网络慢导致 Invoke-RestMethod 超时

```powershell
Invoke-WebRequest -Uri ... -TimeoutSec 600   # 加超时
# 或用 curl.exe（git for windows 自带）
& "C:\Program Files\Git\mingw64\bin\curl.exe" --version
```

---

## 第九步：完成确认

| 检查项 | 链接 |
|---|---|
| 仓库主页 | <https://github.com/Jimmy-xuzimo/vidown> |
| 提交列表 | <https://github.com/Jimmy-xuzimo/vidown/commits/main> |
| Release 页面 | <https://github.com/Jimmy-xuzimo/vidown/releases/tag/v0.1.0> |
| Linux 二进制 | <https://github.com/Jimmy-xuzimo/vidown/releases/download/v0.1.0/vidown-linux-x86_64> |
| 校验和 | <https://github.com/Jimmy-xuzimo/vidown/releases/download/v0.1.0/SHA256SUMS> |

四个链接都点开确认无误，就完成了 🎉
