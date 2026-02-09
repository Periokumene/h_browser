"""媒体与流媒体 API。

- GET /api/items：分页列表，支持 q 搜索
- GET /api/items/<code>：单条详情
- POST /api/scan：触发全量扫描
- GET /api/stream/<code>：返回视频文件流，供 <video> 播放
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from flask import Blueprint, Response, jsonify, request, send_file
from sqlalchemy import and_, exists, or_

from ..config import config
from ..models import Favorite, Genre, MediaItem, Tag, get_session, media_item_genres, media_item_tags
from ..scanner import scan_media
from ..services.media_service import (
    get_all_filter_options,
    get_item_by_code,
    get_item_full_metadata,
    get_poster_path_for_item,
    update_item_genres_tags,
)


api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.route("/config", methods=["GET"])
def get_config():
    """返回媒体库配置。与前端约定：始终返回 { "media_roots": string[] }，与 config 文件一致。"""
    return jsonify({"media_roots": config.media_roots})


@api_bp.route("/config", methods=["PUT"])
def update_config():
    """更新媒体库路径并写回文件，触发变更回调。"""
    data = request.get_json(silent=True) or {}
    media_roots = data.get("media_roots")
    if media_roots is not None and not isinstance(media_roots, list):
        return jsonify({"error": "media_roots 须为数组"}), 400
    if media_roots is not None and not all(isinstance(x, str) for x in media_roots):
        return jsonify({"error": "media_roots 元素须为字符串"}), 400
    try:
        config.update(media_roots=media_roots if media_roots is not None else None)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify({"media_roots": config.media_roots})


@api_bp.route("/filters", methods=["GET"])
def get_filters():
    """返回高级筛选可选值：所有已知类型与标签（来自 media_service，与编辑元数据时新建的项一致）。"""
    db = get_session()
    try:
        options = get_all_filter_options(db)
        return jsonify(options)
    finally:
        db.close()


@api_bp.route("/items", methods=["GET"])
def list_items():
    """分页返回媒体列表，与总表/收藏共用本接口。
    支持 scope：all（默认）总表，favorites 仅收藏；q 搜索；genre/tag 多选过滤；filter_mode: and/or。"""
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

    db = get_session()
    try:
        query = db.query(MediaItem)
        if only_favorites:
            query = query.join(Favorite, Favorite.media_item_id == MediaItem.id)

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

        total = query.count()
        items = (
            query.order_by(MediaItem.code)
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        item_ids = [item.id for item in items]
        favorited_ids = set()
        if item_ids:
            for row in db.query(Favorite.media_item_id).filter(
                Favorite.media_item_id.in_(item_ids)
            ).all():
                favorited_ids.add(row[0])

        # 为列表项补充演员名称（来自 NFO，用于卡片展示）
        item_payloads = []
        for item in items:
            payload = {
                "code": item.code,
                "title": item.title,
                "video_type": item.video_type,
                "has_video": bool(item.video_path),
                "poster_url": f"/api/items/{item.code}/poster",
                "is_favorite": item.id in favorited_ids,
            }
            full = get_item_full_metadata(db, item.code)
            if full and full.get("nfo_metadata") and full["nfo_metadata"].actors:
                payload["actors"] = [a.name for a in full["nfo_metadata"].actors]
            else:
                payload["actors"] = []
            item_payloads.append(payload)

        return jsonify(
            {
                "page": page,
                "page_size": page_size,
                "total": total,
                "items": item_payloads,
            }
        )
    finally:
        db.close()


@api_bp.route("/items/<string:code>", methods=["GET"])
def get_item(code: str):
    """根据番号返回单条媒体详情（标题、简介、是否有视频等）。"""
    db = get_session()
    try:
        full = get_item_full_metadata(db, code)
        if not full or not full["db_item"]:
            return jsonify({"error": "未找到媒体条目"}), 404

        item = full["db_item"]
        metadata = full["nfo_metadata"]

        is_favorite = db.query(Favorite).filter(Favorite.media_item_id == item.id).first() is not None
        payload = {
            "code": item.code,
            "title": item.title,
            "description": item.description,
            "video_type": item.video_type,
            "has_video": bool(item.video_path),
            "poster_url": "/api/items/" + item.code + "/poster",
            "is_favorite": is_favorite,
        }
        if metadata:
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
                "actors": [{"name": a.name, "role": a.role, "thumb": a.thumb} for a in metadata.actors],
                "outline": metadata.outline,
            }
        return jsonify(payload)
    finally:
        db.close()


@api_bp.route("/items/<string:code>/favorite", methods=["PUT"])
def set_item_favorite(code: str):
    """设置或取消收藏。请求体: { "favorite": true | false }。"""
    data = request.get_json(silent=True) or {}
    favorite = data.get("favorite")
    if favorite is None:
        return jsonify({"error": "请求体须包含 favorite 布尔值"}), 400
    if not isinstance(favorite, bool):
        return jsonify({"error": "favorite 须为布尔值"}), 400

    db = get_session()
    try:
        item = get_item_by_code(db, code)
        if item is None:
            return jsonify({"error": "未找到媒体条目"}), 404
        existing = db.query(Favorite).filter(Favorite.media_item_id == item.id).first()
        if favorite:
            if existing is None:
                db.add(Favorite(media_item_id=item.id))
            # else already favorited
        else:
            if existing is not None:
                db.delete(existing)
        db.commit()
        return jsonify({"ok": True, "favorite": favorite})
    except Exception as exc:
        db.rollback()
        logging.getLogger(__name__).exception("设置收藏失败")
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


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

    db = get_session()
    try:
        item = update_item_genres_tags(db, code, genres, tags)
        if item is None:
            return jsonify({"error": "未找到条目或 NFO 不可写"}), 404
        db.commit()
        return jsonify({"ok": True})
    except Exception as exc:
        db.rollback()
        logging.getLogger(__name__).exception("更新元数据失败")
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@api_bp.route("/items/<string:code>/poster", methods=["GET"])
def get_item_poster(code: str) -> Response:
    """根据番号返回该条目的海报图。若无海报文件则 404。"""
    db = get_session()
    try:
        item = get_item_by_code(db, code)
        if item is None:
            return jsonify({"error": "未找到媒体条目"}), 404

        poster_path = get_poster_path_for_item(db, code)
        if poster_path is None or not poster_path.exists():
            return jsonify({"error": "未找到海报图"}), 404

        suffix = poster_path.suffix.lower()
        mimetypes = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif"}
        mimetype = mimetypes.get(suffix, "image/jpeg")
        return send_file(str(poster_path), mimetype=mimetype, max_age=86400)
    finally:
        db.close()


@api_bp.route("/scan", methods=["POST"])
def trigger_scan():
    """手动触发一次全量媒体扫描（config.media_roots），返回本次处理的条目数。"""
    logger = logging.getLogger(__name__)
    db = get_session()
    try:
        count = scan_media(db)
        return jsonify({"processed": count})
    except Exception as exc:
        logger.exception("扫描失败")
        return jsonify({"error": f"扫描失败: {str(exc)}"}), 500
    finally:
        db.close()


def _mimetype_for_path(path: str) -> Optional[str]:
    """根据文件扩展名返回合适的 Content-Type，便于浏览器正确播放。"""
    path_lower = path.lower()
    if path_lower.endswith(".mp4"):
        return "video/mp4"
    if path_lower.endswith(".ts"):
        return "video/mp2t"  # MPEG-TS
    return None


def _resolve_video_path(video_path: str) -> Optional[Path]:
    """将数据库中的视频路径解析为可用的 Path，兼容 Windows 下含中文等路径。"""
    if not video_path or not video_path.strip():
        return None
    p = Path(video_path.strip())
    try:
        resolved = p.resolve()
        if resolved.is_file():
            return resolved
    except (OSError, RuntimeError):
        pass
    return None


@api_bp.route("/stream/<string:code>", methods=["GET"])
def stream_video(code: str) -> Response:
    """根据番号返回视频流。使用 conditional=True 支持 Range；路径经 Path 解析以兼容 Windows 中文路径。"""
    db = get_session()
    try:
        item = get_item_by_code(db, code)
        if item is None or not item.video_path:
            return jsonify({"error": "未找到对应视频文件"}), 404

        file_path = _resolve_video_path(item.video_path)
        if file_path is None:
            return jsonify({"error": "对应视频文件无法访问"}), 404

        mimetype = _mimetype_for_path(item.video_path)
        return send_file(
            str(file_path),
            as_attachment=False,
            mimetype=mimetype,
            conditional=True,
        )
    finally:
        db.close()


@api_bp.route("/stream/<string:code>/playlist.m3u8", methods=["GET"])
def stream_playlist_m3u8(code: str) -> Response:
    """返回 HLS 按字节分片的 m3u8（#EXT-X-BYTERANGE），供 hls.js 播放 .ts。
    首段仅需加载 HLS_SEGMENT_BYTES 即可起播，拖拽时按 range 请求对应段，实现快速启动与灵活 seek。"""
    db = get_session()
    try:
        item = get_item_by_code(db, code)
        if item is None or not item.video_path:
            return jsonify({"error": "未找到对应视频文件"}), 404
        if not (item.video_path or "").lower().endswith(".ts"):
            return jsonify({"error": "仅支持 TS 的 HLS 播放列表"}), 400

        file_path = _resolve_video_path(item.video_path)
        if file_path is None:
            return jsonify({"error": "对应视频文件无法访问"}), 404

        size = file_path.stat().st_size
        # MPEG-TS 包固定 188 字节，分片必须在包边界对齐，否则会出现 "do not start with 0x47" 解析错误
        TS_PACKET_SIZE = 188
        segment_bytes = getattr(config, "HLS_SEGMENT_BYTES", 2 * 1024 * 1024)
        segment_bytes = (segment_bytes // TS_PACKET_SIZE) * TS_PACKET_SIZE
        if segment_bytes < TS_PACKET_SIZE:
            segment_bytes = TS_PACKET_SIZE

        base_url = request.host_url.rstrip("/")
        segment_url = f"{base_url}/api/stream/{code}"

        lines = [
            "#EXTM3U",
            "#EXT-X-VERSION:4",
            "#EXT-X-TARGETDURATION:5",
        ]
        offset = 0
        while offset < size:
            remaining = size - offset
            chunk = min(segment_bytes, remaining)
            chunk = (chunk // TS_PACKET_SIZE) * TS_PACKET_SIZE  # 不截断到包中间
            if chunk == 0:
                break
            lines.append("#EXTINF:4.0,")
            lines.append("#EXT-X-BYTERANGE:%d@%d" % (chunk, offset))
            lines.append(segment_url)
            offset += chunk
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
    finally:
        db.close()

