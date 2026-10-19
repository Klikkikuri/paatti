"""The popup's "Send page" button: what it sends, and the update and conversion that follow.

On a supported site, the server's capture step is recorded here, not run; tests/test_captured.py covers it. On a site
that Paatti does not support, the real server runs, because the site that it adds is what the test checks.
"""

from .conftest import LiveServer, statuses, wait_until


def send_page(browser, base: str) -> str:
    """Click "Send page" in a popup whose active tab is the page at `base`. Returns the status text."""
    popup = browser.context.new_page()
    popup.goto(f"chrome-extension://{browser.extension_id}/src/options/popup.html")
    popup.evaluate("""async (base) => {
        const [tab] = await chrome.tabs.query({ url: `${base}/*` });
        await chrome.tabs.update(tab.id, { active: true });
    }""", base)
    popup.reload()
    popup.click("label[for=navi-settings]")
    popup.click("#devmode-capture-button")
    status = popup.locator("#devmode-capture-status")
    assert wait_until(lambda: status.text_content().strip() not in ("", "Sending…")), status.text_content()
    return status.text_content()


def test_send_page_posts_the_site_rules_and_the_original_headlines(browser):
    with LiveServer() as server:
        received = {}

        def record(page_url, rules, links):
            received.update(page_url=page_url, rules=rules, links=links)
            return {"host": "localhost", "links": len(links), "stored": len(links)}

        server.app.state.captured.capture = record
        browser.add_provider(server.manifest_url)
        site = browser.context.new_page()
        site.goto(f"{server.base}/?seed=5")
        assert wait_until(lambda: statuses(site).get("converted"))
        originals = set(site.evaluate("""() => [...document.querySelectorAll("[data-klikkikuri-original-title]")]
            .map((element) => element.dataset.klikkikuriOriginalTitle.trim())"""))

        assert send_page(browser, server.base).startswith("Done")

        assert received["page_url"] == f"{server.base}/?seed=5"
        assert received["rules"] and all({"container", "link", "title"} <= set(rule) for rule in received["rules"])
        titles = {title for _, title in received["links"]}
        assert originals and originals <= titles, "the converted headlines must be sent as the page showed them"
        assert all(href.startswith("http") for href, _ in received["links"])
        assert not any(title.startswith("XFAIL VIOLATED") for title in titles)


def test_send_page_on_an_unsupported_site_adds_the_site_and_converts_the_page(browser, tmp_path):
    with LiveServer(data_dir=str(tmp_path)) as server:
        browser.add_provider(server.manifest_url)
        browser.add_provider(server.captured_manifest_url)
        base = f"http://127.0.0.1:{server.port}"
        site = browser.context.new_page()
        site.goto(f"{base}/?seed=5")
        assert not statuses(site), "Paatti must not run on a site that no provider supplies"

        assert send_page(browser, base).startswith("Done")

        captured = server.app.state.captured.sites()["sites"]
        assert list(captured) == ["127.0.0.1"]
        assert captured["127.0.0.1"]["origins"] == ["http://127.0.0.1/*"]
        assert wait_until(lambda: statuses(site).get("converted")), statuses(site)
        assert site.locator("[data-klikkikuri-converted-title^='[dev] ']").count() > 0


def test_send_page_on_a_site_that_is_off_sends_the_site_rules(browser):
    with LiveServer() as server:
        received = {}

        def record(page_url, rules, links):
            received.update(rules=rules, links=links)
            return {"host": "localhost", "links": len(links), "stored": len(links)}

        server.app.state.captured.capture = record
        browser.add_provider(server.manifest_url)
        browser.run("""async () => {
            const { controller } = await import("/src/controller.js");
            await controller.setSiteEnabled(false, "localhost");
        }""")
        site = browser.context.new_page()
        site.goto(f"{server.base}/?seed=5")
        assert not statuses(site), "Paatti must not run on a site that is off"

        assert send_page(browser, server.base).startswith("Done")

        site_rules = browser.run("""async () => {
            const { getConfig } = await import("/src/config.js");
            return (await getConfig()).siteConfigs.localhost.rules;
        }""")
        assert received["rules"] == site_rules
        assert received["links"]
        assert wait_until(lambda: statuses(site).get("converted")), statuses(site)
