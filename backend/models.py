"""SQLAlchemy 模型与数据库初始化。

- media.db: MediaItem、Genre、Tag、Favorite、media_item_actors
- actors.db: Actor（name、intro）
- usage.db: Task（异步任务）、未来可扩展播放进度与统计等
- init_db(): 创建三库表结构
- session_scope() / session_scope_usage() 等；任务 CRUD 使用 session_scope_usage()
"""
from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from typing import Generator, Optional

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    create_engine,
    func,
)
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

from .config import config

# ---------------------------------------------------------------------------
# 媒体库 engine / session（media.db）
# ---------------------------------------------------------------------------
engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False}
    if config.DATABASE_URL.startswith("sqlite")
    else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ---------------------------------------------------------------------------
# 演员库 engine / session（actors.db）
# ---------------------------------------------------------------------------
engine_actors = create_engine(
    config.ACTORS_DATABASE_URL,
    connect_args={"check_same_thread": False}
    if config.ACTORS_DATABASE_URL.startswith("sqlite")
    else {},
)
SessionLocalActors = sessionmaker(autocommit=False, autoflush=False, bind=engine_actors)

# ---------------------------------------------------------------------------
# 使用库 engine / session（usage.db：任务、播放进度、统计等）
# ---------------------------------------------------------------------------
engine_usage = create_engine(
    config.USAGE_DATABASE_URL,
    connect_args={"check_same_thread": False}
    if config.USAGE_DATABASE_URL.startswith("sqlite")
    else {},
)
SessionLocalUsage = sessionmaker(autocommit=False, autoflush=False, bind=engine_usage)

# ---------------------------------------------------------------------------
# 使用库模型（UsageBase → usage.db）
# ---------------------------------------------------------------------------
UsageBase = declarative_base()


# ---------------------------------------------------------------------------
# 媒体库模型（Base → media.db）
# ---------------------------------------------------------------------------
Base = declarative_base()


class TimestampMixin:
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


# 多对多关联表（均在 media.db）
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

