"""The API that site.js and the extension use."""

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, HttpUrl

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


class CapturedRule(BaseModel):
    """A site rule as Paatti reads it. A field that the rule does not have stays out of `sites.json`."""

    container: str = Field(max_length=2000)
    link: str | None = Field(None, max_length=2000)
    title: str | None = Field(None, max_length=2000)
    description: str | None = Field(None, max_length=2000)


class CaptureRequest(BaseModel):
    pageUrl: HttpUrl
    rules: list[CapturedRule] = Field(max_length=200)
    links: list[CapturedLink] = Field(max_length=5000)


@router.post("/capture", summary="Store the rules and the links of a page")
def capture(request: Request, body: CaptureRequest, content_length: int | None = Header(None)):
    if content_length is not None and content_length > MAX_CAPTURE_BYTES:
        raise HTTPException(status_code=413, detail=f"A capture can be {MAX_CAPTURE_BYTES} bytes at most")
    rules = [rule.model_dump(exclude_none=True) for rule in body.rules]
    return request.app.state.captured.capture(str(body.pageUrl), rules, [(link.href, link.title) for link in body.links])


@router.get("/captures/{host}", summary="Check the folder of a captured host: its Suola rules and their test cases")
def check_capture(request: Request, host: str):
    report = request.app.state.captured.check(host)
    if report is None:
        raise HTTPException(status_code=404, detail=f"No captured folder for {host}")
    return report
