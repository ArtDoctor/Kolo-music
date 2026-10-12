"""Serialize read/modify/write updates made by parallel library helpers."""

from contextlib import contextmanager
import os
from pathlib import Path
import sys
from typing import Iterator


@contextmanager
def store_lock(path: Path) -> Iterator[None]:
    """Lock a stable sidecar, not the data file which atomic writes replace.

    Keep the sidecar after unlocking: removing it could let a new writer lock
    a different inode while another writer still holds the original one.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.with_suffix(path.suffix + ".lock").open("a+b") as lock:
        if sys.platform == "win32":
            import msvcrt

            if lock.seek(0, os.SEEK_END) == 0:
                lock.write(b"\0")
                lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if sys.platform == "win32":
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
