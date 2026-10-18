"""The blocks of Ilta-Pulu: the site rules, the block markup with its noise, the expected failures, and the
annotations that make a page its own test oracle.

Each block type has one rule in `sites.json`, shaped after a pattern of a real news site (see README.md, "Layout
survey"). The rule names only a part of the markup; the seeded noise around it must never break the match.
"""

from dataclasses import dataclass, field
from random import Random

from . import expectations as ex
from .markup import Comment, El, el, render
from .pool import Article, xfail_target
from .rng import hex_id, rng
from .settings import BLOCKS, Settings

# The rules, in sites.json order. `path` is the content-script path that the block exercises.
RULES = {
    "lead": {"container": "article.lead", "link": ":scope > a", "title": "h2 span:last-child",
             "path": "kicker-span", "description": "Lead story; the headline is the last span after a kicker (hs.fi)"},
    "card": {"container": "div.front div.card a", "link": "self", "title": "div.front-title",
             "path": "link-self", "description": "Front card whose container is the link (iltalehti.fi)"},
    "story": {"container": "div[class*='Story__Wrapper']", "link": "a[href*='/a/']", "title": "h3 a",
              "path": "hashed-class", "description": "Story card with styled-components classes (yle.fi, bbc.com)"},
    "teaser": {"container": "[data-testid='teaser-content']", "link": "a[data-testid='internal-link']", "title": "h2",
               "path": "test-id", "description": "Teaser found by data-testid (mtvuutiset.fi, bbc.com)"},
    "most_read": {"container": "aside ol > li", "link": "a", "title": "h3 span:last-child",
                  "path": "list", "description": "Numbered most-read list (hs.fi, theguardian.com)"},
    "ticker": {"container": "div.newsticker > a.ticker-item", "link": "self", "title": "span.ticker-title",
               "path": "ticker", "description": "News ticker whose items are replaced (iltalehti.fi)"},
    "briefs": {"container": "aside[aria-labelledby=briefs] li:not(:last-child) a", "link": "self", "title": "self",
               "path": "title-self", "description": "Brief list; the link holds the text (yle.fi)"},
    "related": {"container": "article.lead .related > a", "link": ":scope", "title": "h3",
                "path": "nested-container", "description": "Related links inside the lead story (theguardian.com)"},
    "infographic": {"container": "figure.infographic", "link": "a", "title": "svg text",
                    "path": "svg-fallback", "description": "Headline drawn in SVG; badges become a text prefix"},
    "promo": {"container": ".promo", "link": "a", "title": ".promo__title",
              "path": "missing-title", "description": "Promo with no title element"},
    "sidebar": {"container": ".sidebar .card", "link": "a", "title": ".card__title",
                "path": "line-clamp", "description": "Sidebar card with a two-line clamp"},
}

UTILITY_CLASSES = (
    "flex", "grid", "grow", "gap-4", "mb-nof-16", "px-nof-16", "md:w-1/2", "lg:w-6/12", "group-hover:underline",
    "border-b", "text-15", "font-bold", "relative", "overflow-hidden", "is-visible",
)
STYLED_NAMES = ("IndexCard", "Dundee", "Manchester", "Cambridge", "GridItem", "Teaser", "CardHeading")
KICKERS = ("EXCLUSIVE", "LIVE", "WATCH", "UPDATED", "REVEALED", "ANALYSIS")
VARIANTS = ("relative", "absolute", "query", "slash", "fragment", "upper")


def site_rules(blocks) -> list[tuple[str, dict]]:
    """The active rules in sites.json order. The related links live inside the lead, so they need it."""
    return [(name, RULES[name]) for name in BLOCKS
            if name in blocks and (name != "related" or "lead" in blocks)]


@dataclass
class Page:
    """The rendered regions of one page, for the template."""
    ticker: str = ""
    main: list[str] = field(default_factory=list)
    side: list[str] = field(default_factory=list)
    gap_item: int | None = None


