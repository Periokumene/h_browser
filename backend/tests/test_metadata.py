"""测试 metadata 解析与 poster/thumb/fanart 路径解析（含 SSNI-124 约定）。"""
import tempfile
from pathlib import Path

import pytest

# 从 backend 包外运行测试时需将 backend 加入 path；从项目根 python -m pytest backend/tests 则不需要
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.services.metadata import (
    get_fanart_path,
    get_poster_path,
    get_thumb_path,
    parse_nfo,
    update_nfo_genres_tags,
    VideoMetadata,
)


# 最小 NFO：无 thumb/fanart 标签，依赖同目录约定文件名
SSNI_124_NFO_MINIMAL = """<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>SSNI-124 示例标题</title>
    <plot>示例剧情</plot>
    <year>2020</year>
</movie>
"""

# NFO 中 thumb 为 URL 时不应采用，应走 fallback
SSNI_124_NFO_WITH_URL_THUMB = """<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>SSNI-124</title>
    <thumb>https://example.com/poster.jpg</thumb>
</movie>
"""

# NFO 中明确写本地文件名
SSNI_124_NFO_WITH_LOCAL_THUMB = """<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>SSNI-124</title>
    <thumb>SSNI-124-poster.jpg</thumb>
    <fanart>SSNI-124-fanart.jpg</fanart>
</movie>
"""


@pytest.fixture
def temp_media_dir():
    """临时目录，内含 SSNI-124.nfo 与约定命名的图片占位文件。"""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "SSNI-124.nfo").write_text(SSNI_124_NFO_MINIMAL, encoding="utf-8")
        (root / "SSNI-124-poster.jpg").touch()
        (root / "SSNI-124-thumb.jpg").touch()
        (root / "SSNI-124-fanart.jpg").touch()
        yield root


def test_parse_nfo_minimal(temp_media_dir):
    nfo = temp_media_dir / "SSNI-124.nfo"
    meta = parse_nfo(nfo)
    assert meta.title == "SSNI-124 示例标题"
    assert meta.plot == "示例剧情"
    assert meta.year == 2020
    assert meta.poster_path is None
    assert meta.thumb is None
    assert meta.fanart_path is None


def test_get_poster_path_fallback_ssni124(temp_media_dir):
    """无 NFO 海报路径时，应通过 fallback 得到 SSNI-124-poster.jpg。"""
    nfo = temp_media_dir / "SSNI-124.nfo"
    meta = parse_nfo(nfo)
    poster = get_poster_path(nfo, "SSNI-124", meta)
    assert poster is not None
    assert poster.name == "SSNI-124-poster.jpg"
    assert poster.exists()


def test_get_thumb_path_fallback_ssni124(temp_media_dir):
    nfo = temp_media_dir / "SSNI-124.nfo"
    meta = parse_nfo(nfo)
    thumb = get_thumb_path(nfo, "SSNI-124", meta)
    assert thumb is not None
    assert thumb.name == "SSNI-124-thumb.jpg"
    assert thumb.exists()


def test_get_fanart_path_fallback_ssni124(temp_media_dir):
    nfo = temp_media_dir / "SSNI-124.nfo"
    meta = parse_nfo(nfo)
    fanart = get_fanart_path(nfo, "SSNI-124", meta)
    assert fanart is not None
    assert fanart.name == "SSNI-124-fanart.jpg"
    assert fanart.exists()


def test_url_thumb_ignored_fallback_used():
    """NFO 中 thumb 为 URL 时不应采用，应使用同目录约定文件名。"""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "SSNI-124.nfo").write_text(SSNI_124_NFO_WITH_URL_THUMB, encoding="utf-8")
        (root / "SSNI-124-poster.jpg").touch()
        nfo = root / "SSNI-124.nfo"
        meta = parse_nfo(nfo)
        assert meta.poster_path is None  # URL 未写入
        poster = get_poster_path(nfo, "SSNI-124", meta)
        assert poster is not None
        assert poster.name == "SSNI-124-poster.jpg"


