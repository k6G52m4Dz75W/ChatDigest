"""
tests/conftest.py — pytest fixtures & sys.path setup

把 tools/ 加进 sys.path，让测试能 `import ima_upload`。
（不通过 setup.py / pyproject.toml 安装，纯开发期直接 import。）
"""
import sys
from pathlib import Path

# conftest.py 自身位于 <repo>/tests/conftest.py，父目录的兄弟 tools/ 即待测模块目录
_REPO_ROOT = Path(__file__).resolve().parent.parent
_TOOLS_DIR = _REPO_ROOT / "tools"
if str(_TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(_TOOLS_DIR))

# 强制 UTF-8 stdout，避免 Windows console (GBK) 把中文断言信息变成乱码
# （不影响测试结果，只影响报错时的可读性。）
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass
