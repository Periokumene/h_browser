"""媒体库统一数据访问服务。

提供统一的接口访问媒体数据，封装数据库读写与磁盘/NFO 读取，便于未来扩展缓存、增量同步等功能。

职责划分：
- 数据库操作：MediaItem、Genre、Tag 的 CRUD；「所有已知类型/标签」通过 get_all_filter_options 统一提供
- 磁盘操作：通过 metadata 模块做 NFO 解析与艺术路径解析，本模块仅做文件查找与封装
- 数据同步：磁盘 → 数据库的同步逻辑；新建类型/标签经 get_or_create_* 写入 DB，即进入「已知」列表
- 元数据获取：统一返回完整元数据（DB + NFO）
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy import exists, func
from sqlalchemy.orm import Session

from ..models import Genre, MediaItem, Tag, media_item_genres, media_item_tags
from .metadata import (
    ActorInfo,
    VideoMetadata,
    get_fanart_path,
    get_poster_path,
    get_thumb_path,
    parse_nfo,
    update_nfo_genres_tags,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 磁盘操作：文件查找、NFO 解析
# ---------------------------------------------------------------------------


def find_video_file(nfo_dir: Path, code: str) -> Optional[Path]:
    """在同目录下根据番号查找对应视频文件（mp4 / ts）。"""
    for ext in (".mp4", ".ts"):
        candidate = nfo_dir / f"{code}{ext}"
        if candidate.exists():
            return candidate
    return None


def get_file_info(file_path: Optional[Path]) -> tuple[Optional[datetime], Optional[int]]:
    """获取文件的 mtime 和 size。"""
    if file_path is None or not file_path.exists():
        return None, None
    try:
        stat = file_path.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        size = stat.st_size
        return mtime, size
    except OSError:
        return None, None


def load_metadata_from_nfo(nfo_path: Path) -> Optional[VideoMetadata]:
    """从 NFO 文件加载元数据。"""
    if not nfo_path.exists():
        return None
    try:
        return parse_nfo(nfo_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("解析 NFO 失败: %s (%s)", nfo_path, exc)
        return None


# ---------------------------------------------------------------------------
# 数据库操作：Genre/Tag 辅助
# ---------------------------------------------------------------------------


def get_all_filter_options(session: Session) -> dict:
    """返回当前数据库中所有类型与标签，并统计每个类型/标签被多少条视频使用。

    用于筛选器、编辑元数据时的「已有项」；新建类型/标签通过 get_or_create_* 写入同一 DB。
    返回格式：{"genres": [{"name": str, "count": int}, ...], "tags": [...]}，按 name 排序。"""
    genre_rows = (
        session.query(Genre.name, func.count(media_item_genres.c.media_item_id).label("count"))
        .outerjoin(media_item_genres, Genre.id == media_item_genres.c.genre_id)
        .group_by(Genre.id, Genre.name)
        .order_by(Genre.name)
        .all()
    )
    tag_rows = (
        session.query(Tag.name, func.count(media_item_tags.c.media_item_id).label("count"))
        .outerjoin(media_item_tags, Tag.id == media_item_tags.c.tag_id)
        .group_by(Tag.id, Tag.name)
        .order_by(Tag.name)
        .all()
    )
    return {
        "genres": [{"name": name, "count": count} for name, count in genre_rows],
        "tags": [{"name": name, "count": count} for name, count in tag_rows],
    }


def get_or_create_genre(session: Session, name: str) -> Genre:
    """获取或创建 Genre 对象。"""
    genre = session.query(Genre).filter(Genre.name == name).first()
    if genre is None:
        genre = Genre(name=name)
        session.add(genre)
        session.flush()  # 获取 ID
    return genre


def get_or_create_tag(session: Session, name: str) -> Tag:
    """获取或创建 Tag 对象。"""
    tag = session.query(Tag).filter(Tag.name == name).first()
    if tag is None:
        tag = Tag(name=name)
        session.add(tag)
        session.flush()  # 获取 ID
    return tag


# ---------------------------------------------------------------------------
# 数据库操作：MediaItem CRUD
# ---------------------------------------------------------------------------


def get_item_by_code(session: Session, code: str) -> Optional[MediaItem]:
    """从数据库根据番号获取 MediaItem。"""
    return session.query(MediaItem).filter(MediaItem.code == code).one_or_none()


def create_or_update_item(
    session: Session,
    code: str,
    nfo_path: Path,
    video_path: Optional[Path] = None,
    metadata: Optional[VideoMetadata] = None,
    file_mtime: Optional[datetime] = None,
    file_size: Optional[int] = None,
    last_scanned_at: Optional[datetime] = None,
) -> MediaItem:
    """创建或更新 MediaItem，并同步 genres/tags 关联。

    参数：
    - code: 番号
    - nfo_path: NFO 文件路径
    - video_path: 视频文件路径（可选）
    - metadata: 元数据（可选，用于 genres/tags）
    - file_mtime, file_size: 文件信息（可选）
    - last_scanned_at: 扫描时间（可选，默认当前时间）

    返回：创建或更新后的 MediaItem（已 flush，有 ID）。
    """
    if last_scanned_at is None:
        last_scanned_at = datetime.now(timezone.utc)

    item = get_item_by_code(session, code)
    is_new = item is None

    if item is None:
        # 新建时必填字段须在 flush 前设置，否则 INSERT 触发 NOT NULL 约束失败
        item = MediaItem(code=code, nfo_path=str(nfo_path))
        session.add(item)
        session.flush()  # 确保新 item 有 ID，才能操作关联关系

    # 更新基本字段
    item.nfo_path = str(nfo_path)
    item.video_path = str(video_path) if video_path is not None else None
    item.video_type = video_path.suffix.lstrip(".") if video_path is not None else None
    item.file_size = file_size
    item.file_mtime = file_mtime
    item.last_scanned_at = last_scanned_at

    # 更新 title/description（优先用传入的 metadata，否则从 NFO 解析，避免与 metadata 模块重复逻辑）
    if metadata:
        if metadata.title:
            item.title = metadata.title
        if metadata.plot:
            item.description = metadata.plot
    else:
        nfo_meta = load_metadata_from_nfo(nfo_path)
        if nfo_meta:
            if nfo_meta.title:
                item.title = nfo_meta.title
            if nfo_meta.plot:
                item.description = nfo_meta.plot

    # 更新 genres/tags 关联
    if metadata:
        item.genres.clear()
        item.tags.clear()

        for genre_name in metadata.genres or []:
            if genre_name and genre_name.strip():
                genre = get_or_create_genre(session, genre_name.strip())
                item.genres.append(genre)

        for tag_name in metadata.tags or []:
            if tag_name and tag_name.strip():
                tag = get_or_create_tag(session, tag_name.strip())
                item.tags.append(tag)

    return item


def update_item_genres_tags(
    session: Session,
    code: str,
    genres: list[str],
    tags: list[str],
) -> Optional[MediaItem]:
    """更新条目的类型与标签：写回 NFO 并同步数据库关联。

    新名称会通过 get_or_create_genre / get_or_create_tag 写入 DB，即成为「所有已知类型/标签」的一部分，
    筛选接口 get_all_filter_options 会包含它们，无需额外同步。
    返回更新后的 MediaItem，不存在或 NFO 不可写时返回 None。
    """
    item = get_item_by_code(session, code)
    if item is None:
        return None
    nfo_path = Path(item.nfo_path) if item.nfo_path else None
    if not nfo_path or not nfo_path.exists():
        return None

    genres = [g.strip() for g in genres if g and str(g).strip()]
    tags = [t.strip() for t in tags if t and str(t).strip()]

    try:
        update_nfo_genres_tags(nfo_path, genres, tags)
    except Exception as exc:  # noqa: BLE001
        logger.warning("写回 NFO 类型/标签失败: %s (%s)", nfo_path, exc)
        return None

    item.genres.clear()
    item.tags.clear()
    for name in genres:
        item.genres.append(get_or_create_genre(session, name))
    for name in tags:
        item.tags.append(get_or_create_tag(session, name))
    session.flush()

    # 删除使用数为 0 的类型/标签，避免数据库堆积无效项
    session.query(Genre).filter(
        ~exists().where(media_item_genres.c.genre_id == Genre.id)
    ).delete(synchronize_session=False)
    session.query(Tag).filter(
        ~exists().where(media_item_tags.c.tag_id == Tag.id)
    ).delete(synchronize_session=False)

    return item


# ---------------------------------------------------------------------------
# 统一元数据获取：DB + NFO
# ---------------------------------------------------------------------------


def get_item_full_metadata(session: Session, code: str) -> Optional[dict]:
    """获取完整的媒体元数据（数据库 + NFO）。

    返回字典包含：
    - db_item: MediaItem 对象（或 None）
    - nfo_metadata: VideoMetadata 对象（或 None，如果 NFO 存在且解析成功）
    - nfo_path: Path 对象（或 None）
    - video_path: Path 对象（或 None）
    """
    item = get_item_by_code(session, code)
    if item is None:
        return None

    nfo_path = Path(item.nfo_path) if item.nfo_path else None
    video_path = Path(item.video_path) if item.video_path else None

    nfo_metadata = None
    if nfo_path and nfo_path.exists():
        nfo_metadata = load_metadata_from_nfo(nfo_path)

    return {
        "db_item": item,
        "nfo_metadata": nfo_metadata,
        "nfo_path": nfo_path,
        "video_path": video_path,
    }


def _resolve_art_path_for_item(
    session: Session,
    code: str,
    resolver: Callable[[Path, str, VideoMetadata], Optional[Path]],
) -> Optional[Path]:
    """根据番号解析 NFO 与元数据，再通过 resolver(nfo_path, code, metadata) 得到艺术资源路径。"""
    full = get_item_full_metadata(session, code)
    if not full or not full["nfo_path"]:
        return None
    nfo_path = full["nfo_path"]
    metadata = full["nfo_metadata"]
    if metadata is None:
        metadata = load_metadata_from_nfo(nfo_path)
    if metadata is None:
        return None
    return resolver(nfo_path, code, metadata)


def get_poster_path_for_item(session: Session, code: str) -> Optional[Path]:
    """获取指定番号的海报路径（从数据库读取 NFO 路径，解析海报）。"""
    return _resolve_art_path_for_item(session, code, get_poster_path)


def get_fanart_path_for_item(session: Session, code: str) -> Optional[Path]:
    """获取指定番号的 fanart 路径。"""
    return _resolve_art_path_for_item(session, code, get_fanart_path)


def get_thumb_path_for_item(session: Session, code: str) -> Optional[Path]:
    """获取指定番号的 thumb 路径。"""
    return _resolve_art_path_for_item(session, code, get_thumb_path)


# ---------------------------------------------------------------------------
# 磁盘 → 数据库同步
# ---------------------------------------------------------------------------


def sync_item_from_disk(
    session: Session,
    code: str,
    nfo_path: Path,
    last_scanned_at: Optional[datetime] = None,
) -> MediaItem:
    """从磁盘同步单个媒体条目到数据库。

    流程：
    1. 查找同目录视频文件
    2. 解析 NFO 元数据
    3. 获取文件信息（mtime, size）
    4. 创建或更新 MediaItem，同步 genres/tags

    返回：创建或更新后的 MediaItem。
    """
    nfo_dir = nfo_path.parent
    video_path = find_video_file(nfo_dir, code)

    # 确定用于 mtime/size 的目标文件（优先视频，否则 NFO）
    stat_target = video_path if video_path is not None else nfo_path
    file_mtime, file_size = get_file_info(stat_target)

    # 解析 NFO 元数据
    metadata = load_metadata_from_nfo(nfo_path)

    # 创建或更新数据库条目
    return create_or_update_item(
        session=session,
        code=code,
        nfo_path=nfo_path,
        video_path=video_path,
        metadata=metadata,
        file_mtime=file_mtime,
        file_size=file_size,
        last_scanned_at=last_scanned_at,
    )
