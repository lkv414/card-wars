#!/usr/bin/env python3
"""Local card-fixer: review scan images against their JSON and swap records."""
import argparse
import json
import mimetypes
import os
import re
import shutil
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(TOOL_DIR))
SCANS = os.path.join(ROOT, "исходники", "карты")
STATE_DIR = os.path.join(ROOT, ".tmp-reocr", "fixer-backups")
JOURNAL = os.path.join(STATE_DIR, "journal.json")
PROTECTED = {"file", "sha256"}
CARD_RE = re.compile(r"^[A-Za-z0-9_]+\.json$")
LAND_ADJ = {
    "blue": "Равнинное",
    "corn": "Кукурузное",
    "good": "Милое",
    "ice": "Ледяное",
    "sand": "Песчаное",
    "swamp": "Болотное",
    "rainbow": "Радужное",
    "ghost": "Призрачное",
}


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, payload):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def card_sort_key(name):
    match = re.search(r"_card_(\d+)\.json$", name)
    return (name.split("_card_")[0], int(match.group(1)) if match else 0, name)


def pack_of(filename):
    return filename.split("_card_")[0] if "_card_" in filename else "other"


def scan_files():
    if not os.path.isdir(SCANS):
        return []
    return sorted(
        (name for name in os.listdir(SCANS) if name.endswith(".json") and CARD_RE.match(name)),
        key=card_sort_key,
    )


def card_payload(filename):
    data = read_json(os.path.join(SCANS, filename))
    return {"file": filename, "pack": pack_of(filename), "json": data}


def swap_records(a, b):
    if a == b:
        raise ValueError("Нельзя менять карту саму с собой")
    for name in (a, b):
        if not CARD_RE.match(name) or not os.path.isfile(os.path.join(SCANS, name)):
            raise ValueError(f"Неизвестный файл: {name}")

    data_a = read_json(os.path.join(SCANS, a))
    data_b = read_json(os.path.join(SCANS, b))
    for data, name in ((data_a, a), (data_b, b)):
        if "file" not in data or "sha256" not in data:
            raise ValueError(f"В {name} нет file/sha256")

    content_a = {key: value for key, value in data_a.items() if key not in PROTECTED}
    content_b = {key: value for key, value in data_b.items() if key not in PROTECTED}
    new_a = {"file": data_a["file"], "sha256": data_a["sha256"], **content_b}
    new_b = {"file": data_b["file"], "sha256": data_b["sha256"], **content_a}

    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
    backup_dir = os.path.join(STATE_DIR, f"{stamp}_{a[:-5]}_{b[:-5]}")
    os.makedirs(backup_dir, exist_ok=True)
    shutil.copy2(os.path.join(SCANS, a), os.path.join(backup_dir, a))
    shutil.copy2(os.path.join(SCANS, b), os.path.join(backup_dir, b))

    try:
        write_json(os.path.join(SCANS, a), new_a)
        write_json(os.path.join(SCANS, b), new_b)
    except Exception:
        shutil.copy2(os.path.join(backup_dir, a), os.path.join(SCANS, a))
        shutil.copy2(os.path.join(backup_dir, b), os.path.join(SCANS, b))
        raise

    journal = read_json(JOURNAL) if os.path.isfile(JOURNAL) else []
    journal.append(
        {
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "kind": "swap",
            "files": [a, b],
            "a": a,
            "b": b,
            "backup": os.path.basename(backup_dir),
        }
    )
    write_json(JOURNAL, journal)
    return card_payload(a), card_payload(b)


def mark_companions(files):
    if not files:
        raise ValueError("Не выбраны файлы")
    updates = []
    for name in files:
        if not CARD_RE.match(name) or not os.path.isfile(os.path.join(SCANS, name)):
            raise ValueError(f"Неизвестный файл: {name}")
        data = read_json(os.path.join(SCANS, name))
        adjective = LAND_ADJ.get(data.get("landType"))
        if not adjective:
            raise ValueError(f"Неизвестный landType у {name}: {data.get('landType')}")
        updated = {**data, "typeCategory": "companion", "type": f"{adjective} партнерство", "attack": None, "defense": None}
        if updated != data:
            updates.append((name, updated))
    if not updates:
        return [card_payload(name) for name in files]

    stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
    backup_dir = os.path.join(STATE_DIR, f"{stamp}_companions")
    os.makedirs(backup_dir, exist_ok=True)
    for name, _ in updates:
        shutil.copy2(os.path.join(SCANS, name), os.path.join(backup_dir, name))
    try:
        for name, updated in updates:
            write_json(os.path.join(SCANS, name), updated)
    except Exception:
        for name, _ in updates:
            shutil.copy2(os.path.join(backup_dir, name), os.path.join(SCANS, name))
        raise

    journal = read_json(JOURNAL) if os.path.isfile(JOURNAL) else []
    journal.append(
        {
            "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "kind": "mark",
            "files": [name for name, _ in updates],
            "backup": os.path.basename(backup_dir),
        }
    )
    write_json(JOURNAL, journal)
    return [card_payload(name) for name in files]


