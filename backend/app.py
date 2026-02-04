"""个人影音库后端应用入口。

- 创建 Flask 应用，注册 CORS 与 API 蓝本
- 初始化数据库
- 可选：启动时执行一次媒体库扫描（SCAN_ON_STARTUP）
- 直接运行时绑定 0.0.0.0:5000，支持局域网访问
"""
from __future__ import annotations

import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from flask import Flask, jsonify
from flask_cors import CORS

from .config import config
from .models import TASK_TYPE_SYNC_AVATARS, init_db, session_scope_media_and_actors
from .routes.api import api_bp
from .services.ffmpeg import check_ffmpeg_available
from .services.ffprobe import check_ffprobe_available
from .services.media_service import scan_media
from .services.task_runner import start as task_runner_start


def _configure_logging() -> None:
    """根据 config.LOG_LEVEL 配置根 logger（仅首次生效，由 basicConfig 保证）。"""
    level_name = getattr(logging, config.LOG_LEVEL, None)
    if not isinstance(level_name, int):
        level_name = getattr(logging, "INFO", logging.INFO)
    logging.basicConfig(
        level=level_name,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        force=True,
    )


def create_app() -> Flask:
    """创建并配置 Flask 应用实例，注册蓝本、初始化 DB、可选启动扫描。"""
    _configure_logging()
    # 启动时自检 ffprobe / ffmpeg
    config.set_ffprobe_available(check_ffprobe_available(config.ffprobe_path))
    config.set_ffmpeg_available(check_ffmpeg_available())
    logging.getLogger(__name__).info("ffprobe 自检: %s", "可用" if config.ffprobe_available else "不可用，使用固定 EXTINF")
    logging.getLogger(__name__).info("ffmpeg 自检: %s", "可用" if config.ffmpeg_available else "不可用")

    app = Flask(__name__)
    app.config["SECRET_KEY"] = config.SECRET_KEY

    # 允许前端跨域（开发阶段可放宽，生产环境可改为固定 origin）
    CORS(app, supports_credentials=True)

    # 注册蓝本
    app.register_blueprint(api_bp)

    # 初始化数据库
    init_db()

    # 启动异步任务协调器（Beta）
    task_runner_start()

    # 可选：启动时自动扫描一次（避免前端打开是空库）
    if config.scan_on_startup:
        _run_initial_scan()

    return app


def _run_initial_scan() -> None:
    """使用 config.media_roots 执行一次全量媒体扫描并写入 media.db / actors.db。

    扫描完成后，如配置了 avatar_source_url，则提交一个异步演员头像同步任务。
    """
    logger = logging.getLogger(__name__)
    logger.info("启动时执行初次扫描...")
    with session_scope_media_and_actors() as (db_media, db_actors):
        scan_media(db_media, db_actors)
    if config.avatar_source_url:
        try:
            from .services import task_runner as _runner
            unique_key = f"{TASK_TYPE_SYNC_AVATARS}:all"
            task_id = _runner.submit_task(
                TASK_TYPE_SYNC_AVATARS,
                {"trigger": "startup", "unique_key": unique_key},
            )
            logger.info("已提交启动时演员头像同步任务: %s", task_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("提交启动时演员头像同步任务失败: %s", exc)


# 统一使用flask方式启动
# if __name__ == "__main__":
#     app = create_app()
#     # 绑定 0.0.0.0 以便局域网访问
#     app.run(host="0.0.0.0", port=5000, debug=True)

