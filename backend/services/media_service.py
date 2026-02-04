"""媒体库统一数据访问服务。

提供统一的接口访问媒体数据，封装数据库读写与磁盘/NFO 读取，便于未来扩展缓存、增量同步等功能。

职责划分：
- 数据库操作：MediaItem、Genre、Tag 的 CRUD；「所有已知类型/标签」通过 get_all_filter_options 统一提供
- 磁盘操作：通过 metadata 模块做 NFO 解析与艺术路径解析，本模块仅做文件查找与封装
- 数据同步：磁盘 → 数据库的同步逻辑（含全量扫描 scan_media）；新建类型/标签经 get_or_create_* 写入 DB
- 元数据获取：统一返回完整元数据（DB + NFO）
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy import delete, exists, func
from sqlalchemy.orm import Session

from ..config import config
from ..models import Actor, Genre, MediaItem, Tag, media_item_actors, media_item_genres, media_item_tags
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


def find_video_formats(nfo_dir: Path, code: str) -> tuple[bool, bool]:
    """在同目录下检查 code.mp4、code.ts 是否存在。返回 (has_mp4, has_ts)。"""
    has_mp4 = (nfo_dir / f"{code}.mp4").exists()
    has_ts = (nfo_dir / f"{code}.ts").exists()
    return has_mp4, has_ts


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


def get_video_path_for_item(
    session: Session,
    code: str,
    fmt: Optional[str] = None,
) -> Optional[Path]:
    """根据编号与格式解析视频文件路径。folder/code.mp4 或 folder/code.ts。
    fmt: 'mp4' | 'ts' | None。None 时优先 mp4。"""
    item = get_item_by_code(session, code)
    if item is None or not item.folder:
        return None
    if fmt is None:
        fmt = "mp4" if item.has_mp4 else ("ts" if item.has_ts else None)
    if not fmt or fmt not in ("mp4", "ts"):
        return None
    if fmt == "mp4" and not item.has_mp4:
        return None
    if fmt == "ts" and not item.has_ts:
        return None
    path = Path(item.folder) / f"{code}.{fmt}"
    try:
        resolved = path.resolve()
        if resolved.is_file():
            return resolved
    except (OSError, RuntimeError):
        pass
    return None


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


def get_or_create_actor(session_actors: Session, name: str) -> Actor:
    """在演员库中获取或创建 Actor（仅名称，intro/image 可后续维护）。session_actors 须为 get_session_actors()。"""
    actor = session_actors.query(Actor).filter(Actor.name == name).first()
    if actor is None:
        actor = Actor(name=name)
        session_actors.add(actor)
        session_actors.flush()
    return actor


def get_actor_info(session_actors: Session, session_media: Session, name: str) -> Optional[dict]:
    """获取演员信息：intro 来自 actors.db，编号列表来自 media.db 的 media_item_actors。"""
    actor = session_actors.query(Actor).filter(Actor.name == name).first()
    if actor is None:
        return None
    rows = (
        session_media.query(MediaItem.code)
        .join(media_item_actors, media_item_actors.c.media_item_id == MediaItem.id)
        .filter(media_item_actors.c.actor_name == name)
        .all()
    )
    codes = sorted([r[0] for r in rows])
    return {
        "name": actor.name,
        "intro": actor.intro or "",
        "codes": codes,
    }


# ---------------------------------------------------------------------------
# 数据库操作：MediaItem CRUD
# ---------------------------------------------------------------------------


def get_item_by_code(session: Session, code: str) -> Optional[MediaItem]:
    """从数据库根据编号获取 MediaItem。"""
    return session.query(MediaItem).filter(MediaItem.code == code).one_or_none()


def create_or_update_item(
    session_media: Session,
    session_actors: Session,
    code: str,
    nfo_path: Path,
    folder: Path,
    has_mp4: bool = False,
    has_ts: bool = False,
    metadata: Optional[VideoMetadata] = None,
    file_mtime: Optional[datetime] = None,
    file_size: Optional[int] = None,
    last_scanned_at: Optional[datetime] = None,
) -> MediaItem:
    """创建或更新 MediaItem，并同步 genres/tags/演员关联。

    参数：
    - session_media / session_actors: 媒体库与演员库 Session
    - code, nfo_path, folder, has_mp4, has_ts, metadata, file_mtime, file_size, last_scanned_at

    返回：创建或更新后的 MediaItem（已 flush，有 ID）。
    """
    if last_scanned_at is None:
        last_scanned_at = datetime.now(timezone.utc)

    item = get_item_by_code(session_media, code)
    if item is None:
        item = MediaItem(code=code, nfo_path=str(nfo_path), folder=str(folder))
        session_media.add(item)
        session_media.flush()

    item.nfo_path = str(nfo_path)
    item.folder = str(folder)
    item.has_mp4 = 1 if has_mp4 else 0
    item.has_ts = 1 if has_ts else 0
    item.file_size = file_size
    item.file_mtime = file_mtime
    item.last_scanned_at = last_scanned_at

    # 更新 title/description（优先用传入的 metadata，否则从 NFO 解析）
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

    # 更新 genres/tags 关联（按名称去重）
    if metadata:
        item.genres.clear()
        item.tags.clear()
        seen_genres: set[str] = set()
        for genre_name in metadata.genres or []:
            if genre_name and genre_name.strip():
                name = genre_name.strip()
                if name not in seen_genres:
                    seen_genres.add(name)
                    item.genres.append(get_or_create_genre(session_media, name))
        seen_tags: set[str] = set()
        for tag_name in metadata.tags or []:
            if tag_name and tag_name.strip():
                name = tag_name.strip()
                if name not in seen_tags:
                    seen_tags.add(name)
                    item.tags.append(get_or_create_tag(session_media, name))

        # 同步演员：先在 actors.db 中 get_or_create，再写 media_item_actors（media.db）
        seen_actors: set[str] = set()
        actor_names: list[str] = []
        for actor_info in metadata.actors or []:
            if actor_info and actor_info.name and actor_info.name.strip():
                name = actor_info.name.strip()
                if name not in seen_actors:
                    seen_actors.add(name)
                    get_or_create_actor(session_actors, name)
                    actor_names.append(name)
        # 写 media.db 的 code-actor 索引
        session_media.execute(delete(media_item_actors).where(media_item_actors.c.media_item_id == item.id))
        for name in actor_names:
            session_media.execute(media_item_actors.insert().values(media_item_id=item.id, actor_name=name))
        session_media.flush()

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
    - video_path: 优先格式的视频 Path（或 None），仅作兼容用，播放请用 get_video_path_for_item(session, code, fmt)
    """
    item = get_item_by_code(session, code)
    if item is None:
        return None

    nfo_path = Path(item.nfo_path) if item.nfo_path else None
    video_path = get_video_path_for_item(session, code, None)

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
    """根据编号解析 NFO 与元数据，再通过 resolver(nfo_path, code, metadata) 得到艺术资源路径。"""
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
    """获取指定编号的海报路径（从数据库读取 NFO 路径，解析海报）。"""
    return _resolve_art_path_for_item(session, code, get_poster_path)


