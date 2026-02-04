"""环境变量集中定义与读取。所有 backend 用到的环境变量在此统一管理，便于查询和文档化。

使用方式：from backend.env import env 然后 env.VIDEOLIB_DATA_DIR、env.is_dev、env.ffmpeg_path 等。
或直接使用常量名与 get_* 函数。
"""

from __future__ import annotations

import os
from typing import Optional

# -----------------------------------------------------------------------------
# 变量名常量（便于文档、.env.example 与工具生成）
# -----------------------------------------------------------------------------

# 数据根与运行模式
VIDEOLIB_DATA_DIR = "VIDEOLIB_DATA_DIR"  # 数据根目录覆盖；未设时由 FLASK_DEBUG / 平台默认决定
FLASK_DEBUG = "FLASK_DEBUG"  # 1/true/yes 时视为开发环境，数据根为项目根/data
CONFIG_FILE = "CONFIG_FILE"  # config.json 路径覆盖；未设时为 <数据根>/config.json

# 外部工具路径（未设时使用 config 文件或下列默认值）
FFMPEG_PATH = "FFMPEG_PATH"
FFPROBE_PATH = "FFPROBE_PATH"

# 应用行为
SECRET_KEY = "SECRET_KEY"
SCAN_ON_STARTUP = "SCAN_ON_STARTUP"  # 1/0，是否启动时扫描媒体库
HLS_SEGMENT_BYTES = "HLS_SEGMENT_BYTES"  # 整数，HLS 分片字节数
LOG_LEVEL = "LOG_LEVEL"  # DEBUG / INFO / WARNING / ERROR

# 系统变量（仅读取，不在此定义默认值）：LOCALAPPDATA, XDG_DATA_HOME


def _get(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def _get_optional(key: str) -> Optional[str]:
    v = _get(key)
    return v if v else None


def get_data_dir() -> Optional[str]:
    """VIDEOLIB_DATA_DIR；未设返回 None。"""
    return _get_optional(VIDEOLIB_DATA_DIR)


def get_is_dev() -> bool:
    """是否为开发环境（FLASK_DEBUG=1/true/yes 时为 True）。"""
    return _get(FLASK_DEBUG).lower() in ("1", "true", "yes")


def get_config_file_default() -> str:
    """CONFIG_FILE 未设时的默认值由调用方传入（依赖数据根）；此处仅返回空表示「用默认」。
    实际在 config 模块中与 DATA_ROOT 拼接。
    """
    return _get(CONFIG_FILE)  # 空则调用方用 DATA_ROOT / "config.json"


def get_ffmpeg_path() -> str:
    return _get(FFMPEG_PATH, "ffmpeg")


def get_ffprobe_path() -> str:
    return _get(FFPROBE_PATH, "ffprobe")


def get_secret_key() -> str:
    return _get(SECRET_KEY, "dev-secret-change-me")


def get_scan_on_startup() -> bool:
    return _get(SCAN_ON_STARTUP, "1") == "1"


def get_hls_segment_bytes() -> int:
    return int(_get(HLS_SEGMENT_BYTES, str(2 * 1024 * 1024)))


def get_log_level() -> str:
    return _get(LOG_LEVEL, "INFO").upper()


def get_localappdata() -> str:
    """Windows 本地应用数据目录；非 Windows 返回空。"""
    return _get("LOCALAPPDATA", "")


def get_xdg_data_home() -> str:
    """Linux XDG_DATA_HOME；未设返回空。"""
    return _get("XDG_DATA_HOME", "")


class Env:
    """只读环境变量访问门面，便于在一处列出所有可用项。"""

    # 变量名（字符串，便于序列化/文档）
    VIDEOLIB_DATA_DIR = VIDEOLIB_DATA_DIR
    FLASK_DEBUG = FLASK_DEBUG
    CONFIG_FILE = CONFIG_FILE
    FFMPEG_PATH = FFMPEG_PATH
    FFPROBE_PATH = FFPROBE_PATH
    SECRET_KEY = SECRET_KEY
    SCAN_ON_STARTUP = SCAN_ON_STARTUP
    HLS_SEGMENT_BYTES = HLS_SEGMENT_BYTES
    LOG_LEVEL = LOG_LEVEL

    @property
    def data_dir(self) -> Optional[str]:
        return get_data_dir()

    @property
    def is_dev(self) -> bool:
        return get_is_dev()

    @property
    def config_file(self) -> str:
        return get_config_file_default()

    @property
    def ffmpeg_path(self) -> str:
        return get_ffmpeg_path()

    @property
    def ffprobe_path(self) -> str:
        return get_ffprobe_path()

    @property
    def secret_key(self) -> str:
        return get_secret_key()

    @property
    def scan_on_startup(self) -> bool:
        return get_scan_on_startup()

    @property
    def hls_segment_bytes(self) -> int:
        return get_hls_segment_bytes()

    @property
    def log_level(self) -> str:
        return get_log_level()


env = Env()
