"""Pure scheduling logic for profiles and activators.

No Home Assistant imports: everything here is unit-testable in isolation.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import datetime, timedelta

from .const import DAYS, DEFAULT_ACTIVATOR_ID
from .models import Activator, Profile, Zone

ConditionChecker = Callable[[str], str | None]

_DAY_BY_WEEKDAY = dict(enumerate(DAYS))
_PREVIOUS_DAY = {
    DAYS[index]: DAYS[(index - 1) % 7] for index in range(7)
}

DAY_GROUPS: dict[str, tuple[str, ...]] = {
    "weekdays": ("mon", "tue", "wed", "thu", "fri"),
    "feriali": ("mon", "tue", "wed", "thu", "fri"),
    "weekend": ("sat", "sun"),
    "all": DAYS,
    "tutti": DAYS,
    "everyday": DAYS,
}


def expand_days(values: Iterable[str] | None) -> list[str]:
    """Expand day names and groups (``weekdays``/``weekend``) to mon..sun."""
    if values is None:
        return list(DAYS)
    if isinstance(values, str):
        values = [values]
    result: list[str] = []
    for value in values:
        parts = str(value).replace(",", " ").split() or [str(value)]
        for part in parts:
            key = part.strip().lower()
            if key in DAY_GROUPS:
                candidates = DAY_GROUPS[key]
            elif key in DAYS:
                candidates = (key,)
            else:
                continue
            for day in candidates:
                if day not in result:
                    result.append(day)
    return result


def is_timed_activator(activator: Activator) -> bool:
    """True for activators that act as a time window (not a full-day baseline).

    The built-in ``programmazione`` activator always behaves as the baseline so
    that the weekly day plan is not shadowed by its (possibly edited) hours.
    """
    if activator.id == DEFAULT_ACTIVATOR_ID:
        return False
    return activator.end is not None or activator.start != "00:00"


def resolve_profile_choice(
    *,
    zone_id: str,
    moment: datetime,
    profiles: Iterable[str],
    activators: Iterable[Activator],
    weekly: dict[str, str] | None = None,
    pinned_profile: str | None = None,
    active_profile: str | None = None,
    default_profile: str | None = None,
    condition_checker: ConditionChecker | None = None,
) -> tuple[str | None, str]:
    """Return ``(profile_id, source)`` using the documented precedence.

    Order: temporary override -> timed activators -> weekly day plan ->
    full-day baseline activators -> last active profile -> default profile.
    """
    valid = set(profiles)
    if pinned_profile and pinned_profile in valid:
        return pinned_profile, "override"

    activator_list = list(activators)
    timed = [item for item in activator_list if is_timed_activator(item)]
    chosen = pick_activator(timed, zone_id, moment, condition_checker)
    if chosen and chosen.profile_id in valid:
        return chosen.profile_id, "activator"

    weekly_id = (weekly or {}).get(day_key(moment))
    if weekly_id and weekly_id in valid:
        return weekly_id, "weekly"

    baseline = [
        item for item in activator_list if not is_timed_activator(item)
    ]
    chosen = pick_activator(baseline, zone_id, moment, condition_checker)
    if chosen and chosen.profile_id in valid:
        return chosen.profile_id, "baseline"

    if active_profile and active_profile in valid:
        return active_profile, "active"
    if default_profile and default_profile in valid:
        return default_profile, "default"
    return None, "none"


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
