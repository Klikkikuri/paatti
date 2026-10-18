import json

import pytest

from paatti_devserver.chaos import MANIFEST_MAX_BYTES, RESOURCE_MAX_BYTES

DOCUMENTS = ["manifest", "sites", "rules", "data"]


def url(document: str) -> str:
    return f"/manifest/ilta-pulu/{document}.json"


def test_front_page_without_a_seed_redirects_to_one(client_for):
    response = client_for(seed=77).get("/")
    assert response.status_code == 302
    assert response.headers["location"] == "/?seed=77"


def test_front_page_carries_the_reproduce_command(client):
    html = client.get("/?seed=5").text
    assert "paatti-devserver --pool_seed=1" in html and "/?seed=5" in html


def test_article_page_has_its_headline_in_h1_and_takes_any_section_case(client):
    data = client.get(url("data")).json()
    state = client.app.state.devserver
    article = next(a for a in state.pool if a.case == "base")
    for path in (article.path, f"/{article.section.upper()}/a/{article.id}"):
        response = client.get(path)
        assert response.status_code == 200
        assert f"<h1>{article.original}</h1>" in response.text.replace("&#39;", "'")
    assert client.get("/news/a/000000000000").status_code == 404
    assert data["entries"]


@pytest.mark.parametrize("kind", ["more", "churn", "ticker"])
def test_fragments_are_deterministic(client, kind):
    first = client.get(f"/api/fragment?seed=3&kind={kind}&n=2").text
    assert first and first == client.get(f"/api/fragment?seed=3&kind={kind}&n=2").text


def test_manifest_matches_the_provider_format(client):
    manifest = client.get(url("manifest")).json()
    assert manifest["schema_version"] == "0.1.0"
    capture = next(link for link in manifest["links"] if link["rel"] == "x-paatti-dev-capture")
    assert "title" not in capture and capture["href"].startswith("http://localhost:3000/")
    by_type = {resource["type"]: resource for resource in manifest["resources"]}
    assert "origins" not in by_type["site-configs"]
    assert "x-paatti-dev" in by_type


def test_sites_document_names_only_localhost(client):
    sites = client.get(url("sites")).json()["sites"]
    assert list(sites) == ["localhost"]
    assert sites["localhost"]["origins"] == ["http://localhost/*"]


def test_rules_carry_the_port_in_the_domain(client):
    rules = client.get(url("rules")).json()
    assert rules["sites"][0]["domain"] == "localhost:3000"


def test_the_ignored_resource_is_never_served(client):
    assert client.get("/manifest/ilta-pulu/ignored.json").status_code == 410


def test_conditional_get_returns_304_for_the_same_etag(client):
    first = client.get(url("data"))
    etag = first.headers["etag"]
    assert client.get(url("data"), headers={"If-None-Match": etag}).status_code == 304
    changed = client.get(url("data"), headers={"If-None-Match": '"other"',
                                               "If-Modified-Since": first.headers["last-modified"]})
    assert changed.status_code == 200, "If-Modified-Since must be ignored when If-None-Match is present"


FAULTS = [
    # (chaos settings, document, expected status, check of the body)
    ({"provider_404": "data"}, "data", 404, None),
    ({"provider_5xx": "data"}, "data", 503, None),
    ({"provider_429": "manifest"}, "manifest", 429, None),
    ({"provider_redirect": "sites"}, "sites", 302, None),
    ({"malformed_json": "data"}, "data", 200, lambda body: pytest.raises(json.JSONDecodeError, json.loads, body)),
    ({"oversize": "data"}, "data", 200, lambda body: len(body) > RESOURCE_MAX_BYTES),
    ({"oversize": "manifest"}, "manifest", 200, lambda body: len(body) > MANIFEST_MAX_BYTES),
    ({"schema_mismatch": "manifest"}, "manifest", 200, lambda body: json.loads(body)["schema_version"] == "0.2.0"),
    ({"schema_mismatch": "data"}, "data", 200, lambda body: json.loads(body)["schema_version"] == "1.0.0"),
    ({"rejected_sites": True}, "sites", 200, lambda body: "__proto__" in json.loads(body)["sites"]),
    ({"bad_rules": True}, "rules", 200, lambda body: "(?P<broken" in body.decode()),
]


@pytest.mark.parametrize("chaos, document, status, check", FAULTS)
def test_each_provider_fault(client_for, chaos, document, status, check):
    response = client_for(chaos=chaos).get(url(document))
    assert response.status_code == status
    assert response.headers["x-devserver-chaos"].startswith(next(iter(chaos)))
    if check:
        assert check(response.content) is not False
    other = next(d for d in DOCUMENTS if d != document)
    assert "x-devserver-chaos" not in client_for(chaos=chaos).get(url(other)).headers


def test_no_conditional_never_answers_304(client_for):
    client = client_for(chaos={"no_conditional": "data"})
    etag = client.get(url("data")).headers["etag"]
    assert client.get(url("data"), headers={"If-None-Match": etag}).status_code == 200


def test_faults_repeat_for_the_same_seed_and_request_order(client_for):
    def run():
        client = client_for(chaos={"provider_5xx": "data", "rate": 0.5, "seed": 3})
        return [(r.status_code, r.headers.get("x-devserver-chaos")) for r in (client.get(url("data")) for _ in range(12))]

    first = run()
    assert first == run()
    assert {status for status, _ in first} == {200, 503}, "rate 0.5 must give both outcomes in 12 requests"
