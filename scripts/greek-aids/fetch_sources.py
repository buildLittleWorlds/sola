"""Restore the exact source files in source-lock.json; never update revisions."""
from pathlib import Path
import concurrent.futures
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
lock = json.loads((ROOT / "sources/aids/greek/source-lock.json").read_text())


def fetch(item):
    path = ROOT / item["file"]
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]:
        return
    with urllib.request.urlopen(item["url"], timeout=90) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise ValueError(f"Source checksum mismatch: {item['file']}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"Restored {item['file']}")


if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, lock["files"]))
