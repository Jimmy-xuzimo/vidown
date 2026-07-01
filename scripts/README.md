# Vidown 打包脚本

构建跨平台可执行文件的入口。

## 文件

| 文件 | 说明 |
|------|------|
| `build.py` | 主入口，支持 onefile / onedir / .app / AppImage |
| `vidown.spec` | PyInstaller 规格文件（数据/隐藏导入/排除项） |
| `vidown_entry.py` | 冻结入口脚本（不依赖相对导入） |
| `pyinstaller_hooks/` | 自定义 PyInstaller hooks |
| `clean.sh` | 清理 build / dist 临时文件 |

## 快速参考

```bash
# 当前平台
python scripts/build.py --clean --verify

# 完整构建（macOS）
python scripts/build.py --clean --verify --app

# 完整构建（Linux）
python scripts/build.py --clean --verify --appimage

# 完整构建（Windows）
python scripts\build.py --clean --verify

# 手动调用 PyInstaller
python -m PyInstaller scripts/vidown.spec --noconfirm --clean
```

## 详细文档

参见 [docs/BUILDING.md](../docs/BUILDING.md)。
