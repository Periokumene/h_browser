"""异步任务协调器（Beta）：进程内线程池 + 队列，单消费线程写 DB。

- 单例，ThreadPoolExecutor(max_workers=2)，queue.Queue 传递进度/结果事件
- 消费线程循环取队列，仅此线程写 Task 表（usage.db）；ts_to_mp4 成功时同步 media.db（has_mp4/has_ts/file_size/file_mtime）
- submit_task(type, payload) -> task_id；cancel_task(id) 标记取消并更新 DB，worker 内检查并清理
"""
from __future__ import annotations

import atexit
import logging
import queue
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Optional

from ..models import (
    MediaItem,
    Task,
    TASK_STATUS_CANCELLED,
    TASK_TYPE_TS_TO_MP4,
    TASK_TYPE_SYNC_AVATARS,
    TASK_TYPE_GEN_THUMBNAILS,
    TASK_TYPE_GEN_ALL_THUMBNAILS,
    cancel_task as model_cancel_task,
    create_task as model_create_task,
    exists_pending_or_running_ts_to_mp4,
    exists_pending_or_running_by_unique_key,
    get_task as model_get_task,
    list_tasks as model_list_tasks,
    session_scope,
    session_scope_usage,
    update_task_progress,
)

logger = logging.getLogger(__name__)

# 单例状态
_event_queue: queue.Queue = queue.Queue()
_cancelled: set[str] = set()
_cancelled_lock: threading.Lock = threading.Lock()
_executor: Optional[ThreadPoolExecutor] = None
_consumer_thread: Optional[threading.Thread] = None
_shutdown: threading.Event = threading.Event()
_started: bool = False
_start_lock: threading.Lock = threading.Lock()


def put_event(event: dict[str, Any]) -> None:
    """Worker 调用，将进度/结果事件放入队列，由消费线程写 DB。"""
    _event_queue.put(event)


def is_cancelled(task_id: str) -> bool:
    """Worker 调用，检查该任务是否已被请求取消。"""
    with _cancelled_lock:
        return task_id in _cancelled


def _consumer_loop() -> None:
    while not _shutdown.is_set():
        try:
            event = _event_queue.get(timeout=1.0)
        except queue.Empty:
            continue
        task_id = event.get("task_id")
        if not task_id:
            continue
        try:
            with session_scope_usage() as session:
                update_task_progress(
                    session,
                    task_id,
                    progress_pct=event.get("progress_pct"),
                    status=event.get("status"),
                    result=event.get("result"),
                    error=event.get("error"),
                    payload_merge=event.get("payload_merge"),
                )
                session.commit()
                code = None
                if event.get("status") == "success":
                    task = session.query(Task).filter(Task.id == task_id).first()
                    if task and task.task_type == TASK_TYPE_TS_TO_MP4:
                        code = task.get_payload().get("code")
            if code:
                try:
                    with session_scope() as session:
                        item = session.query(MediaItem).filter(MediaItem.code == code).first()
                        if item:
                            item.has_mp4 = 1
                        session.commit()
                except Exception as e:  # noqa: BLE001
                    logger.warning("任务成功但更新 media.has_mp4 失败 code=%s: %s", code, e)
        except Exception as e:  # noqa: BLE001
            logger.exception("任务协调器写 DB 失败 task_id=%s: %s", task_id, e)


def _run_task(task_id: str) -> None:
    """在 worker 线程中执行：加载任务，按 type 分发到具体 handler。"""
    try:
        with session_scope_usage() as session:
            task = session.query(Task).filter(Task.id == task_id).first()
            if not task:
                return
            payload = task.get_payload()
            task_type = task.task_type
        if task_type == TASK_TYPE_TS_TO_MP4:
            from .ffmpeg import run_ts_to_mp4
            run_ts_to_mp4(task_id, payload, put_event, lambda: is_cancelled(task_id))
        elif task_type == TASK_TYPE_SYNC_AVATARS:
            from .avatar_task import run_sync_avatars
            run_sync_avatars(task_id, payload, put_event, lambda: is_cancelled(task_id))
        elif task_type == TASK_TYPE_GEN_THUMBNAILS:
            from .thumbnail_task import run_gen_thumbnails
            run_gen_thumbnails(task_id, payload, put_event, lambda: is_cancelled(task_id))
        elif task_type == TASK_TYPE_GEN_ALL_THUMBNAILS:
            from .thumbnail_task import run_gen_all_thumbnails
            run_gen_all_thumbnails(task_id, payload, put_event, lambda: is_cancelled(task_id))
        else:
            put_event({"task_id": task_id, "status": "failed", "error": f"未知任务类型: {task_type}"})
    except Exception as e:  # noqa: BLE001
        logger.exception("任务执行异常 task_id=%s: %s", task_id, e)
        put_event({"task_id": task_id, "status": "failed", "error": str(e)})


def start() -> None:
    """启动协调器：消费线程 + 将 running 任务重置为 failed（启动时清理）。"""
    global _executor, _consumer_thread, _started
    with _start_lock:
        if _started:
            return
        with session_scope_usage() as session:
            for task in session.query(Task).filter(Task.status == "running").all():
                task.status = TASK_STATUS_CANCELLED
            session.commit()
        _executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="task_worker")
        _shutdown.clear()
        _consumer_thread = threading.Thread(target=_consumer_loop, daemon=True, name="task_consumer")
        _consumer_thread.start()
        _started = True
        logger.info("任务协调器已启动")


def shutdown() -> None:
    """停止接受新任务，等待当前任务结束，消费线程退出。"""
    global _executor, _consumer_thread, _started
    with _start_lock:
        if not _started:
            return
        _shutdown.set()
        if _executor:
            _executor.shutdown(wait=True, cancel_futures=False)
            _executor = None
        if _consumer_thread and _consumer_thread.is_alive():
            _consumer_thread.join(timeout=5.0)
        _started = False
        logger.info("任务协调器已关闭")


def submit_task(task_type: str, payload: dict) -> str:
    """创建任务并提交执行，返回 task_id。需先 start()。"""
    if not _started or not _executor:
        raise RuntimeError("任务协调器未启动")
    with session_scope_usage() as session:
        task_id = model_create_task(session, task_type, payload)
        session.commit()
    _executor.submit(_run_task, task_id)
    return task_id


def cancel_task(task_id: str) -> bool:
    """标记任务为取消；worker 内检查 is_cancelled() 后终止并清理临时文件。"""
    with _cancelled_lock:
        _cancelled.add(task_id)
    with session_scope_usage() as session:
        ok = model_cancel_task(session, task_id)
        session.commit()
        return ok


def list_tasks(status: Optional[str] = None) -> list[dict]:
    """任务列表，可选按 status 筛选。"""
    with session_scope_usage() as session:
        return model_list_tasks(session, status=status)


def get_task(task_id: str) -> Optional[dict]:
    """单任务详情。"""
    with session_scope_usage() as session:
        return model_get_task(session, task_id)


def check_duplicate_ts_to_mp4(code: str) -> Optional[str]:
    """若已存在同 code 的 pending/running ts_to_mp4，返回其 task_id，否则 None。"""
    with session_scope_usage() as session:
        return exists_pending_or_running_ts_to_mp4(session, code)


def _atexit_shutdown() -> None:
    shutdown()


# 注册退出时关闭
atexit.register(_atexit_shutdown)