def get_fanart_path_for_item(session: Session, code: str) -> Optional[Path]:
    """获取指定编号的 fanart 路径。"""
    return _resolve_art_path_for_item(session, code, get_fanart_path)


def get_thumb_path_for_item(session: Session, code: str) -> Optional[Path]:
    """获取指定编号的 thumb 路径。"""
    return _resolve_art_path_for_item(session, code, get_thumb_path)


# 允许的 extrafanart 图片扩展名
EXTRAFANART_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif")


def _read_image_dimensions(path: Path) -> tuple[int, int]:
    """从图片文件头读取宽高，无需 PIL。支持 JPEG、PNG、GIF；失败或 WebP 等返回 (0, 0)。"""
    try:
        with open(path, "rb") as f:
            header = f.read(32)
    except OSError:
        return 0, 0
    if len(header) < 24:
        return 0, 0
    ext = path.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        # JPEG: 找 FFC0 或 FFC2 (SOF0/SOF2)，高 2 字节、宽 2 字节大端
        i = 0
        while i < len(header) - 9:
            if header[i : i + 2] in (b"\xff\xc0", b"\xff\xc2"):
                height = int.from_bytes(header[i + 5 : i + 7], "big")
                width = int.from_bytes(header[i + 7 : i + 9], "big")
                return width, height
            if header[i] == 0xFF and i + 1 < len(header):
                i += 2
                if header[i] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    if i + 6 < len(header):
                        height = int.from_bytes(header[i + 4 : i + 6], "big")
                        width = int.from_bytes(header[i + 6 : i + 8], "big")
                        return width, height
                i += 1
            else:
                i += 1
        return 0, 0
    if ext == ".png":
        # PNG: 签名后 IHDR，宽高在 16:24（各 4 字节大端）
        if header[:8] != b"\x89PNG\r\n\x1a\n":
            return 0, 0
        width = int.from_bytes(header[16:20], "big")
        height = int.from_bytes(header[20:24], "big")
        return width, height
    if ext == ".gif":
        # GIF87a/GIF89a 后 2 字节宽、2 字节高（小端）
        if not (header[:6] == b"GIF87a" or header[:6] == b"GIF89a"):
            return 0, 0
        width = int.from_bytes(header[6:8], "little")
        height = int.from_bytes(header[8:10], "little")
        return width, height
    return 0, 0


def get_extrafanart_paths(session: Session, code: str) -> list[Path]:
    """根据条目的 folder 查找子目录 extrafanart 下的所有图片，按文件名排序返回路径列表。"""
    item = get_item_by_code(session, code)
    if item is None or not item.folder:
        return []
    folder = Path(item.folder)
    extra_dir = folder / "extrafanart"
    if not extra_dir.is_dir():
        return []
    paths: list[Path] = []
    for p in extra_dir.iterdir():
        if p.is_file() and p.suffix.lower() in EXTRAFANART_EXTENSIONS:
            paths.append(p)
    paths.sort(key=lambda x: x.name)
    return paths