# code-actor 索引保留在 media.db；actor_name 为字符串，无 FK（actors 表在 actors.db）
media_item_actors = Table(
    "media_item_actors",
    Base.metadata,
    Column("media_item_id", Integer, ForeignKey("media_items.id"), primary_key=True),
    Column("actor_name", String(255), primary_key=True),
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


class Bookmark(Base, TimestampMixin):
    """书签：媒体条目的时间点+注释，作为媒体数据的一部分存在 media.db。"""

    __tablename__ = "bookmarks"

    id = Column(Integer, primary_key=True, index=True)
    media_item_id = Column(
        Integer,
        ForeignKey("media_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    time_seconds = Column(Float, nullable=False)
    comment = Column(Text, nullable=False, default="")

    media_item = relationship("MediaItem", back_populates="bookmarks")


class MediaItem(Base, TimestampMixin):
    """媒体条目：以编号（code）为业务主键，对应一个 .nfo 及同目录下的 .mp4/.ts。
    视频路径不存库，由 folder + code + 扩展名动态组合：folder/code.mp4 或 folder/code.ts。
    一个条目可同时存在 mp4 与 ts，由 has_mp4、has_ts 标记。
    演员关联通过 media_item_actors 表（仅 actor_name），详情在 actors.db。
    """

    __tablename__ = "media_items"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(255), unique=True, index=True, nullable=False)  # 编号，来自 NFO 文件名

    title = Column(String(512), nullable=True)   # NFO <title>
    description = Column(Text, nullable=True)   # NFO <plot>

    nfo_path = Column(String(1024), nullable=False)   # NFO 绝对路径
    folder = Column(String(1024), nullable=False)   # 视频所在目录绝对路径，与 nfo_path 父目录一致
    has_mp4 = Column(Integer, nullable=False, default=0)   # 1 表示存在 code.mp4
    has_ts = Column(Integer, nullable=False, default=0)   # 1 表示存在 code.ts

    file_size = Column(Integer, nullable=True)   # 优先 mp4 的 size，无则 ts
    file_mtime = Column(DateTime(timezone=True), nullable=True)   # 优先 mp4 的 mtime，用于排序
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
    bookmarks = relationship(
        "Bookmark",
        back_populates="media_item",
        cascade="all, delete-orphan",
        order_by="Bookmark.time_seconds",
    )


class Task(UsageBase, TimestampMixin):
    """异步任务（usage.db）：ts_to_mp4 等，payload 为 JSON，运行中可写 temp_file_path。"""

    __tablename__ = "tasks"

    id = Column(String(36), primary_key=True)  # UUID
    task_type = Column(String(64), nullable=False, index=True)
    status = Column(String(32), nullable=False, index=True)  # pending | running | success | failed | cancelled
    progress_pct = Column(Float, nullable=True)
    payload = Column(Text, nullable=True)  # JSON: code, overwrite, temp_file_path 等
    result = Column(Text, nullable=True)
    error = Column(Text, nullable=True)

    def get_payload(self) -> dict:
        if not self.payload:
            return {}
        try:
            return json.loads(self.payload)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_payload(self, data: dict) -> None:
        self.payload = json.dumps(data, ensure_ascii=False) if data else None


# ---------------------------------------------------------------------------
# 演员库模型（ActorBase → actors.db）
# ---------------------------------------------------------------------------
ActorBase = declarative_base()

# 注意：Task 在 UsageBase（usage.db），不在 Base（media.db）


class Actor(ActorBase):
    """演员信息表（actors.db）：主键为演员名称，仅包含介绍。相关编号在 media.db 的 media_item_actors 中。"""

    __tablename__ = "actors"

    name = Column(String(255), primary_key=True)
    intro = Column(Text, nullable=True)


class SubtitlePreference(Base, TimestampMixin):
    """字幕偏好设置（media.db）：按编号记录首选字幕及时间偏移。

    - code: 编号，业务主键；与 media_items.code 一致，但不做外键约束以降低耦合
    - preferred_gcid: 首选字幕的 gcid；为 None 且记录存在时，表示「明确选择不使用字幕」
    - offset_seconds: 字幕整体偏移秒数，可正可负；为 None 表示使用默认 0
    """

    __tablename__ = "subtitle_preferences"

    code = Column(String(255), primary_key=True, index=True, nullable=False)
    preferred_gcid = Column(String(255), nullable=True)
    offset_seconds = Column(Float, nullable=True)


def init_db() -> None:
    """初始化三库表结构。"""
    Base.metadata.create_all(bind=engine)
    ActorBase.metadata.create_all(bind=engine_actors)
    UsageBase.metadata.create_all(bind=engine_usage)


def get_session():
    """返回媒体库 Session，调用方负责在结束时 db.close()。"""
    return SessionLocal()


def get_session_actors():
    """返回演员库 Session，调用方负责在结束时 db.close()。"""
    return SessionLocalActors()


@contextmanager
def session_scope() -> Generator:
    """媒体库 Session 上下文管理器，退出时自动 close；异常时 rollback。调用方在写操作后自行 commit。"""
    session = SessionLocal()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_actors_scope() -> Generator:
    """演员库 Session 上下文管理器，退出时自动 close；异常时 rollback。调用方在写操作后自行 commit。"""
    session = SessionLocalActors()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_scope_media_and_actors() -> Generator:
    """同时提供媒体库与演员库 Session，退出时自动 close；异常时 rollback。调用方在写操作后自行 commit。"""
    session_media = SessionLocal()
    session_actors = SessionLocalActors()
    try:
        yield session_media, session_actors
    except Exception:
        session_media.rollback()
        session_actors.rollback()
        raise
    finally:
        session_media.close()
        session_actors.close()


@contextmanager
def session_scope_usage() -> Generator:
    """使用库 Session（usage.db），用于任务、播放进度、统计等。退出时自动 close；异常时 rollback。"""
    session = SessionLocalUsage()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ---------------------------------------------------------------------------
# 任务 CRUD（Task 表在 usage.db，调用方使用 session_scope_usage）
# ---------------------------------------------------------------------------

TASK_STATUS_PENDING = "pending"
TASK_STATUS_RUNNING = "running"
TASK_STATUS_SUCCESS = "success"
TASK_STATUS_FAILED = "failed"
TASK_STATUS_CANCELLED = "cancelled"
TASK_TYPE_TS_TO_MP4 = "ts_to_mp4"
TASK_TYPE_SYNC_AVATARS = "sync_avatars"
TASK_TYPE_GEN_THUMBNAILS = "gen_thumbnails"
TASK_TYPE_GEN_ALL_THUMBNAILS = "gen_all_thumbnails"


def create_task(
    session: Session,
    task_type: str,
    payload: dict,
) -> str:
    """创建任务，返回 task id（UUID）。调用方需 commit。"""
    task_id = str(uuid.uuid4())
    task = Task(
        id=task_id,
        task_type=task_type,
        status=TASK_STATUS_PENDING,
        progress_pct=None,
        payload=json.dumps(payload, ensure_ascii=False) if payload else None,
        result=None,
        error=None,
    )
    session.add(task)
    return task_id


def _payload_contains_code(task: Task, code: str) -> bool:
    p = task.get_payload()
    return p.get("code") == code


def exists_pending_or_running_ts_to_mp4(session: Session, code: str) -> Optional[str]:
    """若已存在同 code 的 ts_to_mp4 且 status 为 pending 或 running，返回其 task_id，否则返回 None。

    唯一性键规则：\"<task_type>:<code>\"，存放在 payload.unique_key。
    """
    return exists_pending_or_running_by_unique_key(
        session, f"{TASK_TYPE_TS_TO_MP4}:{code}"
    )


def exists_pending_or_running_by_unique_key(
    session: Session, unique_key: str
) -> Optional[str]:
    """若已存在 payload.unique_key 等于给定 unique_key 且 status 为 pending 或 running 的任务，返回 task_id，否则 None。"""
    tasks = (
        session.query(Task)
        .filter(
            Task.status.in_([TASK_STATUS_PENDING, TASK_STATUS_RUNNING]),
        )
        .all()
    )
    for t in tasks:
        if t.get_payload().get("unique_key") == unique_key:
            return t.id
    return None


def update_task_progress(
    session: Session,
    task_id: str,
    *,
    progress_pct: Optional[float] = None,
    status: Optional[str] = None,
    result: Optional[str] = None,
    error: Optional[str] = None,
    payload_merge: Optional[dict] = None,
) -> bool:
    """更新任务进度或状态。payload_merge 会与现有 payload 合并后写回。返回是否找到并更新。"""
    task = session.query(Task).filter(Task.id == task_id).first()
    if not task:
        return False
    if progress_pct is not None:
        task.progress_pct = progress_pct
    if status is not None:
        task.status = status
    if result is not None:
        task.result = result
    if error is not None:
        task.error = error
    if payload_merge is not None:
        p = task.get_payload()
        p.update(payload_merge)
        task.set_payload(p)
    return True


def list_tasks(
    session: Session,
    status: Optional[str] = None,
) -> list[dict]:
    """任务列表，可选按 status 筛选。返回 dict 列表，每项含 id, task_type, status, progress_pct, payload, result, error, created_at, updated_at。"""
    q = session.query(Task).order_by(Task.created_at.desc())
    if status is not None:
        q = q.filter(Task.status == status)
    rows = q.all()
    return [
        {
            "id": t.id,
            "task_type": t.task_type,
            "status": t.status,
            "progress_pct": t.progress_pct,
            "payload": t.get_payload(),
            "result": t.result,
            "error": t.error,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        }
        for t in rows
    ]


def get_task(session: Session, task_id: str) -> Optional[dict]:
    """单任务详情，不存在返回 None。"""
    task = session.query(Task).filter(Task.id == task_id).first()
    if not task:
        return None
    return {
        "id": task.id,
        "task_type": task.task_type,
        "status": task.status,
        "progress_pct": task.progress_pct,
        "payload": task.get_payload(),
        "result": task.result,
        "error": task.error,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


def cancel_task(session: Session, task_id: str) -> bool:
    """将任务标记为 cancelled。返回是否找到并更新。仅改状态，实际终止与清理由协调器/worker 负责。"""
    return update_task_progress(session, task_id, status=TASK_STATUS_CANCELLED)
