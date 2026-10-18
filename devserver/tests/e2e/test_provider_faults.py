"""Each provider fault, after one clean refresh, gives the provider state that the fault table names."""

import pytest

from .conftest import LiveServer, statuses, wait_until

FULL = 185  # The entries of the default pool; test_pool.py covers the pool itself.

CASES = [
    # (faults, check of the provider data after the failing refresh)
    pytest.param({"provider_5xx": ["data"]},
                 lambda d, before: d["entryCount"] == FULL and d["updated"] == before["updated"]
                 and any(e.get("transient") for e in d["errors"]), id="5xx: transient, cached copy kept"),
    pytest.param({"provider_429": ["data"]},
                 lambda d, before: d["entryCount"] == FULL and any(e.get("retryAfterMs") == 5000 for e in d["errors"]),
                 id="429: transient with Retry-After"),
    pytest.param({"provider_redirect": ["data"]},
                 lambda d, before: d["entryCount"] == FULL and any(e.get("transient") for e in d["errors"]),
                 id="redirect: refused, cached copy kept"),
    pytest.param({"provider_404": ["data"]},
                 lambda d, before: d["entryCount"] == 0 and any(e.get("message") == "HTTP 404" for e in d["errors"]),
                 id="404: permanent, nothing merged"),
    pytest.param({"malformed_json": ["data"]},
                 lambda d, before: d["entryCount"] == 0 and d["errors"], id="malformed JSON"),
    pytest.param({"oversize": ["data"]},
                 lambda d, before: d["entryCount"] == 0 and d["errors"], id="oversize"),
    pytest.param({"schema_mismatch": ["data"]},
                 lambda d, before: d["entryCount"] == 0 and any("not compatible" in e["message"] for e in d["errors"]),
                 id="data schema 1.0.0"),
    pytest.param({"schema_mismatch": ["manifest"]},
                 lambda d, before: d["updated"] == before["updated"]
                 and any("schema_version" in e["message"] for e in d["errors"]), id="manifest schema 0.2.0"),
    pytest.param({"rejected_sites": True},
                 lambda d, before: len(d["rejected"]) == 4 and "localhost" in d["sites"], id="rejected sites"),
    pytest.param({"provider_timeout": ["data"], "provider_latency_ms": 11_000},
                 lambda d, before: d["entryCount"] == FULL and any(e.get("transient") for e in d["errors"]),
                 id="timeout: transient, cached copy kept"),
]


@pytest.mark.parametrize("faults, check", CASES)
def test_provider_fault(browser, faults, check):
    with LiveServer() as server:
        browser.add_provider(server.manifest_url)
        before = browser.provider_data(server.manifest_url)
        assert before["errors"] == [] and before["entryCount"] == FULL

        server.set_chaos(**faults)
        browser.refresh()
        after = browser.provider_data(server.manifest_url)
        assert check(after, before), after


def test_refused_rules_leave_every_link_unconverted(browser):
    with LiveServer(chaos={"bad_rules": True}) as server:
        browser.add_provider(server.manifest_url)
        assert browser.provider_data(server.manifest_url)["hasRules"]
        page = browser.context.new_page()
        page.goto(f"{server.base}/?seed=3")
        counts = wait_until(lambda: statuses(page).get("skipped") and statuses(page))
        assert counts and set(counts) == {"skipped"}, counts
