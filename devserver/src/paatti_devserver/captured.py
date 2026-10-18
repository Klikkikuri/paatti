"""The captured-sites provider: Rahti's real sites, with fake corrections for the links that Rahti has no entry for.

Paatti's popup sends the links and headlines of a page on a Rahti site to `POST /api/capture`. The server signs
each link with the base Suola rules, which equal Rahti's rules at the pinned commit, so the provider needs no
`suola-rules` and its signs are Paatti's official signs.

With "Allow providers to override sites" on, this provider ranks before Rahti on equal weight, and Paatti looks a
link up here first. Thus a fake entry for a link that Rahti covers would hide the real correction. Each capture
fetches Rahti's current data and keeps only the links that Rahti has no entry for; a capture of the same page again
drops the links that Rahti has added since.
"""

import json
import re
import threading
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx2
from niitti.logging import get_logger

from . import expectations as ex
from .rng import rng
from .signing import Signer

log = get_logger(__name__)

RAHTI_RAW = "https://raw.githubusercontent.com/Klikkikuri/rahti"
RAHTI_DATA_URL = f"{RAHTI_RAW}/refs/heads/main/data.json"
FAKE_PREFIX = "[dev] "


class CaptureError(Exception):
    """A capture that the server refuses, with the HTTP status that says why."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def fetch_rahti_signs() -> set[str]:
    """The signs in Rahti's current data. The data changes every few minutes, so this is not the pinned commit."""
    response = httpx2.get(RAHTI_DATA_URL, timeout=20, follow_redirects=False)
    response.raise_for_status()
    return {url["sign"] for entry in response.json()["entries"] for url in entry.get("urls", []) if url.get("sign")}


def origin_host(origin: str) -> str:
    return re.match(r"^https?://([^/]+)/", origin).group(1)


class CapturedSites:
    """The captured pages in `<data_dir>/captures/`, and the provider documents made from them."""

    def __init__(self, settings, fetch_real_signs=fetch_rahti_signs):
        self.settings = settings
        self.fetch_real_signs = fetch_real_signs
        self.captures_dir = Path(settings.data_dir) / "captures"
        self.cache_dir = Path(settings.data_dir) / ".cache"
        self._signer = None
        self._lock = threading.Lock()

    @property
    def sites_url(self) -> str:
        return f"{RAHTI_RAW}/{self.settings.rahti_commit}/sites.json"

    def pinned_sites(self) -> dict:
        """Rahti's sites.json at the pinned commit, downloaded one time into the cache."""
        if not self.settings.rahti_commit:
            raise CaptureError(503, "Start the server with --rahti_commit to serve captured sites")
        cached = self.cache_dir / f"rahti-{self.settings.rahti_commit}-sites.json"
        if not cached.exists():
            response = httpx2.get(self.sites_url, timeout=20, follow_redirects=False)
            response.raise_for_status()
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            cached.write_bytes(response.content)
        return json.loads(cached.read_text())["sites"]

    def origins(self) -> list[str]:
        return sorted({origin for key, site in self.pinned_sites().items()
                       for origin in site.get("origins") or [f"https://{key}/*"]})

    def covers(self, host: str | None) -> bool:
        """Whether a pinned Rahti site covers `host`, as its origins name it (`www.hs.fi`, or `*.hs.fi`)."""
        if not host:
            return False
        for pattern in map(origin_host, self.origins()):
            if host == pattern or (pattern.startswith("*.") and (host == pattern[2:] or host.endswith(pattern[1:]))):
                return True
        return False

    def manifest(self, links: list[dict]) -> dict:
        return {
            "schema_version": "0.1.0",
            "name": "Captured sites (dev server)",
            "links": links,
            "resources": [
                {"type": "site-configs", "href": self.sites_url, "origins": self.origins(),
                 "description": f"Rahti's sites at commit {self.settings.rahti_commit}"},
                {"type": "rahti-data", "href": "data.json",
                 "description": "Fake corrections for the captured links that Rahti has no entry for"},
            ],
        }

    def _file(self, host: str) -> Path:
        return self.captures_dir / f"{host}.json"

    def _load(self, host: str) -> dict:
        path = self._file(host)
        return json.loads(path.read_text())["links"] if path.exists() else {}

    def _signs(self) -> Signer:
        if self._signer is None:
            self._signer = Signer()
        return self._signer

    def capture(self, page_url: str, links: list[tuple[str, str]]) -> dict:
        """Store the links of one page that Rahti has no entry for, and drop stored ones that Rahti now has."""
        host = urlsplit(page_url).hostname
        if not self.covers(host):
            raise CaptureError(422, f"No Rahti site at commit {self.settings.rahti_commit} covers {host}")
        try:
            real = self.fetch_real_signs()
        except Exception as err:  # Any failure: writing fake data blind could hide a real correction.
            raise CaptureError(502, f"Could not read Rahti's current data: {err}") from err

        captured_at = datetime.now(UTC).isoformat()
        received = {}
        for href, title in links:
            absolute = urljoin(page_url, href)
            parts = urlsplit(absolute)
            if parts.scheme not in ("http", "https") or not self.covers(parts.hostname):
                continue
            sign = self._signs().sign(absolute)
            if sign:
                received[absolute] = {"title": " ".join(title.split()), "sign": sign, "captured": captured_at}

        with self._lock:
            stored = {**self._load(host), **received}
            kept = {href: link for href, link in stored.items() if link["sign"] not in real}
            self.captures_dir.mkdir(parents=True, exist_ok=True)
            self._file(host).write_text(json.dumps({"host": host, "links": kept}, indent=1, ensure_ascii=False))

        fake = sum(1 for link in received.values() if link["sign"] not in real)
        log.info("captured", host=host, links=len(received), fake=fake, dropped=len(stored) - len(kept))
        return {"host": host, "links": len(received), "real": len(received) - fake, "fake": fake,
                "stored": len(kept)}

    def data(self) -> dict:
        entries, updated = [], "2026-01-01T00:00:00+00:00"
        for path in sorted(self.captures_dir.glob("*.json")) if self.captures_dir.exists() else []:
            capture = json.loads(path.read_text())
            for link in capture["links"].values():
                entries.append(fake_entry(link, capture["host"]))
                updated = max(updated, link["captured"])
        return {"status": "ok", "updated": updated, "schema_version": "0.1.0", "entries": entries}


def fake_entry(link: dict, host: str) -> dict:
    """A fake Rahti entry, seeded by the sign: the same link always gets the same level and labels."""
    r = rng("captured", link["sign"])
    labels = [label for label, chance in ((ex.LABEL_AI_SLOP, 0.1), (ex.LABEL_VIDEO, 0.1)) if r.random() < chance]
    return {
        "updated": link["captured"],
        "urls": [{"labels": ["com.github.klikkikuri/link-rel=canonical"], "sign": link["sign"]}],
        "clickbaitiness": ex.LEVELS[r.choice((2, 3, 3, 4))],
        "labels": labels,
        "outlet": host,
        "title": FAKE_PREFIX + link["title"],
    }
