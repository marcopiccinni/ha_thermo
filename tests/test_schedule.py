"""Tests for the pure scheduling logic."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from ha_thermo.const import DAYS
from ha_thermo.models import Activator, Profile, Zone
from ha_thermo.schedule import (
    activator_matches,
    day_key,
    next_activator_change,
    next_change,
    next_profile_change,
    pick_activator,
    resolve_target,
)

MONDAY = datetime(2026, 11, 2, 8, 30, tzinfo=UTC)


def _at(hour: int, minute: int = 0, day: int = 2) -> datetime:
    return datetime(2026, 11, day, hour, minute, tzinfo=UTC)


def _profile() -> Profile:
    profile = Profile(
        "comfort",
        "Comfort",
        targets={"studio": 20.0},
        curves={"studio": {day: [20.0] * 24 for day in DAYS}},
        days={"studio": list(DAYS)},
    )
    for hour in range(24):
        temperature = 21.0 if 8 <= hour < 22 else 18.0
        profile.curves["studio"]["mon"][hour] = temperature
    return profile


def _zone() -> Zone:
    return Zone("studio", "Studio", "climate.studio")


def test_day_key() -> None:
    assert day_key(MONDAY) == "mon"
    assert day_key(_at(12, day=8)) == "sun"


def test_activator_normal_window() -> None:
    activator = Activator(
        "a", "A", "comfort", days=["mon"], start="08:00", end="10:00"
    )
    assert activator_matches(activator, _at(8)) is True
    assert activator_matches(activator, _at(9, 59)) is True
    assert activator_matches(activator, _at(10)) is False
    assert activator_matches(activator, _at(7, 59)) is False


def test_activator_without_end_is_from_start_to_midnight() -> None:
    activator = Activator(
        "a", "A", "comfort", days=["mon"], start="22:00", end=None
    )
    assert activator_matches(activator, _at(22)) is True
    assert activator_matches(activator, _at(23, 59)) is True
    assert activator_matches(activator, _at(21, 59)) is False


def test_activator_overnight_window() -> None:
    activator = Activator(
        "a", "A", "comfort", days=["mon"], start="22:00", end="06:00"
    )
    assert activator_matches(activator, _at(23, 0, day=2)) is True
    assert activator_matches(activator, _at(5, 59, day=3)) is True
    assert activator_matches(activator, _at(6, 0, day=3)) is False
    assert activator_matches(activator, _at(22, 0, day=3)) is False


def test_activator_condition() -> None:
    activator = Activator(
        "a",
        "A",
        "comfort",
        days=["mon"],
        start="00:00",
        end="23:59",
        condition_entity="sensor.stagione",
        condition_state="Inverno",
    )
    assert activator_matches(
        activator, MONDAY, lambda entity: "Inverno"
    ) is True
    assert activator_matches(
        activator, MONDAY, lambda entity: "Estate"
    ) is False
    assert activator_matches(activator, MONDAY, lambda entity: None) is False


def test_pick_activator_highest_priority_then_latest_start() -> None:
    low = Activator("low", "Low", "comfort", start="00:00", end="23:59")
    high = Activator(
        "high", "High", "eco", start="08:00", end="10:00", priority=5
    )
    other = Activator(
        "other", "Other", "notte", start="09:00", end="10:00", priority=5
    )
    winner = pick_activator([low, high, other], "studio", _at(9, 30))
    assert winner is not None
    assert winner.id == "other"


def test_pick_activator_respects_zones_and_enabled() -> None:
    activator = Activator(
        "a", "A", "comfort", zones=["cucina"], start="00:00", end="23:59"
    )
    assert pick_activator([activator], "studio", _at(9)) is None
    activator.enabled = False
    assert pick_activator([activator], "cucina", _at(9)) is None


def test_resolve_target_uses_curve() -> None:
    profile = _profile()
    assert resolve_target(profile, _zone(), _at(9)) == 21.0
    assert resolve_target(profile, _zone(), _at(23)) == 18.0


def test_next_profile_change() -> None:
    profile = _profile()
    assert next_profile_change(profile, _zone(), _at(9, 15)) == _at(22)
    # Tuesday uses the default 20 degree curve, so the next change is midnight.
    assert next_profile_change(profile, _zone(), _at(22, 15)) == _at(0, day=3)


def test_next_change_uses_activator_boundary() -> None:
    profile = _profile()
    activator = Activator(
        "a", "A", "comfort", days=list(DAYS), start="10:00", end="23:59"
    )
    assert next_change(profile, [activator], _zone(), _at(9, 30)) == _at(10)


def test_next_activator_change() -> None:
    comfort = Activator(
        "comfort", "Comfort", "comfort", days=list(DAYS), start="06:00", end="22:00"
    )
    notte = Activator(
        "notte", "Notte", "notte", days=list(DAYS), start="22:00", end="06:00"
    )
    # At 21:30 the winner is comfort; at 22:00 the overnight night rule wins.
    assert next_activator_change([comfort, notte], "studio", _at(21, 30)) == _at(
        22
    )


def test_overnight_activator_change_next_day() -> None:
    notte = Activator(
        "notte", "Notte", "notte", days=list(DAYS), start="22:00", end="06:00"
    )
    assert next_activator_change([notte], "studio", _at(5, 30, day=3)) == _at(
        6, day=3
    )


def test_next_change_none_when_flat_profile_and_no_activators() -> None:
    profile = Profile(
        "flat",
        "Flat",
        targets={"studio": 20.0},
        curves={"studio": {day: [20.0] * 24 for day in DAYS}},
        days={"studio": list(DAYS)},
    )
    assert next_change(profile, [], _zone(), MONDAY) is None
    assert next_profile_change(profile, _zone(), MONDAY) is None


def test_next_change_handles_timezone() -> None:
    profile = _profile()
    result = next_change(profile, [], _zone(), MONDAY + timedelta(minutes=1))
    assert result is not None
    assert result.tzinfo is UTC
