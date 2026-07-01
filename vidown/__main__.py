"""支持 `python -m vidown ...` 调用。"""

from .compat import configure_utf8_stdout

# 必须先于所有 CLI / argparse 相关 import 执行，
# 否则 argparse 在解析 --help 之前就会尝试打印中文。
configure_utf8_stdout()

from .cli import main  # noqa: E402  必须在 configure_utf8_stdout 之后

if __name__ == "__main__":
    raise SystemExit(main())
