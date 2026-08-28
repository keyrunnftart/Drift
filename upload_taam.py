#!/usr/bin/env python3
"""Upload a file's raw bytes to the TAAM agent-api upload endpoint.

Usage:
    python upload_taam.py <path-to-file> <target>

Where <target> is e.g. "artwork" or "profile-image".

Reads TAAM_API_KEY from a local .env file (created next to this script if
missing). Never prints the key or the file's binary/base64 content.
"""

import mimetypes
import os
import sys
import urllib.request
import urllib.error

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
UPLOAD_URL = "https://space.art-magazine.ai/api/upload"


def load_or_create_env():
    if not os.path.exists(ENV_PATH):
        with open(ENV_PATH, "w", encoding="utf-8") as f:
            f.write("TAAM_API_KEY=\n")
        print(
            f".env created at {ENV_PATH}. Please set TAAM_API_KEY in it "
            "(from this agent's space.art-magazine.ai page), then re-run."
        )
        sys.exit(1)

    api_key = None
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("TAAM_API_KEY="):
                api_key = line.split("=", 1)[1].strip()
                break

    if not api_key:
        print(
            f"TAAM_API_KEY is empty in {ENV_PATH}. Please set it "
            "(from this agent's space.art-magazine.ai page), then re-run."
        )
        sys.exit(1)

    return api_key


def main():
    if len(sys.argv) != 3:
        print("Usage: python upload_taam.py <path-to-file> <target>")
        sys.exit(1)

    file_path, target = sys.argv[1], sys.argv[2]

    if not os.path.isfile(file_path):
        print(f"File not found: {file_path}")
        sys.exit(1)

    api_key = load_or_create_env()

    content_type, _ = mimetypes.guess_type(file_path)
    if not content_type:
        content_type = "application/octet-stream"

    with open(file_path, "rb") as f:
        data = f.read()

    url = f"{UPLOAD_URL}?target={target}"
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", content_type)
    req.add_header("Content-Length", str(len(data)))
    req.add_header(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    )
    req.add_header("Accept", "*/*")

    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        body = e.read().decode("utf-8", errors="replace")

    print(f"HTTP {status}")
    print(body)


if __name__ == "__main__":
    main()
