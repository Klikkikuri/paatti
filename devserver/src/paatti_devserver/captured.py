"""The captured-sites provider: a fake correction for each link that the developer captures, on any host.

Paatti's popup sends the address of a page, the site rules that it read the page with, and the links and headlines
that the rules found, to `POST /api/capture`. On a site that Paatti supports, the rules are the site's own rules; on
any other site, they are the popup's generic rule. Nothing is downloaded.

Each captured host has a folder `<data_dir>/captures/<host>/`, laid out as a Rahti data directory without a manifest:

- `sites.json`: the site and its selectors. The first capture writes it from the rules that the popup sent. After
  that, the developer edits it, and a capture does not change it.
- `rules.json`: the Suola rules of the host, `{"sites": []}` at first. The developer edits it.
- `links.json`: the captured links by address. A capture merges into it.
- `data.json`: the fake corrections of the folder's links. The server writes it when it changes.

The provider merges the folders. Its `rules.json` is the rules of all folders before `CAPTURE_RULES`, a catch-all,
and the server signs with the same rules before the base rules, as Paatti does (see signing.py). The signs are made
when a document is served, so a rule change applies at the next refresh. A folder that does not parse, or whose
rules Suola refuses, is left out, so that one bad folder does not make Paatti refuse the rules of all captured hosts.

Every captured link gets a fake correction. With "Allow providers to override sites" on, this provider ranks before
Rahti on equal weight, so a fake correction also replaces a real one.
"""

import hashlib
import json
import os
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from niitti.logging import get_logger
from suola import InvalidRulesError

from . import expectations as ex
from .rng import rng
from .signing import CAPTURE_RULES, Signer

log = get_logger(__name__)

FAKE_PREFIX = "[dev] "
SCHEMA_VERSION = "0.1.0"
NO_CAPTURE_YET = "2026-01-01T00:00:00+00:00"


@dataclass
class Folder:
    """The files of one captured host. A folder with an `error` gives nothing to the provider documents."""

    host: str
    sites: dict = field(default_factory=dict)
    rules: list[dict] = field(default_factory=list)
    links: dict = field(default_factory=dict)
    error: str | None = None


