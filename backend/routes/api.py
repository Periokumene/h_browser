"""媒体与流媒体 API。

- GET /api/items：分页列表，支持 q 搜索、actor、sort_mode（code/time/random）、has_bookmark（true/false）
- GET /api/items/<code>：单条详情
- GET/POST /api/items/<code>/bookmarks：书签列表 / 新增书签
- PATCH/DELETE /api/items/<code>/bookmarks/<id>：更新书签注释 / 删除书签
- GET /api/actors/<name>：演员信息与相关编号
- GET /api/actors/<name>/image：演员图片
- POST /api/scan：触发全量扫描
- GET /api/stream/<code>：返回视频文件流；GET .../playlist.m3u8：HLS 列表；GET .../segment/<i>：第 i 段 TS（206）
- GET /api/items/<code>/thumbnails：缩略图状态，200 返回 vtt_url/sprite_url，202 表示生成中并返回 task_id
- GET /api/stream/<code>/thumbnails.vtt、sprite_<n>.jpg：按 code 提供 VTT 与多张雪碧图
- GET /api/subtitles?name=<code>：按编号拉取字幕列表（代理迅雷 API），返回带 vttUrl 的列表
- GET /api/subtitles/track?url=<encoded>：代理并返回单条字幕（SRT 自动转 WebVTT）
"""
from __future__ import annotations

import logging
import math
import random
import urllib.parse
from pathlib import Path
from typing import Optional

from flask import Blueprint, Response, jsonify, request, send_file
from sqlalchemy import and_, exists, or_, select

from ..config import AVATARS_DIR, config
from ..models import (
    Bookmark,
    Favorite,
    Genre,
    MediaItem,
    Tag,
    media_item_actors,
    media_item_genres,
    media_item_tags,
    session_scope,
    session_scope_media_and_actors,
    session_scope_usage,
    TASK_TYPE_GEN_THUMBNAILS,
    TASK_TYPE_GEN_ALL_THUMBNAILS,
    exists_pending_or_running_by_unique_key,
    SubtitlePreference,
)
from ..services.actor_images import find_existing_avatar
from ..services.ffprobe import get_duration as ffprobe_get_duration
from ..services.thumbnail_service import (
    is_thumbnails_complete,
    is_generating,
    get_vtt_path_for_code,
    get_sprite_path_for_code,
)
from ..services.task_runner import submit_task
from ..services.subtitle_service import fetch_subtitle_as_vtt, fetch_subtitle_list
from ..services.media_service import (
    get_all_filter_options,
    get_actor_info,
    get_extrafanart_paths,
    get_extrafanart_with_dimensions,
    get_item_by_code,
    get_item_full_metadata,
    get_poster_path_for_item,
    get_video_path_for_item,
    scan_media,
    update_item_genres_tags,
)

# 随机排序时单次最多加载的 ID 数量，避免过高内存
RANDOM_SORT_MAX_IDS = 50000

# 图片扩展名 → Content-Type，供海报、演员图、extrafanart 等统一使用
IMAGE_MIMETYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def image_mimetype(suffix: str) -> str:
    """根据文件后缀返回图片 MIME 类型，未知则默认 image/jpeg。"""
    return IMAGE_MIMETYPES.get(suffix.lower(), "image/jpeg")


api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.route("/health", methods=["GET"])
def health():
    """健康检查。"""
    return jsonify({"status": "ok"})


@api_bp.route("/subtitles", methods=["GET"])
def get_subtitles():
    """按编号拉取字幕列表（代理迅雷 API），返回带 vttUrl 的列表，前端用 vttUrl 作为 track src。"""
    name = request.args.get("name", "").strip()
    if not name:
        return jsonify({"error": "缺少 name（编号）"}), 400
    items = fetch_subtitle_list(name)
    return jsonify({"list": items})


@api_bp.route("/subtitles/track", methods=["GET"])
def get_subtitle_track():
    """代理单条字幕文件；若为 SRT 则转为 WebVTT 后返回。

    出于安全考虑，仅允许访问迅雷字幕域名（subtitle.v.geilijiasu.com），
    防止通过 url 参数对任意站点发起 SSRF 请求。
    """
    url = request.args.get("url")
    if not url:
        return jsonify({"error": "缺少 url"}), 400
    try:
        url = urllib.parse.unquote(url)
    except Exception:
        return jsonify({"error": "url 无效"}), 400

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc.endswith("subtitle.v.geilijiasu.com"):
        return jsonify({"error": "不允许的字幕源"}), 400

    try:
        body, content_type = fetch_subtitle_as_vtt(url)
    except Exception as e:
        logging.getLogger(__name__).warning("拉取字幕失败 url=%s: %s", url[:80], e)
        return jsonify({"error": "拉取字幕失败"}), 502
    return Response(body, mimetype=content_type)


@api_bp.route("/items/<string:code>/subtitle_pref", methods=["GET"])
def get_subtitle_preference(code: str):
    """获取某个编号的字幕偏好设置。

    - 若记录不存在：返回 404（表示「从未设置偏好」）
    - 若存在且 gcid 为 null：表示「明确选择不使用字幕」
    """
    code = code.strip()
    if not code:
        return jsonify({"error": "code 不能为空"}), 400
    with session_scope() as session:
        pref = session.get(SubtitlePreference, code)
        if pref is None:
            return jsonify({"error": "not_set"}), 404
        return jsonify(
            {
                "code": pref.code,
                "gcid": pref.preferred_gcid,
                "offset_seconds": pref.offset_seconds,
            }
        )


