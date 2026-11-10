"""Migrate legacy profile payloads to the 0.3.5 hourly-only format."""

from __future__ import annotations

from typing import Any

from .const import DAYS
from .models import Profile, _clamp_temp, _float, _norm_curve, _slug

_DAY_SUFFIX = {
    "mon": "Lun",
    "tue": "Mar",
    "wed": "Mer",
    "thu": "Gio",
    "fri": "Ven",
    "sat": "Sab",
    "sun": "Dom",
}

_DEFAULT_HOURLY = {
    "comfort": 20.0,
    "eco": 19.0,
    "night": 18.0,
    "away": 17.0,
    "summer": 26.0,
}


def _hourly_for_day_legacy(data: dict[str, Any], day: str, default: float) -> list[float]:
    """Average legacy zone/day curves into one 24h list."""
    curves = data.get("curves") or {}
    targets = data.get("targets") or {}
    hourly: list[float] = []
    for hour in range(24):
        values: list[float] = []
        if isinstance(curves, dict):
            for zone_curves in curves.values():
                if not isinstance(zone_curves, dict):
                    continue
                curve = zone_curves.get(day)
                if isinstance(curve, list) and len(curve) == 24:
                    values.append(_float(curve[hour], default))
        if not values and isinstance(targets, dict):
            for target in targets.values():
                values.append(_float(target, default))
        if not values:
            values = [default]
        hourly.append(_clamp_temp(sum(values) / len(values)))
    return _norm_curve(hourly, default)


def migrate_legacy_profile_dict(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert one stored profile into one or more hourly-only profile dicts."""
    if isinstance(data.get("hourly"), list) and len(data.get("hourly") or []) == 24:
        profile = Profile.from_dict(data)
        profile.ensure_hourly()
        return [profile.to_dict()]

    profile_id = str(data.get("id") or _slug(str(data.get("name") or "profilo")))
    name = str(data.get("name") or profile_id)
    default = _DEFAULT_HOURLY.get(profile_id, 20.0)
    icon = str(data.get("icon") or "mdi:home-thermometer")
    hvac_mode = data.get("hvac_mode")

    day_hourly = {day: _hourly_for_day_legacy(data, day, default) for day in DAYS}
    reference = day_hourly["mon"]

    def curves_equal(a: list[float], b: list[float]) -> bool:
        return len(a) == len(b) and all(abs(x - y) < 0.05 for x, y in zip(a, b))

    extras: list[dict[str, Any]] = []
    for day in DAYS:
        if day == "mon":
            continue
        if not curves_equal(day_hourly[day], reference):
            suffix = _DAY_SUFFIX[day]
            extras.append(
                {
                    "id": f"{profile_id}_{day}",
                    "name": f"{name} ({suffix})",
                    "icon": icon,
                    "hvac_mode": hvac_mode,
                    "hourly": list(day_hourly[day]),
                }
            )

    primary = {
        "id": profile_id,
        "name": name,
        "icon": icon,
        "hvac_mode": hvac_mode,
        "hourly": list(reference),
    }
    return [primary, *extras]


def migrate_profiles_list(items: list[Any]) -> dict[str, Profile]:
    """Migrate a list of stored profile dicts to the new Profile map."""
    profiles: dict[str, Profile] = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        try:
            for migrated in migrate_legacy_profile_dict(item):
                profile = Profile.from_dict(migrated)
                profile.ensure_hourly()
                base_id = profile.id
                unique_id = base_id
                counter = 2
                while unique_id in profiles:
                    unique_id = f"{base_id}_{counter}"
                    counter += 1
                profile.id = unique_id
                profiles[unique_id] = profile
        except (TypeError, ValueError):
            continue
    return profiles
