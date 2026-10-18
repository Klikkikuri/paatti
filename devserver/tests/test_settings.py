import shlex

import pytest

from paatti_devserver.settings import CHAOS_PROFILES, ChaosSettings, Settings

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
    ({}, ["--chaos=true"], ("chaos", "provider_5xx"), frozenset({"manifest", "sites", "rules", "data"})),
    ({}, ["--chaos", "true"], ("chaos", "rate"), 0.03),
    ({}, ["--chaos"], ("chaos", "rate"), 0.03),
    ({}, ["--chaos", "--chaos.rate=0.2"], ("chaos", "rate"), 0.2),
    ({}, [], ("chaos",), ChaosSettings()),
    ({}, ["--chaos=true"], ("chaos", "page_hostile_css"), False),
    ({}, ["--chaos=all"], ("chaos", "page_hostile_css"), True),
    ({}, ["--chaos=none"], ("chaos",), ChaosSettings()),
    ({}, ['--chaos={"rate": 0.3}'], ("chaos", "rate"), 0.3),
    ({}, ["--chaos.provider_404=", "--chaos=all"], ("chaos", "provider_404"), frozenset()),
    ({"PAATTI_DEVSERVER_CHAOS": "all", "PAATTI_DEVSERVER_CHAOS__RATE": "0.2"}, [], ("chaos", "rate"), 0.2),
]


@pytest.mark.parametrize("environment, argv, path, expected", CASES)
def test_settings_come_from_prefixed_environment_and_command_line(monkeypatch, environment, argv, path, expected):
    for key, value in environment.items():
        monkeypatch.setenv(key, value)
    value = Settings.from_command_line(argv)
    for name in path:
        value = getattr(value, name)
    assert value == expected


def test_reproduce_command_gives_the_same_settings():
    original = make_settings(pool_seed=7, features={"xfail": False, "blocks": "lead,card"},
                             chaos={"provider_5xx": "data", "seed": 3, "page_hostile_css": True})
    line = original.reproduce_command().split("  #")[0]
    again = Settings.from_command_line(shlex.split(line)[1:])
    assert again.features == original.features
    assert again.chaos == original.chaos
    assert again.pool_seed == original.pool_seed



@pytest.mark.parametrize("chaos, expected", [
    ({}, "paatti-devserver --pool_seed=1"),
    ({"rate": 0.03, "provider_5xx": "data"},
     "paatti-devserver --pool_seed=1 --chaos.rate=0.03 --chaos.provider_5xx=data"),
    (dict(CHAOS_PROFILES["true"], provider_timeout=""),
     "paatti-devserver --pool_seed=1 --chaos=true --chaos.provider_timeout="),
    (dict(CHAOS_PROFILES["all"], rate=0.5), "paatti-devserver --pool_seed=1 --chaos=all --chaos.rate=0.5"),
])
def test_reproduce_command_names_the_nearest_chaos_profile(chaos, expected):
    original = make_settings(chaos=chaos)
    assert original.reproduce_command() == expected
    assert Settings.from_command_line(shlex.split(expected)[1:]).chaos == original.chaos


def test_startup_summary_names_the_seeds_the_faults_and_the_command():
    summary = make_settings(seed=42, chaos=dict(CHAOS_PROFILES["true"], provider_timeout="")).startup_summary()
    assert "page seed:     42" in summary
    assert "faults off:    provider_timeout, page_hostile_css\n" in summary
    assert "--chaos=true --chaos.provider_timeout=  # then open /?seed=42" in summary