class CapturedSites:
    """The host folders in `<data_dir>/captures/`, and the provider documents made from them."""

    def __init__(self, settings):
        self.captures_dir = Path(settings.data_dir) / "captures"
        self._lock = threading.RLock()
        self._signer: tuple[str, Signer] | None = None
        self._refusals: dict[str, str | None] = {}
        self._reported: set[tuple[str, str]] = set()
        self._catch_all = None
        if self.captures_dir.exists() and any(self.captures_dir.glob("*.json")):
            log.warning("ignored the capture files of an older server: send the pages again",
                        directory=str(self.captures_dir))

    def manifest(self, links: list[dict]) -> dict:
        return {
            "schema_version": SCHEMA_VERSION,
            "name": "Captured sites (dev server)",
            "links": links,
            "resources": [
                {"type": "suola-rules", "href": "rules.json", "description": "The hosts' rules, and a catch-all"},
                {"type": "site-configs", "href": "sites.json", "description": "The captured sites and their rules"},
                {"type": "rahti-data", "href": "data.json", "description": "Fake corrections for the captured links"},
            ],
        }

    def capture(self, page_url: str, rules: list[dict], links: list[tuple[str, str]]) -> dict:
        """Store the links of one page. The first capture of a host also stores its site with `rules`."""
        page = urlsplit(page_url)
        host = page.hostname
        captured_at = datetime.now(UTC).isoformat()
        received = {}
        for href, title in links:
            absolute = urljoin(page_url, href)
            if urlsplit(absolute).scheme in ("http", "https"):
                received[absolute] = {"title": " ".join(title.split()), "captured": captured_at}

        with self._lock:
            folder = self.captures_dir / host
            folder.mkdir(parents=True, exist_ok=True)
            if not (folder / "sites.json").exists():
                site = {"name": host, "origins": [f"{page.scheme}://{host}/*"], "rules": rules}
                _write(folder / "sites.json", {"schema_version": SCHEMA_VERSION, "sites": {host: site}})
            if not (folder / "rules.json").exists():
                _write(folder / "rules.json", {"sites": []})
            path = folder / "links.json"
            stored = {**(json.loads(path.read_text()) if path.exists() else {}), **received}
            _write(path, dict(sorted(stored.items())))
            self.data()

        log.info("captured", host=host, links=len(received), stored=len(stored))
        return {"host": host, "links": len(received), "stored": len(stored)}

    def sites(self) -> dict:
        """The sites of all folders. `enabled` is left out, because Paatti drops a provider's site that is off."""
        sites = {}
        for folder in self._valid_folders():
            for key, site in folder.sites.items():
                if key in sites:
                    self._report(folder.host, f"the site {key} is also in an earlier folder; that one is used")
                    continue
                sites[key] = {name: value for name, value in site.items() if name != "enabled"}
        return {"schema_version": SCHEMA_VERSION, "sites": sites}

    def rules(self) -> dict:
        return {"sites": [site for folder in self._valid_folders() for site in folder.rules] + CAPTURE_RULES["sites"]}

    def data(self) -> dict:
        """The fake corrections of all folders. Each folder's `data.json` is also written when it changes."""
        signer = self._signs(self.rules())
        entries, seen, updated = [], set(), NO_CAPTURE_YET
        for folder in self._valid_folders():
            folder_entries = _entries(folder, signer)
            folder_updated = max((link["captured"] for link in folder.links.values()), default=NO_CAPTURE_YET)
            self._write_if_changed(self.captures_dir / folder.host / "data.json", _data(folder_entries, folder_updated))
            for entry in folder_entries:
                if entry["urls"][0]["sign"] not in seen:
                    seen.add(entry["urls"][0]["sign"])
                    entries.append(entry)
            updated = max(updated, folder_updated)
        return _data(entries, updated)

    def check(self, host: str) -> dict | None:
        """The state of one folder: whether its rules are usable, the result of each test case, and warnings.

        None for a host without a folder.
        """
        if host not in self._hosts():
            return None
        folder = self._read(host)
        if folder.error:
            return {"host": host, "rules": folder.error, "tests": [], "warnings": []}

        signer = self._signs(self.rules())
        tests = [self._test(case, signer) for site in folder.rules for case in site.get("tests", [])]
        netlocs = {urlsplit(url).netloc.lower() for url in folder.links}
        warnings = [f"the rule domain {site['domain']} matches no captured link; a domain must name the port too"
                    for site in folder.rules
                    if site.get("domain") and not any(_covers(site["domain"], netloc) for netloc in netlocs)]
        others = {key for other in self._valid_folders() if other.host != host for key in other.sites}
        warnings += [f"the site {key} is also in another folder" for key in folder.sites if key in others]
        return {"host": host, "rules": "ok", "tests": tests, "warnings": warnings}

    def _test(self, case: dict, signer: Signer) -> dict:
        url = case["url"]
        sign = signer.sign(url)
        reasons = []
        if sign is None:
            reasons.append("Suola cannot sign the URL")
        else:
            signature = case.get("signature", case.get("sign"))
            if signature and sign != signature:
                reasons.append(f"the sign is {sign}, not {signature}")
            if "expected" in case and sign != hashlib.sha256(case["expected"].encode()).hexdigest():
                reasons.append(f"the URL does not normalize to {case['expected']}")
            if case.get("xfail") and sign != self._catch_all_signs().sign(url):
                reasons.append("a named rule matches the URL, but the case is xfail")
        return {"url": url, "result": "fail" if reasons else "pass", "reasons": reasons}

    def _hosts(self) -> list[str]:
        if not self.captures_dir.exists():
            return []
        return sorted(path.name for path in self.captures_dir.iterdir() if path.is_dir())

    def _valid_folders(self) -> list[Folder]:
        folders = [self._read(host) for host in self._hosts()]
        for folder in folders:
            if folder.error:
                self._report(folder.host, f"the folder is left out: {folder.error}")
        return [folder for folder in folders if not folder.error]

    def _read(self, host: str) -> Folder:
        directory = self.captures_dir / host
        try:
            sites = json.loads((directory / "sites.json").read_text())["sites"]
            rules_text = (directory / "rules.json").read_text()
            rules = json.loads(rules_text)["sites"]
            links_path = directory / "links.json"
            links = json.loads(links_path.read_text()) if links_path.exists() else {}
        except (OSError, ValueError, KeyError, TypeError) as error:
            return Folder(host, error=f"{type(error).__name__}: {error}")
        refusal = self._refusal(rules_text, rules)
        if refusal:
            return Folder(host, error=f"Suola refuses the rules: {refusal}")
        return Folder(host, sites, rules, links)

    def _refusal(self, rules_text: str, rules: list[dict]) -> str | None:
        """Why Suola refuses the rules of one folder, or None. Cached by the text of `rules.json`."""
        if rules_text not in self._refusals:
            try:
                Signer({"sites": rules})
                self._refusals[rules_text] = None
            except (InvalidRulesError, TypeError) as error:
                self._refusals[rules_text] = str(error)
        return self._refusals[rules_text]

    def _signs(self, rules: dict) -> Signer:
        """The signer of the served rules. One slot: a new rule set replaces the previous signer."""
        key = json.dumps(rules)
        with self._lock:
            if self._signer is None or self._signer[0] != key:
                self._signer = (key, Signer(rules))
            return self._signer[1]

    def _catch_all_signs(self) -> Signer:
        if self._catch_all is None:
            self._catch_all = Signer(CAPTURE_RULES, over_base=False)
        return self._catch_all

    def _write_if_changed(self, path: Path, document: dict):
        with self._lock:
            if not path.exists() or path.read_text() != _dumps(document):
                _write(path, document)

    def _report(self, host: str, message: str):
        """Log a problem of a folder one time, not at each refresh."""
        if (host, message) not in self._reported:
            self._reported.add((host, message))
            log.error("captured folder", host=host, problem=message)


def _entries(folder: Folder, signer: Signer) -> list[dict]:
    """The fake entries of a folder's links, one for each sign, in the sequence of the addresses."""
    entries = {}
    for url, link in sorted(folder.links.items()):
        sign = signer.sign(url)
        if sign and sign not in entries:
            entries[sign] = fake_entry({**link, "sign": sign}, folder.host)
    return list(entries.values())


def _data(entries: list[dict], updated: str) -> dict:
    return {"status": "ok", "updated": updated, "schema_version": SCHEMA_VERSION, "entries": entries}


def _covers(domain: str, netloc: str) -> bool:
    return netloc == domain or netloc.endswith("." + domain)


def _dumps(document: dict) -> str:
    return json.dumps(document, indent=1, ensure_ascii=False) + "\n"


def _write(path: Path, document: dict):
    """Write atomically, so that a reader never sees half a file."""
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(_dumps(document))
    os.replace(temporary, path)


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
