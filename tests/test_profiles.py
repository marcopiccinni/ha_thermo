"""Tests for shared profile rules and migration."""

from __future__ import annotations

from ha_thermo.const import DAYS, DEFAULT_PROFILE_IDS
from ha_thermo.models import Profile
from ha_thermo.profile_migration import migrate_legacy_profile_dict, migrate_profiles_list


def test_default_profiles_are_protected_set() -> None:
    assert "comfort" in DEFAULT_PROFILE_IDS


def test_hourly_profile_roundtrip() -> None:
    profile = Profile("test", "Test", hourly=[21.0] * 24)
    restored = Profile.from_dict(profile.to_dict())
    assert len(restored.hourly) == 24
    assert restored.hourly[0] == 21.0


def test_migrate_legacy_flat_profile() -> None:
    legacy = {
        "id": "comfort",
        "name": "Comfort",
        "targets": {"studio": 20.0},
        "curves": {"studio": {day: [20.0] * 24 for day in DAYS}},
    }
    migrated = migrate_legacy_profile_dict(legacy)
    assert len(migrated) == 1
    assert len(migrated[0]["hourly"]) == 24


def test_migrate_legacy_splits_different_weekdays() -> None:
    curves = {day: [20.0] * 24 for day in DAYS}
    curves["sat"] = [18.0] * 24
    legacy = {
        "id": "custom",
        "name": "Custom",
        "curves": {"studio": curves},
    }
    migrated = migrate_legacy_profile_dict(legacy)
    assert len(migrated) >= 2
    assert any(p["id"] == "custom_sat" for p in migrated)


def test_migrate_profiles_list() -> None:
    items = [{"id": "x", "name": "X", "hourly": [19.0] * 24}]
    profiles = migrate_profiles_list(items)
    assert "x" in profiles
