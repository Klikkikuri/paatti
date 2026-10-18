"""The server's settings: command line and `PAATTI_DEVSERVER_*` environment variables only.

The same settings must give the same pages and the same faults, so no other source is read. Niitti's `Settings` also
reads `.env`, several `config.yaml` paths and `/run/secrets` (Klikkikuri/Niitti#5); `settings_customise_sources`
drops them. Niitti still loads a `.env` into `os.environ`, but with the prefix only `PAATTI_DEVSERVER_*` keys in it
reach the server.
"""

import shlex
from pathlib import Path
from typing import Annotated, Literal

from niitti.settings import Settings as NiittiSettings
from pydantic import BaseModel, Field, field_validator
from pydantic_settings import NoDecode, SettingsConfigDict

Document = Literal["manifest", "sites", "rules", "data"]
Documents = Annotated[frozenset[Document], NoDecode]

BLOCKS = (
    "lead", "card", "story", "teaser", "most_read", "ticker", "briefs", "related", "infographic", "promo", "sidebar",
)


def _split(value):
    """A comma-separated string, or a list of them, as one list. `NoDecode` keeps the environment value a string."""
    if isinstance(value, str):
        value = [value]
    if isinstance(value, (list, tuple, set, frozenset)):
        return [part.strip() for item in value for part in str(item).split(",") if part.strip()]
    return value


class FeatureSettings(BaseModel):
    """The content cases of Ilta-Pulu. Each one is on by default; turning one off removes only its case."""

    blocks: Annotated[frozenset[Literal[BLOCKS]], NoDecode] = frozenset(BLOCKS)
    levels: bool = True
    ai_slop: bool = True
    video: bool = True
    sponsored: bool = True
    paywalled: bool = True
    no_entry: bool = True
    missing_href: bool = True
    duplicate_link: bool = True
    edge_headlines: bool = True
    href_variants: bool = True
    load_more: bool = True
    ticker: bool = True
    xfail: bool = True
    annotations: bool = True

    _split_blocks = field_validator("blocks", mode="before")(_split)


class ChaosSettings(BaseModel):
    """Fault injection. Every fault is off by default.

    A provider fault names the documents that it applies to. Whether it fires on one request is decided by
    `seed`, `rate` and the number of the request to that document; see `chaos.py`.
    """

    seed: int = 0
    rate: float = Field(1.0, ge=0.0, le=1.0)

    provider_timeout: Documents = frozenset()
    provider_latency_ms: int = Field(12_000, ge=0)
    provider_5xx: Documents = frozenset()
    provider_429: Documents = frozenset()
    provider_404: Documents = frozenset()
    provider_redirect: Documents = frozenset()
    malformed_json: Documents = frozenset()
    oversize: Documents = frozenset()
    schema_mismatch: Documents = frozenset()
    no_conditional: Documents = frozenset()
    rejected_sites: bool = False
    bad_rules: bool = False

    page_hostile_css: bool = False
    page_dom_churn: bool = False
    page_late_content: bool = False

    _split_documents = field_validator(
        "provider_timeout", "provider_5xx", "provider_429", "provider_404", "provider_redirect", "malformed_json",
        "oversize", "schema_mismatch", "no_conditional", mode="before",
    )(_split)


class Settings(NiittiSettings):
    """The server's settings. See `README.md` for each one."""

    model_config = SettingsConfigDict(
        env_prefix="PAATTI_DEVSERVER_",
        env_nested_delimiter="__",
        cli_prog_name="paatti-devserver",
        cli_kebab_case=False,
        extra="ignore",
        # Niitti's file sources, which settings_customise_sources drops.
        env_file=None,
        secrets_dir=None,
        yaml_file_encoding=None,
    )

    host: str = "127.0.0.1"
    port: int = 3000
    seed: int | None = Field(None, description="The page seed. Without it, `/` redirects to a random one.")
    pool_seed: int = Field(1, description="The seed of the article pool and of data.json.")
    rahti_commit: str | None = Field(None, description="The Rahti commit of the captured-sites manifest.")
    data_dir: Path = Path("test_data")
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    features: FeatureSettings = FeatureSettings()
    chaos: ChaosSettings = ChaosSettings()

    @classmethod
    def settings_customise_sources(cls, settings_cls, init_settings, env_settings, dotenv_settings,
                                   file_secret_settings):
        return init_settings, env_settings

    def reproduce_command(self, **page) -> str:
        """The command that starts a server with these settings, and the page arguments, as one shell line."""
        args = ["paatti-devserver", f"--pool_seed={self.pool_seed}"]
        for name, default in (("features", FeatureSettings()), ("chaos", ChaosSettings())):
            current = getattr(self, name)
            for field in type(current).model_fields:
                value = getattr(current, field)
                if value == getattr(default, field):
                    continue
                shown = ",".join(sorted(value)) if isinstance(value, frozenset) else str(value).lower() \
                    if isinstance(value, bool) else str(value)
                args.append(f"--{name}.{field}={shown}")
        line = shlex.join(args)
        query = "&".join(f"{key}={value}" for key, value in page.items())
        return f"{line}  # then open /?{query}" if query else line
