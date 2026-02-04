"""SQLAlchemy 模型与数据库初始化。

- MediaItem: 媒体条目（番号、NFO/视频路径、标题、简介等）
- User: 用户表，用于登录认证
- Session: 登录会话，存储 token 与过期时间
- init_db(): 创建所有表
- get_session(): 返回新的 Session 实例，使用后需 close
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    func,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from .config import config


engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False}
    if config.DATABASE_URL.startswith("sqlite")
    else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class TimestampMixin:
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MediaItem(Base, TimestampMixin):
    """媒体条目：以番号（code）为业务主键，对应一个 .nfo 及同目录下的 .mp4/.ts。"""

    __tablename__ = "media_items"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(255), unique=True, index=True, nullable=False)  # 番号，来自 NFO 文件名

    title = Column(String(512), nullable=True)   # NFO <title>
    description = Column(Text, nullable=True)   # NFO <plot>

    nfo_path = Column(String(1024), nullable=False)   # 绝对路径
    video_path = Column(String(1024), nullable=True)  # 视频绝对路径，可能为空
    video_type = Column(String(16), nullable=True)   # 扩展名：mp4 / ts 等

    file_size = Column(Integer, nullable=True)
    file_mtime = Column(DateTime(timezone=True), nullable=True)
    last_scanned_at = Column(DateTime(timezone=True), nullable=True)


class User(Base, TimestampMixin):
    """简单用户表，仅用于登录认证。"""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)

    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan")


class Session(Base, TimestampMixin):
    """登录会话 / token 记录。"""

    __tablename__ = "sessions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(String(255), unique=True, index=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    user = relationship("User", back_populates="sessions")


def init_db() -> None:
    """初始化数据库表结构。"""
    Base.metadata.create_all(bind=engine)


def get_session():
    """返回一个新的 SQLAlchemy Session，调用方负责在结束时 db.close()。"""
    return SessionLocal()

