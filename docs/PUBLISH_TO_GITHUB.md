# 发布到 GitHub —— 手动操作清单

> 目标：把 `/workspace/vidown` 推送到 `https://github.com/Jimmy-xuzimo/vidown`，并发布 `v0.1.0` Release。

本清单**不需要 GitHub CLI**，只用 `git` 和 `curl`（Release 阶段用 curl 调用 REST API）。

---

## 〇、前提检查

在你本机的终端里执行：

```bash
git --version    # 需要 >= 2.30
curl --version   # 任何版本都行
```

如果你用的是本机已安装的 GitHub CLI（`gh`），可以跳过第 4 步的 curl 写法，直接用 `gh release create`。

---

## 一、生成 Personal Access Token（PAT）

1. 打开 <https://github.com/settings/tokens/new>
2. **Note** 填：`vidown-publish`
3. **Expiration** 选：`No expiration` 或 `90 days`
4. **Scopes** 至少勾选：
   - `repo`（创建仓库、推送代码）
   - `workflow`（可选；仅当你后续要写 GitHub Actions 触发 release 时需要）
5. 点 **Generate token** → 复制 `ghp_xxxxxxxxxxxxxxxxxxxx`

> ⚠️ **token 只显示一次**，关掉页面就再也看不到。请保存到密码管理器或本机密钥环。

---

## 二、把代码搬到本机

由于当前代码在 TRAE 沙箱里，你需要把它导出到本机。两种方式任选：

### 方式 A：用 TRAE 的"下载"功能

1. 在 TRAE 界面里打开文件树，定位到 `/workspace/vidown`
2. 整目录下载为 zip
3. 在本机解压到任意目录，例如 `~/projects/vidown`

### 方式 B：自己重新做一次（最快）

```bash
mkdir -p ~/projects/vidown && cd ~/projects/vidown
# 把当前在沙箱里的 77 个已提交文件复制过来，或从 TRAE 的产物面板导出
# 关键路径：vidown/  scripts/  tests/  configs/  docs/  assets/  .github/  .gitignore
#          pyproject.toml  requirements*.txt  README.md  CHANGELOG.md  LICENSE
```

---

## 三、配置本地 Git 身份

提交需要署名。如果用占位身份也行（**但 GitHub 会显示"unverified"标记**），建议用真实信息：

```bash
cd ~/projects/vidown

# 替换成你自己的 GitHub 用户名和验证邮箱
git config user.name  "Jimmy-xuzimo"
git config user.email "your-verified-email@example.com"

# 检查 remote 配置（应当为空，因为我们用 HTTPS + token 推）
git remote -v
```

> 想让 GitHub 显示 **"Verified"** 绿勾，邮箱必须是你 GitHub 账号下已验证的邮箱：<https://github.com/settings/emails>。

---

## 四、推送代码到新仓库

### 4.1 在 GitHub 网页上创建空仓库

1. 打开 <https://github.com/new>
2. **Owner**：`Jimmy-xuzimo`
3. **Repository name**：`vidown`
4. **Description**：`通用视频下载器 —— 类 Downie4 的全能流媒体下载工具`
5. 选择 **Public**（如需私有选 Private）
6. **不要**勾选 `Add a README` / `Add .gitignore` / `Add a license`（避免与本地冲突）
7. 点 **Create repository**

### 4.2 推送 main 分支

页面跳转到 `https://github.com/Jimmy-xuzimo/vidown` 后会显示一段命令。在本机执行：

```bash
cd ~/projects/vidown

# 设置 remote（HTTPS 形式，token 在第 5 步推送时再提供）
git remote add origin https://github.com/Jimmy-xuzimo/vidown.git

# 推送 main
git push -u origin main
```

执行 `git push` 时会要求输入凭据：

- **Username**：`Jimmy-xuzimo`
- **Password**：粘贴 PAT（**不是 GitHub 登录密码**）

如果不想每次都输入，可改用以下任一方式（任选其一）：

```bash
# 方式 1：把 token 写入 remote URL（最简单）
git remote set-url origin https://ghp_xxxxxxxxxxxx@github.com/Jimmy-xuzimo/vidown.git

# 方式 2：使用 Git 凭据缓存（15 分钟有效）
git config --global credential.helper cache

# 方式 3：永久保存到 ~/.git-credentials
git config --global credential.helper store
```

