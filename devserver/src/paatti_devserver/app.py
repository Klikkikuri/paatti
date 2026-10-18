"""The FastAPI application: the site, the provider documents and the API, with the fault and cache layers."""

from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .captured import CapturedSites
from .chaos import Chaos
from .conditional import conditional_get
from .layout import netloc
from .pool import Article, build_pool
from .settings import Settings
from .signing import Signer, ilta_pulu_rules

PACKAGE = Path(__file__).parent


@dataclass
class State:
    """What every request reads: the settings, the article pool and its signs. Built one time per app."""

    settings: Settings
    pool: list[Article]
    signs: dict[str, str]
    by_id: dict[str, Article] = field(init=False)

    def __post_init__(self):
        self.by_id = {article.id: article for article in self.pool}


def build_state(settings: Settings) -> State:
    pool = build_pool(settings.pool_seed, settings.features)
    signer = Signer(ilta_pulu_rules(netloc(settings)))
    signs = {article.id: signer.sign(f"http://{netloc(settings)}{article.path}") for article in pool}
    return State(settings, pool, signs)


def create_app(settings: Settings) -> FastAPI:
    from .routers import api, manifest, site

    app = FastAPI(title="Paatti development server", version="0.1.0")
    app.state.devserver = build_state(settings)
    app.state.templates = Jinja2Templates(directory=PACKAGE / "templates")
    app.state.captured = CapturedSites(settings)

    # Starlette runs the middleware added last first: the cache layer must see the body after the faults.
    # app.state.chaos lets an in-process test switch the faults between two refreshes; nothing else changes it.
    app.state.chaos = Chaos(settings)
    app.middleware("http")(app.state.chaos.middleware)
    app.middleware("http")(conditional_get)

    app.mount("/static", StaticFiles(directory=PACKAGE / "static"), name="static")
    app.include_router(manifest.router)
    app.include_router(api.router)
    app.include_router(site.router)
    return app
