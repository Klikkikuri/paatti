"""URL signatures, made by the same Suola rules that the extension uses.

The extension signs a link to a host that a provider supplies with the provider's named rule set: the provider's
rules over the base rules. `Suola()` plus `append_rules()` gives the same result while no provider rule names a
domain of the base rules. The Ilta-Pulu rule names `localhost:<port>` and no base rule does. Suola compares a
rule's domain with `host:port`, so the domain carries the port.

The captured-sites rule is a catch-all (`domain: ""`), so that any host can be signed when the base rules have no
catch-all. While the base rules have one, it has the same template, so the order of the two does not change a sign.

`append_rules()` cannot be undone, so each rule set has its own instance. An instance is safe to share between
threads, which FastAPI needs because it runs `def` endpoints in a thread pool.
"""

import json

from suola import InvalidURLError, Suola

ARTICLE_PATTERN = r"^/(?P<Section>[A-Za-z]+)/a/(?P<ArticleID>[0-9a-f]{12})"
ARTICLE_TEMPLATE = "http://localhost/{{ .Section }}/a/{{ .ArticleID }}"

CAPTURE_RULES = {
    "sites": [{
        "domain": "",
        "templates": [{"pattern": r"^(?P<Path>/.*?)/*$", "template": "https://{{ .Host }}{{ .Path }}"}],
        "tests": [
            {"url": "https://unknown.example/news/story",
             "signature": "8a8eda7ebdf27c81416fd9f9c75412f2407c7a588aae37bce0c7073670047876"},
            {"url": "https://UNKNOWN.example/news/story/?utm_source=rss&fbclid=x",
             "signature": "8a8eda7ebdf27c81416fd9f9c75412f2407c7a588aae37bce0c7073670047876"},
        ],
    }]
}


def ilta_pulu_rules(netloc: str, tests: list[dict] | None = None) -> dict:
    """The Suola rules of Ilta-Pulu for a server at `netloc` (`localhost:3000`, or `localhost` on port 80)."""
    return {
        "sites": [{
            "domain": netloc,
            "templates": [{
                "pattern": ARTICLE_PATTERN,
                "template": ARTICLE_TEMPLATE,
                "transform": {"Section": "lowercase"},
            }],
            "tests": tests or [],
        }]
    }


class Signer:
    """One Suola instance with an optional rule set over the base rules."""

    def __init__(self, rules: dict | None = None):
        self._suola = Suola()
        if rules is not None:
            self._suola.append_rules(json.dumps(rules))

    def sign(self, url: str) -> str | None:
        """The signature of `url`, or None when Suola cannot sign it, for example because it has no host."""
        try:
            return self._suola(url)
        except InvalidURLError:
            return None
