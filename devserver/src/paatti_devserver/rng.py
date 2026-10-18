"""Named random streams. Each scope has its own stream, so a change in one place does not shift another."""

import hashlib
import random

from faker import Faker


def scope_key(*scope) -> str:
    return ":".join(str(part) for part in scope)


def rng(*scope) -> random.Random:
    """A stream for `scope`. A string seed is hashed with SHA-512, so it is the same in each Python version."""
    return random.Random(scope_key(*scope))


def faker(*scope) -> Faker:
    """A Faker for `scope`. Its output is the same only within one Faker version, which `uv.lock` pins."""
    fake = Faker("en_US")
    fake.seed_instance(scope_key(*scope))
    return fake


def hex_id(*scope, length: int = 12) -> str:
    return hashlib.sha256(scope_key(*scope).encode()).hexdigest()[:length]
