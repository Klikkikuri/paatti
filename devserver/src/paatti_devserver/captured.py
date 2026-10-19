"""The captured-sites provider: a fake correction for each link that the developer captures, on any host.

Paatti's popup sends the address of a page, the site rules that it read the page with, and the links and headlines
that the rules found, to `POST /api/capture`. On a site that Paatti supports, the rules are the site's own rules; on
any other site, they are the popup's generic rule. The provider serves the rules back in `sites.json`, so a captured
site keeps its own selectors, and a new site gets the generic rule. Nothing is downloaded.

The server signs each link with `CAPTURE_RULES`, a catch-all over the base rules. The provider supplies the same
rules in `rules.json`, so Paatti signs a link of a captured host the same way.

Every captured link gets a fake correction. With "Allow providers to override sites" on, this provider ranks before
Rahti on equal weight, so a fake correction also replaces a real one.
"""

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from niitti.logging import get_logger

from . import expectations as ex
from .rng import rng
from .signing import CAPTURE_RULES, Signer

log = get_logger(__name__)

FAKE_PREFIX = "[dev] "


class CapturedSites:
    """The captured pages in `<data_dir>/captures/`, and the provider documents made from them."""

    def __init__(self, settings):
        self.captures_dir = Path(settings.data_dir) / "captures"
        self._signer = None
        self._lock = threading.Lock()

    def manifest(self, links: list[dict]) -> dict:
        return {
            "schema_version": "0.1.0",
            "name": "Captured sites (dev server)",
            "links": links,
            "resources": [
                {"type": "suola-rules", "href": "rules.json", "description": "Signs the links of any host"},
                {"type": "site-configs", "href": "sites.json", "description": "The captured sites and their rules"},
                {"type": "rahti-data", "href": "data.json", "description": "Fake corrections for the captured links"},
            ],
        }

    def _file(self, host: str) -> Path:
        return self.captures_dir / f"{host}.json"

    def _captures(self) -> list[dict]:
        paths = sorted(self.captures_dir.glob("*.json")) if self.captures_dir.exists() else []
        return [json.loads(path.read_text()) for path in paths]

    def _signs(self) -> Signer:
        if self._signer is None:
            self._signer = Signer(CAPTURE_RULES)
        return self._signer

    def capture(self, page_url: str, rules: list[dict], links: list[tuple[str, str]]) -> dict:
        """Store the rules and the links of one page. The links merge by address with the earlier links of its host."""
        page = urlsplit(page_url)
        host = page.hostname
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
            path = self._file(host)
            stored = {**(json.loads(path.read_text())["links"] if path.exists() else {}), **received}
            self.captures_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"host": host, "origin": f"{page.scheme}://{host}/*", "rules": rules,
                                        "links": stored}, indent=1, ensure_ascii=False))

        log.info("captured", host=host, links=len(received), stored=len(stored))
        return {"host": host, "links": len(received), "stored": len(stored)}

    def sites(self) -> dict:
        """A site for each captured host. A capture file without rules is older than the rules: send the page again."""
        sites = {capture["host"]: {"name": capture["host"], "origins": [capture["origin"]], "rules": capture["rules"]}
                 for capture in self._captures() if "rules" in capture}
        return {"schema_version": "0.1.0", "sites": sites}

    def data(self) -> dict:
        entries, updated = [], "2026-01-01T00:00:00+00:00"
        for capture in self._captures():
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
