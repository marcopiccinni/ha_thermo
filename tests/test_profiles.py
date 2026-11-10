"""Tests for shared profile rules."""

from __future__ import annotations

import pytest

from ha_thermo.const import DEFAULT_PROFILE_IDS
from ha_thermo.models import Profile


def test_default_profiles_are_protected_set() -> None:
    assert DEFAULT_PROFILE_IDS == frozenset(
        {"comfort", "eco", "night", "away", "summer"}
    )


def test_profile_roundtrip() -> None:
    profile = Profile("test", "Test", targets={"studio": 21.0})
    profile.ensure_zone("studio", 20.0)
    restored = Profile.from_dict(profile.to_dict())
    assert restored.id == "test"
    assert restored.targets["studio"] == 21.0


def test_profile_ensure_zone_builds_curves() -> None:
    profile = Profile("x", "X")
    assert profile.ensure_zone("z1", 19.5)
    assert len(profile.curves["z1"]["mon"]) == 24
