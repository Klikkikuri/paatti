import functools
import os

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, settings as hypothesis_settings

from paatti_devserver.app import build_state, create_app
from paatti_devserver.settings import Settings

# `dev` keeps a random search and an example database; `ci` repeats the same examples on each run.
hypothesis_settings.register_profile("dev", max_examples=30, deadline=None,
                                     suppress_health_check=[HealthCheck.too_slow])
hypothesis_settings.register_profile("ci", max_examples=30, deadline=None, derandomize=True,
                                     suppress_health_check=[HealthCheck.too_slow])
hypothesis_settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "dev"))


def make_settings(**overrides) -> Settings:
    """Settings from the arguments only: the environment of the test run must not change them."""
    return Settings.model_validate({"port": 3000, **overrides})


@functools.cache
def _state(key: str):
    return build_state(Settings.model_validate_json(key))


def state_for(settings: Settings):
    """The app state for `settings`, built one time per distinct settings, because Suola is slow to start."""
    return _state(settings.model_dump_json())


@pytest.fixture
def client_for():
    """A TestClient factory. Each call builds a fresh app, so the chaos request counts start at 0."""
    def make(**overrides) -> TestClient:
        return TestClient(create_app(make_settings(**overrides)), follow_redirects=False)
    return make


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(create_app(make_settings()), follow_redirects=False)
