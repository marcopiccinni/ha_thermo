"""Pure helpers for timed bypasses and overrides."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

from .models import Bypass


def parse_duration_minutes(value: Any) -> float | None:
    """Parse a duration in minutes from a number or ``HH:MM`` string."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        minutes = float(value)
    else:
        text = str(value).strip().lower().removesuffix("m")
        if ":" in text:
            hours, minutes_text = text.split(":", 1)
            minutes = int(hours) * 60 + int(minutes_text)
        else:
            minutes = float(text)
    if minutes <= 0:
        raise ValueError("duration_must_be_positive")
    if minutes > 60 * 24 * 30:
        raise ValueError("duration_too_long")
    return minutes


def parse_until(value: Any, now: datetime) -> datetime | None:
    """Parse an absolute end datetime, accepting ISO strings."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        result = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            result = datetime.fromisoformat(text)
        except ValueError as err:
            raise ValueError("invalid_until") from err
    if result.tzinfo is None and now.tzinfo is not None:
        result = result.replace(tzinfo=now.tzinfo)
    return result


def resolve_end(
    duration: Any,
    until: Any,
    now: datetime,
    default_minutes: float | None = None,
) -> datetime:
    """Resolve a bypass end from duration/until/default."""
    parsed_until = parse_until(until, now)
    if parsed_until is not None:
        if parsed_until <= now:
            raise ValueError("until_in_the_past")
        return parsed_until
    minutes = parse_duration_minutes(duration)
    if minutes is None:
        minutes = default_minutes
    if minutes is None or minutes <= 0:
        raise ValueError("duration_required")
    return now + timedelta(minutes=minutes)


def active_bypass(
    bypasses: Iterable[Bypass], zone_id: str, now: datetime
) -> Bypass | None:
    """Return the active bypass for a zone (most recent wins)."""
    matches = [
        item
        for item in bypasses
        if item.applies_to(zone_id) and item.until > now
    ]
    if not matches:
        return None
    return max(matches, key=lambda item: item.created)


def clean_expired(bypasses: Iterable[Bypass], now: datetime) -> list[Bypass]:
    """Return only the bypasses that have not expired."""
    return [item for item in bypasses if item.until > now]


def remaining_seconds(bypass: Bypass, now: datetime) -> float:
    """Seconds left before a bypass expires."""
    return max(0.0, (bypass.until - now).total_seconds())


def is_active(bypass: Bypass, now: datetime) -> bool:
    """Return True when the bypass is still running."""
    return bypass.until > now
