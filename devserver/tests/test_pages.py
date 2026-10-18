from hypothesis import given, strategies as st

from paatti_devserver import documents
from paatti_devserver import expectations as ex
from paatti_devserver.layout import RULES, front_page, site_rules
from paatti_devserver.markup import render
from paatti_devserver.settings import BLOCKS
from paatti_devserver.signing import Signer, ilta_pulu_rules

from .conftest import make_settings, state_for
from .scan import parse, scan

SIGNER = Signer(ilta_pulu_rules("localhost:3000"))
BOOLEAN_FEATURES = ["levels", "ai_slop", "video", "sponsored", "paywalled", "no_entry", "missing_href",
                    "duplicate_link", "edge_headlines", "href_variants", "xfail"]

seeds = st.integers(min_value=0, max_value=10**9)
feature_sets = st.fixed_dictionaries({}, optional={
    **{name: st.booleans() for name in BOOLEAN_FEATURES},
    "blocks": st.sets(st.sampled_from(BLOCKS), min_size=1).map(frozenset),
})


def page_html(settings, seed: int) -> str:
    state = state_for(settings)
    page = front_page(settings, state.pool, seed)
    return page.ticker + "".join(page.main) + "".join(page.side)


def status_of(item, data_by_sign) -> str:
    """The status that processSite writes for one scanned link (see Paatti src/contentScript.js:259-315)."""
    if item["title"] is None or not item["href"]:
        return ex.SKIPPED
    sign = SIGNER.sign(f"http://localhost:3000{item['href']}" if item["href"].startswith("/") else item["href"])
    entry = data_by_sign.get(sign)
    if entry is None:
        return ex.SKIPPED
    level = ex.LEVELS.index(entry["clickbaitiness"])
    if entry.get("title") and level >= ex.DEFAULT_THRESHOLD:
        return ex.CONVERTED
    if not entry.get("title") and ex.LABEL_PAYWALLED in entry["labels"]:
        return ex.PAYWALLED
    return ex.ORIGINAL


@given(seed=seeds)
def test_the_same_seed_gives_the_same_page(seed):
    settings = make_settings()
    assert page_html(settings, seed) == page_html(settings, seed)


def test_another_seed_gives_another_page():
    settings = make_settings()
    assert page_html(settings, 1) != page_html(settings, 2)


@given(seed=seeds, features=feature_sets)
def test_rules_find_every_block_and_no_expected_failure(seed, features):
    settings = make_settings(features=features)
    state = state_for(settings)
    rules = [rule for _, rule in site_rules(settings.features.blocks)]
    data_by_sign = {entry["urls"][0]["sign"]: entry for entry in documents.data(state)["entries"]}
    document = parse(page_html(settings, seed))

    scanned = {id(item["container"]): item for item in scan(document, rules)}
    for element in document.select("[data-expect-status]"):
        expected = element["data-expect-status"]
        item = scanned.get(id(element))
        where = f"{element.get('data-devserver-block')} ({element.get('data-expect-path')})"
        if expected == ex.GAP:
            continue
        if expected == ex.XFAIL:
            assert item is None or status_of(item, data_by_sign) == ex.SKIPPED, where
            continue
        assert item is not None, f"no rule matched {where}"
        assert status_of(item, data_by_sign) == expected, where
    for item in scanned.values():
        assert item["container"].has_attr("data-expect-status"), str(item["container"])[:160]


@given(seed=seeds)
def test_no_violation_target_is_reachable_through_a_rule(seed):
    settings = make_settings()
    state = state_for(settings)
    violated = {state.signs[a.id] for a in state.pool if a.case.startswith("xfail_")}
    document = parse(page_html(settings, seed))
    for item in scan(document, [rule for _, rule in site_rules(settings.features.blocks)]):
        href = item["href"] or ""
        if href.startswith("/"):
            assert SIGNER.sign(f"http://localhost:3000{href}") not in violated


@given(seed=seeds)
def test_every_href_variant_signs_to_its_article(seed):
    settings = make_settings()
    state = state_for(settings)
    document = parse(page_html(settings, seed))
    for element in document.select("[data-devserver-href]"):
        link = element if element.name == "a" else element.select_one("a[href*='/a/']")
        href = link["href"]
        url = href if href.startswith("http") else f"http://localhost:3000{href}"
        article_id = href.split("/a/")[1][:12]
        assert SIGNER.sign(url) == state.signs[article_id], (element["data-devserver-href"], href)


@given(seed=seeds)
def test_annotations_can_be_turned_off(seed):
    html = page_html(make_settings(features={"annotations": False}), seed)
    assert "data-expect-" not in html and "data-devserver-" not in html


def test_no_rule_names_a_test_attribute():
    for rule in RULES.values():
        for selector in (rule["container"], rule["link"], rule["title"]):
            assert "data-expect" not in selector and "data-devserver" not in selector


def test_the_default_front_page_shows_every_status_and_expected_failure():
    document = parse(page_html(make_settings(), 1))
    statuses = {element["data-expect-status"] for element in document.select("[data-expect-status]")}
    assert {ex.CONVERTED, ex.ORIGINAL, ex.PAYWALLED, ex.SKIPPED, ex.XFAIL, ex.GAP} <= statuses
    kinds = {element["data-devserver-xfail"] for element in document.select("[data-devserver-xfail]")}
    assert kinds == {"outside", "nested", "advert", "external", "javascript", "gap"}
    paths = {element["data-expect-path"] for element in document.select("[data-expect-path]")}
    assert {rule["path"] for rule in RULES.values()} <= paths


def test_markup_escapes_headlines_as_text():
    from paatti_devserver.markup import el
    assert render(el("h2", {}, "<b>Exclusive</b> &amp; more")) == "<h2>&lt;b&gt;Exclusive&lt;/b&gt; &amp;amp; more</h2>"
