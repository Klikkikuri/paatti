"""The popup's "Send page" button: what the content script sends, and the update and conversion that follow.

The server's capture step is recorded here, not run; tests/test_captured.py covers it.
"""

from .conftest import LiveServer, statuses, wait_until


def test_send_page_posts_the_original_headlines_and_reports_the_result(browser):
    with LiveServer() as server:
        received = {}

        def record(page_url, links):
            received.update(page_url=page_url, links=links)
            return {"host": "localhost", "links": len(links), "stored": len(links)}

        server.app.state.captured.capture = record
        browser.add_provider(server.manifest_url)
        site = browser.context.new_page()
        site.goto(f"{server.base}/?seed=5")
        assert wait_until(lambda: statuses(site).get("converted"))
        originals = set(site.evaluate("""() => [...document.querySelectorAll("[data-klikkikuri-original-title]")]
            .map((element) => element.dataset.klikkikuriOriginalTitle.trim())"""))

        popup = browser.context.new_page()
        popup.goto(f"chrome-extension://{browser.extension_id}/src/options/popup.html")
        popup.evaluate("""async (base) => {
            const [tab] = await chrome.tabs.query({ url: `${base}/*` });
            await chrome.tabs.update(tab.id, { active: true });
        }""", server.base)
        popup.reload()
        popup.click("label[for=navi-settings]")
        popup.click("#devmode-capture-button")
        status = popup.locator("#devmode-capture-status")
        assert wait_until(lambda: status.text_content().strip() not in ("", "Sending…")), status.text_content()
        assert status.text_content().startswith("Done"), status.text_content()

        assert received["page_url"] == f"{server.base}/?seed=5"
        titles = {title for _, title in received["links"]}
        assert originals and originals <= titles, "the converted headlines must be sent as the page showed them"
        assert all(href.startswith("http") for href, _ in received["links"])
        assert not any(title.startswith("XFAIL VIOLATED") for title in titles)
