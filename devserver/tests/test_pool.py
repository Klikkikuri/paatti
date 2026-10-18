import pytest

from paatti_devserver import expectations as ex
from paatti_devserver.pool import build_pool
from paatti_devserver.settings import FeatureSettings

CASE_FLAGS = ["levels", "ai_slop", "video", "sponsored", "paywalled", "no_entry", "edge_headlines", "xfail"]


def test_default_pool_covers_every_case():
    pool = build_pool(1, FeatureSettings())
    statuses = {ex.expected_status(article) for article in pool}
    assert statuses == {ex.CONVERTED, ex.ORIGINAL, ex.PAYWALLED, ex.SKIPPED}
    labels = {label for article in pool for label in article.labels}
    assert {ex.LABEL_AI_SLOP, ex.LABEL_VIDEO, ex.LABEL_SPONSORED, ex.LABEL_PAYWALLED} <= labels
    assert {article.level for article in pool if article.has_entry} == set(range(len(ex.LEVELS)))


@pytest.mark.parametrize("flag", CASE_FLAGS)
def test_turning_a_flag_off_removes_only_its_case(flag):
    on = build_pool(1, FeatureSettings())
    off = build_pool(1, FeatureSettings(**{flag: False}))
    case = "xfail_" if flag == "xfail" else flag
    assert [a for a in on if not a.case.startswith(case)] == off
    assert any(a.case.startswith(case) for a in on)


def test_pool_is_the_same_for_the_same_seed_and_differs_for_another():
    assert build_pool(5, FeatureSettings()) == build_pool(5, FeatureSettings())
    assert build_pool(5, FeatureSettings()) != build_pool(6, FeatureSettings())


def test_invented_surnames_are_not_in_fakers_surname_list():
    """Faker's surnames include real public figures; a fake clickbait about a real person can defame them."""
    from faker.providers.person.en_US import Provider

    from paatti_devserver.headlines import invented_surname
    from paatti_devserver.rng import rng

    real = {name.lower() for name in Provider.last_names}
    drawn = {invented_surname(rng("surname", i)).lower() for i in range(2000)}
    assert not drawn & real
