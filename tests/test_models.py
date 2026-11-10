"""Tests for the pure data models."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from ha_thermo.const import DAYS
from ha_thermo.models import Activator, Bypass, Profile, Zone, slugify


def _profile() -> Profile:
    hourly = [20.0] * 24
    hourly[8] = 21.0
    return Profile("comfort", "Comfort", hourly=hourly)


def test_zone_clamps_temperature() -> None:
    zone = Zone("studio", "Studio", "climate.studio", min_temp=15, max_temp=25)
    assert zone.clamp(10) == 15
    assert zone.clamp(30) == 25


def test_profile_target_at_hour() -> None:
    profile = _profile()
    assert profile.target_at(8, 18) == 21.0
    assert profile.target_at(3, 18) == 20.0


def test_profile_ensure_hourly() -> None:
    profile = Profile("p", "P")
    assert profile.ensure_hourly(19.5) is True
    assert len(profile.hourly) == 24
    assert profile.ensure_hourly(19.5) is False


def test_profile_clone_is_deep() -> None:
    profile = _profile()
    clone = profile.clone("comfort_2", "Comfort 2")
    clone.hourly[8] = 22.0
    assert profile.hourly[8] == 21.0


def test_profile_roundtrip() -> None:
    profile = _profile()
    restored = Profile.from_dict(profile.to_dict())
    assert restored.to_dict() == profile.to_dict()


def test_profile_validate_rejects_bad_curve() -> None:
    profile = Profile("p", "P", hourly=[20.0] * 23)
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
    activator.validate({"comfort"})


def test_bypass_resolves_absolute_offset() -> None:
    now = datetime.now(UTC)
    end = now + timedelta(hours=1)
    absolute = Bypass("b1", [], end, now, temperature=23)
    assert absolute.resolve(20) == 23
    offset = Bypass("b2", ["studio"], end, now, offset=1.5)
    assert offset.resolve(20) == 21.5


def test_slugify() -> None:
    assert slugify("Fuori casa (weekend)!") == "fuori_casa_weekend"
