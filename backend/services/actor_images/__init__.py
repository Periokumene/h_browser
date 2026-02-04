"""演员图片（头像）模块：可插拔的提供方与扫描后全量同步。

- 通过 config.avatar_source_url 配置头像仓库地址（为空表示禁用）
- 扫描完成后通过异步任务调用 sync_actor_images(session_actors) 做全库更新与缓存
- 与具体图源解耦，便于未来剥离为插件或更换数据源
"""
from __future__ import annotations

import logging
from typing import Callable, List, Optional

from ...config import AVATARS_DIR, config
from .interface import ActorImageProvider
from .utils import find_existing_avatar, safe_avatar_basename

logger = logging.getLogger(__name__)

_provider_instance: Optional[ActorImageProvider] = None


def _get_provider() -> Optional[ActorImageProvider]:
    """根据配置返回当前演员图片提供方，未启用则返回 None。

    当前实现：当 config.avatar_source_url 非空时，使用 AvatarsProvider。
    """
    global _provider_instance
    if _provider_instance is not None:
        return _provider_instance
    base = config.avatar_source_url
    if not base:
        return None
    base = base.rstrip("/")
    from .avatars_provider import AvatarsProvider

    filetree_url = f"{base}/Filetree.json"
    content_base = f"{base}/Content/"
    _provider_instance = AvatarsProvider(
        filetree_url=filetree_url,
        content_base_url=content_base,
    )
    return _provider_instance


def sync_actor_images(
    session_actors,
    progress_cb: Optional[Callable[[int, int], None]] = None,
) -> int:
    """全量同步演员头像：拉取当前提供方、为库中所有演员解析并缓存图片（写入 data/resources/avatars）。

    未启用提供方时直接返回 0。
    返回：本次尝试处理的演员数量（用于日志与结果描述）。
    """
    provider = _get_provider()
    if provider is None:
        logger.info("未配置 avatar_source_url，跳过演员头像同步")
        return 0
    from ...models import Actor

    actor_names: List[str] = [row[0] for row in session_actors.query(Actor.name).all()]
    if not actor_names:
        return 0
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    total = len(actor_names)
    try:
        for idx, name in enumerate(actor_names, start=1):
            # 若本地已存在头像则跳过，仅对未缓存的演员尝试同步
            existing = find_existing_avatar(AVATARS_DIR, name)
            if existing is None:
                provider.resolve(name, AVATARS_DIR)
            if progress_cb is not None:
                try:
                    progress_cb(idx, total)
                except Exception:  # noqa: BLE001
                    # 进度回调异常不应中断主流程
                    logger.debug("头像同步进度回调异常，已忽略", exc_info=True)
        logger.info("演员头像同步完成，共处理 %d 名演员", total)
        return total
    except Exception as exc:  # noqa: BLE001
        logger.exception("演员头像同步失败: %s", exc)
        raise


__all__ = [
    "sync_actor_images",
    "find_existing_avatar",
    "safe_avatar_basename",
]
