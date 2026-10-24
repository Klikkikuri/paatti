import hashlib
import json
from urllib.parse import urljoin

import pytest
import yaml
from fastapi.testclient import TestClient

from paatti_devserver import expectations as ex
from paatti_devserver.app import create_app
from paatti_devserver.captured import FAKE_PREFIX, fake_entry
from paatti_devserver.settings import FeatureSettings
from paatti_devserver.signing import BASE_RULES, CAPTURE_RULES, Signer

from .conftest import make_settings

PAGE = "https://www.iltalehti.fi/"
FIRST = "/kotimaa/a/7d3c5ba2-66bd-473e-9c0b-fc3ec26abe80"
SECOND = "/urheilu/a/51495a62-a494-4474-a234-ddedae3e112b"
SITE_RULE = {"container": "div.front div.card a", "link": "self", "title": "div.front-title"}
GENERIC_RULE = {"container": "a[href]", "link": "self", "title": "self"}
SIGNER = Signer(CAPTURE_RULES)
YLE_RULE = {"domain": "yle.fi",
            "templates": [{"pattern": "^/a/(?P<Id>[^/]+)", "template": "https://yle.fi/x/{{ .Id }}"}]}
PARENT_RULE = {"domain": "example.fi",
               "templates": [{"pattern": "^/(?P<Id>[0-9]+)", "template": "https://example.fi/{{ .Id }}"}]}
BAD_RULE = {"domain": "bad.example", "templates": [{"pattern": "(?P<broken", "template": "x"}]}
# The cases that remove a link's entry or its captured title are off, so that each link has its `[dev]` title.
EVERY_LINK_CONVERTED = {"no_entry": False, "paywalled": False, "edge_headlines": False}


@pytest.fixture
def client(tmp_path):
    return TestClient(create_app(make_settings(data_dir=str(tmp_path), features=EVERY_LINK_CONVERTED)))


def capture(client, *hrefs, page=PAGE, rules=(SITE_RULE,)):
    return client.post("/api/capture", json={"pageUrl": page, "rules": list(rules),
                                             "links": [{"href": h, "title": f"  Title of {h} "} for h in hrefs]})


def entries(client) -> dict[str, dict]:
    data = client.get("/manifest/captured-sites/data.json").json()
    return {entry["urls"][0]["sign"]: entry for entry in data["entries"]}


def sites(client) -> dict[str, dict]:
    return client.get("/manifest/captured-sites/sites.json").json()["sites"]


def write_rules(tmp_path, host: str, *rules: dict):
    (tmp_path / "captures" / host / "rules.json").write_text(json.dumps({"sites": list(rules)}))


