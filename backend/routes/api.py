"""媒体与流媒体 API 及认证装饰器。

- 认证：从 Authorization Bearer 或 X-Auth-Token 取 token，与 sessions 表校验；过期判断兼容 SQLite 多环境 datetime
- GET /api/items：分页列表，支持 q 搜索
- GET /api/items/<code>：单条详情
- POST /api/scan：触发全量扫描
- GET /api/stream/<code>：返回视频文件流，供 <video> 播放
"""
from __future__ import annotations

from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Optional

from urllib.parse import quote

from flask import Blueprint, Response, jsonify, request, send_file

from ..config import config
from ..models import MediaItem, Session as SessionModel, get_session
from ..scanner import scan_media


api_bp = Blueprint("api", __name__, url_prefix="/api")


def _utc_aware_now() -> datetime:
    """当前 UTC 时间（timezone-aware），便于与 DB 返回值统一比较。"""
    return datetime.now(timezone.utc)


def _normalize_to_utc_aware(value: Any) -> Optional[datetime]:
    """将 SQLite 可能返回的 datetime/date/str 规范为 timezone-aware UTC datetime。

    SQLite 在不同环境下可能返回 naive datetime、字符串或 date，
    此处统一为 aware datetime，无法解析时返回 None。
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc)
        return value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            # ISO 格式或常见格式
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except (ValueError, TypeError):
            return None
    # date 或其它类型视为当天 0 点 UTC
    try:
        from datetime import date
        if isinstance(value, date) and not isinstance(value, datetime):
            return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    except Exception:
        pass
    return None


def _is_session_expired(expires_at: Any) -> bool:
    """判断会话是否已过期。任何无法正确比较的情况均视为已过期（安全优先）。"""
    now = _utc_aware_now()
    try:
        exp = _normalize_to_utc_aware(expires_at)
        if exp is None:
            return True
        return exp <= now
    except (TypeError, ValueError, AttributeError):
        return True


def _get_token_from_request(allow_query: bool = False) -> Optional[str]:
    """从请求中读取 token：优先 Authorization: Bearer，其次 X-Auth-Token；若 allow_query 为 True 则再尝试 query 参数 token（供 <video> 等无法带 Header 的场景）。"""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    token = request.headers.get("X-Auth-Token")
    if token:
        return token.strip()
    if allow_query:
        token = request.args.get("token")
        if token:
            return token.strip()
    return None


def _validate_token(token: Optional[str]) -> bool:
    """校验 token 是否有效且未过期，不产生 401 响应，仅返回是否通过。"""
    if not token:
        return False
    db = get_session()
    try:
        session_obj = (
            db.query(SessionModel)
            .filter(SessionModel.token == token)
            .one_or_none()
        )
        if session_obj is None:
            return False
        if _is_session_expired(session_obj.expires_at):
            return False
        return True
    except Exception:
        return False
    finally:
        db.close()


def login_required(fn: Callable):
    """装饰器：校验请求中的 token，无效或过期返回 401；通过则执行被装饰的视图。"""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = _get_token_from_request()
        if not token:
            return jsonify({"error": "未提供令牌"}), 401

        db = get_session()
        try:
            session_obj = (
                db.query(SessionModel)
                .filter(SessionModel.token == token)
                .one_or_none()
            )
            if session_obj is None:
                return jsonify({"error": "令牌无效或已过期"}), 401
            if _is_session_expired(session_obj.expires_at):
                return jsonify({"error": "令牌无效或已过期"}), 401
            return fn(*args, **kwargs)
        except Exception:
            # 数据库/序列化/时区等异常统一视为未认证，避免 500 泄露内部错误
            return jsonify({"error": "令牌无效或已过期"}), 401
        finally:
            db.close()

    return wrapper


@api_bp.route("/items", methods=["GET"])
@login_required
def list_items():
    """分页返回媒体列表，支持 q 参数按番号/标题模糊搜索。"""
    page = max(int(request.args.get("page", 1)), 1)
    page_size = min(max(int(request.args.get("page_size", 20)), 1), 100)
    search = (request.args.get("q") or "").strip()

    db = get_session()
    try:
        query = db.query(MediaItem)
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

        return jsonify(
            {
                "page": page,
                "page_size": page_size,
                "total": total,
                "items": [
                    {
                        "code": item.code,
                        "title": item.title,
                        "video_type": item.video_type,
                        "has_video": bool(item.video_path),
                    }
                    for item in items
                ],
            }
        )
    finally:
        db.close()


@api_bp.route("/items/<string:code>", methods=["GET"])
@login_required
def get_item(code: str):
    """根据番号返回单条媒体详情（标题、简介、是否有视频等）。"""
    db = get_session()
    try:
        item = db.query(MediaItem).filter(MediaItem.code == code).one_or_none()
        if item is None:
            return jsonify({"error": "未找到媒体条目"}), 404

        return jsonify(
            {
                "code": item.code,
                "title": item.title,
                "description": item.description,
                "video_type": item.video_type,
                "has_video": bool(item.video_path),
            }
        )
    finally:
        db.close()


@api_bp.route("/scan", methods=["POST"])
@login_required
def trigger_scan():
    """手动触发一次全量媒体扫描（config.MEDIA_ROOT），返回本次处理的条目数。"""
    db = get_session()
    try:
        count = scan_media(db, media_root=config.MEDIA_ROOT)
        return jsonify({"processed": count})
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
    """根据番号返回视频流。支持 query 参数 token（因 <video> 无法带 Authorization）。
    使用 conditional=True 支持 Range；路径经 Path 解析以兼容 Windows 中文路径。"""
    token = _get_token_from_request(allow_query=True)
    if not _validate_token(token):
        return jsonify({"error": "未提供令牌或令牌无效"}), 401

    db = get_session()
    try:
        item = db.query(MediaItem).filter(MediaItem.code == code).one_or_none()
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
    token = _get_token_from_request(allow_query=True)
    if not _validate_token(token):
        return jsonify({"error": "未提供令牌或令牌无效"}), 401

    db = get_session()
    try:
        item = db.query(MediaItem).filter(MediaItem.code == code).one_or_none()
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
        segment_url = f"{base_url}/api/stream/{code}?token={quote(token or '', safe='')}"

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