class Builder:
    """Builds the blocks of one page from its seed. Every draw comes from a stream named after its use."""

    def __init__(self, settings: Settings, pool: list[Article], seed, source: str):
        self.settings = settings
        self.features = settings.features
        self.chaos = settings.chaos
        self.pool = pool
        self.seed = seed
        self.source = source
        self.netloc = netloc(settings)
        self.rule_index = {name: index for index, (name, _) in enumerate(site_rules(self.features.blocks))}
        self._queue = self._article_queue()

    # Article draws

    def _article_queue(self) -> list[Article]:
        """The case articles first, then the base articles, each group in a seeded order."""
        r = rng(self.seed, self.source, "queue")
        cases = [a for a in self.pool if a.case not in ("base",) and not a.case.startswith("xfail_")]
        base = [a for a in self.pool if a.case == "base"]
        r.shuffle(cases)
        r.shuffle(base)
        return cases + base

    def take(self) -> Article:
        if not self._queue:
            self._queue = self._article_queue()
        return self._queue.pop(0)

    def href(self, article: Article, r: Random) -> tuple[str, str]:
        variant = r.choice(VARIANTS) if self.features.href_variants else "relative"
        path = article.path
        return variant, {
            "relative": path,
            "absolute": f"http://{self.netloc}{path}",
            "query": f"{path}?utm_source=frontpage&utm_medium=web",
            "slash": f"{path}/",
            "fragment": f"{path}#comments",
            "upper": f"/{article.section.upper()}/a/{article.id}",
        }[variant]

    def is_on(self, block: str) -> bool:
        return block in self.features.blocks and (block != "related" or "lead" in self.features.blocks)

    # Annotations

    def annotate(self, container: El, block: str, *, article: Article | None = None, status: str | None = None,
                 path: str | None = None, xfail: str | None = None, noise=(), variant: str | None = None):
        if not self.features.annotations:
            return
        rule = f"{block}#{self.rule_index[block]}" if block in self.rule_index else block
        container.attrs.update({
            "data-expect-status": status or ex.expected_status(article),
            "data-expect-path": path or RULES.get(block, {}).get("path", block),
            "data-expect-entry": ex.entry_facts(article),
            "data-devserver-block": rule,
            "data-devserver-noise": ",".join(noise) or None,
            "data-devserver-xfail": xfail,
            "data-devserver-href": variant,
            "data-devserver-source": self.source,
        })

    # Noise

    def noise(self, r: Random, allowed: tuple[str, ...]) -> list[str]:
        return [kind for kind in allowed if r.random() < 0.45]

    @staticmethod
    def utility(r: Random) -> list[str]:
        return r.sample(UTILITY_CLASSES, r.randint(1, 3))

    @staticmethod
    def styled(r: Random, part: str) -> list[str]:
        return [f"{r.choice(STYLED_NAMES)}-styles__{part}-sc-{hex_id(r.random())[:8]}-{r.randint(0, 9)}",
                hex_id(r.random())[:6]]

    @staticmethod
    def data_attrs(r: Random) -> dict:
        return {"data-track-id": hex_id(r.random())[:10], "data-position": str(r.randint(1, 40)),
                "data-component": r.choice(("teaser", "card", "list-item", "promo-slot"))}

    @staticmethod
    def time_el(r: Random) -> El:
        hour, minute = r.randint(6, 23), r.randint(0, 59)
        return el("time", {"datetime": f"2026-01-01T{hour:02}:{minute:02}:00+02:00"}, f"{hour:02}:{minute:02}")

    @staticmethod
    def image(r: Random) -> El:
        return el("img", {"src": "/static/placeholder.svg", "alt": "", "width": "320", "height": "180",
                          "loading": "lazy"})

    @staticmethod
    def headline(text: str, r: Random, kinds) -> list:
        """The headline text, with whitespace and a comment node around it when the noise says so."""
        if "comment" in kinds:
            return ["\n      ", Comment(f"headline {r.randint(1, 999)}"), f" {text} "]
        return [text]

    # Blocks

    def lead(self, with_nested_xfail: bool) -> El:
        r = rng(self.seed, self.source, "lead", self.take_counter())
        article = self.take()
        kinds = self.noise(r, ("class", "styled", "data", "kicker", "image", "wrapper", "time", "comment"))
        variant, href = self.href(article, r)
        title = el("h2", {"class": "lead__title"},
                   el("span", {"class": "kicker"}, r.choice(KICKERS)) if "kicker" in kinds else None,
                   el("span", {"class": "headline"}, *self.headline(article.original, r, kinds)))
        inner = el("div", {"class": "lead__text"}, title) if "wrapper" in kinds else title
        link = el("a", {"class": "lead__link", "href": href},
                  self.image(r) if "image" in kinds else None, inner)
        container = el("article", {"class": "lead"}, link, self.time_el(r) if "time" in kinds else None)
        self._container_noise(container, r, kinds, "Lead")
        self.annotate(container, "lead", article=article, noise=kinds, variant=variant)
        if self.is_on("related"):
            related = el("div", {"class": "related"}, *[self.related_item() for _ in range(r.randint(2, 3))])
            container.children.append(related)
        if with_nested_xfail:
            target = xfail_target(self.pool, "nested")
            byline = el("a", {"href": target.path}, target.original)
            self.annotate(byline, "lead", article=target, status=ex.XFAIL, path="scope-child-excluded",
                          xfail="nested")
            container.children.append(el("div", {"class": "byline"}, byline))
        return container

    def related_item(self) -> El:
        r = rng(self.seed, self.source, "related", self.take_counter())
        article = self.take()
        kinds = self.noise(r, ("data", "image"))
        variant, href = self.href(article, r)
        link = el("a", {"class": "related-link", "href": href}, self.image(r) if "image" in kinds else None,
                  el("h3", {}, article.original))
        if "data" in kinds:
            link.attrs.update(self.data_attrs(r))
        self.annotate(link, "related", article=article, noise=kinds, variant=variant)
        return link

    def card(self, article: Article | None = None, variant_href: tuple[str, str] | None = None,
             missing_href: bool = False, path: str | None = None) -> tuple[El, Article | None, tuple]:
        """A card, its article, and its `(variant, href)`, so that a duplicate can repeat both."""
        r = rng(self.seed, self.source, "card", self.take_counter())
        article = article if article is not None or missing_href else self.take()
        kinds = self.noise(r, ("class", "styled", "data", "wrapper", "image", "live", "time", "comment"))
        variant, href = variant_href or (self.href(article, r) if not missing_href else (None, None))
        link = el("a", {"class": "card-link", "href": href},
                  self.image(r) if "image" in kinds else None,
                  el("div", {"class": "front-title"}, *self.headline(article.original if article else
                                                                     "Video: watch the full interview", r, kinds)),
                  el("span", {"class": "live-pill"}, "LIVE") if "live" in kinds else None)
        if "data" in kinds:
            link.attrs.update(self.data_attrs(r))
        self.annotate(link, "card", article=article, noise=kinds, variant=variant,
                      status=ex.SKIPPED if missing_href else None, path=path)
        inner = el("div", {"class": "card__inner"}, link) if "wrapper" in kinds else link
        card = el("div", {"class": "card"}, inner, self.time_el(r) if "time" in kinds else None)
        if "class" in kinds:
            card.add_class(*self.utility(r))
        if "styled" in kinds:
            card.add_class(*self.styled(r, "Card"))
        return card, article, (variant, href)

    def javascript_card(self) -> El:
        link = el("a", {"class": "card-link", "href": "javascript:void(0)"},
                  el("div", {"class": "front-title"}, "XFAIL: card whose link is javascript:"))
        self.annotate(link, "card", status=ex.XFAIL, path="unsignable-href", xfail="javascript")
        return el("div", {"class": "card"}, link)

    def story(self) -> El:
        r = rng(self.seed, self.source, "story", self.take_counter())
        article = self.take()
        kinds = self.noise(r, ("data", "image", "time", "section-link"))
        variant, href = self.href(article, r)
        texts = el("div", {"class": f"Story__Texts-sc-{hex_id(r.random())[:8]}-1"},
                   el("h3", {"class": "Typography-sc-8becf565-0 coXzWz"}, el("a", {"href": href}, article.original)),
                   self.time_el(r) if "time" in kinds else None)
        container = el("div", {"class": f"GenericStory__Wrapper-sc-{hex_id(r.random())[:8]}-6 {hex_id(r.random())[:5]}"},
                       el("a", {"href": f"/{article.section}/", "class": "section-link"}, article.section.title())
                       if "section-link" in kinds else None,
                       self.image(r) if "image" in kinds else None, texts)
        if "data" in kinds:
            container.attrs.update(self.data_attrs(r))
        self.annotate(container, "story", article=article, noise=kinds, variant=variant)
        return container

    def teaser(self) -> El:
        r = rng(self.seed, self.source, "teaser", self.take_counter())
        article = self.take()
        kinds = self.noise(r, ("class", "data", "aria", "image", "category"))
        variant, href = self.href(article, r)
        link = el("a", {"data-testid": "internal-link", "href": href, "class": "group"},
                  self.image(r) if "image" in kinds else None,
                  el("h2", {"class": "pb-400 group-hover:underline"}, article.original))
        content = el("div", {"class": "flex grow", "data-testid": "teaser-content"}, link,
                     el("span", {"class": "category"}, article.section) if "category" in kinds else None)
        if "class" in kinds:
            content.add_class(*self.utility(r))
        if "data" in kinds:
            content.attrs.update(self.data_attrs(r))
        if "aria" in kinds:
            content.attrs["aria-label"] = "Teaser"
        self.annotate(content, "teaser", article=article, noise=kinds, variant=variant)
        return el("div", {"class": "teaser flex", "data-testid": "teaser"}, content)

    def teaser_link_outside(self) -> El:
        target = xfail_target(self.pool, "outside")
        content = el("div", {"class": "flex grow", "data-testid": "teaser-content"},
                     el("h2", {"class": "pb-400"}, target.original))
        self.annotate(content, "teaser", article=target, status=ex.XFAIL, path="link-outside-container",
                      xfail="outside")
        return el("div", {"class": "teaser flex", "data-testid": "teaser"}, content,
                  el("a", {"data-testid": "internal-link", "href": target.path}, "Read more"))

    def teaser_advert(self) -> El:
        target = xfail_target(self.pool, "advert")
        content = el("div", {"class": "flex grow", "data-testid": "ad-content"},
                     el("a", {"data-testid": "internal-link", "href": target.path, "class": "group"},
                        el("h2", {"class": "pb-400 group-hover:underline"}, target.original)),
                     el("span", {"class": "category"}, "Advertisement"))
        self.annotate(content, "teaser", article=target, status=ex.XFAIL, path="lookalike-not-matched",
                      xfail="advert")
        return el("div", {"class": "teaser flex", "data-testid": "teaser"}, content)

    def most_read(self, count: int) -> El:
        items = []
        for rank in range(1, count + 1):
            r = rng(self.seed, self.source, "most_read", self.take_counter())
            article = self.take()
            kinds = self.noise(r, ("data", "kicker", "class"))
            variant, href = self.href(article, r)
            heading = el("h3", {},
                         el("span", {"class": "kicker"}, r.choice(KICKERS)) if "kicker" in kinds else None,
                         el("span", {}, article.original))
            item = el("li", {}, el("span", {"class": "rank"}, str(rank)), el("a", {"href": href}, heading))
            if "class" in kinds:
                item.add_class(*self.utility(r))
            if "data" in kinds:
                item.attrs.update(self.data_attrs(r))
            self.annotate(item, "most_read", article=article, noise=kinds, variant=variant)
            items.append(item)
        return el("aside", {"class": "most-read"}, el("h2", {}, "Most read"), el("ol", {}, *items))

    def ticker_item(self, r: Random, article: Article, gap: bool = False) -> El:
        variant, href = self.href(article, r)
        item = el("a", {"class": "ticker-item", "href": href}, self.time_el(r),
                  el("div", {"class": "ticker-content"}, el("span", {"class": "ticker-title"}, article.original)))
        if gap:
            self.annotate(item, "ticker", article=article, status=ex.GAP, path="in-place-recycle", xfail="gap",
                          variant=variant)
        else:
            self.annotate(item, "ticker", article=article, variant=variant)
        return item

    def ticker(self, with_gap: bool) -> tuple[El, int | None]:
        r = rng(self.seed, self.source, "ticker")
        items = [self.ticker_item(rng(self.seed, self.source, "ticker", i), self.take()) for i in range(5)]
        gap_index = None
        if with_gap:
            gap_index = len(items)
            items.append(self.ticker_item(r, self.take(), gap=True))
        return el("div", {"class": "newsticker"}, *items), gap_index

    def briefs(self, count: int, with_external_xfail: bool) -> El:
        items = []
        for _ in range(count):
            r = rng(self.seed, self.source, "briefs", self.take_counter())
            article = self.take()
            variant, href = self.href(article, r)
            link = el("a", {"href": href}, article.original)
            self.annotate(link, "briefs", article=article, variant=variant)
            items.append(el("li", {}, self.time_el(r), " ", link))
        if with_external_xfail:
            link = el("a", {"href": f"https://www.example.com/news/a/{hex_id(self.seed, 'external')}"},
                      "XFAIL: link to an external host")
            self.annotate(link, "briefs", status=ex.XFAIL, path="external-host", xfail="external")
            items.insert(len(items) // 2, el("li", {}, link))
        items.append(el("li", {"class": "more"}, el("a", {"href": "/"}, "All briefs")))
        return el("aside", {"aria-labelledby": "briefs", "class": "briefs"},
                  el("h2", {"id": "briefs"}, "In brief"), el("ul", {}, *items))

    def infographic(self) -> El:
        r = rng(self.seed, self.source, "infographic", self.take_counter())
        article = self.take()
        variant, href = self.href(article, r)
        svg = el("svg", {"xmlns": "http://www.w3.org/2000/svg", "viewBox": "0 0 640 120", "role": "img"},
                 el("rect", {"width": "640", "height": "120", "rx": "8", "fill": "#16324f"}),
                 el("text", {"x": "20", "y": "68", "fill": "#ffffff", "font-size": "22"}, article.original))
        container = el("figure", {"class": "infographic"}, el("a", {"href": href}, svg),
                       el("figcaption", {}, "Graphic: Ilta-Pulu"))
        self.annotate(container, "infographic", article=article, variant=variant)
        return container

    def promo(self) -> El:
        r = rng(self.seed, self.source, "promo", self.take_counter())
        article = self.take()
        _, href = self.href(article, r)
        container = el("div", {"class": "promo"},
                       el("a", {"href": href}, el("span", {"class": "promo__label"}, "Subscribe for the full story")))
        self.annotate(container, "promo", article=article, status=ex.SKIPPED)
        return container

    def sidebar(self, count: int) -> El:
        cards = []
        for _ in range(count):
            r = rng(self.seed, self.source, "sidebar", self.take_counter())
            article = self.take()
            kinds = self.noise(r, ("data", "image", "time"))
            variant, href = self.href(article, r)
            card = el("div", {"class": "card"},
                      el("a", {"href": href}, self.image(r) if "image" in kinds else None,
                         el("span", {"class": "card__title"}, article.original)),
                      self.time_el(r) if "time" in kinds else None)
            if "data" in kinds:
                card.attrs.update(self.data_attrs(r))
            self.annotate(card, "sidebar", article=article, noise=kinds, variant=variant)
            cards.append(card)
        return el("div", {"class": "sidebar"}, el("h2", {}, "More stories"), *cards)

    def _container_noise(self, container: El, r: Random, kinds, part: str):
        if "class" in kinds:
            container.add_class(*self.utility(r))
        if "styled" in kinds:
            container.add_class(*self.styled(r, part))
        if "data" in kinds:
            container.attrs.update(self.data_attrs(r))

    _counter = 0

    def take_counter(self) -> int:
        self._counter += 1
        return self._counter

    # Groups

    def card_grid(self, count: int, *, duplicate: bool, missing_href: bool, javascript_xfail: bool) -> El:
        drawn = [self.card() for _ in range(count)]
        cards = [card for card, _, _ in drawn]
        if duplicate and drawn:
            _, article, variant_href = drawn[0]
            cards.append(self.card(article=article, variant_href=variant_href, path="duplicate")[0])
        if missing_href:
            cards.insert(len(cards) // 2, self.card(missing_href=True, path="missing-href")[0])
        if javascript_xfail:
            cards.insert(1, self.javascript_card())
        return el("div", {"class": "front grid"}, *cards)


def netloc(settings: Settings) -> str:
    """The host and port that a browser uses for the server. Suola matches rule domains on this."""
    return "localhost" if settings.port == 80 else f"localhost:{settings.port}"


def front_page(settings: Settings, pool: list[Article], seed: int) -> Page:
    """The blocks of the front page for `seed`."""
    b = Builder(settings, pool, seed, "front")
    f = settings.features
    r = rng(seed, "front", "layout")
    page = Page()

    if b.is_on("ticker") and f.ticker:
        ticker, page.gap_item = b.ticker(with_gap=f.xfail)
        page.ticker = render(ticker)

    main: list[El] = []
    if b.is_on("lead"):
        main += [b.lead(with_nested_xfail=f.xfail and i == 0) for i in range(r.randint(1, 2))]
    sections: list[El] = []
    if b.is_on("card"):
        sections.append(b.card_grid(r.randint(6, 10), duplicate=f.duplicate_link, missing_href=f.missing_href,
                                    javascript_xfail=f.xfail))
    if b.is_on("story"):
        sections.append(el("section", {"class": "stories"}, *[b.story() for _ in range(r.randint(3, 5))]))
    if b.is_on("teaser"):
        teasers = [b.teaser() for _ in range(r.randint(4, 6))]
        if f.xfail:
            teasers.insert(1, b.teaser_link_outside())
            teasers.insert(3, b.teaser_advert())
        sections.append(el("section", {"class": "teasers"}, *teasers))
    if b.is_on("infographic"):
        sections.append(b.infographic())
    if b.is_on("promo"):
        sections += [b.promo() for _ in range(r.randint(1, 2))]
    r.shuffle(sections)
    main += sections

    side: list[El] = []
    if b.is_on("most_read"):
        side.append(b.most_read(r.randint(5, 8)))
    if b.is_on("briefs"):
        side.append(b.briefs(r.randint(4, 6), with_external_xfail=f.xfail))
    if b.is_on("sidebar"):
        side.append(b.sidebar(r.randint(3, 4)))

    page.main = [late(settings, seed, f"main{i}", block) for i, block in enumerate(main)]
    page.side = [late(settings, seed, f"side{i}", block) for i, block in enumerate(side)]
    return page


def late(settings: Settings, seed: int, key: str, block: El) -> str:
    """The block's HTML; inside a `<template>` that `site.js` inserts later, when `page_late_content` picks it."""
    if not settings.chaos.page_late_content or rng(seed, "page_late_content", key).random() >= 0.35:
        return render(block)
    for node in block.walk():
        if "data-expect-status" in node.attrs:
            node.attrs["data-devserver-chaos"] = "page_late_content"
    return f'<template data-devserver-late="{key}">{render(block)}</template>'


def article_page(settings: Settings, pool: list[Article], article: Article) -> Page:
    """The blocks beside an article: a most-read list and a brief list."""
    b = Builder(settings, pool, (settings.seed or 0, article.id), "article")
    page = Page()
    if b.is_on("most_read"):
        page.side.append(render(b.most_read(5)))
    if b.is_on("briefs"):
        page.side.append(render(b.briefs(4, with_external_xfail=False)))
    return page


def fragment(settings: Settings, pool: list[Article], seed: int, kind: str, number: int) -> str:
    """The HTML that `site.js` loads: a page of more cards and teasers, one churn card, or one ticker item."""
    b = Builder(settings, pool, seed, f"{kind}:{number}")
    if kind == "more":
        parts = []
        if b.is_on("card"):
            parts.append(b.card_grid(6, duplicate=False, missing_href=False, javascript_xfail=False))
        if b.is_on("teaser"):
            parts.append(el("section", {"class": "teasers"}, *[b.teaser() for _ in range(2)]))
        return "".join(render(part) for part in parts)
    if kind == "churn":
        return render(b.card()[0]) if b.is_on("card") else ""
    if kind == "ticker":
        item = b.ticker_item(rng(seed, "ticker-tick", number), b.take())
        return render(item) if b.is_on("ticker") else ""
    raise ValueError(kind)
