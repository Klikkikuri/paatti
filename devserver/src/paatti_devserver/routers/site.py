"""Ilta-Pulu's own pages: the front page, the article pages and the privacy notice."""

import secrets

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from ..layout import article_page, front_page, site_rules

router = APIRouter(tags=["site"])


def _render(request: Request, template: str, **context) -> HTMLResponse:
    state = request.app.state.devserver
    settings = state.settings
    features, chaos = settings.features, settings.chaos
    blocks = {name for name, _ in site_rules(features.blocks)}
    body_data = {
        "data-seed": context.get("seed", ""),
        "data-ticker": "ticker" in blocks and features.ticker,
        "data-load-more": "card" in blocks and features.load_more,
        "data-churn": chaos.page_dom_churn and "card" in blocks,
        "data-late": chaos.page_late_content,
        **context.pop("extra_body_data", {}),
    }
    return request.app.state.templates.TemplateResponse(request, template, {
        "settings": settings,
        "body_data": {key: value for key, value in body_data.items() if value not in (False, "")},
        "hostile_css": chaos.page_hostile_css,
        **context,
    })


@router.get("/", response_class=HTMLResponse, summary="The front page; without ?seed= it redirects to one")
def front(request: Request, seed: int | None = None):
    settings = request.app.state.devserver.settings
    if seed is None:
        chosen = settings.seed if settings.seed is not None else secrets.randbelow(1_000_000)
        return RedirectResponse(f"/?seed={chosen}", status_code=302)
    page = front_page(settings, request.app.state.devserver.pool, seed)
    gap = {"data-gap": page.gap_item} if page.gap_item is not None else {}
    return _render(request, "front.html", page=page, seed=seed, extra_body_data=gap,
                   reproduce=settings.reproduce_command(seed=seed))


@router.get("/privacy", response_class=HTMLResponse, summary="The privacy notice that the manifest links")
def privacy(request: Request):
    return _render(request, "privacy.html")


@router.get("/{section}/a/{article_id}", response_class=HTMLResponse, summary="An article page")
def article(request: Request, section: str, article_id: str):
    state = request.app.state.devserver
    found = state.by_id.get(article_id)
    if found is None:
        raise HTTPException(status_code=404, detail="No such article")
    page = article_page(state.settings, state.pool, found)
    return _render(request, "article.html", article=found, page=page,
                   reproduce=state.settings.reproduce_command())
