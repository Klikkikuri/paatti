"""The API that site.js and the extension use."""

from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from ..layout import fragment

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/fragment", response_class=HTMLResponse,
            summary="HTML that site.js inserts: more cards, one churn card, or one ticker item")
def get_fragment(request: Request, seed: int, kind: Literal["more", "churn", "ticker"] = "more", n: int = 1):
    state = request.app.state.devserver
    return HTMLResponse(fragment(state.settings, state.pool, seed, kind, n))
