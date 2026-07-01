# 开发指南

## 环境设置

```bash
# 克隆
git clone https://github.com/vidown/vidown.git
cd vidown

# 创建 venv
python3 -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate

# 安装开发依赖
pip install -r requirements-dev.txt
pip install -e .
```

## 运行测试

```bash
pytest                          # 全部测试
pytest tests/test_format_selector.py -v   # 单独文件
pytest -k "test_youtube"        # 按关键字过滤
pytest --cov=vidown             # 覆盖率
```

## 代码风格

- **black**：行宽 100
- **ruff**：行宽 100
- **mypy**：可选，类型注解非强制

```bash
black .
ruff check . --fix
mypy vidown/
```

## 添加自定义引擎

```python
# my_engine.py
from vidown.engines.base import BaseEngine, EngineCapability, EngineContext
from vidown.core.models import VideoInfo, DownloadTask, Platform, MediaKind

class MyEngine(BaseEngine):
    name = "my_engine"
    display_name = "My Custom Engine"
    capabilities = [EngineCapability.PROBE, EngineCapability.DOWNLOAD]

    def can_handle(self, url, platform, kind):
        return "mysite.com" in url

    def priority(self, url, platform, kind):
        return 50

    def probe(self, url, ctx):
        return VideoInfo(url=url, title="demo", platform=Platform.UNKNOWN)

    def download_info(self, task, info, ctx):
        # your download logic
        return "/path/to/output.mp4"
```

然后在 `vidown.core.scheduler.DownloadScheduler._build_default_registry` 中注册：

```python
registry.register(MyEngine(config))
```

## 添加 CLI 子命令

在 `vidown/cli/main.py`：

```python
def cmd_mycommand(args):
    """我的自定义命令"""
    print("hello")
    return 0

# 在 build_parser() 中
mc = sub.add_parser("mycommand", help="我的命令")
mc.set_defaults(func=cmd_mycommand)
```

## API 调用示例

### Python 嵌入

```python
from vidown.core.config import load_config
from vidown.core.scheduler import DownloadScheduler
from vidown.core.models import DownloadStatus

config = load_config()
scheduler = DownloadScheduler(config)

results = []
def on_status(task):
    if task.status == DownloadStatus.COMPLETED:
        results.append(task.output_path)
    elif task.status == DownloadStatus.FAILED:
        print(f"Failed: {task.error_message}")

scheduler.on_status(on_status)
scheduler.add_task("https://www.youtube.com/watch?v=abc")
scheduler.add_task("https://www.bilibili.com/video/BV1xx")

scheduler.start()
scheduler.shutdown(wait=True)
print(f"Downloaded: {results}")
```

### REST API（GUI 后端）

启动 `vidown gui` 后可调用：

```bash
# 添加任务
curl -X POST http://127.0.0.1:8765/api/add \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=abc"}'

# 列出任务
curl http://127.0.0.1:8765/api/tasks

# 取消任务
curl -X POST http://127.0.0.1:8765/api/cancel \
  -H "Content-Type: application/json" \
  -d '{"task_id": "abc123"}'

# SSE 实时事件
curl -N http://127.0.0.1:8765/api/events
```

## 发布流程

1. 更新 `vidown/__init__.py` 中的 `__version__`
2. 更新 `pyproject.toml` 中的 `version`
3. `git tag v0.1.0`
4. `git push --tags`
5. CI 构建并发布到 PyPI