@api_bp.route("/items/<string:code>/subtitle_pref", methods=["PUT"])
def set_subtitle_preference(code: str):
    """更新某个编号的字幕偏好设置。

    请求体示例：
    {
      "gcid": "543C...",
      "offset_seconds": 1.5
    }

    语义约定：
    - 若记录不存在则创建
    - gcid 为 null：表示「明确选择不使用字幕」
    - offset_seconds 为 null：表示使用默认 0（但仍记录一条偏好）
    """
    code = code.strip()
    if not code:
        return jsonify({"error": "code 不能为空"}), 400
    data = request.get_json(silent=True) or {}
    gcid = data.get("gcid", None)
    offset_seconds = data.get("offset_seconds", None)

    if gcid is not None and not isinstance(gcid, str):
        return jsonify({"error": "gcid 须为字符串或 null"}), 400
    if offset_seconds is not None and not isinstance(offset_seconds, (int, float)):
        return jsonify({"error": "offset_seconds 须为数字或 null"}), 400

    with session_scope() as session:
        pref = session.get(SubtitlePreference, code)
        if pref is None:
            pref = SubtitlePreference(code=code)
            session.add(pref)
        pref.preferred_gcid = gcid
        pref.offset_seconds = float(offset_seconds) if offset_seconds is not None else None
        session.commit()
        return jsonify(
            {
                "code": pref.code,
                "gcid": pref.preferred_gcid,
                "offset_seconds": pref.offset_seconds,
            }
        )


@api_bp.route("/config", methods=["GET"])
def get_config():
    """返回数据源配置。

    与前端约定：
    - media_roots: 媒体库根路径列表
    - ffmpeg_available: 是否可用 ffmpeg（用于 TS→MP4 功能）
    - avatar_source_url: 演员头像仓库源 URL（为空表示禁用头像同步）
    """
    return jsonify({
        "media_roots": config.media_roots,
        "ffmpeg_available": getattr(config, "ffmpeg_available", False),
        "avatar_source_url": getattr(config, "avatar_source_url", None),
        "scan_on_startup": config.scan_on_startup,
    })


