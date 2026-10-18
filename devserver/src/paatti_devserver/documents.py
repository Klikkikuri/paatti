"""The provider documents of Ilta-Pulu: manifest.json, sites.json, rules.json and data.json.

The shapes follow Paatti's provider resolver (src/provider.js) and docs/providers.md. The site key is `localhost`:
its origin `http://localhost/*` has no port, so it matches the server on any port. The manifest and sites.json are
on one origin, so the `site-configs` resource declares no `origins`.
"""

from .layout import netloc, site_rules
from .pool import rahti_entry, updated_at

SCHEMA_VERSION = "0.1.0"
CAPTURE_REL = "x-paatti-dev-capture"


def base_url(settings) -> str:
    return f"http://{netloc(settings)}"


def links(settings) -> list[dict]:
    """The manifest links. The capture link has no `title`: the options page shows a titled link of an unknown rel."""
    return [
        {"rel": "privacy-policy", "href": f"{base_url(settings)}/privacy", "title": "Ilta-Pulu privacy notice"},
        {"rel": CAPTURE_REL, "href": f"{base_url(settings)}/api/capture"},
    ]


def manifest(settings) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "name": "Ilta-Pulu (dev server)",
        "updated": updated_at(settings.pool_seed),
        "links": links(settings),
        "resources": [
            {"type": "suola-rules", "href": "rules.json", "description": "Signs Ilta-Pulu article links"},
            {"type": "site-configs", "href": "sites.json"},
            {"type": "rahti-data", "href": "data.json"},
            {"type": "x-paatti-dev", "href": "ignored.json",
             "description": "An unknown resource type, which Paatti must ignore and not fetch"},
        ],
    }


def sites(settings) -> dict:
    rules = [{"description": rule["description"], "container": rule["container"], "link": rule["link"],
              "title": rule["title"]} for _, rule in site_rules(settings.features.blocks)]
    return {
        "schema_version": SCHEMA_VERSION,
        "sites": {
            "localhost": {
                "name": "Ilta-Pulu",
                "description": "The fake news site of the Paatti development server",
                "enabled": True,
                "origins": ["http://localhost/*"],
                "links": [{"rel": "x-publisher-policy", "href": f"{base_url(settings)}/privacy",
                           "title": "Ilta-Pulu publishing policy"}],
                "rules": rules,
            }
        },
    }


def rules_tests(state) -> list[dict]:
    """Suola `tests` for the rules: a few articles in two href variants, and an id of the wrong length."""
    tests = []
    for article in state.pool[:3]:
        url = f"{base_url(state.settings)}{article.path}"
        tests += [
            {"url": url, "signature": state.signs[article.id]},
            {"url": f"{url}/?utm_source=x", "signature": state.signs[article.id]},
        ]
    tests.append({"url": f"{base_url(state.settings)}/news/a/0123", "xfail": True})
    return tests


def data(state) -> dict:
    updated = updated_at(state.settings.pool_seed)
    return {
        "status": "ok",
        "updated": updated,
        "schema_version": SCHEMA_VERSION,
        "entries": [rahti_entry(article, state.signs[article.id], updated)
                    for article in state.pool if article.has_entry],
    }

