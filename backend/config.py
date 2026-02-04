"""应用配置：config 文件存储媒体库路径与可选的 ffmpeg/ffprobe 路径；数据根可开发/正式分离。

- 数据根：由 VIDEOLIB_DATA_DIR / FLASK_DEBUG 或平台默认决定；其下为 config.json、*.db、resources/ 等
- 开发（FLASK_DEBUG=1）：数据根 = 项目根/data，与 backend、frontend 并列
- 正式：未设置时使用平台用户数据目录（Windows %LOCALAPPDATA%\\ZakoData 等），自动创建
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Callable

from backend import env  # 环境变量统一从 backend.env 读取

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent

# 正式环境数据根目录名
PRODUCTION_DATA_DIR_NAME = "ZakoData"
PRODUCTION_DATA_DIR_NAME_LINUX = "zakodata"


def _resolve_data_root() -> Path:
    """确定数据根目录并创建；优先级：VIDEOLIB_DATA_DIR > FLASK_DEBUG（开发）> 平台默认（ZakoData）。"""
    data_dir = env.get_data_dir()
    if data_dir:
        root = Path(data_dir).resolve()
        root.mkdir(parents=True, exist_ok=True)
        return root

    if env.get_is_dev():
        root = PROJECT_ROOT / "data"
        root.mkdir(parents=True, exist_ok=True)
        return root.resolve()

    if sys.platform == "win32":
        base = env.get_localappdata()
        if not base:
            base = str(Path.home() / "AppData" / "Local")
        root = Path(base) / PRODUCTION_DATA_DIR_NAME
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support" / PRODUCTION_DATA_DIR_NAME
    else:
        xdg = env.get_xdg_data_home()
        base = Path(xdg) if xdg else Path.home() / ".local" / "share"
        root = base / PRODUCTION_DATA_DIR_NAME_LINUX
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


DATA_ROOT = _resolve_data_root()

_config_file_env = env.get_config_file_default()
CONFIG_FILE = Path(_config_file_env if _config_file_env else str(DATA_ROOT / "config.json"))

DB_PATH = (DATA_ROOT / "media.db").resolve()
DATABASE_URL = f"sqlite:///{DB_PATH}"

ACTORS_DB_PATH = (DATA_ROOT / "actors.db").resolve()
ACTORS_DATABASE_URL = f"sqlite:///{ACTORS_DB_PATH}"

USAGE_DB_PATH = (DATA_ROOT / "usage.db").resolve()
USAGE_DATABASE_URL = f"sqlite:///{USAGE_DB_PATH}"

RESOURCES_DIR = (DATA_ROOT / "resources").resolve()
# 演员头像统一存放在 data/resources/avatars 下，通过「名称 → 文件」规则动态解析，不再依赖 DB 字段
AVATARS_DIR = (RESOURCES_DIR / "avatars").resolve()
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
# 缩略图按视频存储：每个视频在其所在目录下拥有 sprites/ 子目录（thumbnails.vtt、sprite.jpg），无需中央目录

class Config:
    """应用配置。媒体库路径与 ffmpeg/ffprobe 路径可编辑并持久化到 config 文件。"""

    DB_PATH: Path = DB_PATH
    DATABASE_URL: str = DATABASE_URL
    ACTORS_DB_PATH: Path = ACTORS_DB_PATH
    ACTORS_DATABASE_URL: str = ACTORS_DATABASE_URL
    USAGE_DB_PATH: Path = USAGE_DB_PATH
    USAGE_DATABASE_URL: str = USAGE_DATABASE_URL

    def __init__(self) -> None:
        self._media_roots: list[str] = []
        self._ffmpeg_path: str | None = None
        self._ffprobe_path: str | None = None
        # 演员头像仓库源 URL；为空表示禁用头像同步
        self._avatar_source_url: str | None = None
        # 后端启动时是否自动执行媒体库扫描；None 表示未持久化，使用 env 默认
        self._scan_on_startup: bool | None = None
        self._on_change_callbacks: list[Callable[[], None]] = []
        # 启动自检结果：是否可用 ffprobe 获取时长（未检或不可用时为 False）
        self._ffprobe_available: bool = False
        self._ffmpeg_available: bool = False

    @property
    def media_roots(self) -> list[str]:
        return list(self._media_roots)

    @property
    def ffmpeg_path(self) -> str:
        """ffmpeg 可执行路径；未配置时用环境变量 FFMPEG_PATH，否则 "ffmpeg"。"""
        if self._ffmpeg_path is not None and self._ffmpeg_path.strip():
            return self._ffmpeg_path.strip()
        return env.get_ffmpeg_path()

    @property
    def ffprobe_path(self) -> str:
        """ffprobe 可执行路径；未配置时用环境变量 FFPROBE_PATH，否则 "ffprobe"。"""
        if self._ffprobe_path is not None and self._ffprobe_path.strip():
            return self._ffprobe_path.strip()
        return env.get_ffprobe_path()

    @property
    def ffprobe_available(self) -> bool:
        """启动自检后 ffprobe 是否可用；为 True 时 m3u8 使用 ffprobe 获取精确时长。"""
        return self._ffprobe_available

    def set_ffprobe_available(self, value: bool) -> None:
        """设置启动自检结果（由 services.ffprobe 在启动时调用）。"""
        self._ffprobe_available = value

    @property
    def ffmpeg_available(self) -> bool:
        """启动自检后 ffmpeg 是否可用（用于 TS→MP4 等任务）。"""
        return self._ffmpeg_available

    def set_ffmpeg_available(self, value: bool) -> None:
        """设置启动自检结果（由 services.ffmpeg 在启动时调用）。"""
        self._ffmpeg_available = value

    @property
    def avatar_source_url(self) -> str | None:
        """演员头像仓库源 URL；为空或 None 表示未配置（不启用外部头像同步）。"""
        if self._avatar_source_url is None:
            return None
        v = self._avatar_source_url.strip()
        return v or None

    @property
    def scan_on_startup(self) -> bool:
        """是否在后端启动时自动执行媒体库扫描。未持久化时使用环境变量 SCAN_ON_STARTUP。"""
        if self._scan_on_startup is not None:
            return self._scan_on_startup
        return env.get_scan_on_startup()

    def load_from_file(self) -> None:
        """从 config 文件加载 media_roots 与可选的 ffmpeg_path/ffprobe_path。"""
        if not CONFIG_FILE.exists():
            return
        try:
            raw = CONFIG_FILE.read_text(encoding="utf-8")
            data = json.loads(raw)
        except (json.JSONDecodeError, OSError):
            return
        if isinstance(data.get("media_roots"), list):
            self._media_roots = [str(x).strip() for x in data["media_roots"] if str(x).strip()]
        if "ffmpeg_path" in data and data["ffmpeg_path"] is not None:
            self._ffmpeg_path = str(data["ffmpeg_path"]).strip() or None
        if "ffprobe_path" in data and data["ffprobe_path"] is not None:
            self._ffprobe_path = str(data["ffprobe_path"]).strip() or None
        # 头像仓库源 URL（可选）
        if "avatar_source_url" in data and data["avatar_source_url"] is not None:
            v = str(data["avatar_source_url"]).strip()
            self._avatar_source_url = v or None
        if "scan_on_startup" in data:
            self._scan_on_startup = bool(data["scan_on_startup"])

    def save_to_file(self) -> None:
        """将当前 media_roots、ffmpeg/ffprobe 路径与头像仓库源写入 config 文件。"""
        data: dict = {"media_roots": self._media_roots}
        if self._ffmpeg_path is not None:
            data["ffmpeg_path"] = self._ffmpeg_path
        if self._ffprobe_path is not None:
            data["ffprobe_path"] = self._ffprobe_path
        if self._avatar_source_url is not None:
            data["avatar_source_url"] = self._avatar_source_url
        data["scan_on_startup"] = self.scan_on_startup
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def update(
        self,
        *,
        media_roots: list[str] | None = None,
        ffmpeg_path: str | None = None,
        ffprobe_path: str | None = None,
        avatar_source_url: str | None = None,
        scan_on_startup: bool | None = None,
    ) -> None:
        """更新配置并写回文件，然后触发变更回调。传入 None 的键不修改。"""
        if media_roots is not None:
            self._media_roots = [str(x).strip() for x in media_roots if str(x).strip()]
        if ffmpeg_path is not None:
            self._ffmpeg_path = str(ffmpeg_path).strip() or None
        if ffprobe_path is not None:
            self._ffprobe_path = str(ffprobe_path).strip() or None
        if avatar_source_url is not None:
            v = str(avatar_source_url).strip()
            self._avatar_source_url = v or None
        if scan_on_startup is not None:
            self._scan_on_startup = scan_on_startup
        self.save_to_file()
        self._notify_change()

    def add_on_change(self, callback: Callable[[], None]) -> None:
        """注册配置变更回调。"""
        self._on_change_callbacks.append(callback)

    def _notify_change(self) -> None:
        for cb in self._on_change_callbacks:
            try:
                cb()
            except Exception:  # noqa: BLE001
                pass

    SECRET_KEY: str = env.get_secret_key()
    HLS_SEGMENT_BYTES: int = env.get_hls_segment_bytes()
    LOG_LEVEL: str = env.get_log_level()


config = Config()
config.load_from_file()