@api_bp.route("/config", methods=["PUT"])
def update_config():
    """更新数据源配置并写回文件，触发变更回调。"""
    data = request.get_json(silent=True) or {}
    media_roots = data.get("media_roots")
    avatar_source_url = data.get("avatar_source_url")
    ffmpeg_path = data.get("ffmpeg_path")
    ffprobe_path = data.get("ffprobe_path")
    if media_roots is not None and not isinstance(media_roots, list):
        return jsonify({"error": "media_roots 须为数组"}), 400
    if media_roots is not None and not all(isinstance(x, str) for x in media_roots):
        return jsonify({"error": "media_roots 元素须为字符串"}), 400
    if avatar_source_url is not None and not isinstance(avatar_source_url, str):
        return jsonify({"error": "avatar_source_url 须为字符串"}), 400
    if ffmpeg_path is not None and not isinstance(ffmpeg_path, str):
        return jsonify({"error": "ffmpeg_path 须为字符串"}), 400
    if ffprobe_path is not None and not isinstance(ffprobe_path, str):
        return jsonify({"error": "ffprobe_path 须为字符串"}), 400
    scan_on_startup = data.get("scan_on_startup")
    if scan_on_startup is not None and not isinstance(scan_on_startup, bool):
        return jsonify({"error": "scan_on_startup 须为布尔值"}), 400
    try:
        config.update(
            media_roots=media_roots if media_roots is not None else None,
            avatar_source_url=avatar_source_url if avatar_source_url is not None else None,
            ffmpeg_path=ffmpeg_path if ffmpeg_path is not None else None,
            ffprobe_path=ffprobe_path if ffprobe_path is not None else None,
            scan_on_startup=scan_on_startup if scan_on_startup is not None else None,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({
        "media_roots": config.media_roots,
        "ffmpeg_available": getattr(config, "ffmpeg_available", False),
        "avatar_source_url": getattr(config, "avatar_source_url", None),
        "scan_on_startup": config.scan_on_startup,
    })


@api_bp.route("/actors/<path:name>", methods=["GET"])
def get_actor(name: str):
    """返回演员信息：介绍、图片 URL、相关作品编号列表（intro 来自 actors.db，图片由本地 avatars 路径动态解析）。"""
    name = urllib.parse.unquote(name)
    with session_scope_media_and_actors() as (db_media, db_actors):
        info = get_actor_info(db_actors, db_media, name)
        if not info:
            return jsonify({"error": "未找到该演员"}), 404
        payload = {
            "name": info["name"],
            "intro": info["intro"] or "",
            "codes": info["codes"],
        }
        avatar_path = find_existing_avatar(AVATARS_DIR, name)
        if avatar_path is not None:
            payload["image_url"] = f"/api/actors/{urllib.parse.quote(name, safe='')}/image"
        else:
            payload["image_url"] = None
        return jsonify(payload)


@api_bp.route("/actors/<path:name>/image", methods=["GET"])
def get_actor_image(name: str) -> Response:
    """返回演员头像文件。头像存放在数据根下 resources/avatars 目录，通过演员名 + 后缀动态解析。"""
    name = urllib.parse.unquote(name)
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    path = find_existing_avatar(AVATARS_DIR, name)
    if path is None:
        return jsonify({"error": "未找到该演员头像"}), 404
    try:
        path.relative_to(AVATARS_DIR)
    except ValueError:
        return jsonify({"error": "非法路径"}), 400
    if not path.exists():
        return jsonify({"error": "未找到该演员头像文件"}), 404
    return send_file(str(path), mimetype=image_mimetype(path.suffix), max_age=86400)


@api_bp.route("/filters", methods=["GET"])
def get_filters():
    """返回高级筛选可选值：所有已知类型与标签（来自 media_service，与编辑元数据时新建的项一致）。"""
    with session_scope() as db:
        options = get_all_filter_options(db)
        return jsonify(options)


def _apply_sort_and_paginate(db, query, page: int, page_size: int, sort_mode: str, seed: str):
    """根据 sort_mode 应用排序并分页。返回 (items, total)。"""
    total = query.count()
    if sort_mode == "time":
        items = (
            query.order_by(MediaItem.file_mtime.desc().nullslast(), MediaItem.code)
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return items, total
    if sort_mode == "random":
        ids = [row[0] for row in query.with_entities(MediaItem.id).distinct().limit(RANDOM_SORT_MAX_IDS).all()]
        if not ids:
            return [], total
        rng = random.Random(seed)
        rng.shuffle(ids)
        start = (page - 1) * page_size
        page_ids = ids[start : start + page_size]
        if not page_ids:
            return [], total
        id_to_order = {iid: i for i, iid in enumerate(page_ids)}
        items = db.query(MediaItem).filter(MediaItem.id.in_(page_ids)).all()
        items.sort(key=lambda x: id_to_order[x.id])
        return items, total
    items = (
        query.order_by(MediaItem.code)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total


@api_bp.route("/items", methods=["GET"])
def list_items():
    """分页返回媒体列表，与总表/收藏共用本接口。
    支持 scope：all/favorites；q 搜索；genre/tag 过滤；filter_mode: and/or；
    actor：指定演员名；sort_mode: code（默认）/ time / random；random 时可用 seed 保证同 seed 同页一致。"""
    page = max(int(request.args.get("page", 1)), 1)
    page_size = min(max(int(request.args.get("page_size", 20)), 1), 100)
    scope = (request.args.get("scope") or request.args.get("favorite") or "all").strip().lower()
    if scope not in ("all", "favorites"):
        scope = "all"
    only_favorites = scope == "favorites"
    search = (request.args.get("q") or "").strip()
    genres = request.args.getlist("genre") or request.args.getlist("genres") or []
    tags = request.args.getlist("tag") or request.args.getlist("tags") or []
    genres = [g.strip() for g in genres if g and g.strip()]
    tags = [t.strip() for t in tags if t and t.strip()]
    filter_mode = (request.args.get("filter_mode") or "and").strip().lower()
    if filter_mode not in ("and", "or"):
        filter_mode = "and"
    actor = (request.args.get("actor") or request.args.get("actor_name") or "").strip()
    sort_mode = (request.args.get("sort_mode") or "code").strip().lower()
    if sort_mode not in ("code", "time", "random"):
        sort_mode = "code"
    seed = (request.args.get("seed") or "0").strip()
    has_bookmark_param = request.args.get("has_bookmark")
    has_bookmark_filter = None  # None=不过滤, True=仅含书签, False=仅不含书签
    if has_bookmark_param is not None and has_bookmark_param.strip().lower() in ("true", "false"):
        has_bookmark_filter = has_bookmark_param.strip().lower() == "true"

    with session_scope() as db:
        query = db.query(MediaItem)
        if only_favorites:
            query = query.join(Favorite, Favorite.media_item_id == MediaItem.id)

        if has_bookmark_filter is not None:
            bookmark_exists = exists().where(Bookmark.media_item_id == MediaItem.id)
            if has_bookmark_filter:
                query = query.filter(bookmark_exists)
            else:
                query = query.filter(~bookmark_exists)

        # 指定演员：只保留该演员参与的作品
        if actor:
            query = query.join(media_item_actors, media_item_actors.c.media_item_id == MediaItem.id).filter(
                media_item_actors.c.actor_name == actor
            )

        # 按 genre/tag 过滤
        # 交集(and)：类型需全部具备、标签需全部具备，且类型与标签同时满足
        # 并集(or)：类型具备其一即可、标签具备其一即可，类型或标签满足其一即可
        genre_condition_or = None   # 有任一选中类型即可
        genre_condition_and = None # 有全部选中类型
        tag_condition_or = None
        tag_condition_and = None
        if genres:
            genre_objs = db.query(Genre).filter(Genre.name.in_(genres)).all()
            if not genre_objs:
                return jsonify(
                    {
                        "page": page,
                        "page_size": page_size,
                        "total": 0,
                        "items": [],
                    }
                )
            genre_ids = [g.id for g in genre_objs]
            genre_condition_or = exists().where(
                and_(
                    media_item_genres.c.media_item_id == MediaItem.id,
                    media_item_genres.c.genre_id.in_(genre_ids),
                )
            )
            # 交集：每个选中的类型都要存在
            genre_condition_and = and_(
                *[
                    exists().where(
                        and_(
                            media_item_genres.c.media_item_id == MediaItem.id,
                            media_item_genres.c.genre_id == gid,
                        )
                    )
                    for gid in genre_ids
                ]
            )
        if tags:
            tag_objs = db.query(Tag).filter(Tag.name.in_(tags)).all()
            if not tag_objs:
                return jsonify(
                    {
                        "page": page,
                        "page_size": page_size,
                        "total": 0,
                        "items": [],
                    }
                )
            tag_ids = [t.id for t in tag_objs]
            tag_condition_or = exists().where(
                and_(
                    media_item_tags.c.media_item_id == MediaItem.id,
                    media_item_tags.c.tag_id.in_(tag_ids),
                )
            )
            tag_condition_and = and_(
                *[
                    exists().where(
                        and_(
                            media_item_tags.c.media_item_id == MediaItem.id,
                            media_item_tags.c.tag_id == tid,
                        )
                    )
                    for tid in tag_ids
                ]
            )

        if filter_mode == "or":
            conds = [c for c in (genre_condition_or, tag_condition_or) if c is not None]
            if conds:
                query = query.filter(or_(*conds))
        else:
            if genre_condition_and is not None:
                query = query.filter(genre_condition_and)
            if tag_condition_and is not None:
                query = query.filter(tag_condition_and)

        if search:
            like = f"%{search}%"
            query = query.filter(
                (MediaItem.code.ilike(like)) | (MediaItem.title.ilike(like))
            )

        items, total = _apply_sort_and_paginate(db, query, page, page_size, sort_mode, seed)
        item_ids = [item.id for item in items]
        favorited_ids = set()
        if item_ids:
            for row in db.query(Favorite.media_item_id).filter(
                Favorite.media_item_id.in_(item_ids)
            ).all():
                favorited_ids.add(row[0])

        has_bookmark_ids = set()
        if item_ids:
            for row in db.query(Bookmark.media_item_id).filter(
                Bookmark.media_item_id.in_(item_ids)
            ).distinct().all():
                has_bookmark_ids.add(row[0])

        # 为列表项补充演员名称（来自 media_item_actors，与扫描同步，一次批量查询）
        actors_by_item_id = {}
        if item_ids:
            rows = db.execute(
                select(media_item_actors.c.media_item_id, media_item_actors.c.actor_name).where(
                    media_item_actors.c.media_item_id.in_(item_ids)
                )
            ).fetchall()
            for mid, aname in rows:
                actors_by_item_id.setdefault(mid, []).append(aname)

        item_payloads = []
        for item in items:
            has_video = bool(item.has_mp4 or item.has_ts)
            payload = {
                "code": item.code,
                "title": item.title,
                "has_video": has_video,
                "has_mp4": bool(item.has_mp4),
                "has_ts": bool(item.has_ts),
                "poster_url": f"/api/items/{item.code}/poster",
                "is_favorite": item.id in favorited_ids,
                "has_bookmark": item.id in has_bookmark_ids,
                "actors": actors_by_item_id.get(item.id, []),
            }
            item_payloads.append(payload)

        return jsonify(
            {
                "page": page,
                "page_size": page_size,
                "total": total,
                "items": item_payloads,
            }
        )


def _actor_thumb_url(actor_name: str) -> Optional[str]:
    """若演员有本地缓存头像则返回相对 URL，否则返回 None（前端可回退到 NFO thumb）。"""
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    path = find_existing_avatar(AVATARS_DIR, actor_name)
    if path is None:
        return None
    try:
        path.relative_to(AVATARS_DIR)
    except ValueError:
        return None
    return f"/api/actors/{urllib.parse.quote(actor_name, safe='')}/image"


@api_bp.route("/items/<string:code>", methods=["GET"])
def get_item(code: str):
    """根据编号返回单条媒体详情（标题、简介、是否有视频等）。演员 thumb 优先使用库内缓存图。"""
    with session_scope_media_and_actors() as (db_media, db_actors):
        full = get_item_full_metadata(db_media, code)
        if not full or not full["db_item"]:
            return jsonify({"error": "未找到媒体条目"}), 404

        item = full["db_item"]
        metadata = full["nfo_metadata"]

        is_favorite = db_media.query(Favorite).filter(Favorite.media_item_id == item.id).first() is not None
        has_video = bool(item.has_mp4 or item.has_ts)
        payload = {
            "code": item.code,
            "title": item.title,
            "description": item.description,
            "has_video": has_video,
            "has_mp4": bool(item.has_mp4),
            "has_ts": bool(item.has_ts),
            "poster_url": "/api/items/" + item.code + "/poster",
            "is_favorite": is_favorite,
        }
        if metadata:
            actor_list = []
            for a in metadata.actors:
                thumb = _actor_thumb_url(a.name)
                if thumb is None and getattr(a, "thumb", None):
                    thumb = a.thumb
                actor_list.append({"name": a.name, "role": a.role, "thumb": thumb})
            payload["metadata"] = {
                "rating": metadata.rating,
                "userrating": metadata.userrating,
                "votes": metadata.votes,
                "year": metadata.year,
                "premiered": metadata.premiered,
                "runtime": metadata.runtime,
                "genres": metadata.genres,
                "tags": metadata.tags,
                "country": metadata.country,
                "director": metadata.director,
                "studio": metadata.studio,
                "actors": actor_list,
                "outline": metadata.outline,
            }
        return jsonify(payload)


@api_bp.route("/items/<string:code>/favorite", methods=["PUT"])
def set_item_favorite(code: str):
    """设置或取消收藏。请求体: { "favorite": true | false }。"""
    data = request.get_json(silent=True) or {}
    favorite = data.get("favorite")
    if favorite is None:
        return jsonify({"error": "请求体须包含 favorite 布尔值"}), 400
    if not isinstance(favorite, bool):
        return jsonify({"error": "favorite 须为布尔值"}), 400

    try:
        with session_scope() as db:
            item = get_item_by_code(db, code)
            if item is None:
                return jsonify({"error": "未找到媒体条目"}), 404
            existing = db.query(Favorite).filter(Favorite.media_item_id == item.id).first()
            if favorite:
                if existing is None:
                    db.add(Favorite(media_item_id=item.id))
            else:
                if existing is not None:
                    db.delete(existing)
            db.commit()
        return jsonify({"ok": True, "favorite": favorite})
    except Exception as exc:
        logging.getLogger(__name__).exception("设置收藏失败")
        return jsonify({"error": str(exc)}), 500


@api_bp.route("/items/<string:code>/metadata", methods=["PATCH"])
def patch_item_metadata(code: str):
    """更新条目的类型与标签，写回 NFO 并同步数据库。请求体: { "genres": string[], "tags": string[] }。"""
    data = request.get_json(silent=True) or {}
    genres = data.get("genres")
    tags = data.get("tags")
    if genres is None or tags is None:
        return jsonify({"error": "请求体须包含 genres 与 tags 数组"}), 400
    if not isinstance(genres, list) or not isinstance(tags, list):
        return jsonify({"error": "genres 与 tags 须为数组"}), 400
    genres = [str(x).strip() for x in genres if x is not None and str(x).strip()]
    tags = [str(x).strip() for x in tags if x is not None and str(x).strip()]

    try:
        with session_scope() as db:
            item = update_item_genres_tags(db, code, genres, tags)
            if item is None:
                return jsonify({"error": "未找到条目或 NFO 不可写"}), 404
            db.commit()
        return jsonify({"ok": True})
    except Exception as exc:
        logging.getLogger(__name__).exception("更新元数据失败")
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# 书签 API（media.db Bookmark，按 code 管理）
# ---------------------------------------------------------------------------

def _bookmark_to_payload(b: Bookmark) -> dict:
    """单条书签序列化为 JSON，id 统一为字符串。"""
    return {
        "id": str(b.id),
        "time": float(b.time_seconds),
        "comment": b.comment or "",
    }


@api_bp.route("/items/<string:code>/bookmarks", methods=["GET"])
def list_bookmarks(code: str):
    """返回该视频的书签列表，按 time 升序。"""
    with session_scope() as db:
        item = get_item_by_code(db, code)
        if item is None:
            return jsonify({"error": "未找到该编号"}), 404
        bookmarks = db.query(Bookmark).filter(Bookmark.media_item_id == item.id).order_by(Bookmark.time_seconds).all()
        return jsonify({"bookmarks": [_bookmark_to_payload(b) for b in bookmarks]})


BOOKMARK_COMMENT_MAX_LENGTH = 2000


@api_bp.route("/items/<string:code>/bookmarks", methods=["POST"])
def create_bookmark(code: str):
    """新增一条书签。请求体: { "time": number, "comment": string }。"""
    data = request.get_json(silent=True) or {}
    time_sec = data.get("time")
    comment = (data.get("comment") or "").strip() or "未命名书签"
    if len(comment) > BOOKMARK_COMMENT_MAX_LENGTH:
        return jsonify({"error": f"comment 长度不能超过 {BOOKMARK_COMMENT_MAX_LENGTH} 字符"}), 400
    if time_sec is None:
        return jsonify({"error": "请求体须包含 time"}), 400
    try:
        time_sec = float(time_sec)
    except (TypeError, ValueError):
        return jsonify({"error": "time 须为数字"}), 400
    if time_sec < 0:
        return jsonify({"error": "time 不能为负数"}), 400

    with session_scope() as db:
        item = get_item_by_code(db, code)
        if item is None:
            return jsonify({"error": "未找到该编号"}), 404
        b = Bookmark(media_item_id=item.id, time_seconds=time_sec, comment=comment)
        db.add(b)
        db.commit()
        db.refresh(b)
    return jsonify(_bookmark_to_payload(b)), 201


@api_bp.route("/items/<string:code>/bookmarks/<string:bookmark_id>", methods=["PATCH"])
def update_bookmark(code: str, bookmark_id: str):
    """更新书签注释。请求体: { "comment": string }。"""
    data = request.get_json(silent=True) or {}
    comment = (data.get("comment") or "").strip()
    if "comment" not in data:
        return jsonify({"error": "请求体须包含 comment"}), 400
    if len(comment) > BOOKMARK_COMMENT_MAX_LENGTH:
        return jsonify({"error": f"comment 长度不能超过 {BOOKMARK_COMMENT_MAX_LENGTH} 字符"}), 400

    with session_scope() as db:
        item = get_item_by_code(db, code)
        if item is None:
            return jsonify({"error": "未找到该编号"}), 404
        try:
            bid = int(bookmark_id)
        except ValueError:
            return jsonify({"error": "无效的书签 id"}), 400
        b = db.query(Bookmark).filter(
            Bookmark.id == bid,
            Bookmark.media_item_id == item.id,
        ).first()
        if b is None:
            return jsonify({"error": "未找到该书签"}), 404
        b.comment = comment or "未命名书签"
        db.commit()
        db.refresh(b)
    return jsonify(_bookmark_to_payload(b))


@api_bp.route("/items/<string:code>/bookmarks/<string:bookmark_id>", methods=["DELETE"])
def delete_bookmark(code: str, bookmark_id: str):
    """删除该书签。"""
    with session_scope() as db:
        item = get_item_by_code(db, code)
        if item is None:
            return jsonify({"error": "未找到该编号"}), 404
        try:
            bid = int(bookmark_id)
        except ValueError:
            return jsonify({"error": "无效的书签 id"}), 400
        b = db.query(Bookmark).filter(
            Bookmark.id == bid,
            Bookmark.media_item_id == item.id,
        ).first()
        if b is None:
            return jsonify({"error": "未找到该书签"}), 404
        db.delete(b)
        db.commit()
    return jsonify({"ok": True}), 200


@api_bp.route("/items/<string:code>/poster", methods=["GET"])
def get_item_poster(code: str) -> Response:
    """根据编号返回该条目的海报图。若无海报文件则 404。"""
    with session_scope() as db:
        item = get_item_by_code(db, code)
        if item is None:
            return jsonify({"error": "未找到媒体条目"}), 404

        poster_path = get_poster_path_for_item(db, code)
        if poster_path is None or not poster_path.exists():
            return jsonify({"error": "未找到海报图"}), 404

        return send_file(str(poster_path), mimetype=image_mimetype(poster_path.suffix), max_age=86400)


@api_bp.route("/items/<string:code>/extrafanart", methods=["GET"])
def get_extrafanart_list(code: str):
    """根据条目的 folder 查询子目录 extrafanart 内所有图片，以 URL 列表及每张的宽高返回。"""
    with session_scope() as db:
        paths = get_extrafanart_paths(db, code)
        dimensions = get_extrafanart_with_dimensions(db, code)
        base = request.host_url.rstrip("/")
        urls = [f"{base}/api/items/{urllib.parse.quote(code)}/extrafanart/{i}" for i in range(len(paths))]
        return jsonify({"urls": urls, "dimensions": dimensions})


@api_bp.route("/items/<string:code>/extrafanart/<int:index>", methods=["GET"])
def get_extrafanart_image(code: str, index: int) -> Response:
    """返回 extrafanart 目录下第 index 张图片（按文件名排序）。"""
    with session_scope() as db:
        item = get_item_by_code(db, code)
        if item is None or not item.folder:
            return jsonify({"error": "未找到媒体条目"}), 404
        paths = get_extrafanart_paths(db, code)
        if index < 0 or index >= len(paths):
            return jsonify({"error": "未找到该索引的图片"}), 404
        path = paths[index]
        try:
            path = path.resolve()
            extra_dir = (Path(item.folder) / "extrafanart").resolve()
            path.relative_to(extra_dir)
        except (OSError, RuntimeError, ValueError):
            return jsonify({"error": "无法访问该文件"}), 404
        if not path.is_file():
            return jsonify({"error": "文件不存在"}), 404
        return send_file(str(path), mimetype=image_mimetype(path.suffix), max_age=86400)


@api_bp.route("/scan", methods=["POST"])
def trigger_scan():
    """手动触发一次全量媒体扫描（config.media_roots）。

    扫描完成后，如已配置 avatar_source_url，则提交一个异步的演员头像同步任务。
    返回：本次处理的条目数及可选的头像任务 ID。
    """
    logger = logging.getLogger(__name__)
    try:
        with session_scope_media_and_actors() as (db_media, db_actors):
            count = scan_media(db_media, db_actors)
        avatar_task_id = None
        if config.avatar_source_url:
            try:
                runner = _get_task_runner()
                from ..models import TASK_TYPE_SYNC_AVATARS

                unique_key = f"{TASK_TYPE_SYNC_AVATARS}:all"
                avatar_task_id = runner.submit_task(
                    TASK_TYPE_SYNC_AVATARS,
                    {"trigger": "scan", "unique_key": unique_key},
                )
                logger.info("已提交扫描后演员头像同步任务: %s", avatar_task_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("提交扫描后演员头像同步任务失败: %s", exc)
        return jsonify({"processed": count, "avatar_task_id": avatar_task_id})
    except Exception as exc:
        logger.exception("扫描失败")
        return jsonify({"error": f"扫描失败: {str(exc)}"}), 500


# ---------------------------------------------------------------------------
# 异步任务 API（Beta）
# ---------------------------------------------------------------------------

def _get_task_runner():
    from ..services import task_runner
    return task_runner


@api_bp.route("/tasks", methods=["GET"])
def list_tasks():
    """任务列表，可选 ?status= 筛选。"""
    status = request.args.get("status")
    runner = _get_task_runner()
    items = runner.list_tasks(status=status if status else None)
    return jsonify({"tasks": items})


@api_bp.route("/tasks/<string:task_id>", methods=["GET"])
def get_task(task_id: str):
    """单任务详情。"""
    runner = _get_task_runner()
    task = runner.get_task(task_id)
    if not task:
        return jsonify({"error": "未找到该任务"}), 404
    return jsonify(task)


@api_bp.route("/tasks", methods=["POST"])
def create_task():
    """创建任务。body: { "type": "ts_to_mp4", "code": "ABC-123", "overwrite": true } 或 { "type": "gen_all_thumbnails" }。"""
    logger = logging.getLogger(__name__)
    data = request.get_json(silent=True) or {}
    task_type = data.get("type")
    runner = _get_task_runner()

    if task_type == "ts_to_mp4":
        code = data.get("code")
        overwrite = data.get("overwrite", True)
        if not code or not isinstance(code, str):
            return jsonify({"error": "缺少 code"}), 400
        if not isinstance(overwrite, bool):
            return jsonify({"error": "overwrite 须为布尔值"}), 400
        if not getattr(config, "ffmpeg_available", False):
            return jsonify({
                "error": "ffmpeg_unavailable",
                "message": "ffmpeg 未安装或不可用，请配置 FFMPEG_PATH 或安装 ffmpeg",
            }), 503
        existing = runner.check_duplicate_ts_to_mp4(code)
        if existing:
            return jsonify({"error": "duplicate", "task_id": existing}), 409
        unique_key = f"{task_type}:{code}"
        payload = {"code": code, "overwrite": overwrite, "unique_key": unique_key}
    elif task_type == "gen_all_thumbnails":
        if not getattr(config, "ffprobe_available", False) or not getattr(config, "ffmpeg_available", False):
            return jsonify({
                "error": "ffmpeg_unavailable",
                "message": "ffprobe/ffmpeg 未安装或不可用，无法生成缩略图",
            }), 503
        with session_scope_usage() as session:
            existing = exists_pending_or_running_by_unique_key(
                session, f"{TASK_TYPE_GEN_ALL_THUMBNAILS}:all"
            )
        if existing:
            return jsonify({"error": "duplicate", "task_id": existing}), 409
        payload = {"unique_key": f"{TASK_TYPE_GEN_ALL_THUMBNAILS}:all"}
    else:
        return jsonify({"error": "不支持的 task type"}), 400

    try:
        task_id = runner.submit_task(task_type, payload)
        return jsonify({"id": task_id, "status": "pending"})
    except RuntimeError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as exc:
        logger.exception("创建任务失败")
        return jsonify({"error": str(exc)}), 500


@api_bp.route("/tasks/<string:task_id>/cancel", methods=["POST"])
def cancel_task(task_id: str):
    """取消任务并触发 worker 清理临时文件。"""
    runner = _get_task_runner()
    ok = runner.cancel_task(task_id)
    if not ok:
        return jsonify({"error": "未找到该任务或无法取消"}), 404
    return jsonify({"ok": True})


def _mimetype_for_format(fmt: str) -> Optional[str]:
    """根据格式返回 Content-Type。"""
    if fmt == "mp4":
        return "video/mp4"
    if fmt == "ts":
        return "video/mp2t"
    return None


@api_bp.route("/stream/<string:code>", methods=["GET"])
def stream_video(code: str) -> Response:
    """根据编号返回视频流。可选 ?format=mp4|ts，缺省优先 mp4。conditional=True 支持 Range。"""
    fmt_param = (request.args.get("format") or "").strip().lower()
    if fmt_param and fmt_param not in ("mp4", "ts"):
        return jsonify({"error": "format 须为 mp4 或 ts"}), 400
    fmt = fmt_param if fmt_param in ("mp4", "ts") else None

    with session_scope() as db:
        file_path = get_video_path_for_item(db, code, fmt)
        if file_path is None:
            return jsonify({"error": "未找到对应视频文件"}), 404

        resolved_fmt = file_path.suffix.lstrip(".").lower() if file_path.suffix else ""
        mimetype = _mimetype_for_format(resolved_fmt) or "video/mp4"
        return send_file(
            str(file_path),
            as_attachment=False,
            mimetype=mimetype,
            conditional=True,
        )


def _compute_ts_segments(file_path: Path):
    """计算 TS 文件的分片 (offset, chunk) 及每段时长，供 m3u8 与 segment 接口复用。
    分片按 188 字节包边界对齐，避免解析错误。"""
    size = file_path.stat().st_size
    TS_PACKET_SIZE = 188
    segment_bytes = getattr(config, "HLS_SEGMENT_BYTES", 2 * 1024 * 1024)
    segment_bytes = (segment_bytes // TS_PACKET_SIZE) * TS_PACKET_SIZE
    if segment_bytes < TS_PACKET_SIZE:
        segment_bytes = TS_PACKET_SIZE

    segments: list[tuple[int, int]] = []
    offset = 0
    while offset < size:
        remaining = size - offset
        chunk = min(segment_bytes, remaining)
        chunk = (chunk // TS_PACKET_SIZE) * TS_PACKET_SIZE
        if chunk == 0:
            break
        segments.append((offset, chunk))
        offset += chunk

    if config.ffprobe_available and segments:
        total_duration = ffprobe_get_duration(file_path, config.ffprobe_path)
        if total_duration is not None and total_duration > 0:
            extinf_durations = [
                round(total_duration * (chunk / size), 1) for _, chunk in segments
            ]
            extinf_durations = [max(0.1, d) for d in extinf_durations]
            target_duration_int = max(1, math.ceil(max(extinf_durations)))
        else:
            extinf_durations = [4.0] * len(segments)
            target_duration_int = 5
    else:
        extinf_durations = [4.0] * len(segments)
        target_duration_int = 5

    return segments, extinf_durations, target_duration_int


@api_bp.route("/stream/<string:code>/segment/<int:segment_index>", methods=["GET"])
def stream_segment(code: str, segment_index: int) -> Response:
    """返回 HLS 第 segment_index 段 TS 字节（206），供 Video.js 等按段 URL 请求。
    与 playlist.m3u8 的分片计算一致，仅当存在 code.ts 时可用。"""
    with session_scope() as db:
        file_path = get_video_path_for_item(db, code, "ts")
        if file_path is None:
            return jsonify({"error": "未找到 TS 视频或该条目无 TS 格式"}), 404

        segments, _, _ = _compute_ts_segments(file_path)
        if segment_index < 0 or segment_index >= len(segments):
            return jsonify({"error": "无效的分片索引"}), 404

        offset, chunk = segments[segment_index]
        size = file_path.stat().st_size
        with open(file_path, "rb") as f:
            f.seek(offset)
            data = f.read(chunk)

        return Response(
            data,
            status=206,
            mimetype="video/mp2t",
            headers={
                "Content-Range": f"bytes {offset}-{offset + len(data) - 1}/{size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(data)),
            },
        )


@api_bp.route("/stream/<string:code>/playlist.m3u8", methods=["GET"])
def stream_playlist_m3u8(code: str) -> Response:
    """返回 HLS m3u8，每段使用独立 URL（/segment/<i>），兼容 Video.js VHS。
    仅当存在 code.ts 时可用。原 #EXT-X-BYTERANGE 同 URL 方案与 VHS 兼容性差，故改为按段 URL。"""
    with session_scope() as db:
        file_path = get_video_path_for_item(db, code, "ts")
        if file_path is None:
            return jsonify({"error": "未找到 TS 视频或该条目无 TS 格式"}), 404

        segments, extinf_durations, target_duration_int = _compute_ts_segments(file_path)
        # 使用相对 URL，使分片请求与 m3u8 同源，避免 base_url 与前端不一致
        lines = [
            "#EXTM3U",
            "#EXT-X-VERSION:4",
            "#EXT-X-TARGETDURATION:%d" % target_duration_int,
        ]
        for i, dur in enumerate(extinf_durations):
            lines.append("#EXTINF:%.1f," % dur)
            lines.append(f"segment/{i}")
        lines.append("#EXT-X-ENDLIST")
        body = "\n".join(lines) + "\n"

        return Response(
            body,
            mimetype="application/vnd.apple.mpegurl",
            headers={
                "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
                "Cache-Control": "no-cache",
            },
        )


# --- 缩略图 API：与前端 useThumbnails / spriteThumbnails 约定 ---
# 200：body 含 vtt_url、sprite_url（相对路径，前端会拼 baseUrl）；202：生成中，前端轮询同接口直至 200 或超时
@api_bp.route("/items/<string:code>/thumbnails", methods=["GET"])
def get_thumbnails_status(code: str):
    """缩略图状态与触发生成。已完整则 200 返回 vtt_url、sprite_url；生成中或刚创建任务则 202 返回 task_id。"""
    with session_scope() as session:
        if is_thumbnails_complete(session, code):
            vtt_url = f"/api/stream/{code}/thumbnails.vtt"
            sprite_url = f"/api/stream/{code}/sprite_0.jpg"
            return jsonify({"vtt_url": vtt_url, "sprite_url": sprite_url}), 200

        if is_generating(session, code):
            with session_scope_usage() as usage_session:
                task_id = exists_pending_or_running_by_unique_key(
                    usage_session, f"{TASK_TYPE_GEN_THUMBNAILS}:{code}"
                )
            return jsonify({"status": "generating", "task_id": task_id}), 202

        item = get_item_by_code(session, code)
        if not item:
            return jsonify({"error": "未找到该编号"}), 404
        video_path = get_video_path_for_item(session, code, None)
    if not video_path:
        return jsonify({"error": "该条目无可用视频文件"}), 400

    with session_scope_usage() as session:
        existing = exists_pending_or_running_by_unique_key(
            session, f"{TASK_TYPE_GEN_THUMBNAILS}:{code}"
        )
    if existing:
        return jsonify({"status": "generating", "task_id": existing}), 202
    task_id = submit_task(
        TASK_TYPE_GEN_THUMBNAILS,
        {"code": code, "unique_key": f"{TASK_TYPE_GEN_THUMBNAILS}:{code}"},
    )
    return jsonify({"status": "generating", "task_id": task_id}), 202


# 流式返回 VTT/雪碧图文件，供前端 spriteThumbnails 插件 src 请求；VTT 内相对 URL 以本接口所在“目录”为基准
@api_bp.route("/stream/<string:code>/thumbnails.vtt", methods=["GET"])
def stream_thumbnails_vtt(code: str) -> Response:
    """按编号返回该视频的缩略图 VTT 文件（视频文件夹内 sprites/thumbnails.vtt）；无则 404。"""
    with session_scope() as session:
        path = get_vtt_path_for_code(session, code)
    if not path or not path.is_file():
        return jsonify({"error": "未找到该编号的缩略图 VTT"}), 404
    return send_file(
        str(path),
        mimetype="text/vtt",
        as_attachment=False,
        conditional=True,
    )


@api_bp.route("/stream/<string:code>/sprite_<int:index>.jpg", methods=["GET"])
def stream_thumbnails_sprite(code: str, index: int) -> Response:
    """按编号与索引返回该视频的缩略图雪碧图（sprites/sprite_<index>.jpg）；无则 404。"""
    if index < 0:
        return jsonify({"error": "无效的雪碧图索引"}), 400
    with session_scope() as session:
        path = get_sprite_path_for_code(session, code, index)
    if not path or not path.is_file():
        return jsonify({"error": "未找到该编号的缩略图雪碧图"}), 404
    return send_file(
        str(path),
        mimetype="image/jpeg",
        as_attachment=False,
        conditional=True,
    )

