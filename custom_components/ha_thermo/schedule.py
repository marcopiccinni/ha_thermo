"""Pure scheduling logic for profiles and activators.

No Home Assistant imports: everything here is unit-testable in isolation.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime, timedelta

from .const import DAYS
from .models import Activator, Profile, Zone

ConditionChecker = Callable[[str], str | None]

_DAY_BY_WEEKDAY = dict(enumerate(DAYS))
_PREVIOUS_DAY = {
    DAYS[index]: DAYS[(index - 1) % 7] for index in range(7)
}


def day_key(moment: datetime) -> str:
    """Return the mon..sun key for a datetime."""
    return _DAY_BY_WEEKDAY[moment.weekday()]


def _minutes(value: str) -> int:
    hour, minute = value.split(":", 1)
    return int(hour) * 60 + int(minute)


def condition_matches(
    activator: Activator, condition_checker: ConditionChecker | None
) -> bool:
    """Evaluate the optional condition entity of an activator."""
    if not activator.condition_entity:
        return True
    if condition_checker is None:
        return False
    state = condition_checker(activator.condition_entity)
    if state is None:
        return False
    expected = activator.condition_state
    if expected is None or expected == "":
        return state not in {"unknown", "unavailable"}
    return state == expected


def activator_matches(
    activator: Activator,
    moment: datetime,
    condition_checker: ConditionChecker | None = None,
) -> bool:
    """Return True when the activator window covers ``moment``."""
    if not activator.enabled:
        return False
    if not condition_matches(activator, condition_checker):
        return False

    start = _minutes(activator.start)
    end = _minutes(activator.end) if activator.end else 24 * 60
    current = moment.hour * 60 + moment.minute
    today = day_key(moment)

    if activator.end is None:
        return today in activator.days and current >= start
    if start == end:
        return today in activator.days
    if start < end:
        return today in activator.days and start <= current < end
    # Overnight window, e.g. 22:00 -> 06:00: the day refers to the start day.
    if current >= start and today in activator.days:
        return True
    previous = _PREVIOUS_DAY[today]
    return current < end and previous in activator.days


def _specificity(activator: Activator) -> tuple[int, int, int, str]:
    start = _minutes(activator.start)
    end = _minutes(activator.end) if activator.end else 24 * 60
    length = (end - start) % (24 * 60) or 24 * 60
    # Higher priority wins; then a later start; then a shorter window.
    return (activator.priority, start, -length, activator.id)


def pick_activator(
    activators: Iterable[Activator],
    zone_id: str,
    moment: datetime,
    condition_checker: ConditionChecker | None = None,
) -> Activator | None:
    """Return the winning activator for a zone, or None."""
    matching = [
        activator
        for activator in activators
        if activator.enabled
        and activator.applies_to(zone_id)
        and activator_matches(activator, moment, condition_checker)
    ]
    if not matching:
        return None
    return max(matching, key=_specificity)


def resolve_target(
    profile: Profile,
    zone: Zone,
    moment: datetime,
    fallback: float | None = None,
) -> float:
    """Resolve the profile target for a zone at a given moment."""
    base = zone.default_temp if fallback is None else fallback
    return profile.target_for(
        zone.id,
        day_key(moment),
        moment.hour,
        base,
    )


def _hour_boundary(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)


def next_profile_change(
    profile: Profile,
    zone: Zone,
    moment: datetime,
    fallback: float | None = None,
) -> datetime | None:
    """Return the next hour boundary where the profile target changes."""
    current = resolve_target(profile, zone, moment, fallback)
    boundary = _hour_boundary(moment)
    for _ in range(24 * 8):
        target = resolve_target(profile, zone, boundary, fallback)
        if abs(target - current) >= 0.05:
            return boundary
        boundary += timedelta(hours=1)
    return None


def _candidate_boundaries(
    activators: Iterable[Activator], moment: datetime
) -> list[datetime]:
    candidates: set[datetime] = set()
    for offset in range(9):
        day = (moment + timedelta(days=offset)).date()
        for activator in activators:
            for value in (activator.start, activator.end):
                if not value:
                    continue
                hour, minute = (int(part) for part in value.split(":", 1))
                candidate = moment.replace(
                    year=day.year,
                    month=day.month,
                    day=day.day,
                    hour=hour,
                    minute=minute,
                    second=0,
                    microsecond=0,
                )
                candidates.add(candidate)
        candidates.add(
            moment.replace(
                year=day.year,
                month=day.month,
                day=day.day,
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
        )
    return sorted(candidate for candidate in candidates if candidate > moment)


def next_activator_change(
    activators: Iterable[Activator],
    zone_id: str,
    moment: datetime,
    condition_checker: ConditionChecker | None = None,
) -> datetime | None:
    """Return the next moment the winning activator/profile changes."""
    activators = list(activators)
    current = pick_activator(activators, zone_id, moment, condition_checker)
    current_id = current.id if current else None
    for candidate in _candidate_boundaries(activators, moment):
        selected = pick_activator(
            activators,
            zone_id,
            candidate,
            condition_checker,
        )
        if (selected.id if selected else None) != current_id:
            return candidate
    return None


def next_change(
    profile: Profile | None,
    activators: Iterable[Activator],
    zone: Zone,
    moment: datetime,
    condition_checker: ConditionChecker | None = None,
    fallback: float | None = None,
) -> datetime | None:
    """Return the next profile or activator transition for a zone."""
    candidates: list[datetime] = []
    if profile is not None:
        profile_change = next_profile_change(
            profile, zone, moment, fallback
        )
        if profile_change is not None:
            candidates.append(profile_change)
    activator_change = next_activator_change(
        activators, zone.id, moment, condition_checker
    )
    if activator_change is not None:
        candidates.append(activator_change)
    return min(candidates) if candidates else None
