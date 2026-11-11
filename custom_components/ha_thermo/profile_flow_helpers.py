"""Unit-testable helpers for the options-flow profile UI."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .const import DAYS
from .models import Profile

if TYPE_CHECKING:
    from .manager import ThermoManager

PROFILE_NEW = "__new__"

HOUR_SECTION_KEYS = ("night", "morning", "afternoon", "evening")

HOUR_SECTIONS: tuple[tuple[str, range], ...] = (
    ("night", range(0, 6)),
    ("morning", range(6, 12)),
    ("afternoon", range(12, 18)),
    ("evening", range(18, 24)),
)


def profile_summary_label(profile: Profile) -> str:
    """Dropdown label: Name · min–max °C."""
    profile.ensure_hourly()
    lo = min(profile.hourly)
    hi = max(profile.hourly)
    return f"{profile.name} · {lo:g}–{hi:g} °C"


def curve_preview(hourly: list[float]) -> str:
    """Compact text preview of the 24h curve."""
    if len(hourly) != 24:
        return "—"
    runs: list[str] = []
    start = 0
    for hour in range(1, 25):
        if hour == 24 or hourly[hour] != hourly[start]:
            end = hour - 1
            runs.append(f"{start:02d}–{end:02d}h {hourly[start]:g}°C")
            start = hour
    text = " · ".join(runs)
    return text if len(text) <= 120 else f"{text[:117]}…"


def flatten_section_hours(user_input: dict[str, Any]) -> list[float]:
    """Read nested section form values into a 24h list."""
    uniform = user_input.get("uniform_temp")
    if uniform is not None and str(uniform).strip() != "":
        return [float(uniform)] * 24
    hourly = [20.0] * 24
    for section_key in HOUR_SECTION_KEYS:
        block = user_input.get(section_key)
        if not isinstance(block, dict):
            continue
        for field, value in block.items():
            if not str(field).startswith("hour_"):
                continue
            hour = int(str(field).split("_", 1)[1])
            if 0 <= hour < 24:
                hourly[hour] = float(value)
    return hourly


_NOTICE: dict[str, dict[str, str]] = {
    "profile_saved": {"it": "Profilo salvato.", "en": "Profile saved."},
    "profile_created": {"it": "Profilo creato.", "en": "Profile created."},
    "profile_deleted": {"it": "Profilo eliminato.", "en": "Profile deleted."},
    "profile_duplicated": {"it": "Profilo duplicato.", "en": "Profile duplicated."},
    "profile_renamed": {"it": "Profilo rinominato.", "en": "Profile renamed."},
}


def notice_message(language: str, key: str | None) -> str:
    if not key:
        return " "
    lang = "it" if (language or "").lower().startswith("it") else "en"
    return _NOTICE.get(key, {}).get(lang, key)


def weekly_profile_usage(
    manager: ThermoManager, profile_id: str
) -> list[tuple[str, list[str]]]:
    """Zones (name) and weekdays using profile_id."""
    usage: list[tuple[str, list[str]]] = []
    for zone_id, schedule in manager.weekly_profiles.items():
        days = [day for day in DAYS if schedule.get(day) == profile_id]
        if not days:
            continue
        zone = manager.zones.get(zone_id)
        label = zone.name if zone is not None else str(zone_id)
        usage.append((label, days))
    return usage
