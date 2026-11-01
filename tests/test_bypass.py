"""Tests for the pure bypass helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from ha_thermo.bypass import (
    active_bypass,
    clean_expired,
    parse_duration_minutes,
    parse_until,
    remaining_seconds,
    resolve_end,
)
from ha_thermo.models import Bypass

NOW = datetime(2026, 11, 2, 8, 0, tzinfo=UTC)


def _bypass(identifier: str, hours: float, zones=None) -> Bypass:
    return Bypass(
        identifier,
        zones or [],
        NOW + timedelta(hours=hours),
        NOW,
        temperature=21,
    )


def test_parse_duration_minutes() -> None:
    assert parse_duration_minutes(90) == 90
    assert parse_duration_minutes("90") == 90
    assert parse_duration_minutes("90m") == 90
    assert parse_duration_minutes("01:30") == 90
    assert parse_duration_minutes(None) is None
    with pytest.raises(ValueError, match="duration_must_be_positive"):
        parse_duration_minutes(0)


def test_parse_until() -> None:
    parsed = parse_until("2026-11-02T10:00:00+00:00", NOW)
    assert parsed == datetime(2026, 11, 2, 10, 0, tzinfo=UTC)
    with pytest.raises(ValueError, match="invalid_until"):
        parse_until("not-a-date", NOW)


def test_resolve_end_prefers_until() -> None:
    end = resolve_end(None, "2026-11-02T10:00:00+00:00", NOW)
    assert end.hour == 10
    assert resolve_end(30, None, NOW) == NOW + timedelta(minutes=30)
    assert resolve_end(None, None, NOW, default_minutes=15) == NOW + timedelta(
        minutes=15
    )
    with pytest.raises(ValueError, match="until_in_the_past"):
        resolve_end(None, "2026-11-02T07:00:00+00:00", NOW)
    with pytest.raises(ValueError, match="duration_required"):
        resolve_end(None, None, NOW)


def test_active_bypass_prefers_newest() -> None:
    older = _bypass("older", 2)
    newer = _bypass("newer", 1)
    newer.created = NOW + timedelta(minutes=1)
    assert active_bypass([older, newer], "studio", NOW).id == "newer"


def test_active_bypass_respects_zones() -> None:
    assert active_bypass([_bypass("b", 1, ["studio"])], "cucina", NOW) is None
    assert active_bypass([_bypass("b", 1, [])], "cucina", NOW) is not None


def test_active_bypass_ignores_expired() -> None:
    expired = Bypass(
        "old", [], NOW - timedelta(minutes=1), NOW - timedelta(hours=1)
    )
    assert active_bypass([expired], "studio", NOW) is None


def test_clean_expired_and_remaining() -> None:
    active = _bypass("active", 1)
    expired = _bypass("expired", 0)
    assert [item.id for item in clean_expired([active, expired], NOW)] == [
        "active"
    ]
    assert remaining_seconds(active, NOW) == 3600
    assert remaining_seconds(expired, NOW) == 0
