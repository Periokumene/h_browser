"""测试 scanner 扫描逻辑，确保跳过模板文件（如 movie.nfo）。"""
import os
import tempfile
from pathlib import Path

import pytest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


@pytest.fixture
def clean_db():
    """清空数据库表，确保测试独立性。"""
    import backend.models
    from backend.models import MediaItem, get_session
    db = get_session()
    try:
        db.query(MediaItem).delete()
        db.commit()
    finally:
        db.close()
    yield


def test_skip_movie_nfo_template(clean_db):
    """应跳过 movie.nfo 等模板文件，不创建 code="movie" 的条目。"""
    from backend.models import MediaItem, get_session
    from backend.scanner import scan_media
    
    with tempfile.TemporaryDirectory() as d:
        media_root = Path(d)
        # 创建 movie.nfo（模板文件）
        (media_root / "movie.nfo").write_text(
            '<?xml version="1.0"?><movie><title>Template</title></movie>', encoding="utf-8"
        )
        # 创建正常的 NFO
        (media_root / "SSNI-124.nfo").write_text(
            '<?xml version="1.0"?><movie><title>SSNI-124</title></movie>', encoding="utf-8"
        )
        (media_root / "SSNI-124.mp4").touch()

        db = get_session()
        try:
            count = scan_media(db, media_roots=[str(media_root)])
            assert count == 1  # 只处理 SSNI-124，跳过 movie.nfo
            
            items = db.query(MediaItem).all()
            codes = [item.code for item in items]
            assert "movie" not in codes, f"不应包含 code='movie'，但找到了: {codes}"
            assert "SSNI-124" in codes
        finally:
            db.close()


def test_skip_multiple_template_files(clean_db):
    """应跳过多个模板文件名。"""
    from backend.models import MediaItem, get_session
    from backend.scanner import scan_media
    
    with tempfile.TemporaryDirectory() as d:
        media_root = Path(d)
        for template_name in ["movie.nfo", "template.nfo", "sample.nfo", "example.nfo"]:
            (media_root / template_name).write_text(
                '<?xml version="1.0"?><movie><title>Template</title></movie>', encoding="utf-8"
            )
        (media_root / "REAL-001.nfo").write_text(
            '<?xml version="1.0"?><movie><title>REAL-001</title></movie>', encoding="utf-8"
        )
        (media_root / "REAL-001.mp4").touch()

        db = get_session()
        try:
            count = scan_media(db, media_roots=[str(media_root)])
            assert count == 1
            
            items = db.query(MediaItem).all()
            codes = [item.code for item in items]
            assert codes == ["REAL-001"], f"应只有 REAL-001，但得到: {codes}"
        finally:
            db.close()
