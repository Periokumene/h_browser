"""SQLAlchemy 模型与数据库初始化。

- MediaItem: 媒体条目（番号、NFO/视频路径、标题、简介等）
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
    Table,
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


# 多对多关联表
media_item_genres = Table(
    "media_item_genres",
    Base.metadata,
    Column("media_item_id", Integer, ForeignKey("media_items.id"), primary_key=True),
    Column("genre_id", Integer, ForeignKey("genres.id"), primary_key=True),
)

media_item_tags = Table(
    "media_item_tags",
    Base.metadata,
    Column("media_item_id", Integer, ForeignKey("media_items.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True),
)


class Genre(Base):
    """类型（Genre）：用于高级筛选。"""

    __tablename__ = "genres"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, index=True, nullable=False)

    items = relationship(
        "MediaItem",
        secondary=media_item_genres,
        back_populates="genres",
    )


class Tag(Base):
    """标签（Tag）：用于高级筛选。"""

    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, index=True, nullable=False)

    items = relationship(
        "MediaItem",
        secondary=media_item_tags,
        back_populates="tags",
    )


class Favorite(Base):
    """收藏：媒体条目的子集，与总表共用同一套查询与筛选。"""

    __tablename__ = "favorites"

    id = Column(Integer, primary_key=True, index=True)
    media_item_id = Column(
        Integer,
        ForeignKey("media_items.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    media_item = relationship("MediaItem", back_populates="favorite_record")


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

    genres = relationship(
        "Genre",
        secondary=media_item_genres,
        back_populates="items",
    )
    tags = relationship(
        "Tag",
        secondary=media_item_tags,
        back_populates="items",
    )
    favorite_record = relationship(
        "Favorite",
        back_populates="media_item",
        uselist=False,
        cascade="all, delete-orphan",
    )


def init_db() -> None:
    """初始化数据库表结构。"""
    Base.metadata.create_all(bind=engine)


def get_session():
    """返回一个新的 SQLAlchemy Session，调用方负责在结束时 db.close()。"""
    return SessionLocal()

