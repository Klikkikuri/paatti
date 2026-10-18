"""The API that site.js and the extension use."""

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, HttpUrl

from ..captured import CaptureError
from ..layout import fragment

MAX_CAPTURE_BYTES = 4 * 1024 * 1024

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/fragment", response_class=HTMLResponse,
            summary="HTML that site.js inserts: more cards, one churn card, or one ticker item")
def get_fragment(request: Request, seed: int, kind: Literal["more", "churn", "ticker"] = "more", n: int = 1):
    state = request.app.state.devserver
    return HTMLResponse(fragment(state.settings, state.pool, seed, kind, n))


class CapturedLink(BaseModel):
    href: str = Field(max_length=4096)
    title: str = Field(max_length=2000)


class CaptureRequest(BaseModel):
    pageUrl: HttpUrl
    links: list[CapturedLink] = Field(max_length=5000)


@router.post("/capture", summary="Store the links of a page on a Rahti site that Rahti has no correction for")
def capture(request: Request, body: CaptureRequest, content_length: int | None = Header(None)):
    if content_length is not None and content_length > MAX_CAPTURE_BYTES:
        raise HTTPException(status_code=413, detail=f"A capture can be {MAX_CAPTURE_BYTES} bytes at most")
    try:
        return request.app.state.captured.capture(str(body.pageUrl), [(link.href, link.title) for link in body.links])
    except CaptureError as err:
        raise HTTPException(status_code=err.status, detail=str(err)) from err
