#!/usr/bin/env python3
"""
Card Wars Images Reviewer & Verifier Server.
Serves a dedicated interactive web interface to review, inspect, and edit all 972 cards in `исходники/Images/`.
"""
import os
import sys
import json
import urllib.parse
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES_DIR = os.path.join(ROOT_DIR, "исходники", "Images")
VIEWER_DIR = os.path.join(ROOT_DIR, "tools", "viewer")
STATE_FILE = os.path.join(ROOT_DIR, "tools", "viewer", "review_state.json")

def load_all_cards():
    cards = []
    for root, dirs, files in os.walk(IMAGES_DIR):
        for f in sorted(files):
            if f.lower().endswith((".png", ".jpg", ".jpeg")):
                stem, ext = os.path.splitext(f)
                json_name = stem + ".json"
                json_path = os.path.join(root, json_name)
                img_path = os.path.join(root, f)

                rel_root = os.path.relpath(root, IMAGES_DIR).replace("\\", "/")
                category = rel_root.split("/")[0]
                subcategory = rel_root.split("/")[1] if "/" in rel_root else ""

                card_data = {}
                if os.path.exists(json_path):
                    try:
                        with open(json_path, "r", encoding="utf-8") as jf:
                            card_data = json.load(jf)
                    except Exception as e:
                        card_data = {"error": str(e)}

                rel_img = os.path.relpath(img_path, IMAGES_DIR).replace("\\", "/")
                rel_json = os.path.relpath(json_path, IMAGES_DIR).replace("\\", "/")

                cards.append({
                    "id": stem,
                    "filename": f,
                    "rel_img": rel_img,
                    "rel_json": rel_json,
                    "category": category,
                    "subcategory": subcategory,
                    "data": card_data,
                })
    return cards

def load_review_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_review_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

class ReviewerHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # Serve viewer files
        parsed = urllib.parse.urlparse(path).path
        if parsed in ("/", "/index.html", "/app.js", "/styles.css"):
            clean = parsed.lstrip("/") or "index.html"
            return os.path.join(VIEWER_DIR, clean)
        return super().translate_path(path)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == "/api/cards":
            cards = load_all_cards()
            state = load_review_state()
            payload = {
                "total": len(cards),
                "cards": cards,
                "verified": state.get("verified", {}),
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            return

        if path.startswith("/img/"):
            rel_path = path[5:]
            file_path = os.path.normpath(os.path.join(IMAGES_DIR, rel_path))
            if os.path.commonpath([IMAGES_DIR, file_path]) != IMAGES_DIR or not os.path.exists(file_path):
                self.send_error(404, "File not found")
                return

            ext = os.path.splitext(file_path)[1].lower()
            mime = "image/png" if ext == ".png" else "image/jpeg"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.end_headers()
            with open(file_path, "rb") as f:
                self.wfile.write(f.read())
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/save":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                payload = json.loads(body.decode("utf-8"))
                rel_json = payload.get("rel_json")
                new_data = payload.get("data")

                if not rel_json or not new_data:
                    raise ValueError("Missing rel_json or data")

                target_path = os.path.normpath(os.path.join(IMAGES_DIR, rel_json))
                if os.path.commonpath([IMAGES_DIR, target_path]) != IMAGES_DIR:
                    raise PermissionError("Access denied")

                # Preserve sha256
                if os.path.exists(target_path):
                    old_data = json.load(open(target_path, encoding="utf-8"))
                    if "sha256" in old_data:
                        new_data["sha256"] = old_data["sha256"]

                with open(target_path, "w", encoding="utf-8") as f:
                    json.dump(new_data, f, ensure_ascii=False, indent=2)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "saved"}')
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        if path == "/api/verify":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                payload = json.loads(body.decode("utf-8"))
                card_id = payload.get("id")
                is_verified = bool(payload.get("verified"))

                state = load_review_state()
                if "verified" not in state:
                    state["verified"] = {}
                state["verified"][card_id] = is_verified
                save_review_state(state)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status": "ok"}')
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
            return

        self.send_error(404)

def run_server(port=8080, open_browser=True):
    server_address = ("0.0.0.0", port)
    httpd = ThreadingHTTPServer(server_address, ReviewerHandler)
    httpd.daemon_threads = True
    url = f"http://127.0.0.1:{port}"
    print("=" * 60)
    print(f" CARD WARS REVIEWER STARTED (MULTI-THREADED)")
    print(f" URL: {url} or http://localhost:{port}")
    print(f" Press Ctrl+C to stop.")
    print("=" * 60)

    if open_browser:
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping reviewer server...")
        httpd.server_close()

if __name__ == "__main__":
    port = 8080
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    no_browser = "--no-browser" in sys.argv
    run_server(port=port, open_browser=not no_browser)
