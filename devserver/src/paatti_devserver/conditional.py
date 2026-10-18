"""Conditional GET for the provider documents: an ETag from the body, and 304 when it still matches.

Paatti sends `If-None-Match` and `If-Modified-Since` for `rahti-data` (src/provider.js:107-121). As RFC 9110
section 13.2.2 says, `If-Modified-Since` is ignored when `If-None-Match` is present: a document can change twice in
one second, and a Last-Modified match would then hide the change.
"""

import email.utils
import hashlib

from fastapi import Request, Response

from .chaos import DOCUMENT_PATH


async def conditional_get(request: Request, call_next):
    response = await call_next(request)
    if not DOCUMENT_PATH.match(request.url.path) or response.status_code != 200:
        return response

    body = b"".join([chunk async for chunk in response.body_iterator])
    etag = f'"{hashlib.sha256(body).hexdigest()[:32]}"'
    headers = {key: value for key, value in response.headers.items() if key.lower() != "content-length"}
    headers["ETag"] = etag
    headers["Cache-Control"] = "no-cache"

    if not getattr(request.state, "no_conditional", False) and not_modified(request, etag, headers.get("last-modified")):
        return Response(status_code=304, headers={key: value for key, value in headers.items()
                                                  if key.lower() != "content-type"})
    return Response(body, status_code=200, headers=headers)


def not_modified(request: Request, etag: str, last_modified: str | None) -> bool:
    if_none_match = request.headers.get("if-none-match")
    if if_none_match is not None:
        return etag in [tag.strip() for tag in if_none_match.split(",")] or if_none_match.strip() == "*"
    if_modified_since = request.headers.get("if-modified-since")
    if if_modified_since and last_modified:
        try:
            return email.utils.parsedate_to_datetime(last_modified) <= \
                email.utils.parsedate_to_datetime(if_modified_since)
        except (TypeError, ValueError):
            return False
    return False
