"""Data models for HA Thermo.

This module intentionally has no Home Assistant imports so it can be tested
without an HA installation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .const import (
    DAYS,
    HOURS_IN_DAY,
    MAX_TEMP,
    MIN_TEMP,
    PROFILE_ICON,
)

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _float(value: Any, default: float) -> float:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return default


def _clamp_temp(value: float) -> float:
    return round(min(MAX_TEMP, max(MIN_TEMP, value)), 2)


def _norm_days(value: Any) -> list[str]:
    if not isinstance(value, (list, tuple, set)):
        return list(DAYS)
    days = [str(day) for day in value if str(day) in DAYS]
    return days or list(DAYS)


def _norm_curve(value: Any, default: float) -> list[float]:
    curve: list[float] = []
    if isinstance(value, (list, tuple)):
        for item in value[:HOURS_IN_DAY]:
            curve.append(_clamp_temp(_float(item, default)))
    while len(curve) < HOURS_IN_DAY:
        curve.append(_clamp_temp(default))
    return curve


def _slug(value: str, fallback: str = "profilo") -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")
    return slug[:48] or fallback


@dataclass(slots=True)
class Zone:
    """A room controlled by one climate entity."""

    id: str
    name: str
    climate_entity: str
    temperature_sensor: str | None = None
    min_temp: float = 5.0
    max_temp: float = 30.0
    default_temp: float = 20.0

    def __post_init__(self) -> None:
        self.min_temp = _float(self.min_temp, 5.0)
        self.max_temp = _float(self.max_temp, 30.0)
        if self.max_temp <= self.min_temp:
            self.min_temp, self.max_temp = 5.0, 35.0
        self.default_temp = self.clamp(self.default_temp)
        self.temperature_sensor = self.temperature_sensor or None

    def clamp(self, value: float) -> float:
        """Clamp a temperature to the zone limits."""
        return round(min(self.max_temp, max(self.min_temp, float(value))), 2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "climate_entity": self.climate_entity,
            "temperature_sensor": self.temperature_sensor,
            "min_temp": self.min_temp,
            "max_temp": self.max_temp,
            "default_temp": self.default_temp,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Zone:
        return cls(
            id=str(data.get("id") or ""),
            name=str(data.get("name") or data.get("id") or "Zona"),
            climate_entity=str(data.get("climate_entity") or ""),
            temperature_sensor=data.get("temperature_sensor") or None,
            min_temp=_float(data.get("min_temp"), 5.0),
            max_temp=_float(data.get("max_temp"), 30.0),
            default_temp=_float(data.get("default_temp"), 20.0),
        )


@dataclass(slots=True)
class Profile:
    """A shared 24-hour target temperature curve (global, not per thermostat)."""

    id: str
    name: str
    icon: str = PROFILE_ICON
    hvac_mode: str | None = None
    hourly: list[float] = field(default_factory=list)

    def ensure_hourly(self, default: float = 20.0) -> bool:
        """Ensure the profile has exactly 24 hourly setpoints."""
        if len(self.hourly) == HOURS_IN_DAY:
            return False
        self.hourly = _norm_curve(self.hourly, default)
        return True

    def target_at(self, hour: int, fallback: float = 20.0) -> float:
        """Return the target temperature for a clock hour (0-23)."""
        if 0 <= hour < HOURS_IN_DAY and len(self.hourly) == HOURS_IN_DAY:
            return _clamp_temp(self.hourly[hour])
        return _clamp_temp(fallback)

    def clone(
        self, new_id: str, new_name: str, zone_ids: list[str] | None = None
    ) -> Profile:
        """Return an independent deep copy (zone_ids kept for API compatibility)."""
        _ = zone_ids
        return Profile(
            id=new_id,
            name=new_name,
            icon=self.icon,
            hvac_mode=self.hvac_mode,
            hourly=list(self.hourly),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "icon": self.icon,
            "hvac_mode": self.hvac_mode,
            "hourly": list(self.hourly),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Profile:
        name = str(data.get("name") or data.get("id") or "Profilo")
        default_temp = 20.0
        hourly_raw = data.get("hourly")
        hourly = (
            _norm_curve(hourly_raw, default_temp)
            if isinstance(hourly_raw, list)
            else []
        )
        profile = cls(
            id=str(data.get("id") or _slug(name)),
            name=name,
            icon=str(data.get("icon") or PROFILE_ICON),
            hvac_mode=data.get("hvac_mode") or None,
            hourly=hourly,
        )
        profile.ensure_hourly(default_temp)
        return profile

    def validate(self) -> None:
        if not self.id or not self.name.strip():
            raise ValueError("profile_name_required")
        if self.hvac_mode is not None and self.hvac_mode not in {
            "off",
            "heat",
            "cool",
            "heat_cool",
            "auto",
            "dry",
            "fan_only",
        }:
            raise ValueError("profile_invalid_hvac_mode")
        if len(self.hourly) != HOURS_IN_DAY:
            raise ValueError("profile_invalid_curve")
        if any(not MIN_TEMP <= float(v) <= MAX_TEMP for v in self.hourly):
            raise ValueError("temperature_out_of_range")


@dataclass(slots=True)
class Activator:
    """A day/time rule that selects a profile."""

    id: str
    name: str
    profile_id: str
    zones: list[str] = field(default_factory=list)
    days: list[str] = field(default_factory=lambda: list(DAYS))
    start: str = "00:00"
    end: str | None = None
    priority: int = 0
    enabled: bool = True
    condition_entity: str | None = None
    condition_state: str | None = None

    def __post_init__(self) -> None:
        self.zones = [str(zone) for zone in self.zones]
        self.days = _norm_days(self.days)
        # Keep invalid values so validate() can report them instead of
        # silently normalising a typo to midnight.
        self.start = _norm_time(self.start) or str(self.start or "00:00")
        self.end = (_norm_time(self.end) or str(self.end)) if self.end else None
        try:
            self.priority = int(self.priority)
        except (TypeError, ValueError):
            self.priority = 0
        self.condition_entity = self.condition_entity or None
        self.condition_state = self.condition_state or None

    def applies_to(self, zone_id: str) -> bool:
        return not self.zones or zone_id in self.zones

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "profile_id": self.profile_id,
            "zones": list(self.zones),
            "days": list(self.days),
            "start": self.start,
            "end": self.end,
            "priority": self.priority,
            "enabled": self.enabled,
            "condition_entity": self.condition_entity,
            "condition_state": self.condition_state,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Activator:
        name = str(data.get("name") or data.get("id") or "Attivatore")
        return cls(
            id=str(data.get("id") or _slug(name)),
            name=name,
            profile_id=str(data.get("profile_id") or ""),
            zones=list(data.get("zones") or []),
            days=list(data.get("days") or DAYS),
            start=str(data.get("start") or "00:00"),
            end=data.get("end") or None,
            priority=data.get("priority") or 0,
            enabled=bool(data.get("enabled", True)),
            condition_entity=data.get("condition_entity") or None,
            condition_state=data.get("condition_state") or None,
        )

    def validate(self, profile_ids: set[str] | None = None) -> None:
        if not self.id or not self.name.strip():
            raise ValueError("activator_name_required")
        if not self.profile_id:
            raise ValueError("activator_profile_required")
        if profile_ids is not None and self.profile_id not in profile_ids:
            raise ValueError("activator_unknown_profile")
        if _norm_time(self.start) is None:
            raise ValueError("activator_invalid_time")
        if self.end is not None and _norm_time(self.end) is None:
            raise ValueError("activator_invalid_time")


@dataclass(slots=True)
class Bypass:
    """A temporary override for one or more zones."""

    id: str
    zones: list[str]
    until: datetime
    created: datetime
    temperature: float | None = None
    offset: float | None = None
    source: str = "service"

    def __post_init__(self) -> None:
        self.zones = [str(zone) for zone in self.zones]
        if self.temperature is not None:
            self.temperature = _clamp_temp(self.temperature)
        if self.offset is not None:
            self.offset = round(float(self.offset), 2)

    def applies_to(self, zone_id: str) -> bool:
        return not self.zones or zone_id in self.zones

    def resolve(self, base: float) -> float:
        if self.temperature is not None:
            return _clamp_temp(self.temperature)
        if self.offset is not None:
            return _clamp_temp(base + self.offset)
        return _clamp_temp(base)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "zones": list(self.zones),
            "until": self.until.isoformat(),
            "created": self.created.isoformat(),
            "temperature": self.temperature,
            "offset": self.offset,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Bypass:
        return cls(
            id=str(data.get("id") or ""),
            zones=list(data.get("zones") or []),
            until=_parse_datetime(data.get("until")),
            created=_parse_datetime(data.get("created")),
            temperature=(
                _float(data.get("temperature"), 20.0)
                if data.get("temperature") is not None
                else None
            ),
            offset=(
                _float(data.get("offset"), 0.0)
                if data.get("offset") is not None
                else None
            ),
            source=str(data.get("source") or "service"),
        )

    def validate(self) -> None:
        if self.temperature is None and self.offset is None:
            raise ValueError("bypass_value_required")
        if not MIN_TEMP <= float(self.temperature or 20.0) <= MAX_TEMP:
            raise ValueError("temperature_out_of_range")
        if self.offset is not None and abs(self.offset) > 15:
            raise ValueError("bypass_offset_out_of_range")


def _norm_time(value: Any) -> str | None:
    text = str(value or "").strip()
    if len(text) == 4:
        text = f"0{text}"
    return text if _TIME_RE.match(text) else None


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    text = str(value or "").replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return datetime.now().astimezone()


def slugify(value: str, fallback: str = "profilo") -> str:
    """Return a stable identifier from a human name."""
    return _slug(value, fallback)
