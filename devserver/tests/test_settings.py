import shlex
import sys

import pytest

from paatti_devserver.settings import Settings

from .conftest import make_settings

CASES = [
    # (environment, argv, field path, expected)
    ({"PAATTI_DEVSERVER_CHAOS__PROVIDER_5XX": "data,manifest"}, [], ("chaos", "provider_5xx"),
     frozenset({"data", "manifest"})),
    ({}, ["--chaos.provider_404", "sites,rules"], ("chaos", "provider_404"), frozenset({"sites", "rules"})),
    ({"PAATTI_DEVSERVER_FEATURES__XFAIL": "false"}, [], ("features", "xfail"), False),
    ({}, ["--features.blocks", "lead,card"], ("features", "blocks"), frozenset({"lead", "card"})),
    ({"SEED": "99"}, [], ("seed",), None),
    ({"PAATTI_DEVSERVER_SEED": "99"}, [], ("seed",), 99),
]


@pytest.mark.parametrize("environment, argv, path, expected", CASES)
def test_settings_come_from_prefixed_environment_and_command_line(monkeypatch, environment, argv, path, expected):
    for key, value in environment.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(sys, "argv", ["paatti-devserver", *argv])
    value = Settings(_cli_parse_args=True)
    for name in path:
        value = getattr(value, name)
    assert value == expected


def test_reproduce_command_gives_the_same_settings(monkeypatch):
    original = make_settings(pool_seed=7, features={"xfail": False, "blocks": "lead,card"},
                             chaos={"provider_5xx": "data", "seed": 3, "page_hostile_css": True})
    line = original.reproduce_command().split("  #")[0]
    monkeypatch.setattr(sys, "argv", shlex.split(line))
    again = Settings(_cli_parse_args=True)
    assert again.features == original.features
    assert again.chaos == original.chaos
    assert again.pool_seed == original.pool_seed
