"""URL signatures, made by the same Suola rules that the extension uses.

The extension signs a link to a host that a provider supplies with the provider's named rule set: the provider's
rules before the base rules, so that a provider rule wins against a base rule with the same domain and weight
(`defineRules` in suola/docs/api.md). `append_rules()` puts the rules after the base rules, so `Signer` builds the
same sequence from the submodule's `rules.yaml` instead. The wheel and the submodule have the same tag
(pyproject.toml), so the two copies of the base rules are the same. Suola compares a rule's domain with
`host:port`, so the Ilta-Pulu domain carries the port.

The captured-sites rule is a catch-all (`domain: ""`), so that any host can be signed when the base rules have no
catch-all. While the base rules have one, it has the same template, so the order of the two does not change a sign.

An instance is safe to share between threads, which FastAPI needs because it runs `def` endpoints in a thread pool.
"""

import functools
import json
import tempfile
from pathlib import Path

import yaml
from suola import InvalidURLError, Suola

BASE_RULES = Path(__file__).resolve().parents[3] / "suola" / "rules.yaml"

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


@functools.cache
def base_sites() -> list[dict]:
    """The sites of the base rules, without the test cases, which Suola does not use."""
    sites = yaml.safe_load(BASE_RULES.read_text())["sites"]
    return [{key: value for key, value in site.items() if key != "tests"} for site in sites]


class Signer:
    """One Suola instance: the base rules, or a rule set before the base rules, or a rule set alone.

    Raises `suola.InvalidRulesError` when Suola refuses the rule set.
    """

    def __init__(self, rules: dict | None = None, over_base: bool = True):
        if rules is None:
            self._suola = Suola()
            return
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rules.json"
            path.write_text(json.dumps({"sites": rules["sites"] + (base_sites() if over_base else [])}))
            self._suola = Suola(custom_rules=path)

    def sign(self, url: str) -> str | None:
        """The signature of `url`, or None when Suola cannot sign it, for example because it has no host."""
        try:
            return self._suola(url)
        except InvalidURLError:
            return None
