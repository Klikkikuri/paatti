"""Content that arrives after the first conversion pass, page faults, and the popup's main-page entry."""

import pytest

from .conftest import LiveServer, statuses, wait_for_mismatches, wait_until
from .test_expectations import describe


def open_checked(browser, server, seed: int):
    browser.add_provider(server.manifest_url)
    page = browser.context.new_page()
    page.goto(f"{server.base}/?seed={seed}&check=1")
    assert wait_for_mismatches(page) == []
    return page


def test_load_more_and_ticker_replacements_are_converted(browser):
    with LiveServer() as server:
        page = open_checked(browser, server, 7)
        page.click("#load-more")
        assert wait_until(lambda: page.locator("[data-devserver-source^='more:']").count() > 0)
        assert wait_until(lambda: page.locator("[data-devserver-source^='ticker:']").count() > 0, timeout_s=12)
        found = wait_for_mismatches(page)
        assert found == [], describe(found)


def first_seed_with(server, marker: str) -> int:
    """The first page seed whose front page contains `marker`. A page fault picks its blocks from the seed."""
    from fastapi.testclient import TestClient
    client = TestClient(server.app)
    return next(seed for seed in range(1, 100) if marker in client.get(f"/?seed={seed}").text)


def test_late_content_is_converted(browser):
    with LiveServer(chaos={"page_late_content": True}) as server:
        page = open_checked(browser, server, first_seed_with(server, "<template data-devserver-late"))
        late = page.locator("[data-devserver-chaos='page_late_content']")
        assert wait_until(lambda: late.count() > 0)
        found = wait_for_mismatches(page)
        assert found == [], describe(found)


def test_churned_cards_get_their_own_status(browser):
    with LiveServer(chaos={"page_dom_churn": True}) as server:
        page = open_checked(browser, server, 13)
        churned = page.locator("[data-devserver-chaos^='page_dom_churn']")
        assert wait_until(lambda: churned.count() >= 2, timeout_s=15)
        found = wait_for_mismatches(page)
        assert found == [], describe(found)


BADGES = "klikkikuri-converted-badge, klikkikuri-ai-badge, klikkikuri-video-badge"


def test_badges_keep_their_size_under_hostile_css(browser):
    with LiveServer(chaos={"page_hostile_css": True}) as server:
        page = open_checked(browser, server, 17)
        badges = page.locator(BADGES)
        assert badges.count() > 0
        sizeless = [i for i in range(badges.count()) if (badges.nth(i).bounding_box() or {}).get("width", 0) == 0]
        assert sizeless == [], f"{len(sizeless)} of {badges.count()} badges have no size"


@pytest.mark.xfail(strict=True, reason="Known extension gap: the badges force display, but not visibility, so a "
                                       "page's :not(:defined) { visibility: hidden } hides them all")
def test_badges_stay_visible_under_hostile_css(browser):
    with LiveServer(chaos={"page_hostile_css": True}) as server:
        page = open_checked(browser, server, 17)
        badges = page.locator(BADGES)
        hidden = [i for i in range(badges.count()) if not badges.nth(i).is_visible()]
        assert hidden == [], f"{len(hidden)} of {badges.count()} badges are hidden"


def test_article_page_is_the_main_page_entry(browser):
    with LiveServer() as server:
        browser.add_provider(server.manifest_url)
        article = next(a for a in server.app.state.devserver.pool if a.case == "base")
        page = browser.context.new_page()
        page.goto(f"{server.base}{article.path}")
        assert wait_until(lambda: statuses(page).get("converted"))
        results = browser.run("""async (url) => {
            const [tab] = await chrome.tabs.query({ url });
            return chrome.tabs.sendMessage(tab.id, { command: "getConversions" });
        }""", f"{server.base}{article.path}")
        main = results[0]
        assert main.get("isMainPage") and main["convertedTitle"] == article.converted
