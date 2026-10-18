"""The popup's "Send page" button: where it shows, what the content script sends, and the update that follows.

The real captured-sites provider covers only Rahti's hosts, and these tests must not depend on them. A stand-in
supplies Ilta-Pulu's site inline and records the capture; tests/test_captured.py covers the real capture step.
"""

from paatti_devserver import documents

from .conftest import LiveServer, statuses, wait_until


class LocalCapture:
    """A captured-sites provider for `localhost`: Ilta-Pulu's site, no data, and a recorder for the capture."""

    def __init__(self, settings):
        self.sites = documents.sites(settings)["sites"]
        self.received = {}

    def manifest(self, links):
        return {"schema_version": "0.1.0", "name": "Captured localhost (test)", "links": links,
                "resources": [{"type": "site-configs", "sites": self.sites}, {"type": "rahti-data", "href": "data.json"}]}

    def data(self):
        return {"status": "ok", "updated": "2026-01-01T00:00:00+00:00", "schema_version": "0.1.0", "entries": []}

    def capture(self, page_url, links):
        self.received.update(page_url=page_url, links=links)
        return {"host": "localhost", "links": len(links), "real": 3, "fake": len(links) - 3, "stored": len(links)}


def open_popup_for(browser, server):
    """The popup, opened while the Ilta-Pulu tab is the active one, on its settings view."""
    popup = browser.context.new_page()
    popup.goto(f"chrome-extension://{browser.extension_id}/src/options/popup.html")
    popup.evaluate("""async (base) => {
        const [tab] = await chrome.tabs.query({ url: `${base}/*` });
        await chrome.tabs.update(tab.id, { active: true });
    }""", server.base)
    popup.reload()
    popup.click("label[for=navi-settings]")
    return popup


def test_send_page_shows_only_on_a_site_of_the_capturing_provider(browser):
    with LiveServer() as server:
        browser.add_provider(server.manifest_url)
        site = browser.context.new_page()
        site.goto(f"{server.base}/?seed=5")
        assert wait_until(lambda: statuses(site).get("converted"))
        assert open_popup_for(browser, server).locator("#devmode-capture").is_hidden(), \
            "Ilta-Pulu's own provider names no capture endpoint"


def test_send_page_posts_the_original_headlines_and_reports_the_result(browser):
    with LiveServer() as server:
        capture = server.app.state.captured = LocalCapture(server.settings)
        browser.add_provider(server.manifest_url)
        browser.add_provider(f"{server.base}/manifest/captured-sites/manifest.json")
        site = browser.context.new_page()
        site.goto(f"{server.base}/?seed=5")
        assert wait_until(lambda: statuses(site).get("converted"))
        originals = set(site.evaluate("""() => [...document.querySelectorAll("[data-klikkikuri-original-title]")]
            .map((element) => element.dataset.klikkikuriOriginalTitle.trim())"""))

        popup = open_popup_for(browser, server)
        popup.click("#devmode-capture-button")
        status = popup.locator("#devmode-capture-status")
        assert wait_until(lambda: status.text_content().strip() not in ("", "Sending…")), status.text_content()
        assert status.text_content().startswith("Done"), status.text_content()

        assert capture.received["page_url"] == f"{server.base}/?seed=5"
        titles = {title for _, title in capture.received["links"]}
        assert originals and originals <= titles, "the converted headlines must be sent as the page showed them"
        assert all(href.startswith("http") for href, _ in capture.received["links"])
        assert not any(title.startswith("XFAIL VIOLATED") for title in titles)
