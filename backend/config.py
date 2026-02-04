"""应用配置：从环境变量读取媒体根目录、数据库路径、密钥等。

使用方式：from backend.config import config
"""
import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent


class Config:
    """应用基础配置，从环境变量读取，未设置时使用下列默认值。"""

    # 媒体根目录，扫描时从此目录递归查找 *.nfo 与对应 *.mp4 / *.ts
    MEDIA_ROOT: Path = Path(os.getenv("MEDIA_ROOT", r"F:\TestLib"))

    # SQLite 数据库文件路径；DATABASE_URL 未设置时由此生成
    DB_PATH: Path = Path(
        os.getenv("DB_PATH", str(BASE_DIR / "media.db"))
    ).resolve()
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", f"sqlite:///{DB_PATH}"
    )

    # Flask SECRET_KEY，用于会话等
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-change-me")

    # 是否在应用启动时自动执行一次媒体扫描（"1" 为是）
    SCAN_ON_STARTUP: bool = os.getenv("SCAN_ON_STARTUP", "1") == "1"


config = Config()