def test_local_thumb_in_nfo_used():
    """NFO 中写本地文件名时，应优先使用该文件。
    注意：只有 <thumb> 时，只设置 thumb，不设置 poster_path（符合分离原则）。
    但 get_poster_path 会使用 thumb 作为后备，所以仍能找到海报。
    """
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "SSNI-124.nfo").write_text(SSNI_124_NFO_WITH_LOCAL_THUMB, encoding="utf-8")
        (root / "SSNI-124-poster.jpg").touch()
        (root / "SSNI-124-fanart.jpg").touch()
        nfo = root / "SSNI-124.nfo"
        meta = parse_nfo(nfo)
        # 只有 <thumb> 时，只设置 thumb，不设置 poster_path
        assert meta.poster_path is None
        assert meta.thumb == "SSNI-124-poster.jpg"
        assert meta.fanart_path == "SSNI-124-fanart.jpg"
        # get_poster_path 会使用 thumb 作为后备，所以仍能找到海报
        poster = get_poster_path(nfo, "SSNI-124", meta)
        assert poster is not None and poster.name == "SSNI-124-poster.jpg"
        fanart = get_fanart_path(nfo, "SSNI-124", meta)
        assert fanart is not None and fanart.name == "SSNI-124-fanart.jpg"


def test_poster_and_thumb_separate():
    """poster 和 thumb 应分别从对应字段获取，不应相互覆盖。"""
    nfo_with_both = """<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>Test</title>
    <poster>poster.jpg</poster>
    <thumb>thumb.jpg</thumb>
</movie>
"""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "TEST.nfo").write_text(nfo_with_both, encoding="utf-8")
        meta = parse_nfo(root / "TEST.nfo")
        assert meta.poster_path == "poster.jpg"
        assert meta.thumb == "thumb.jpg"
        assert meta.poster_path != meta.thumb


def test_thumb_aspect_poster_only_sets_poster():
    """<thumb aspect="poster"> 应只设置 poster_path，不设置 thumb。"""
    nfo_thumb_poster = """<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>Test</title>
    <thumb aspect="poster">poster.jpg</thumb>
    <thumb>thumb.jpg</thumb>
</movie>
"""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "TEST.nfo").write_text(nfo_thumb_poster, encoding="utf-8")
        meta = parse_nfo(root / "TEST.nfo")
        assert meta.poster_path == "poster.jpg"
        assert meta.thumb == "thumb.jpg"
        assert meta.poster_path != meta.thumb


def test_only_thumb_no_poster():
    """只有 <thumb> 时，应只设置 thumb，不设置 poster_path。"""
    nfo_only_thumb = """<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>Test</title>
    <thumb>thumb.jpg</thumb>
</movie>
"""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        (root / "TEST.nfo").write_text(nfo_only_thumb, encoding="utf-8")
        meta = parse_nfo(root / "TEST.nfo")
        assert meta.poster_path is None
        assert meta.thumb == "thumb.jpg"


def test_update_nfo_genres_tags():
    """update_nfo_genres_tags 应正确写回 NFO 中的类型与标签，其余节点不变。"""
    nfo_initial = """<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>DASD-701</title>
    <genre>类型A</genre>
    <tag>旧标签</tag>
</movie>
"""
    with tempfile.TemporaryDirectory() as d:
        root = Path(d)
        nfo_path = root / "DASD-701.nfo"
        nfo_path.write_text(nfo_initial, encoding="utf-8")
        update_nfo_genres_tags(nfo_path, ["类型A", "类型B"], ["旧标签", "测试专用"])
        content = nfo_path.read_text(encoding="utf-8")
        assert "<genre>类型A</genre>" in content
        assert "<genre>类型B</genre>" in content
        assert "<tag>旧标签</tag>" in content
        assert "<tag>测试专用</tag>" in content
        assert "<title>DASD-701</title>" in content
        # 格式：每个 genre/tag 单独成行，不堆在一行
        lines_with_genre_or_tag = [ln for ln in content.splitlines() if "<genre>" in ln or "<tag>" in ln]
        assert len(lines_with_genre_or_tag) == 4, "应有 4 行分别为两个 genre 与两个 tag"
        meta = parse_nfo(nfo_path)
        assert set(meta.genres) == {"类型A", "类型B"}
        assert set(meta.tags) == {"旧标签", "测试专用"}