def sha256(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def test_every_captured_link_gets_a_fake_entry(client):
    response = capture(client, FIRST, SECOND, "javascript:void(0)")
    assert response.status_code == 200
    assert response.json() == {"host": "www.iltalehti.fi", "links": 2, "stored": 2}
    first = entries(client)[SIGNER.sign(PAGE.rstrip("/") + FIRST)]
    assert first["title"] == f"{FAKE_PREFIX}Title of {FIRST}"
    assert SIGNER.sign(PAGE.rstrip("/") + SECOND) in entries(client)


def test_a_capture_makes_a_folder_like_a_rahti_directory(client, tmp_path):
    capture(client, FIRST)
    folder = tmp_path / "captures" / "www.iltalehti.fi"
    assert sorted(path.name for path in folder.iterdir()) == ["data.json", "links.json", "rules.json", "sites.json"]
    assert json.loads((folder / "rules.json").read_text()) == {"sites": []}
    assert json.loads((folder / "data.json").read_text())["entries"] == list(entries(client).values())


def test_a_new_capture_merges_the_links_and_keeps_the_edited_site(client, tmp_path):
    capture(client, FIRST)
    path = tmp_path / "captures" / "www.iltalehti.fi" / "sites.json"
    edited = json.loads(path.read_text())
    edited["sites"]["www.iltalehti.fi"].update(rules=[GENERIC_RULE], enabled=False)
    path.write_text(json.dumps(edited))

    response = capture(client, FIRST, SECOND, rules=[SITE_RULE])
    assert response.json()["stored"] == 2 and len(entries(client)) == 2
    assert sites(client)["www.iltalehti.fi"] == {"name": "www.iltalehti.fi", "origins": ["https://www.iltalehti.fi/*"],
                                                 "rules": [GENERIC_RULE]}, "`enabled` is not served"


LINKS = [{"title": "Story", "captured": "2026-10-19T00:00:00+00:00", "sign": sha256(f"https://example.org/{i}")}
         for i in range(200)]
CASES = [
    # (feature, whether an entry has the feature's case)
    ("levels", lambda entry: entry and ex.LEVELS.index(entry["clickbaitiness"]) < ex.DEFAULT_THRESHOLD),
    ("ai_slop", lambda entry: entry and ex.LABEL_AI_SLOP in entry["labels"]),
    ("video", lambda entry: entry and ex.LABEL_VIDEO in entry["labels"]),
    ("sponsored", lambda entry: entry and ex.LABEL_SPONSORED in entry["labels"]),
    ("paywalled", lambda entry: entry and ex.LABEL_PAYWALLED in entry["labels"] and "title" not in entry),
    ("no_entry", lambda entry: entry is None),
    ("edge_headlines", lambda entry: entry and entry.get("title", FAKE_PREFIX + "Story") != FAKE_PREFIX + "Story"),
]


@pytest.mark.parametrize("feature, has_case", CASES)
def test_a_feature_gives_some_captured_links_its_case_and_off_removes_only_that(feature, has_case):
    on = [fake_entry(link, "example.org", FeatureSettings()) for link in LINKS]
    off = [fake_entry(link, "example.org", FeatureSettings(**{feature: False})) for link in LINKS]
    assert any(has_case(entry) for entry in on)
    assert not any(has_case(entry) for entry in off)
    assert [entry for entry in on if not has_case(entry)] == [b for a, b in zip(on, off) if not has_case(a)]


def test_with_every_case_off_each_link_gets_its_title_above_the_threshold():
    features = FeatureSettings(**{feature: False for feature, _ in CASES})
    for link in LINKS:
        entry = fake_entry(link, "example.org", features)
        assert entry["title"] == FAKE_PREFIX + "Story" and entry["labels"] == []
        assert ex.LEVELS.index(entry["clickbaitiness"]) >= ex.DEFAULT_THRESHOLD


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


@pytest.mark.parametrize("captures, rules, link, expected", [
    # A rule for a domain that the base rules name: the folder's rule wins, as in Paatti's named rule set.
    ([("https://yle.fi/", "/a/74-20012345")], ("yle.fi", YLE_RULE), "https://yle.fi/a/74-20012345/?utm=x",
     "https://yle.fi/x/74-20012345"),
    # A rule in one folder for a parent domain also signs the links of another folder.
    ([("https://www.example.fi/", "/1"), ("https://uutiset.example.fi/", "/2/otsikko")],
     ("www.example.fi", PARENT_RULE), "https://uutiset.example.fi/2/otsikko", "https://example.fi/2"),
])
def test_a_folder_rule_changes_the_signs_at_the_next_refresh(client, tmp_path, captures, rules, link, expected):
    for page, href in captures:
        capture(client, href, page=page, rules=[GENERIC_RULE])
    assert sha256(expected) not in entries(client)
    write_rules(tmp_path, *rules)
    assert sha256(expected) in entries(client)


def test_a_rule_keeps_only_the_fields_that_it_has(client):
    capture(client, FIRST, rules=[{"container": "article", "description": None}])
    assert sites(client)["www.iltalehti.fi"]["rules"] == [{"container": "article"}]


def test_without_captures_the_provider_has_no_sites_and_no_entries(client):
    assert sites(client) == {}
    assert entries(client) == {}


@pytest.mark.parametrize("file, content, problem", [
    ("rules.json", json.dumps({"sites": [BAD_RULE]}), "Suola refuses the rules"),
    ("rules.json", "{", "JSONDecodeError"),
    ("sites.json", json.dumps({"no": "sites"}), "KeyError"),
])
def test_a_bad_folder_leaves_out_only_its_own_host(client, tmp_path, file, content, problem):
    capture(client, FIRST)
    capture(client, "/story", page="https://bad.example/", rules=[GENERIC_RULE])
    (tmp_path / "captures" / "bad.example" / file).write_text(content)

    assert list(sites(client)) == ["www.iltalehti.fi"]
    assert client.get("/manifest/captured-sites/rules.json").json() == CAPTURE_RULES
    assert len(entries(client)) == 1
    assert problem in client.get("/api/captures/bad.example").json()["rules"]


def test_old_capture_files_are_ignored(client, tmp_path):
    (tmp_path / "captures").mkdir()
    (tmp_path / "captures" / "old.example.json").write_text('{"host": "old.example", "links": {}}')
    assert sites(client) == {}


def test_the_folder_data_is_written_only_when_it_changes(client, tmp_path):
    capture(client, "/a/74-20012345", page="https://yle.fi/", rules=[GENERIC_RULE])
    path = tmp_path / "captures" / "yle.fi" / "data.json"
    written = path.stat().st_mtime_ns
    entries(client)
    assert path.stat().st_mtime_ns == written
    write_rules(tmp_path, "yle.fi", YLE_RULE)
    entries(client)
    assert path.stat().st_mtime_ns != written
    assert json.loads(path.read_text())["entries"][0]["urls"][0]["sign"] == sha256("https://yle.fi/x/74-20012345")


def test_the_same_folders_give_the_same_data_and_a_304(client, tmp_path):
    capture(client, FIRST, SECOND)
    first = client.get("/manifest/captured-sites/data.json")
    assert client.get("/manifest/captured-sites/data.json").content == first.content
    assert client.get("/manifest/captured-sites/data.json",
                      headers={"If-None-Match": first.headers["etag"]}).status_code == 304
    write_rules(tmp_path, "www.iltalehti.fi", {"domain": "www.iltalehti.fi", "templates": [
        {"pattern": "^/(?P<Section>[^/]+)/a/(?P<Id>[^/]+)", "template": "https://il.fi/{{ .Id }}"}]})
    assert client.get("/manifest/captured-sites/data.json").headers["etag"] != first.headers["etag"]


YLE_ARTICLE = "https://yle.fi/a/74-20012345"
CHECKS = [
    # (test case in rules.json, result, start of the reason)
    ({"url": YLE_ARTICLE, "expected": "https://yle.fi/x/74-20012345"}, "pass", None),
    ({"url": YLE_ARTICLE, "signature": sha256("https://yle.fi/x/74-20012345")}, "pass", None),
    ({"url": YLE_ARTICLE, "sign": sha256("https://yle.fi/x/74-20012345")}, "pass", None),
    ({"url": "https://yle.fi/uutiset", "xfail": True}, "pass", None),
    ({"url": YLE_ARTICLE, "expected": "https://yle.fi/a/74-20012345"}, "fail", "the URL does not normalize"),
    ({"url": YLE_ARTICLE, "signature": "0" * 64}, "fail", "the sign is"),
    ({"url": YLE_ARTICLE, "xfail": True}, "fail", "a named rule matches"),
]


@pytest.mark.parametrize("case, result, reason", CHECKS)
def test_the_check_runs_the_test_cases_of_the_folder_rules(client, tmp_path, case, result, reason):
    capture(client, "/a/74-20012345", page="https://yle.fi/", rules=[GENERIC_RULE])
    write_rules(tmp_path, "yle.fi", {**YLE_RULE, "tests": [case]})
    report = client.get("/api/captures/yle.fi").json()
    assert report["rules"] == "ok" and report["warnings"] == []
    [test] = report["tests"]
    assert test["result"] == result
    assert (reason is None and test["reasons"] == []) or test["reasons"][0].startswith(reason)


def test_the_check_gives_the_sign_of_each_link_also_without_an_entry(tmp_path):
    client = TestClient(create_app(make_settings(data_dir=str(tmp_path))))
    hrefs = sorted(f"/story/{i}" for i in range(40))
    capture(client, *hrefs, page="https://example.org/", rules=[GENERIC_RULE])
    links = client.get("/api/captures/example.org").json()["links"]
    assert [link["sign"] for link in links] == [SIGNER.sign(f"https://example.org{href}") for href in hrefs]
    assert {link["sign"] for link in links if link["entry"]} == set(entries(client))
    assert not all(link["entry"] for link in links), "no_entry is on by default"


def test_the_check_warns_about_a_domain_without_the_port_and_a_shared_site(client, tmp_path):
    capture(client, "/news/a/0123456789ab", page="http://localhost:3000/", rules=[GENERIC_RULE])
    capture(client, "/story", page="https://other.example/", rules=[GENERIC_RULE])
    write_rules(tmp_path, "localhost", {"domain": "localhost", "templates": YLE_RULE["templates"]})
    path = tmp_path / "captures" / "other.example" / "sites.json"
    path.write_text(path.read_text().replace('"other.example": {', '"localhost": {', 1))

    warnings = client.get("/api/captures/localhost").json()["warnings"]
    assert [warning.split(";")[0] for warning in warnings] == [
        "the rule domain localhost matches no captured link", "the site localhost is also in another folder"]


@pytest.mark.parametrize("host", ["unknown.example", "..", "captures"])
def test_the_check_of_a_host_without_a_folder_is_404(client, host):
    capture(client, FIRST)
    assert client.get(f"/api/captures/{host}").status_code == 404


def test_a_malformed_page_address_is_refused(client):
    assert capture(client, FIRST, page="not a url").status_code == 422


def test_a_page_at_host_dot_dot_is_refused_and_stores_nothing_outside_the_folders(tmp_path):
    client = TestClient(create_app(make_settings(data_dir=str(tmp_path))))
    response = client.post("/api/capture", json={
        "pageUrl": "https://../x", "rules": [SITE_RULE], "links": [{"href": "/once/", "title": "A story"}]})
    assert response.status_code == 422
    assert not (tmp_path / "captures").exists(), "no folder came out of the host .."


@pytest.mark.parametrize("host", ["..", "a..b", "x" * 64])
def test_a_host_that_the_codec_rejects_is_422_with_no_folders(client, tmp_path, host):
    response = capture(client, FIRST, page=f"https://{host}/")
    assert response.status_code == 422
    assert not (tmp_path / "captures").exists() or not list((tmp_path / "captures").iterdir()), \
        "no folder came out of a refused host"


def test_an_idn_page_gets_a_punycode_folder(client, tmp_path):
    response = capture(client, FIRST, page="https://www.ähti.fi/")
    assert response.status_code == 200
    folder = tmp_path / "captures" / "www.xn--hti-pla.fi"
    assert (folder / "links.json").exists()
    site = json.loads((folder / "sites.json").read_text())["sites"]["www.xn--hti-pla.fi"]
    assert site["name"] == "www.xn--hti-pla.fi" and site["origins"] == ["https://www.xn--hti-pla.fi/*"]
    assert entries(client)[SIGNER.sign("https://www.xn--hti-pla.fi" + FIRST)]["title"].startswith(FAKE_PREFIX)
    assert client.get("/api/captures/www.xn--hti-pla.fi").json()["host"] == "www.xn--hti-pla.fi"


def test_a_capture_without_rules_is_refused(client):
    response = client.post("/api/capture", json={"pageUrl": PAGE, "links": []})
    assert response.status_code == 422


def test_manifest_supplies_the_catch_all_rule_and_the_captured_sites(client):
    manifest = client.get("/manifest/captured-sites/manifest.json").json()
    assert [(resource["type"], resource["href"]) for resource in manifest["resources"]] == [
        ("suola-rules", "rules.json"), ("site-configs", "sites.json"), ("rahti-data", "data.json")]
    assert not any("origins" in resource for resource in manifest["resources"])
    assert client.get("/manifest/captured-sites/rules.json").json() == CAPTURE_RULES


BASE_TEST_URLS = [case["url"] for site in yaml.safe_load(BASE_RULES.read_text())["sites"]
                  for case in site.get("tests", [])]


@pytest.mark.parametrize("url", ["https://unknown.example/news/story", *BASE_TEST_URLS])
def test_the_catch_all_over_the_submodule_rules_signs_as_the_wheel_does(url):
    """Fails when the wheel and the submodule do not have the same rules: change both together."""
    assert SIGNER.sign(url) == Signer().sign(url)
