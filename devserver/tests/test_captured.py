from urllib.parse import urljoin

import pytest
from fastapi.testclient import TestClient

from paatti_devserver.app import create_app
from paatti_devserver.captured import FAKE_PREFIX
from paatti_devserver.signing import CAPTURE_RULES, Signer

from .conftest import make_settings

PAGE = "https://www.iltalehti.fi/"
FIRST = "/kotimaa/a/7d3c5ba2-66bd-473e-9c0b-fc3ec26abe80"
SECOND = "/urheilu/a/51495a62-a494-4474-a234-ddedae3e112b"
SITE_RULE = {"container": "div.front div.card a", "link": "self", "title": "div.front-title"}
GENERIC_RULE = {"container": "a[href]", "link": "self", "title": "self"}
SIGNER = Signer(CAPTURE_RULES)


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(make_settings(data_dir=str(tmp_path))))


def capture(client, *hrefs, page=PAGE, rules=(SITE_RULE,)):
    return client.post("/api/capture", json={"pageUrl": page, "rules": list(rules),
                                             "links": [{"href": h, "title": f"  Title of {h} "} for h in hrefs]})


def entries(client) -> dict[str, dict]:
    data = client.get("/manifest/captured-sites/data.json").json()
    return {entry["urls"][0]["sign"]: entry for entry in data["entries"]}


def sites(client) -> dict[str, dict]:
    return client.get("/manifest/captured-sites/sites.json").json()["sites"]


def test_every_captured_link_gets_a_fake_entry(client):
    response = capture(client, FIRST, SECOND, "javascript:void(0)")
    assert response.status_code == 200
    assert response.json() == {"host": "www.iltalehti.fi", "links": 2, "stored": 2}
    first = entries(client)[SIGNER.sign(PAGE.rstrip("/") + FIRST)]
    assert first["title"] == f"{FAKE_PREFIX}Title of {FIRST}"
    assert SIGNER.sign(PAGE.rstrip("/") + SECOND) in entries(client)


def test_a_new_capture_merges_the_links_and_replaces_the_rules(client):
    capture(client, FIRST)
    response = capture(client, FIRST, SECOND, rules=[GENERIC_RULE])
    assert response.json()["stored"] == 2 and len(entries(client)) == 2
    assert sites(client)["www.iltalehti.fi"]["rules"] == [GENERIC_RULE]


@pytest.mark.parametrize("page, href, key, origin", [
    ("https://www.iltalehti.fi/", FIRST, "www.iltalehti.fi", "https://www.iltalehti.fi/*"),
    ("https://example.org/news/", "story/1", "example.org", "https://example.org/*"),
    ("http://plain.example/", "/story/1", "plain.example", "http://plain.example/*"),
    ("http://localhost:3000/?seed=1", "/news/a/0123456789ab", "localhost", "http://localhost/*"),
])
def test_any_captured_host_becomes_a_site_with_the_sent_rules(client, page, href, key, origin):
    assert capture(client, href, page=page, rules=[GENERIC_RULE]).status_code == 200
    assert sites(client) == {key: {"name": key, "origins": [origin], "rules": [GENERIC_RULE]}}
    assert SIGNER.sign(urljoin(page, href)) in entries(client)


def test_a_rule_keeps_only_the_fields_that_it_has(client):
    capture(client, FIRST, rules=[{"container": "article", "description": None}])
    assert sites(client)["www.iltalehti.fi"]["rules"] == [{"container": "article"}]


def test_without_captures_the_provider_has_no_sites_and_no_entries(client):
    assert sites(client) == {}
    assert entries(client) == {}


def test_a_capture_file_without_rules_gives_no_site(client, tmp_path):
    capture(client, FIRST)
    (tmp_path / "captures" / "old.example.json").write_text('{"host": "old.example", "links": {}}')
    assert list(sites(client)) == ["www.iltalehti.fi"]


def test_a_malformed_page_address_is_refused(client):
    assert capture(client, FIRST, page="not a url").status_code == 422


def test_a_capture_without_rules_is_refused(client):
    response = client.post("/api/capture", json={"pageUrl": PAGE, "links": []})
    assert response.status_code == 422


def test_manifest_supplies_the_catch_all_rule_and_the_captured_sites(client):
    manifest = client.get("/manifest/captured-sites/manifest.json").json()
    assert [(resource["type"], resource["href"]) for resource in manifest["resources"]] == [
        ("suola-rules", "rules.json"), ("site-configs", "sites.json"), ("rahti-data", "data.json")]
    assert not any("origins" in resource for resource in manifest["resources"])
    assert client.get("/manifest/captured-sites/rules.json").json() == CAPTURE_RULES


@pytest.mark.parametrize("url", ["https://unknown.example/news/story", "https://www.iltalehti.fi" + FIRST])
def test_the_catch_all_rule_signs_as_the_base_rules_do(url):
    assert SIGNER.sign(url) == Signer().sign(url)
