"""URL signatures, made by the same Suola rules that the extension uses.

The extension signs a link to a host that a provider supplies with the provider's named rule set: the provider's
rules over the base rules. `Suola()` plus `append_rules()` gives the same result while no provider rule names a
domain of the base rules. The Ilta-Pulu rule names `localhost:<port>` and no base rule does. Suola compares a
rule's domain with `host:port`, so the domain carries the port.

Three workarounds for Suola's Python package, each until its issue is fixed:
- The packaged module is named explicitly. Without it, Suola can load `cwd/../build/wasi.wasm` or a cached copy
  first (Klikkikuri/suola#21).
- A lock serializes each instance, because the runtime is not thread-safe (Klikkikuri/suola#22). FastAPI runs
  `def` endpoints in a thread pool.
- `append_rules()` cannot be undone, so each rule set has its own instance.
"""

import importlib.resources
import json
import threading

from suola import Suola

ARTICLE_PATTERN = r"^/(?P<Section>[A-Za-z]+)/a/(?P<ArticleID>[0-9a-f]{12})"
ARTICLE_TEMPLATE = "http://localhost/{{ .Section }}/a/{{ .ArticleID }}"


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
        self._lock = threading.Lock()
        self._suola = Suola(wasm_module=str(importlib.resources.files("suola") / "suola.wasm"))
        if rules is not None:
            self._suola.append_rules(json.dumps(rules))

    def sign(self, url: str) -> str | None:
        """The signature of `url`, or None when no rule matches it."""
        with self._lock:
            return self._suola(url)
