#!/usr/bin/env python3
"""
Minimal HTTP server for development environment.
Serves data.json on http://localhost:3000/data.json
"""

import http.server
import os
import socketserver
import argparse
import email.utils
from pathlib import Path

PORT = 3000

BASE_DIR = Path(__file__).resolve().parent
TEST_DATA = BASE_DIR / "test_data" / "data.json"
MERI_INSTANCE = BASE_DIR.parent / "meri" / "instance" / "rahti" / "data.json"

# Production URL to fetch data.json from
PRODUCTION_URL = "https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json"

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        url_path = self.path.split('?')[0]
        if url_path == '/data.json':
            path = self.get_data_path()
            if path and path.exists():
                stats = path.stat()
                mtime = stats.st_mtime
                size = stats.st_size
                last_modified = email.utils.formatdate(mtime, usegmt=True)
                etag = f'"{int(mtime)}-{size}"'

                # Check If-None-Match
                if self.headers.get('If-None-Match') == etag:
                    self.send_response(304)
                    self.end_headers()
                    return

                # Check If-Modified-Since
                ims = self.headers.get('If-Modified-Since')
                if ims:
                    ims_date = email.utils.parsedate_to_datetime(ims)
                    mtime_date = email.utils.parsedate_to_datetime(last_modified)
                    if mtime_date <= ims_date:
                        self.send_response(304)
                        self.end_headers()
                        return

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Last-Modified', last_modified)
                self.send_header('ETag', etag)
                self.end_headers()
                
                if self.command == 'GET':
                    with path.open('rb') as f:
                        self.wfile.write(f.read())
            else:
                self.send_error(404, "File not found")
        else:
            return super().do_GET()

    do_HEAD = do_GET

    def get_data_path(self):
        # 1. Check Meri location
        if MERI_INSTANCE.exists():
            return MERI_INSTANCE
        
        # 2. Check test_data directory
        if TEST_DATA.exists():
            return TEST_DATA
        
        return None

def run_server():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fetch-production', action='store_true')
    args = parser.parse_args()

    if args.fetch_production:
        print(f"Fetching production data from {PRODUCTION_URL}")
        import urllib.request
        try:
            with urllib.request.urlopen(PRODUCTION_URL) as response:
                data = response.read()
                TEST_DATA.parent.mkdir(parents=True, exist_ok=True)
                with TEST_DATA.open('wb') as f:
                    f.write(data)
                print(f"Production data fetched and saved to {TEST_DATA}")
        except Exception as e:
            print(f"Error fetching production data: {e}")

    socketserver.TCPServer.allow_reuse_address = True
    print("Starting HTTP server")
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving HTTP on http://localhost:{PORT}/data.json")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass

if __name__ == "__main__":
    run_server()