def undo_last():
    if not os.path.isfile(JOURNAL):
        raise ValueError("Нет действий для отмены")
    journal = read_json(JOURNAL)
    if not journal:
        raise ValueError("Нет действий для отмены")
    entry = journal[-1]
    backup_dir = os.path.join(STATE_DIR, entry["backup"])
    files = entry.get("files") or [entry["a"], entry["b"]]
    for name in files:
        source = os.path.join(backup_dir, name)
        if not os.path.isfile(source):
            raise ValueError(f"Бэкап не найден: {source}")
    for name in files:
        shutil.copy2(os.path.join(backup_dir, name), os.path.join(SCANS, name))
    journal.pop()
    write_json(JOURNAL, journal)
    return [card_payload(name) for name in files], entry


class Handler(BaseHTTPRequestHandler):
    server_version = "CardFixer/1.0"

    def log_message(self, fmt, *args):
        print(f"[fixer] {fmt % args}")

    def _send(self, status, body, content_type, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8", {"Cache-Control": "no-store"})

    def _error(self, message, status=400):
        self._json({"error": message}, status)

    def _serve_static(self, relative):
        safe = os.path.normpath(relative).lstrip("\\/")
        path = os.path.abspath(os.path.join(TOOL_DIR, safe))
        if not path.startswith(os.path.abspath(TOOL_DIR) + os.sep) or not os.path.isfile(path):
            self._error("Not found", 404)
            return
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as handle:
            body = handle.read()
        self._send(200, body, content_type, {"Cache-Control": "no-cache"})

    def _serve_scan(self, relative):
        name = os.path.basename(relative)
        if not name.endswith(".png"):
            self._error("Not found", 404)
            return
        path = os.path.join(SCANS, name)
        if not os.path.isfile(path):
            self._error("Not found", 404)
            return
        with open(path, "rb") as handle:
            body = handle.read()
        self._send(200, body, "image/png", {"Cache-Control": "public, max-age=3600"})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/packs":
            counts = {}
            for name in scan_files():
                pack = pack_of(name)
                counts[pack] = counts.get(pack, 0) + 1
            self._json({"packs": [{"id": key, "count": counts[key]} for key in sorted(counts)]})
            return
        if parsed.path == "/api/cards":
            pack = parse_qs(parsed.query).get("pack", ["all"])[0]
            files = scan_files()
            if pack != "all":
                files = [name for name in files if pack_of(name) == pack]
            self._json({"cards": [card_payload(name) for name in files]})
            return
        if parsed.path == "/api/status":
            journal = read_json(JOURNAL) if os.path.isfile(JOURNAL) else []
            self._json({"swaps": len(journal), "scans": len(scan_files())})
            return
        if parsed.path.startswith("/scans/"):
            self._serve_scan(parsed.path[len("/scans/"):])
            return
        if parsed.path in ("/", "/index.html"):
            self._serve_static("index.html")
            return
        self._serve_static(parsed.path.lstrip("/"))

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._error("Некорректный JSON")
            return
        try:
            if parsed.path == "/api/swap":
                a, b = payload.get("a", ""), payload.get("b", "")
                first, second = swap_records(a, b)
                self._json({"a": first, "b": second})
                return
            if parsed.path == "/api/mark-companion":
                files = payload.get("files") or []
                self._json({"cards": mark_companions(files)})
                return
            if parsed.path == "/api/undo":
                cards, entry = undo_last()
                self._json({"cards": cards, "undone": entry})
                return
            self._error("Not found", 404)
        except ValueError as error:
            self._error(str(error))
        except Exception as error:  # noqa: BLE001
            self._error(f"Ошибка: {error}", 500)


def main():
    parser = argparse.ArgumentParser(description="Card Wars card-fixer")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()
    os.makedirs(STATE_DIR, exist_ok=True)
    if not os.path.isdir(SCANS):
        raise SystemExit(f"Не найдена папка сканов: {SCANS}")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/"
    print(f"card-fixer: {len(scan_files())} сканов, {url}")
    print(f"бэкапы обменов: {STATE_DIR}")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nостановлено")


if __name__ == "__main__":
    main()
