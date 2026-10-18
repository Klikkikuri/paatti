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
REAL = "/kotimaa/a/7d3c5ba2-66bd-473e-9c0b-fc3ec26abe80"
MISSING = "/urheilu/a/51495a62-a494-4474-a234-ddedae3e112b"
BASE = Signer()


@pytest.fixture
def server(tmp_path):
    """A server whose pinned Rahti sites are in the cache, and whose Rahti data holds only REAL."""
    cache = tmp_path / ".cache"
    cache.mkdir()
    (cache / f"rahti-{COMMIT}-sites.json").write_text(json.dumps({"schema_version": "0.1.0", "sites": SITES}))
    app = create_app(make_settings(data_dir=str(tmp_path), rahti_commit=COMMIT))
    real_signs = {BASE.sign(PAGE.rstrip("/") + REAL)}
    app.state.captured.fetch_real_signs = lambda: real_signs
    return TestClient(app), real_signs


def capture(client, *hrefs, page=PAGE):
    return client.post("/api/capture", json={"pageUrl": page, "links": [{"href": h, "title": f"  Title of {h} "}
                                                                          for h in hrefs]})


def fake_signs(client) -> set[str]:
    return {entry["urls"][0]["sign"] for entry in client.get("/manifest/captured-sites/data.json").json()["entries"]}


def test_only_links_without_real_data_get_fake_entries(server):
    client, _ = server
    response = capture(client, REAL, MISSING, "https://www.example.com/news/a/1")
    assert response.status_code == 200
    assert response.json() == {"host": "www.iltalehti.fi", "links": 2, "real": 1, "fake": 1, "stored": 1}
    data = client.get("/manifest/captured-sites/data.json").json()
    [entry] = data["entries"]
    assert entry["urls"][0]["sign"] == BASE.sign(PAGE.rstrip("/") + MISSING)
    assert entry["title"] == f"{FAKE_PREFIX}Title of {MISSING}"


def test_a_new_capture_drops_links_that_rahti_has_added(server):
    client, real_signs = server
    capture(client, MISSING)
    assert fake_signs(client)
    real_signs.add(BASE.sign(PAGE.rstrip("/") + MISSING))
    capture(client, REAL)
    assert fake_signs(client) == set()


def test_subdomain_origins_cover_their_hosts(server):
    client, _ = server
    response = capture(client, "/kaupunki/art-2000011234567.html", page="https://www.hs.fi/")
    assert response.status_code == 200 and response.json()["fake"] == 1


@pytest.mark.parametrize("page, status", [
    ("https://www.example.com/", 422),
    ("not a url", 422),
])
def test_refused_captures(server, page, status):
    client, _ = server
    assert capture(client, MISSING, page=page).status_code == status


def test_a_failed_rahti_fetch_writes_nothing(server, tmp_path):
    client, _ = server

    def unreachable():
        raise OSError("network down")

    client.app.state.captured.fetch_real_signs = unreachable
    assert capture(client, MISSING).status_code == 502
    assert not (tmp_path / "captures").exists()


def test_manifest_declares_the_pinned_sites_and_their_origins(server):
    client, _ = server
    manifest = client.get("/manifest/captured-sites/manifest.json").json()
    sites, data = manifest["resources"]
    assert sites["href"].endswith(f"/{COMMIT}/sites.json")
    assert sites["origins"] == ["https://*.hs.fi/*", "https://www.iltalehti.fi/*"]
    assert data == {"type": "rahti-data", "href": "data.json", "description": data["description"]}
    assert not any(resource["type"] == "suola-rules" for resource in manifest["resources"])


def test_without_a_commit_the_provider_is_unavailable(tmp_path):
    client = TestClient(create_app(make_settings(data_dir=str(tmp_path))))
    assert client.get("/manifest/captured-sites/manifest.json").status_code == 503
