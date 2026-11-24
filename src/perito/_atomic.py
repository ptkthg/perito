"""Substituição atômica de arquivos derivados, com temporário no mesmo diretório."""
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path


def version(path: Path) -> str:
    try:
        stat = path.stat()
        return f'{stat.st_mtime_ns}-{stat.st_size}'
    except FileNotFoundError:
        return '0-0'


@contextmanager
def atomic_open(path: Path):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='',
                                         dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            yield handle
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
