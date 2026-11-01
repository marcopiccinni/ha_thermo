"""Tests for the pure data models."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from ha_thermo.const import DAYS
from ha_thermo.models import Activator, Bypass, Profile, Zone, slugify


def _profile() -> Profile:
    return Profile(
        id="comfort",
        name="Comfort",
        targets={"studio": 20.0},
        curves={"studio": {day: [20.0] * 24 for day in DAYS}},
        days={"studio": list(DAYS)},
    )


def test_zone_clamps_temperature() -> None:
    zone = Zone("studio", "Studio", "climate.studio", min_temp=15, max_temp=25)
    assert zone.clamp(10) == 15
    assert zone.clamp(30) == 25
    assert zone.clamp(21.26) == 21.26


def test_zone_fixes_inverted_limits() -> None:
    zone = Zone("x", "X", "climate.x", min_temp=30, max_temp=10)
    assert zone.min_temp < zone.max_temp


def test_profile_target_falls_back_on_disabled_day() -> None:
    profile = _profile()
    profile.targets["studio"] = 18.0
    profile.days["studio"] = ["mon", "tue"]
    assert profile.target_for("studio", "mon", 8, 20) == 20.0
    assert profile.target_for("studio", "wed", 8, 20) == 18.0


def test_profile_target_falls_back_on_missing_curve() -> None:
    profile = _profile()
    profile.targets["cucina"] = 19.0
    assert profile.target_for("cucina", "mon", 8, 20) == 19.0


def test_profile_ensure_zone_creates_full_week() -> None:
    profile = Profile("p", "P")
    assert profile.ensure_zone("studio", 21) is True
    assert profile.targets["studio"] == 21
    assert set(profile.curves["studio"]) == set(DAYS)
    assert all(len(curve) == 24 for curve in profile.curves["studio"].values())
    assert profile.days["studio"] == list(DAYS)
    assert profile.ensure_zone("studio", 21) is False


def test_profile_clone_is_deep_and_can_limit_zones() -> None:
    profile = _profile()
    profile.ensure_zone("cucina", 19)
    clone = profile.clone("comfort_2", "Comfort 2", ["studio"])
    assert set(clone.targets) == {"studio"}
    assert set(clone.curves) == {"studio"}
    clone.curves["studio"]["mon"][8] = 22.0
    assert profile.curves["studio"]["mon"][8] == 20.0
    assert clone.id != profile.id


def test_profile_roundtrip() -> None:
    profile = _profile()
    restored = Profile.from_dict(profile.to_dict())
    assert restored.to_dict() == profile.to_dict()


def test_profile_validate_rejects_bad_curve() -> None:
    profile = _profile()
    profile.curves["studio"]["mon"] = [20.0] * 23
    with pytest.raises(ValueError, match="profile_invalid_curve"):
        profile.validate()


def test_activator_roundtrip_and_validation() -> None:
    activator = Activator(
        id="mattina",
        name="Mattina",
        profile_id="comfort",
        days=["mon", "tue"],
        start="7:00",
        end="09:30",
        priority=2,
    )
    assert activator.start == "07:00"
    assert activator.to_dict()["end"] == "09:30"
    activator.validate({"comfort"})
    with pytest.raises(ValueError, match="activator_unknown_profile"):
        activator.validate({"eco"})


def test_activator_rejects_invalid_time() -> None:
    activator = Activator("a", "A", "comfort", start="25:00")
    with pytest.raises(ValueError, match="activator_invalid_time"):
        activator.validate({"comfort"})


def test_bypass_resolves_absolute_offset_and_freeze() -> None:
    now = datetime.now(UTC)
    end = now + timedelta(hours=1)
    absolute = Bypass("b1", [], end, now, temperature=23)
    assert absolute.resolve(20) == 23
    offset = Bypass("b2", ["studio"], end, now, offset=1.5)
    assert offset.resolve(20) == 21.5
    freeze = Bypass("b3", [], end, now)
    assert freeze.resolve(20) == 20


def test_bypass_roundtrip() -> None:
    now = datetime.now(UTC)
    bypass = Bypass("b", ["studio"], now + timedelta(hours=2), now, offset=-1)
    restored = Bypass.from_dict(bypass.to_dict())
    assert restored.until == bypass.until
    assert restored.offset == bypass.offset


def test_slugify() -> None:
    assert slugify("Fuori casa (weekend)!") == "fuori_casa_weekend"
    assert slugify("***") == "profilo"