def get_extrafanart_with_dimensions(session: Session, code: str) -> list[tuple[int, int]]:
    """返回 extrafanart 列表（与 get_extrafanart_paths 同序），每项为 (width, height)。"""
    paths = get_extrafanart_paths(session, code)
    return [_read_image_dimensions(p) for p in paths]


# ---------------------------------------------------------------------------
# 磁盘 → 数据库同步
# ---------------------------------------------------------------------------


def sync_item_from_disk(
    session_media: Session,
    session_actors: Session,
    code: str,
    nfo_path: Path,
    last_scanned_at: Optional[datetime] = None,
) -> MediaItem:
    """从磁盘同步单个媒体条目到数据库（媒体库 + 演员库）。

    流程：
    1. 检查同目录 code.mp4、code.ts 是否存在
    2. 解析 NFO 元数据
    3. 文件信息（mtime, size）优先取自 mp4，无则 ts
    4. 创建或更新 MediaItem，同步 genres/tags/演员（actors.db + media_item_actors）

    返回：创建或更新后的 MediaItem。
    """
    nfo_dir = nfo_path.parent
    has_mp4, has_ts = find_video_formats(nfo_dir, code)

    stat_target = None
    if has_mp4:
        stat_target = nfo_dir / f"{code}.mp4"
    elif has_ts:
        stat_target = nfo_dir / f"{code}.ts"
    if stat_target is None:
        stat_target = nfo_path
    file_mtime, file_size = get_file_info(stat_target)

    metadata = load_metadata_from_nfo(nfo_path)

    return create_or_update_item(
        session_media=session_media,
        session_actors=session_actors,
        code=code,
        nfo_path=nfo_path,
        folder=nfo_dir,
        has_mp4=has_mp4,
        has_ts=has_ts,
        metadata=metadata,
        file_mtime=file_mtime,
        file_size=file_size,
        last_scanned_at=last_scanned_at,
    )


# ---------------------------------------------------------------------------
# 全量扫描：遍历媒体根目录，收集 NFO 并同步到 DB
# ---------------------------------------------------------------------------

# 模板文件名黑名单：这些文件名不应被当作编号处理
_TEMPLATE_NFO_NAMES = {
    "movie",
    "template",
    "sample",
    "example",
    "test",
    "default",
    "blank",
}


def _is_template_nfo(nfo_path: Path) -> bool:
    """判断是否为模板 NFO 文件（如 movie.nfo、template.nfo），应跳过。"""
    stem = nfo_path.stem.lower()
    return stem in _TEMPLATE_NFO_NAMES


def _scan_one_root(
    session_media: Session,
    session_actors: Session,
    media_root: Path,
    now: datetime,
    seen_codes: set[str],
) -> int:
    """扫描单个媒体根目录，将 NFO + 视频信息写入媒体库与演员库。返回本路径处理条数。"""
    processed = 0
    for dirpath, _dirnames, filenames in os.walk(media_root):
        dir_path = Path(dirpath)
        nfo_files = [f for f in filenames if f.lower().endswith(".nfo")]
        if not nfo_files:
            continue

        for nfo_name in nfo_files:
            nfo_path = dir_path / nfo_name
            code = nfo_path.stem

            if _is_template_nfo(nfo_path):
                logger.debug("跳过模板 NFO 文件: %s", nfo_path)
                continue

            if code in seen_codes:
                logger.info("检测到重复编号 %s，跳过后续 NFO：%s", code, nfo_path)
                continue
            seen_codes.add(code)

            try:
                sync_item_from_disk(session_media, session_actors, code, nfo_path, last_scanned_at=now)
                processed += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("同步媒体条目失败 %s: %s", nfo_path, exc)

    return processed


def scan_media(
    session_media: Session,
    session_actors: Session,
    media_roots: Optional[list[str | Path]] = None,
) -> int:
    """扫描媒体目录（可多个），将 NFO + 视频信息写入 media.db 与 actors.db。

    - session_media / session_actors: 媒体库与演员库 Session
    - media_roots 为 None 时使用 config.media_roots
    - 不存在的路径会记录警告并跳过，不抛错
    - 编号重复时只保留第一次出现的条目
    返回本次扫描处理的条目总数。
    """
    if media_roots is None:
        media_roots = config.media_roots

    now = datetime.now(timezone.utc)
    seen_codes: set[str] = set()
    total = 0

    for raw in media_roots:
        root = Path(raw).resolve()
        if not root.exists():
            logger.warning("媒体库路径不存在，已跳过: %s", root)
            continue
        total += _scan_one_root(session_media, session_actors, root, now, seen_codes)

    session_media.commit()
    session_actors.commit()
    logger.info("扫描完成，共处理 %s 条媒体记录", total)
    return total
