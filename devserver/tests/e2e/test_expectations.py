"""Each annotated block on Ilta-Pulu gets the status that its data-expect-status names."""

from .conftest import LiveServer, wait_for_mismatches


def describe(found) -> str:
    return "\n".join(f"  {item.get('block')}: expected {item.get('expected')}, got {item.get('actual')}"
                     f" · {item.get('path')} · {item.get('entry')} · {item.get('noise')} · {item.get('source')}"
                     for item in found or [])


def test_every_block_meets_its_expectation(browser, seeds):
    with LiveServer() as server:
        manifest_url = f"{server.base}/manifest/ilta-pulu/manifest.json"
        setup = browser.add_provider(manifest_url)
        assert setup["environment"] == "development"
        assert setup["data"]["errors"] == [] and setup["data"]["rejected"] == [], setup["data"]

        page = browser.context.new_page()
        for seed in seeds:
            page.goto(f"{server.base}/?seed={seed}&check=1")
            found = wait_for_mismatches(page)
            assert found == [], (f"seed {seed}: {len(found or [])} mismatch(es)\n{describe(found)}\n"
                                 f"Reproduce: {server.settings.reproduce_command(seed=seed)}")