> ⚠️ 方式 1 会把 token 写入 `.git/config`，**仅在本机使用即可**，不要把 `.git/config` 分享给他人。

### 4.3 验证推送成功

```bash
git log --oneline -5
# 应能看到: 3d57d7b feat: initial release v0.1.0
```

打开 <https://github.com/Jimmy-xuzimo/vidown> 应能看到 77 个文件。

---

## 五、创建 v0.1.0 Release 并上传二进制

这一步会做四件事：
1. 创建一个 git tag `v0.1.0`
2. 把 24 MB 的 `dist/vidown` 上传到 Release assets
3. 生成 SHA256 校验和文件
4. 自动写好 Release Notes（从 CHANGELOG.md 复制）

### 5.1 给本地仓库打 tag

```bash
cd ~/projects/vidown

# annotated tag（带作者与时间戳，GitHub 推荐）
git tag -a v0.1.0 -m "v0.1.0 - 首次发布

Vidown —— 通用视频下载器类 Downie4 的全能流媒体下载工具。

- 支持 1700+ 站点（yt-dlp 主引擎）
- M3U8/HLS/DASH 流媒体处理
- 统一输出 H.264/AAC MP4（CRF 18 / preset slow）
- Web GUI（Downie4 风格，单页 + SSE 实时进度）
- 跨平台：Linux 单文件 / macOS .app / Windows .exe"

# 把 tag 推上去
git push origin v0.1.0
```

### 5.2 上传二进制到 Release

把 PAT 临时放进环境变量（**不要写到任何文件里**）：

```bash
export VIDOWN_GH_TOKEN="ghp_xxxxxxxxxxxx"
export VIDOWN_GH_USER="Jimmy-xuzimo"
```

#### 方式 A：用 `gh` CLI（如果你装了）

```bash
# 校验和
cd ~/projects/vidown
sha256sum dist/vidown > dist/SHA256SUMS
cat dist/SHA256SUMS

# 创建 release 并上传
gh release create v0.1.0 \
  --repo "$VIDOWN_GH_USER/vidown" \
  --title "v0.1.0 - 首次发布" \
  --notes-file CHANGELOG.md \
  dist/vidown \
  dist/SHA256SUMS
```

#### 方式 B：纯 curl（不需要安装 gh）

```bash
cd ~/projects/vidown

# 0) 准备校验和
sha256sum dist/vidown > dist/SHA256SUMS
SHA=$(awk '{print $1}' dist/SHA256SUMS)
echo "SHA256: $SHA"

# 1) 读取 CHANGELOG 顶部作为 release notes
NOTES=$(awk '/^## \[0.1.0\]/{flag=1} flag && !/^## \[0.1.0\]/{print} flag && /^## \[/{if(NR>FNR)exit}' CHANGELOG.md | sed '$d')
# 如果上面命令没拿到内容，就用整个文件
[ -z "$NOTES" ] && NOTES="$(cat CHANGELOG.md)"

# 2) 调用 GitHub API 创建 release（返回 JSON 含 upload_url）
RESP=$(curl -s -X POST \
  -H "Authorization: token $VIDOWN_GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$VIDOWN_GH_USER/vidown/releases" \
  -d "$(printf '{"tag_name":"v0.1.0","target_commitish":"main","name":"v0.1.0 - 首次发布","body":%s,"draft":false,"prerelease":false}' \
      "$(printf '%s' "$NOTES" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')"
  )")

UPLOAD_URL=$(echo "$RESP" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("upload_url","").split("{")[0])')

if [ -z "$UPLOAD_URL" ]; then
  echo "创建 release 失败，响应："
  echo "$RESP"
  exit 1
fi

# 3) 上传 vidown 二进制
curl -s -X POST \
  -H "Authorization: token $VIDOWN_GH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @"dist/vidown" \
  "$UPLOAD_URL?name=vidown-linux-x86_64"

# 4) 上传 SHA256SUMS
curl -s -X POST \
  -H "Authorization: token $VIDOWN_GH_TOKEN" \
  -H "Content-Type: text/plain" \
  --data-binary @"dist/SHA256SUMS" \
  "$UPLOAD_URL?name=SHA256SUMS"

echo
echo "完成！访问：https://github.com/$VIDOWN_GH_USER/vidown/releases/tag/v0.1.0"
```

