from __future__ import annotations

import logging
from typing import Any, Callable

from ..models import (
    TASK_STATUS_FAILED,
    TASK_STATUS_RUNNING,
    TASK_STATUS_SUCCESS,
    session_actors_scope,
)
from .actor_images import sync_actor_images

logger = logging.getLogger(__name__)


def run_sync_avatars(
    task_id: str,
    payload: dict[str, Any],
    put_event: Callable[[dict[str, Any]], None],
    is_cancelled: Callable[[], bool],
) -> None:
    """异步任务：全库同步演员头像。

    - 读取 actors.db 中所有演员名
    - 调用 sync_actor_images 下载头像到 data/resources/avatars
    - 记录进度与结果到 Task 表
    """
    logger.info("任务 %s 开始同步演员头像", task_id)
    put_event({"task_id": task_id, "status": TASK_STATUS_RUNNING, "progress_pct": 0.0})
    try:
        if is_cancelled():
            raise RuntimeError("任务在开始前已被取消")
        with session_actors_scope() as session_actors:
            # 进度回调：按完成比例更新 progress_pct，最多约 20 次写入
            def progress_cb(done: int, total: int) -> None:
                if total <= 0:
                    return
                if is_cancelled():
                    return
                step = max(1, total // 20)
                if done % step != 0 and done != total:
                    return
                pct = round(done * 100.0 / total, 1)
                put_event({"task_id": task_id, "progress_pct": pct})

            processed = sync_actor_images(session_actors, progress_cb=progress_cb)
            session_actors.commit()
        if is_cancelled():
            raise RuntimeError("任务已被取消")
        msg = f"同步完成，共处理 {processed} 名演员"
        logger.info("任务 %s 同步演员头像完成: %s", task_id, msg)
        put_event(
            {
                "task_id": task_id,
                "status": TASK_STATUS_SUCCESS,
                "progress_pct": 100.0,
                "result": msg,
            }
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("任务 %s 同步演员头像失败: %s", task_id, exc)
        put_event(
            {
                "task_id": task_id,
                "status": TASK_STATUS_FAILED,
                "error": str(exc),
            }
        )

