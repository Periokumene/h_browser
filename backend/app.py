"""个人影音库后端应用入口。

- 创建 Flask 应用，注册 CORS 与 API 蓝本
- 初始化数据库
- 可选：启动时执行一次媒体库扫描（SCAN_ON_STARTUP）
- 直接运行时绑定 0.0.0.0:5000，支持局域网访问
"""
from __future__ import annotations

import logging
from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS

from .config import config
from .ffprobe_util import check_ffprobe_available
from .models import get_session, init_db
from .routes.api import api_bp
from .scanner import scan_media


def create_app() -> Flask:
    """创建并配置 Flask 应用实例，注册蓝本、初始化 DB、可选启动扫描。"""
    # 启动时自检 ffprobe，用于 HLS 精确时长；失败则 m3u8 退化为固定 #EXTINF:4.0
    config.set_ffprobe_available(check_ffprobe_available(config.ffprobe_path))
    logging.getLogger(__name__).info("ffprobe 自检: %s", "可用" if config.ffprobe_available else "不可用，使用固定 EXTINF")

    app = Flask(__name__)
    app.config["SECRET_KEY"] = config.SECRET_KEY

    # 允许前端跨域（开发阶段可放宽，生产环境可改为固定 origin）
    CORS(app, supports_credentials=True)

    # 注册蓝本
    app.register_blueprint(api_bp)

    # 初始化数据库
    init_db()

    # 可选：启动时自动扫描一次（避免前端打开是空库）
    if config.SCAN_ON_STARTUP:
        _run_initial_scan()

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"})

    return app


def _run_initial_scan() -> None:
    """使用 config.media_roots 执行一次全量媒体扫描并写入数据库。"""
    logging.getLogger(__name__).info("启动时执行初次扫描...")
    db = get_session()
    try:
        scan_media(db)
    finally:
        db.close()


if __name__ == "__main__":
    app = create_app()
    # 绑定 0.0.0.0 以便局域网访问
    app.run(host="0.0.0.0", port=5000, debug=True)

