"""认证相关接口：登录签发 token，写入 sessions 表供 api 模块校验。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash

from ..models import Session, User, get_session


auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# Token 有效天数，过期后需重新登录
TOKEN_TTL_DAYS = 7


@auth_bp.route("/login", methods=["POST"])
def login():
    """校验用户名与密码，成功则生成随机 token 写入 sessions 并返回 token、expires_at、username。"""
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "用户名或密码不能为空"}), 400

    db = get_session()
    try:
        user = db.query(User).filter(User.username == username).one_or_none()
        if user is None or not check_password_hash(user.password_hash, password):
            return jsonify({"error": "用户名或密码错误"}), 401

        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=TOKEN_TTL_DAYS)

        session_obj = Session(user_id=user.id, token=token, expires_at=expires_at)
        db.add(session_obj)
        db.commit()

        return jsonify(
            {
                "token": token,
                "expires_at": expires_at.isoformat(),
                "username": user.username,
            }
        )
    finally:
        db.close()

