"""The server's settings: command line and `PAATTI_DEVSERVER_*` environment variables only.

The same settings must give the same pages and the same faults, so no other source is read. Niitti's `Settings` also
reads `.env`, several `config.yaml` paths and `/run/secrets` (Klikkikuri/Niitti#5); `settings_customise_sources`
drops them. Niitti still loads a `.env` into `os.environ`, but with the prefix only `PAATTI_DEVSERVER_*` keys in it
reach the server.
"""

import json
import shlex
import sys
from pathlib import Path
from typing import Annotated, Literal

from niitti.settings import Settings as NiittiSettings
from pydantic import BaseModel, Field, field_validator
from pydantic_settings import EnvSettingsSource, NoDecode, SettingsConfigDict

Document = Literal["manifest", "sites", "rules", "data"]
Documents = Annotated[frozenset[Document], NoDecode]
ALL_DOCUMENTS = frozenset(Document.__args__)

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


def _differences(current: BaseModel, default: BaseModel) -> list[tuple[str, object]]:
    return [(field, value) for field, value in current if value != getattr(default, field)]


def _profiles() -> dict[str, dict]:
    """The named values of `--chaos`. A provider fault in a profile applies to all documents."""
    fields = ChaosSettings.model_fields
    documents = sorted(ALL_DOCUMENTS)
    provider = {name: documents for name, info in fields.items() if info.annotation == frozenset[Document]}
    switches = {name: True for name, info in fields.items() if info.annotation is bool}
    return {
        "none": {},
        "false": {},
        "true": {**provider, **switches, "page_hostile_css": False, "rate": 0.03},
        "all": {**provider, **switches, "rate": 0.1},
    }


CHAOS_PROFILES = _profiles()


class _ProfileEnvSource(EnvSettingsSource):
    """Reads `PAATTI_DEVSERVER_CHAOS=<profile>` as the profile's object."""

    def decode_complex_value(self, field_name, field, value):
        if field_name == "chaos" and value in CHAOS_PROFILES:
            return dict(CHAOS_PROFILES[value])
        return super().decode_complex_value(field_name, field, value)


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
    chaos: ChaosSettings = Field(ChaosSettings(), description=(
        "A profile: none, true (a little of each fault) or all; or a JSON object. --chaos.<fault> overrides one."))

    @classmethod
    def settings_customise_sources(cls, settings_cls, init_settings, env_settings, dotenv_settings,
                                   file_secret_settings):
        return init_settings, _ProfileEnvSource(settings_cls)

    @classmethod
    def from_command_line(cls, args: list[str] | None = None) -> "Settings":
        """The settings from `args` (default: `sys.argv`) and the environment, with a `--chaos` profile expanded.

        `--chaos` without a value is `--chaos=true`.
        """
        def expand(value: str) -> str:
            return json.dumps(CHAOS_PROFILES[value]) if value in CHAOS_PROFILES else value

        args = list(sys.argv[1:] if args is None else args)
        for i, arg in enumerate(args):
            if arg.startswith("--chaos="):
                args[i] = "--chaos=" + expand(arg.removeprefix("--chaos="))
            elif arg == "--chaos" and (i + 1 == len(args) or args[i + 1].startswith("-")):
                args[i] = "--chaos=" + expand("true")
            elif arg == "--chaos":
                args[i + 1] = expand(args[i + 1])
        return cls(_cli_parse_args=args)

    def startup_summary(self) -> str:
        """The settings that decide the pages and the faults, and the command that repeats them."""
        chaos, features = self.chaos, self.features
        faults = {name: value for name, value in chaos if name not in ("seed", "rate", "provider_latency_ms")}
        on = [name if value in (True, ALL_DOCUMENTS) else f"{name}={','.join(sorted(value))}"
              for name, value in faults.items() if value]
        off = [name for name, value in faults.items() if not value]
        features_off = [name for name, value in features if value is False]
        features_off += [f"block {block}" for block in BLOCKS if block not in features.blocks]
        page = {"seed": self.seed} if self.seed is not None else {}
        return "\n".join([
            f"Ilta-Pulu at http://{self.host}:{self.port}/",
            f"  page seed:     {self.seed if self.seed is not None else 'random for each visit to /'}",
            f"  pool seed:     {self.pool_seed}",
            f"  rahti commit:  {self.rahti_commit or '(none: no captured-sites provider)'}",
            f"  features off:  {', '.join(features_off) or '(none)'}",
            f"  chaos:         seed {chaos.seed}, rate {chaos.rate}, latency {chaos.provider_latency_ms} ms",
            f"  faults on:     {', '.join(on) or '(none)'}  (a provider fault without '=' is on all documents)",
            f"  faults off:    {', '.join(off) or '(none)'}",
            f"  reproduce:     {self.reproduce_command(**page)}",
        ])

    def reproduce_command(self, **page) -> str:
        """The command that starts a server with these settings, and the page arguments, as one shell line.

        The chaos settings are given as the nearest profile and the settings that differ from it.
        """
        args = ["paatti-devserver", f"--pool_seed={self.pool_seed}"]
        if self.rahti_commit:
            args.append(f"--rahti_commit={self.rahti_commit}")
        profiles = {name: ChaosSettings(**CHAOS_PROFILES[name]) for name in ("none", "true", "all")}
        profile = min(profiles, key=lambda name: len(_differences(self.chaos, profiles[name])))
        if profile != "none":
            args.append(f"--chaos={profile}")
        for name, current, default in (("features", self.features, FeatureSettings()),
                                       ("chaos", self.chaos, profiles[profile])):
            for field, value in _differences(current, default):
                shown = ",".join(sorted(value)) if isinstance(value, frozenset) else str(value).lower() \
                    if isinstance(value, bool) else str(value)
                args.append(f"--{name}.{field}={shown}")
        line = shlex.join(args)
        query = "&".join(f"{key}={value}" for key, value in page.items())
        return f"{line}  # then open /?{query}" if query else line
