"""Deterministic fault injection for the provider documents.

A fault that is on fires on a request when `Random(f"{seed}:{flag}:{document}:{n}").random() < rate`, where `n`
counts the requests to that document of that provider since the start. The extension fetches each document one
time per refresh, so `n` is the refresh number; a retry counts as a refresh too. The same flags, seed and request
order thus repeat the same faults. Each fault that fires is logged and named in `X-Devserver-Chaos`.

The page faults are not here: they change the page itself, keyed on the page seed (see layout.py and site.js).
"""

import asyncio
import json
import re
from collections import defaultdict

from fastapi import Request, Response
from niitti.logging import get_logger

from .rng import rng

log = get_logger(__name__)

DOCUMENT_PATH = re.compile(r"^/manifest/(?P<provider>[^/]+)/(?P<document>manifest|sites|rules|data)\.json$")

# The fault that ends the request first wins; the order is the order of this tuple.
STATUS_FAULTS = ("provider_404", "provider_5xx", "provider_429", "provider_redirect")
BODY_FAULTS = ("schema_mismatch", "malformed_json", "oversize")
MANIFEST_MAX_BYTES = 256 * 1024
RESOURCE_MAX_BYTES = 8 * 1024 * 1024


class Chaos:
    """The fault decisions of one server. A fresh instance starts every request count at 0."""

    def __init__(self, settings):
        self.settings = settings
        self.chaos = settings.chaos
        self.counts = defaultdict(int)

    def fires(self, flag: str, document: str, n: int) -> bool:
        return rng(self.chaos.seed, flag, document, n).random() < self.chaos.rate

    def faults_for(self, provider: str, document: str) -> tuple[list[str], int]:
        n = self.counts[provider, document]
        self.counts[provider, document] += 1
        flags = [flag for flag in ("provider_timeout", "no_conditional", *STATUS_FAULTS, *BODY_FAULTS)
                 if document in getattr(self.chaos, flag)]
        if self.chaos.rejected_sites and document == "sites":
            flags.append("rejected_sites")
        if self.chaos.bad_rules and document == "rules":
            flags.append("bad_rules")
        return [flag for flag in flags if self.fires(flag, document, n)], n

    async def middleware(self, request: Request, call_next):
        match = DOCUMENT_PATH.match(request.url.path)
        if not match:
            return await call_next(request)

        provider, document = match["provider"], match["document"]
        fired, n = self.faults_for(provider, document)
        for flag in fired:
            log.info("chaos fault", flag=flag, provider=provider, document=document, n=n)
        header = {"X-Devserver-Chaos": ", ".join(f"{flag};n={n}" for flag in fired)} if fired else {}

        if "provider_timeout" in fired:
            await asyncio.sleep(self.chaos.provider_latency_ms / 1000)
        request.state.no_conditional = "no_conditional" in fired
        for flag in STATUS_FAULTS:
            if flag in fired:
                return status_fault(flag, request, header)

        response = await call_next(request)
        transforms = [flag for flag in ("rejected_sites", "bad_rules", *BODY_FAULTS) if flag in fired]
        if not transforms or response.status_code != 200:
            response.headers.update(header)
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        for flag in transforms:
            body = BODY_TRANSFORMS[flag](body, document, self.settings)
        headers = {key: value for key, value in response.headers.items() if key.lower() != "content-length"}
        return Response(body, status_code=200, headers={**headers, **header}, media_type="application/json")


def status_fault(flag: str, request: Request, header: dict) -> Response:
    if flag == "provider_404":
        return Response("not found", 404, headers=header)
    if flag == "provider_5xx":
        return Response("unavailable", 503, headers={**header, "Retry-After": "5"})
    if flag == "provider_429":
        return Response("too many requests", 429, headers={**header, "Retry-After": "5"})
    return Response(status_code=302, headers={**header, "Location": f"{request.url.path}?redirected=1"})


def _json(transform):
    def apply(body: bytes, document: str, settings) -> bytes:
        return json.dumps(transform(json.loads(body), document, settings)).encode()
    return apply


@_json
def schema_mismatch(doc: dict, document: str, settings) -> dict:
    """A breaking schema version: 0.2.0 for the manifest and sites.json (caret rule), 1.0.0 for data.json."""
    if document in ("manifest", "sites"):
        doc["schema_version"] = "0.2.0"
    elif document == "data":
        doc["schema_version"] = "1.0.0"
    return doc


@_json
def rejected_sites(doc: dict, document: str, settings) -> dict:
    """Site entries that Paatti must refuse: a port in the key, foreign origins, a reserved key, a wildcard key."""
    doc["sites"].update({
        f"localhost:{settings.port}": {"name": "Port in the key"},
        "evil.example": {"name": "Foreign origin", "origins": ["https://www.hs.fi/*"]},
        "__proto__": {"name": "Reserved key"},
        "*": {"name": "Wildcard key"},
    })
    return doc


@_json
def bad_rules(doc: dict, document: str, settings) -> dict:
    """A rule whose regex does not compile, so Suola refuses the whole rule set."""
    doc["sites"].append({"domain": "broken.localhost", "templates": [{"pattern": "(?P<broken", "template": "x"}]})
    return doc


def malformed_json(body: bytes, document: str, settings) -> bytes:
    return body[: len(body) // 2]


def oversize(body: bytes, document: str, settings) -> bytes:
    """Valid JSON padded with spaces past the size limit that Paatti applies to the document."""
    limit = MANIFEST_MAX_BYTES if document == "manifest" else RESOURCE_MAX_BYTES
    return body + b" " * (limit + 1 - len(body))


BODY_TRANSFORMS = {
    "schema_mismatch": schema_mismatch,
    "rejected_sites": rejected_sites,
    "bad_rules": bad_rules,
    "malformed_json": malformed_json,
    "oversize": oversize,
}
