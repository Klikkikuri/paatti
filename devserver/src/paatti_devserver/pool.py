"""The fixed article pool of Ilta-Pulu and its Rahti data.

The pool depends only on `pool_seed` and the content features, never on a page seed. Thus one `data.json` covers
every page. Each coverage case is a group of articles with their own id scope, so turning a feature off removes its
group and leaves the other articles byte-identical.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from . import expectations as ex
from .headlines import EDGE_PAIRS, PAIRS, SECTIONS, Pair, fill
from .rng import faker, hex_id, rng
from .settings import FeatureSettings

BASE_ARTICLES = 160
XFAIL_VIOLATED_TITLE = "XFAIL VIOLATED — this headline must not change"

# The xfail kinds whose link points at an article that must never be converted.
XFAIL_TARGETS = {
    "outside": "XFAIL: link outside its container",
    "nested": "XFAIL: link nested below the container's direct children",
    "advert": "XFAIL: advert that looks like a teaser",
}


@dataclass(frozen=True)
class Article:
    id: str
    section: str
    original: str
    converted: str | None
    level: int
    labels: tuple[str, ...] = ()
    has_entry: bool = True
    case: str = "base"
    body: tuple[str, ...] = field(default=(), compare=False)

    @property
    def path(self) -> str:
        return f"/{self.section}/a/{self.id}"


def _article(pool_seed: int, case: str, index: int, pair: Pair, *, level: int, labels=(), converted=True,
             has_entry=True, original: str | None = None) -> Article:
    scope = (pool_seed, "article", case, index)
    fake = faker(*scope)
    clickbait, neutral = fill(pair, fake, rng(*scope, "names"))
    return Article(
        id=hex_id(*scope),
        section=pair.section,
        original=original or clickbait,
        converted=neutral if converted else None,
        level=level,
        labels=tuple(labels),
        has_entry=has_entry,
        case=case,
        body=tuple(fake.paragraph(nb_sentences=5) for _ in range(4)),
    )


def _pair(pool_seed: int, case: str, index: int) -> Pair:
    return rng(pool_seed, "pair", case, index).choice(PAIRS)


def build_pool(pool_seed: int, features: FeatureSettings) -> list[Article]:
    """Every article: the base articles first, then one group per active coverage case."""
    def group(case, count, options):
        return [_article(pool_seed, case, i, _pair(pool_seed, case, i), **options(i)) for i in range(count)]

    articles = group("base", BASE_ARTICLES, lambda i: {"level": rng(pool_seed, "level", i).randint(2, 4)})
    cases = {
        "levels": lambda: group("levels", len(ex.LEVELS), lambda i: {"level": i}),
        "ai_slop": lambda: group("ai_slop", 3, lambda i: {"level": 3, "labels": [ex.LABEL_AI_SLOP]}),
        "video": lambda: group("video", 3, lambda i: {"level": 3, "labels": [ex.LABEL_VIDEO]}),
        "sponsored": lambda: group("sponsored", 2, lambda i: {"level": 2, "labels": [ex.LABEL_SPONSORED]}),
        "paywalled": lambda: group("paywalled", 3,
                                   lambda i: {"level": 2, "labels": [ex.LABEL_PAYWALLED], "converted": False}),
        "no_entry": lambda: group("no_entry", 4, lambda i: {"level": 0, "has_entry": False}),
        "edge_headlines": lambda: [
            _article(pool_seed, "edge_headlines", i, pair, level=3) for i, pair in enumerate(EDGE_PAIRS)
        ],
    }
    for name, make in cases.items():
        if getattr(features, name):
            articles += make()
    if features.xfail:
        articles += [
            _article(pool_seed, f"xfail_{kind}", 0, PAIRS[0], level=4, original=title)
            for kind, title in XFAIL_TARGETS.items()
        ]
    return articles


def xfail_target(articles: list[Article], kind: str) -> Article:
    return next(article for article in articles if article.case == f"xfail_{kind}")


def updated_at(pool_seed: int) -> str:
    """The `updated` time of the data, from `pool_seed`, not from the clock, so that `data.json` is reproducible."""
    return (datetime(2026, 1, 1, tzinfo=UTC) + timedelta(hours=pool_seed % 8760)).isoformat()


def rahti_entry(article: Article, sign: str, updated: str) -> dict:
    """One Rahti `entries[]` item, in the shape of Rahti's `data.json`."""
    entry = {
        "updated": updated,
        "urls": [{"labels": ["com.github.klikkikuri/link-rel=canonical"], "sign": sign}],
        "clickbaitiness": ex.LEVELS[article.level],
        "labels": list(article.labels),
        "outlet": "Ilta-Pulu",
    }
    if article.converted:
        entry["title"] = XFAIL_VIOLATED_TITLE if article.case.startswith("xfail_") else article.converted
    return entry
