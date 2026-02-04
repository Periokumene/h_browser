"""个人影音库后端应用入口。

- 创建 Flask 应用，注册 CORS、认证与 API 蓝本
- 初始化数据库并确保存在默认管理员用户
- 可选：启动时执行一次媒体库扫描（SCAN_ON_STARTUP）
- 直接运行时绑定 0.0.0.0:5000，支持局域网访问
"""
from __future__ import annotations

import logging
from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash

from .config import config
from .models import User, get_session, init_db
from .routes.api import api_bp
from .routes.auth import auth_bp
from .scanner import scan_media


def create_app() -> Flask:
    """创建并配置 Flask 应用实例，注册蓝本、初始化 DB、默认用户与可选启动扫描。"""
    app = Flask(__name__)
    app.config["SECRET_KEY"] = config.SECRET_KEY

    # 允许前端跨域（开发阶段可放宽，生产环境可改为固定 origin）
    CORS(app, supports_credentials=True)

    # 注册蓝本
    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp)

    # 初始化数据库
    init_db()

    # 确保至少有一个用户（从环境变量读取，或使用默认 admin/admin）
    _ensure_default_user()

    # 可选：启动时自动扫描一次（避免前端打开是空库）
    if config.SCAN_ON_STARTUP:
        _run_initial_scan()

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"})

    return app


def _ensure_default_user() -> None:
    """若 users 表中不存在默认用户，则创建一名（用户名/密码来自环境变量，默认 admin/admin）。"""
    import os

    default_username = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
    default_password = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin")

    db = get_session()
    try:
        user = db.query(User).filter(User.username == default_username).one_or_none()
        if user is None:
            user = User(
                username=default_username,
                password_hash=generate_password_hash(default_password),
            )
            db.add(user)
            db.commit()
    finally:
        db.close()


def _run_initial_scan() -> None:
    """使用 config.MEDIA_ROOT 执行一次全量媒体扫描并写入数据库。"""
    logging.getLogger(__name__).info("启动时执行初次扫描...")
    db = get_session()
    try:
        scan_media(db, media_root=config.MEDIA_ROOT)
    finally:
        db.close()


if __name__ == "__main__":
    app = create_app()
    # 绑定 0.0.0.0 以便局域网访问
    app.run(host="0.0.0.0", port=5000, debug=True)

