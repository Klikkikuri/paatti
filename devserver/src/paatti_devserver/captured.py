"""The captured-sites provider: Rahti's real sites, with a fake correction for each link that the developer captures.

Paatti's popup sends the links and headlines of a page to `POST /api/capture`. The server signs each link with the
base Suola rules, whose catch-all signs any host. They equal Rahti's rules at the pinned commit, so the provider
needs no `suola-rules` and its signs are Paatti's official signs. The corrections take effect on the sites that the
provider supplies: Rahti's sites. A capture from another host is stored, but Paatti does not look it up.

Every captured link gets a fake correction. With "Allow providers to override sites" on, this provider ranks before
Rahti on equal weight, so a fake correction also replaces a real one.
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
FAKE_PREFIX = "[dev] "


class CaptureError(Exception):
    """A capture that the server refuses, with the HTTP status that says why."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def origin_host(origin: str) -> str:
    return re.match(r"^https?://([^/]+)/", origin).group(1)


class CapturedSites:
    """The captured pages in `<data_dir>/captures/`, and the provider documents made from them."""

    def __init__(self, settings):
        self.settings = settings
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

    def manifest(self, links: list[dict]) -> dict:
        return {
            "schema_version": "0.1.0",
            "name": "Captured sites (dev server)",
            "links": links,
            "resources": [
                {"type": "site-configs", "href": self.sites_url, "origins": self.origins(),
                 "description": f"Rahti's sites at commit {self.settings.rahti_commit}"},
                {"type": "rahti-data", "href": "data.json", "description": "Fake corrections for the captured links"},
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
        """Store the links of one page, merged by address with the earlier captures of its host."""
        host = urlsplit(page_url).hostname
        captured_at = datetime.now(UTC).isoformat()
        received = {}
        for href, title in links:
            absolute = urljoin(page_url, href)
            if urlsplit(absolute).scheme not in ("http", "https"):
                continue
            sign = self._signs().sign(absolute)
            if sign:
                received[absolute] = {"title": " ".join(title.split()), "sign": sign, "captured": captured_at}

        with self._lock:
            stored = {**self._load(host), **received}
            self.captures_dir.mkdir(parents=True, exist_ok=True)
            self._file(host).write_text(json.dumps({"host": host, "links": stored}, indent=1, ensure_ascii=False))

        log.info("captured", host=host, links=len(received), stored=len(stored))
        return {"host": host, "links": len(received), "stored": len(stored)}

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
