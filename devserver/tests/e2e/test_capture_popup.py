"""The popup's "Send page" button: what it sends, and the update and conversion that follow.

On a supported site, the server's capture step is recorded here, not run; tests/test_captured.py covers it. On a site
that Paatti does not support, the real server runs, because the site that it adds is what the test checks.
"""

import json

from .conftest import LiveServer, statuses, wait_until

LEAD_RULE = {"container": "article.lead", "link": ":scope > a", "title": "h2 span:last-child"}


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


def reload_until_processed(page, attempts: int = 3):
    """Reload until the content script processes the page. After a site change, the worker registers the content
    script again (updateDynamicContentScripts in src/background.js), and a page that loads in between gets none."""
    for _ in range(attempts):
        page.reload()
        if wait_until(lambda: statuses(page), timeout_s=5):
            return


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


def test_edits_in_the_host_folder_apply_at_the_next_database_update(browser, tmp_path):
    """The workflow of docs/development/adding-a-new-site.md: capture, edit the selectors and the Suola rule, update."""
    with LiveServer(data_dir=str(tmp_path)) as server:
        browser.add_provider(server.manifest_url)
        browser.add_provider(server.captured_manifest_url)
        base = f"http://127.0.0.1:{server.port}"
        site = browser.context.new_page()
        site.goto(f"{base}/?seed=5")
        assert send_page(browser, base).startswith("Done")
        assert wait_until(lambda: statuses(site).get("converted")), "the popup must turn the site on first"

        folder = tmp_path / "captures" / "127.0.0.1"
        sites = json.loads((folder / "sites.json").read_text())
        sites["sites"]["127.0.0.1"]["rules"] = [LEAD_RULE]
        (folder / "sites.json").write_text(json.dumps(sites))
        (folder / "rules.json").write_text(json.dumps({"sites": [{"domain": f"127.0.0.1:{server.port}", "templates": [
            {"pattern": r"^/[A-Za-z]+/a/(?P<Id>[0-9a-f]{12})", "template": "https://dev.example/{{ .Id }}"}]}]}))
        browser.refresh()
        reload_until_processed(site)

        assert statuses(site).get("converted"), statuses(site)
        converted = site.locator("[data-klikkikuri-converted-title^='[dev] ']")
        assert converted.count() > 0, "the links must be signed with the folder's Suola rule, as the server signed them"
        processed = site.locator("[data-klikkikuri-status]")
        assert processed.evaluate_all("(elements) => elements.every((element) => element.closest('article.lead'))"), \
            "only the edited rule applies"
