import json

import pytest
from fastapi.testclient import TestClient

from paatti_devserver.app import create_app
from paatti_devserver.captured import FAKE_PREFIX
from paatti_devserver.signing import Signer

from .conftest import make_settings

COMMIT = "0123456789abcdef0123456789abcdef01234567"
SITES = {
    "www.iltalehti.fi": {"name": "Iltalehti", "origins": ["https://www.iltalehti.fi/*"], "rules": []},
    "hs.fi": {"name": "HS", "origins": ["https://*.hs.fi/*"], "rules": []},
}
PAGE = "https://www.iltalehti.fi/"
FIRST = "/kotimaa/a/7d3c5ba2-66bd-473e-9c0b-fc3ec26abe80"
SECOND = "/urheilu/a/51495a62-a494-4474-a234-ddedae3e112b"
BASE = Signer()


@pytest.fixture
def client(tmp_path):
    """A server whose pinned Rahti sites are in the cache, so that no test reaches the network."""
    cache = tmp_path / ".cache"
    cache.mkdir()
    (cache / f"rahti-{COMMIT}-sites.json").write_text(json.dumps({"schema_version": "0.1.0", "sites": SITES}))
    return TestClient(create_app(make_settings(data_dir=str(tmp_path), rahti_commit=COMMIT)))


def capture(client, *hrefs, page=PAGE):
    return client.post("/api/capture", json={"pageUrl": page, "links": [{"href": h, "title": f"  Title of {h} "}
                                                                          for h in hrefs]})


def entries(client) -> dict[str, dict]:
    data = client.get("/manifest/captured-sites/data.json").json()
    return {entry["urls"][0]["sign"]: entry for entry in data["entries"]}


def test_every_captured_link_gets_a_fake_entry(client):
    response = capture(client, FIRST, SECOND, "javascript:void(0)")
    assert response.status_code == 200
    assert response.json() == {"host": "www.iltalehti.fi", "links": 2, "stored": 2}
    first = entries(client)[BASE.sign(PAGE.rstrip("/") + FIRST)]
    assert first["title"] == f"{FAKE_PREFIX}Title of {FIRST}"
    assert BASE.sign(PAGE.rstrip("/") + SECOND) in entries(client)


def test_a_new_capture_merges_by_address(client):
    capture(client, FIRST)
    response = capture(client, FIRST, SECOND)
    assert response.json()["stored"] == 2 and len(entries(client)) == 2


@pytest.mark.parametrize("page, href", [
    ("http://localhost:3000/?seed=1", "/news/a/0123456789ab"),
    ("https://www.example.com/", "/story/1"),
])
def test_any_host_that_suola_signs_is_accepted(client, page, href):
    assert capture(client, href, page=page).status_code == 200
    assert BASE.sign(page.split("/?")[0].rstrip("/") + href) in entries(client)


def test_a_malformed_page_address_is_refused(client):
    assert capture(client, FIRST, page="not a url").status_code == 422


def test_manifest_declares_the_pinned_sites_and_their_origins(client):
    manifest = client.get("/manifest/captured-sites/manifest.json").json()
    sites, data = manifest["resources"]
    assert sites["href"].endswith(f"/{COMMIT}/sites.json")
    assert sites["origins"] == ["https://*.hs.fi/*", "https://www.iltalehti.fi/*"]
    assert data == {"type": "rahti-data", "href": "data.json", "description": data["description"]}
    assert not any(resource["type"] == "suola-rules" for resource in manifest["resources"])


def test_without_a_commit_the_provider_is_unavailable(tmp_path):
    client = TestClient(create_app(make_settings(data_dir=str(tmp_path))))
    assert client.get("/manifest/captured-sites/manifest.json").status_code == 503