> Windows PowerShell 用户请用 `scripts/publish_to_github.ps1`（如果你本机已经拉取了这份仓库的话）。

---

## 六、验证发布

打开以下链接确认一切就绪：

| 检查项 | URL |
|---|---|
| 仓库主页 | <https://github.com/Jimmy-xuzimo/vidown> |
| 代码（应看到 77 个文件） | <https://github.com/Jimmy-xuzimo/vidown/tree/main> |
| 提交历史 | <https://github.com/Jimmy-xuzimo/vidown/commits/main> |
| Release 页面 | <https://github.com/Jimmy-xuzimo/vidown/releases/tag/v0.1.0> |
| 二进制下载 | <https://github.com/Jimmy-xuzimo/vidown/releases/download/v0.1.0/vidown-linux-x86_64> |

---

## 七、收尾（可选）

### 7.1 调整仓库设置

访问 <https://github.com/Jimmy-xuzimo/vidown/settings>：

- **General → Features**：
  - ✅ Issues（开 issue 接收反馈）
  - ✅ Discussions（社区讨论）
  - ❌ Wiki（不需要）
  - ✅ Projects（可选）
- **General → Default branch**：保持 `main`
- **General → Social preview**：上传 `assets/icon_512.png` 作为预览图
- **Security → Code security and analysis**：
  - ✅ Dependabot alerts
  - ✅ Code scanning（已通过 `.github/workflows/codeql.yml` 启用）

### 7.2 添加 Topics

访问 <https://github.com/Jimmy-xuzimo/vidown> → 右侧 "About" 齿轮 → **Topics** 输入：

```
video-downloader  yt-dlp  m3u8  hls  ffmpeg  python
cross-platform  h264  mp4  downloader  streaming
```

### 7.3 修复合并设置

访问 <https://github.com/Jimmy-xuzimo/vidown/settings> → **General → Pull Requests**：

- ✅ Allow squash merging
- ❌ Allow merge commits（保持线性历史）
- ❌ Allow rebase merging
- ✅ Automatically delete head branches

### 7.4 设置 GitHub Pages（可选）

如果想用 `docs/` 目录作为文档站点：

1. <https://github.com/Jimmy-xuzimo/vidown/settings/pages>
2. Source：`Deploy from a branch`
3. Branch：`main` / `docs/`

---

## 八、常见问题

**Q1: `git push` 报 `Permission denied` / `403`**  
→ 检查 PAT 是否勾选了 `repo` scope；Username 是否填了 `Jimmy-xuzimo`（不是邮箱）。

**Q2: Release 报 `Bad credentials`**  
→ token 复制时漏了字符；重新生成一个。

**Q3: 提交邮箱显示"unverified"**  
→ 在 <https://github.com/settings/emails> 添加并验证该邮箱。

**Q4: 想撤销刚 push 的提交**  
→ 先看 <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository>。本地已 push 的代码**永远会留在 GitHub 事件日志里**，所以发布前**不要把 token 提交进代码**。

**Q5: Release 资产超过 2 GB 限制？**  
→ `dist/vidown` 仅 24 MB，远低于限制。

**Q6: macOS / Windows 二进制？**  
→ 当前 `dist/vidown` 是在 **Linux** 上构建的，**不能在 macOS / Windows 上运行**。要发布多平台二进制，请在各自平台的 runner 上跑 `scripts/build.py`，或借助 GitHub Actions 矩阵（`.github/workflows/build.yml` 已配置好）。

---

## 九、下次更新流程（备忘）

```bash
cd ~/projects/vidown
# 修改代码...
git add -A
git commit -m "feat: 新功能描述"
git push
git tag -a v0.1.1 -m "v0.1.1 描述"
git push origin v0.1.1
gh release create v0.1.1 --title "v0.1.1" --notes-file CHANGELOG.md dist/vidown
```

完成。
