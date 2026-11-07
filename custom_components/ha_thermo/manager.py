"""Core manager for HA Thermo - Simplified version."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .bypass import active_bypass, parse_duration_minutes, remaining_seconds, resolve_end
from .const import (
    ATTR_BYPASS,
    ATTR_PROFILE_ID,
    ATTR_PROFILE_NAME,
    ATTR_SOURCE,
    ATTR_TARGET,
    ATTR_ZONE_ID,
    ATTR_ZONES,
    CONF_MANUAL_HOLD,
    CONF_REASSERT_INTERVAL,
    CONF_SCAN_INTERVAL,
    CONF_ZONES,
    DEFAULT_MANUAL_HOLD,
    DEFAULT_REASSERT_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    EVENT_BYPASS_ENDED,
    EVENT_BYPASS_STARTED,
    EVENT_MANUAL_OVERRIDE,
    EVENT_PROFILE_CHANGED,
    EVENT_TARGET_CHANGED,
    PROFILE_AUTO,
    STORAGE_KEY,
    STORAGE_VERSION,
    entity_unique_id,
)
from .models import Bypass, Profile, Zone, slugify

_LOGGER = logging.getLogger(__name__)


class ThermoManager:
    """Main manager for HA Thermo integration."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.enabled = True
        self.settings: dict[str, Any] = {}
        self.zones: dict[str, Zone] = {}
        self.profiles: dict[str, Profile] = {}
        self.bypasses: dict[str, Bypass] = {}
        self.active_profiles: dict[str, str] = {}
        self.pinned_profiles: dict[str, dict[str, Any]] = {}
        self.manual_overrides: dict[str, dict[str, Any]] = {}
        self.disabled_zones: set[str] = set()
        self.effective_targets: dict[str, float | None] = {}
        self._desired: dict[str, float] = {}
        self._last_apply: dict[str, datetime] = {}
        self._ignore_until: dict[str, datetime] = {}
        self._applied_mode: dict[str, str] = {}
        self._store = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry.entry_id}")
        self._entry_id = entry.entry_id

    async def async_setup(self) -> None:
        """Initialize the manager."""
        raw = await self._store.async_load() or {}
        self._restore(raw)
        self._sync_zones()
        self._save()

    def _restore(self, raw: dict[str, Any]) -> None:
        """Restore state from storage."""
        self.enabled = bool(raw.get("enabled", True))
        self.disabled_zones = {str(z) for z in raw.get("disabled_zones") or []}
        self.settings = {
            "manual_hold": raw.get("manual_hold", DEFAULT_MANUAL_HOLD),
            "reassert_interval": raw.get("reassert_interval", DEFAULT_REASSERT_INTERVAL),
            "scan_interval": raw.get("scan_interval", DEFAULT_SCAN_INTERVAL),
        }

        profiles: dict[str, Profile] = {}
        for item in raw.get("profiles") or []:
            if not isinstance(item, dict):
                continue
            try:
                profile = Profile.from_dict(item)
                profiles[profile.id] = profile
            except (TypeError, ValueError):
                _LOGGER.warning("Ignoring invalid profile: %s", item)
        self.profiles = profiles or self._create_defaults()

        self.active_profiles = {
            str(zone): str(profile)
            for zone, profile in (raw.get("active_profiles") or {}).items()
        }
        self.pinned_profiles = {}
        for zone_id, pin in (raw.get("pinned_profiles") or {}).items():
            if not isinstance(pin, dict):
                continue
            profile_id = pin.get("profile_id")
            if not profile_id:
                continue
            self.pinned_profiles[str(zone_id)] = {
                "profile_id": str(profile_id),
                "until": _parse_datetime(pin.get("until")),
            }
        self.manual_overrides = {}
        now = dt_util.now()
        for zone_id, override in (raw.get("manual_overrides") or {}).items():
            if not isinstance(override, dict):
                continue
            until = _parse_datetime(override.get("until"))
            temperature = override.get("temperature")
            if until is None or temperature is None or until <= now:
                continue
            self.manual_overrides[str(zone_id)] = {
                "temperature": float(temperature),
                "until": until,
            }

        bypasses: dict[str, Bypass] = {}
        for item in raw.get("bypasses") or []:
            if not isinstance(item, dict):
                continue
            try:
                bypass = Bypass.from_dict(item)
                bypasses[bypass.id] = bypass
            except (TypeError, ValueError):
                _LOGGER.warning("Ignoring invalid bypass: %s", item)
        self.bypasses = bypasses

        zones: dict[str, Zone] = {}
        for item in (raw.get("zones") or []):
            if not isinstance(item, dict):
                continue
            try:
                zone = Zone.from_dict(item)
                zones[zone.id] = zone
            except (TypeError, ValueError):
                _LOGGER.warning("Ignoring invalid zone: %s", item)
        self.zones = zones

    def _create_defaults(self) -> dict[str, Profile]:
        """Create default profiles."""
        profiles = {}
        defaults = {
            "comfort": ("Comfort", 20.0, "mdi:home-thermometer"),
            "eco": ("Eco", 19.0, "mdi:leaf"),
            "night": ("Notte", 18.0, "mdi:weather-night"),
            "away": ("Fuori casa", 17.0, "mdi:home-export"),
            "summer": ("Estate", 26.0, "mdi:sun-thermometer"),
        }
        for pid, (name, temp, icon) in defaults.items():
            profiles[pid] = Profile(
                id=pid,
                name=name,
                icon=icon,
                targets={},
                curves={},
                days={},
            )
            profiles[pid].hvac_mode = "heat"
        return profiles

    def _sync_zones(self) -> None:
        """Sync zones with config entry options."""
        options = dict(self.entry.options)
        zone_configs = options.get(CONF_ZONES, [])
        current: dict[str, Zone] = {}
        for cfg in zone_configs:
            zone = Zone.from_dict(cfg)
            current[zone.id] = zone
        for zone_id in list(self.zones):
            if zone_id not in current:
                self.zones.pop(zone_id, None)
                self.active_profiles.pop(zone_id, None)
                self.pinned_profiles.pop(zone_id, None)
                self.manual_overrides.pop(zone_id, None)
                self.disabled_zones.discard(zone_id)
        for zone_id, zone in current.items():
            if zone_id not in self.zones:
                self.zones[zone_id] = zone
                if zone_id not in self.active_profiles:
                    default = self._default_profile_id()
                    if default:
                        self.active_profiles[zone_id] = default
        self.zones = current

    def _save(self) -> None:
        """Persist state to storage."""
        data = {
            "enabled": self.enabled,
            "disabled_zones": sorted(self.disabled_zones),
            "manual_hold": self.settings["manual_hold"],
            "reassert_interval": self.settings["reassert_interval"],
            "scan_interval": self.settings["scan_interval"],
            "profiles": [p.to_dict() for p in self.profiles.values()],
            "bypasses": [b.to_dict() for b in self.bypasses.values()],
            "active_profiles": dict(self.active_profiles),
            "pinned_profiles": self._serialize_pins(),
            "manual_overrides": self._serialize_overrides(),
        }
        self._store.async_delay_save(lambda: data, 2.0)

    def _serialize_pins(self) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for zone_id, pin in self.pinned_profiles.items():
            until = pin.get("until")
            result[zone_id] = {
                "profile_id": pin.get("profile_id"),
                "until": until.isoformat() if isinstance(until, datetime) else None,
            }
        return result

    def _serialize_overrides(self) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for zone_id, override in self.manual_overrides.items():
            until = override.get("until")
            result[zone_id] = {
                "temperature": override.get("temperature"),
                "until": until.isoformat() if isinstance(until, datetime) else None,
            }
        return result

    def _expire(self, now: datetime) -> bool:
        """Expire timed items."""
        changed = False
        for bypass_id, bypass in list(self.bypasses.items()):
            if bypass.until <= now:
                self.bypasses.pop(bypass_id, None)
                changed = True
                self._fire(
                    EVENT_BYPASS_ENDED,
                    {ATTR_BYPASS: bypass.to_dict(), ATTR_ZONES: bypass.zones},
                )
        for zone_id, pin in list(self.pinned_profiles.items()):
            until = pin.get("until")
            if isinstance(until, datetime) and until <= now:
                self.pinned_profiles.pop(zone_id, None)
                changed = True
        for zone_id, override in list(self.manual_overrides.items()):
            until = override.get("until")
            if not isinstance(until, datetime) or until <= now:
                self.manual_overrides.pop(zone_id, None)
                changed = True
        return changed

    def _resolve_profile(self, zone_id: str, now: datetime) -> str | None:
        """Resolve the active profile for a zone."""
        pin = self.pinned_profiles.get(zone_id)
        if pin:
            profile_id = pin.get("profile_id")
            if profile_id in self.profiles:
                until = pin.get("until")
                if not isinstance(until, datetime) or until > now:
                    return profile_id
                self.pinned_profiles.pop(zone_id, None)
        active = self.active_profiles.get(zone_id)
        if active in self.profiles:
            return active
        return self._default_profile_id()

    async def async_tick(self) -> None:
        """Periodic tick to resolve and apply targets."""
        now = dt_util.now()
        self._expire(now)
        for zone_id in self.zones:
            zone = self.zones[zone_id]
            resolved = self._resolve_profile(zone_id, now)
            if resolved and self.active_profiles.get(zone_id) != resolved:
                self.active_profiles[zone_id] = resolved
                self._applied_mode.pop(zone_id, None)
                profile = self.profiles.get(resolved)
                self._fire(
                    EVENT_PROFILE_CHANGED,
                    {
                        ATTR_ZONE_ID: zone_id,
                        ATTR_PROFILE_ID: resolved,
                        ATTR_PROFILE_NAME: profile.name if profile else resolved,
                    },
                )
            await self._apply_zone(zone, now)
        self._save()

    async def _apply_zone(self, zone: Zone, now: datetime) -> None:
        """Apply target to a single zone."""
        target, source = self._effective_target(zone, now)
        if target is not None:
            target = zone.clamp(target)
        previous = self.effective_targets.get(zone.id)
        self.effective_targets[zone.id] = target
        if target is not None and (previous is None or abs(previous - target) >= 0.05):
            self._fire(
                EVENT_TARGET_CHANGED,
                {ATTR_ZONE_ID: zone.id, ATTR_TARGET: target, ATTR_SOURCE: source},
            )
        if target is None or source == "disabled":
            self._desired.pop(zone.id, None)
            return
        desired = self._desired.get(zone.id)
        actual = self._climate_target(zone)
        needs_apply = desired is None or abs(desired - target) >= 0.05
        reassert = self.settings["reassert_interval"]
        last_apply = self._last_apply.get(zone.id)
        if (
            not needs_apply
            and reassert > 0
            and (last_apply is None or now - last_apply >= timedelta(minutes=reassert))
            and (actual is None or abs(actual - target) > 0.4)
        ):
            needs_apply = True
        if needs_apply:
            await self._set_temperature(zone, target, now)
        profile = self.profiles.get(self.active_profiles.get(zone.id))
        mode = profile.hvac_mode if profile else None
        if mode and self._applied_mode.get(zone.id) != mode:
            await self._set_hvac_mode(zone, mode)
            self._applied_mode[zone.id] = mode

    def _effective_target(
        self, zone: Zone, now: datetime
    ) -> tuple[float | None, str]:
        """Calculate effective target with precedence."""
        if not self.enabled or zone.id in self.disabled_zones:
            return self._climate_target(zone), "disabled"
        bypass = active_bypass(self.bypasses.values(), zone.id, now)
        if bypass is not None:
            base = self._base_target(zone, now)
            return bypass.resolve(base), "bypass"
        override = self.manual_overrides.get(zone.id)
        if override:
            until = override.get("until")
            if not isinstance(until, datetime) or until > now:
                temperature = override.get("temperature")
                if temperature is not None:
                    return float(temperature), "override"
        target = self._base_target(zone, now)
        return target, "profile"

    def _base_target(self, zone: Zone, now: datetime) -> float:
        """Get base target from active profile."""
        profile_id = self.active_profiles.get(zone.id)
        profile = self.profiles.get(profile_id)
        if profile is not None:
            curve = profile.curves.get(zone.id, {}).get(_day_key(now))
            if curve:
                hour = now.hour
                return curve[hour] if 0 <= hour < 24 else zone.default_temp
        climate_target = self._climate_target(zone)
        if climate_target is not None:
            return climate_target
        return zone.default_temp

    def _climate_target(self, zone: Zone) -> float | None:
        """Read current target from climate entity."""
        state = self.hass.states.get(zone.climate_entity)
        if state is None or state.state in {STATE_UNAVAILABLE, STATE_UNKNOWN, "off"}:
            return None
        value = state.attributes.get("temperature")
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    async def _set_temperature(
        self, zone: Zone, target: float, now: datetime
    ) -> None:
        """Set temperature on climate entity."""
        state = self.hass.states.get(zone.climate_entity)
        if state is None or state.state in {STATE_UNAVAILABLE, STATE_UNKNOWN}:
            return
        self._desired[zone.id] = target
        self._last_apply[zone.id] = now
        self._ignore_until[zone.id] = now + timedelta(seconds=10)
        try:
            await self.hass.services.async_call(
                "climate",
                "set_temperature",
                {"entity_id": zone.climate_entity, "temperature": target},
                blocking=False,
            )
        except Exception:
            _LOGGER.exception("Could not set temperature on %s", zone.climate_entity)

    async def _set_hvac_mode(self, zone: Zone, mode: str) -> None:
        """Set HVAC mode on climate entity."""
        state = self.hass.states.get(zone.climate_entity)
        if state is None or state.state in {STATE_UNAVAILABLE, STATE_UNKNOWN}:
            return
        try:
            await self.hass.services.async_call(
                "climate",
                "set_hvac_mode",
                {"entity_id": zone.climate_entity, "hvac_mode": mode},
                blocking=False,
            )
        except Exception:
            _LOGGER.exception("Could not set hvac mode on %s", zone.climate_entity)

    @callback
    def _handle_state_change(self, event: Any) -> None:
        """Handle climate state changes for manual override detection."""
        entity_id = event.data.get("entity_id")
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        if entity_id is None or new_state is None:
            return
        zone = self._zone_for_climate(entity_id)
        if zone is None:
            return
        if new_state.state in {STATE_UNAVAILABLE, STATE_UNKNOWN, "off"}:
            return
        now = dt_util.now()
        ignore_until = self._ignore_until.get(zone.id)
        if ignore_until is not None and now < ignore_until:
            return
        if not self.enabled or zone.id in self.disabled_zones:
            return
        if active_bypass(self.bypasses.values(), zone.id, now) is not None:
            return
        new_temp = new_state.attributes.get("temperature")
        old_temp = old_state.attributes.get("temperature") if old_state else None
        if new_temp is None or old_temp is None:
            return
        try:
            new_temp = float(new_temp)
            old_temp = float(old_temp)
        except (TypeError, ValueError):
            return
        if abs(new_temp - old_temp) < 0.5:
            return
        hold_minutes = self.settings["manual_hold"]
        if hold_minutes <= 0:
            return
        until = now + timedelta(minutes=hold_minutes)
        self.manual_overrides[zone.id] = {"temperature": new_temp, "until": until}
        self._fire(
            EVENT_MANUAL_OVERRIDE,
            {ATTR_ZONE_ID: zone.id, ATTR_TARGET: new_temp, "until": until.isoformat()},
        )
        self._save()

    def _zone_for_climate(self, entity_id: str) -> Zone | None:
        """Find zone by climate entity."""
        for zone in self.zones.values():
            if zone.climate_entity == entity_id:
                return zone
        return None

    def _default_profile_id(self) -> str | None:
        """Get default profile ID."""
        if "comfort" in self.profiles:
            return "comfort"
        return next(iter(self.profiles), None)

    def _fire(self, event_type: str, data: dict[str, Any]) -> None:
        """Fire an event."""
        self.hass.bus.async_fire(event_type, data)

    def _notify(self) -> None:
        """Notify listeners."""
        pass

    async def async_set_profile(
        self,
        profile_id: str,
        zones: list[str] | None = None,
        duration: Any = None,
    ) -> None:
        """Pin a profile on zones."""
        zone_ids = self._resolve_zone_ids(zones)
        if profile_id == PROFILE_AUTO:
            for zone_id in zone_ids:
                self.pinned_profiles.pop(zone_id, None)
            self._save()
            self._notify()
            return
        if profile_id not in self.profiles:
            raise ValueError("unknown_profile")
        minutes = parse_duration_minutes(duration)
        now = dt_util.now()
        until = now + timedelta(minutes=minutes) if minutes else None
        profile = self.profiles[profile_id]
        for zone_id in zone_ids:
            self.pinned_profiles[zone_id] = {"profile_id": profile_id, "until": until}
            self.active_profiles[zone_id] = profile_id
            self.manual_overrides.pop(zone_id, None)
            self._applied_mode.pop(zone_id, None)
            self._fire(
                EVENT_PROFILE_CHANGED,
                {
                    ATTR_ZONE_ID: zone_id,
                    ATTR_PROFILE_ID: profile_id,
                    ATTR_PROFILE_NAME: profile.name,
                    ATTR_SOURCE: "manual",
                },
            )
        self._save()
        self._notify()

    async def async_start_bypass(
        self,
        zones: list[str] | None = None,
        temperature: float | None = None,
        offset: float | None = None,
        duration: Any = None,
        until: Any = None,
        source: str = "service",
    ) -> Bypass:
        """Start a timed bypass."""
        import uuid
        zone_ids = self._resolve_zone_ids(zones)
        if temperature is not None and offset is not None:
            raise ValueError("bypass_value_ambiguous")
        now = dt_util.now()
        end = resolve_end(duration, until, now, default_minutes=60)
        created: list[Bypass] = []
        if temperature is None and offset is None:
            for zone_id in zone_ids:
                base = self._base_target(self.zones[zone_id], now)
                bypass = Bypass(
                    id=uuid.uuid4().hex,
                    zones=[zone_id],
                    until=end,
                    created=now,
                    temperature=base,
                    source=source,
                )
                bypass.validate()
                created.append(bypass)
        else:
            bypass = Bypass(
                id=uuid.uuid4().hex,
                zones=[] if len(zone_ids) == len(self.zones) else zone_ids,
                until=end,
                created=now,
                temperature=temperature,
                offset=offset,
                source=source,
            )
            bypass.validate()
            created.append(bypass)
        for bypass in created:
            self.bypasses[bypass.id] = bypass
        for zone_id in zone_ids:
            self.manual_overrides.pop(zone_id, None)
        for bypass in created:
            self._fire(
                EVENT_BYPASS_STARTED,
                {ATTR_BYPASS: bypass.to_dict(), ATTR_ZONES: bypass.zones},
            )
        self._save()
        self._notify()
        return created[0]

    async def async_stop_bypass(self, zones: list[str] | None = None) -> None:
        """Stop bypasses for zones."""
        zone_ids = set(self._resolve_zone_ids(zones))
        to_remove = [
            bid
            for bid, bypass in self.bypasses.items()
            if not bypass.zones or zone_ids.intersection(bypass.zones)
        ]
        for bid in to_remove:
            bypass = self.bypasses.pop(bid)
            self._fire(
                EVENT_BYPASS_ENDED,
                {ATTR_BYPASS: bypass.to_dict(), ATTR_ZONES: bypass.zones},
            )
        self._save()
        self._notify()

    async def async_set_temperature(
        self,
        zones: list[str] | None = None,
        temperature: float | None = None,
        duration: Any = None,
    ) -> None:
        """Set a temporary temperature override."""
        zone_ids = self._resolve_zone_ids(zones)
        if temperature is None:
            raise ValueError("temperature_required")
        minutes = parse_duration_minutes(duration)
        now = dt_util.now()
        until = now + timedelta(minutes=minutes) if minutes else None
        for zone_id in zone_ids:
            self.manual_overrides[zone_id] = {
                "temperature": temperature,
                "until": until,
            }
        self._save()
        self._notify()

    async def async_enable(
        self, enabled: bool, zones: list[str] | None = None
    ) -> None:
        """Enable or disable control."""
        if zones:
            zone_ids = self._resolve_zone_ids(zones)
            if enabled:
                self.disabled_zones.difference_update(zone_ids)
            else:
                self.disabled_zones.update(zone_ids)
        else:
            self.enabled = enabled
        self._save()
        self._notify()

    async def async_create_profile(self, profile_dict: dict[str, Any]) -> Profile:
        """Create a new profile."""
        profile = Profile.from_dict(profile_dict)
        if profile.id in self.profiles:
            raise ValueError("profile_exists")
        self.profiles[profile.id] = profile
        self._save()
        self._notify()
        return profile

    async def async_update_profile(self, profile_dict: dict[str, Any]) -> Profile:
        """Update an existing profile."""
        profile = Profile.from_dict(profile_dict)
        if profile.id not in self.profiles:
            raise ValueError("unknown_profile")
        self.profiles[profile.id] = profile
        self._save()
        self._notify()
        return profile

    async def async_delete_profile(self, profile_id: str) -> None:
        """Delete a profile."""
        if profile_id not in self.profiles:
            raise ValueError("unknown_profile")
        self.profiles.pop(profile_id)
        for zone_id, pin in list(self.pinned_profiles.items()):
            if pin.get("profile_id") == profile_id:
                self.pinned_profiles.pop(zone_id, None)
        default = self._default_profile_id()
        for zone_id in self.zones:
            if self.active_profiles.get(zone_id) == profile_id:
                if default:
                    self.active_profiles[zone_id] = default
                else:
                    self.active_profiles.pop(zone_id, None)
                self._applied_mode.pop(zone_id, None)
        self._save()
        self._notify()

    async def async_clone_profile(
        self, source_id: str, name: str, zones: list[str] | None = None
    ) -> Profile:
        """Clone a profile."""
        import uuid
        source = self.profiles.get(source_id)
        if source is None:
            raise ValueError("unknown_profile")
        new_id = slugify(name) or f"{source_id}_clone_{uuid.uuid4().hex[:6]}"
        if new_id in self.profiles:
            new_id = f"{new_id}_{uuid.uuid4().hex[:6]}"
        import copy
        new_profile = copy.deepcopy(source)
        new_profile.id = new_id
        new_profile.name = name
        if zones:
            zone_ids = self._resolve_zone_ids(zones)
            new_profile.targets = {
                zid: source.targets.get(zid, 20.0) for zid in zone_ids
            }
            new_profile.curves = {
                zid: dict(source.curves.get(zid, {})) for zid in zone_ids
            }
            new_profile.days = {
                zid: list(source.days.get(zid, [])) for zid in zone_ids
            }
        self.profiles[new_id] = new_profile
        self._save()
        self._notify()
        return new_profile

    async def async_reload(self) -> None:
        """Reload profiles and activators."""
        self._save()
        self._notify()

    def _resolve_zone_ids(self, values: list[str] | None) -> list[str]:
        """Resolve zone IDs from input."""
        if not values:
            if not self.zones:
                raise ValueError("no_zones_configured")
            return list(self.zones.keys())
        resolved: list[str] = []
        for value in values:
            zone_id = str(value)
            if zone_id in self.zones:
                resolved.append(zone_id)
                continue
            zone = self._zone_for_climate(zone_id)
            if zone is None:
                raise ValueError("unknown_zone")
            resolved.append(zone.id)
        return list(dict.fromkeys(resolved))

    async def async_update_zone(
        self,
        zone_id: str,
        name: str | None = None,
        climate_entity: str | None = None,
        temperature_sensor: str | None = None,
        min_temp: float | None = None,
        max_temp: float | None = None,
        default_temp: float | None = None,
    ) -> None:
        """Update zone settings."""
        if zone_id not in self.zones:
            raise ValueError("unknown_zone")
        zone = self.zones[zone_id]
        if name is not None:
            zone.name = name
        if climate_entity is not None:
            zone.climate_entity = climate_entity
        if temperature_sensor is not None:
            zone.temperature_sensor = temperature_sensor
        if min_temp is not None:
            zone.min_temp = min_temp
        if max_temp is not None:
            zone.max_temp = max_temp
        if default_temp is not None:
            zone.default_temp = default_temp
        options = dict(self.entry.options)
        zone_list = options.get(CONF_ZONES, [])
        updated = False
        for i, cfg in enumerate(zone_list):
            if cfg.get("id") == zone_id:
                zone_list[i] = zone.to_dict()
                updated = True
                break
        if updated:
            options[CONF_ZONES] = zone_list
            self.hass.config_entries.async_update_entry(self.entry, options=options)
        self._save()
        self._notify()

    def current_temperature(self, zone: Zone) -> float | None:
        """Read current temperature from sensor or climate."""
        if zone.temperature_sensor:
            state = self.hass.states.get(zone.temperature_sensor)
            if state and state.state not in {STATE_UNAVAILABLE, STATE_UNKNOWN}:
                try:
                    return float(state.state)
                except (TypeError, ValueError):
                    pass
        return self._climate_target(zone)

    def target_temperature(self, zone_id: str) -> float | None:
        """Get effective target."""
        return self.effective_targets.get(zone_id)

    def active_profile_id(self, zone_id: str) -> str | None:
        """Get active profile ID."""
        pin = self.pinned_profiles.get(zone_id)
        if pin and pin.get("profile_id") in self.profiles:
            until = pin.get("until")
            if not isinstance(until, datetime) or until > dt_util.now():
                return str(pin["profile_id"])
        return self.active_profiles.get(zone_id)

    def active_profile_name(self, zone_id: str) -> str | None:
        """Get active profile name."""
        profile_id = self.active_profile_id(zone_id)
        profile = self.profiles.get(profile_id)
        return profile.name if profile else None

    def is_pinned(self, zone_id: str) -> bool:
        """Check if zone has pinned profile."""
        return zone_id in self.pinned_profiles

    def bypass_for_zone(self, zone_id: str) -> Bypass | None:
        """Get active bypass for zone."""
        return active_bypass(self.bypasses.values(), zone_id, dt_util.now())

    def bypass_remaining(self, zone_id: str) -> float | None:
        """Get remaining bypass seconds."""
        bypass = self.bypass_for_zone(zone_id)
        if bypass is None:
            return None
        return remaining_seconds(bypass, dt_util.now())

    def is_override_active(self, zone_id: str) -> bool:
        """Check if manual override is active."""
        override = self.manual_overrides.get(zone_id)
        if not override:
            return False
        until = override.get("until")
        return isinstance(until, datetime) and until > dt_util.now()

    def is_zone_enabled(self, zone_id: str) -> bool:
        """Check if zone is enabled."""
        return self.enabled and zone_id not in self.disabled_zones

    @property
    def zone_order(self) -> list[str]:
        """Get zone order."""
        return list(self.zones.keys())

    async def async_get_config(self) -> dict[str, Any]:
        """Get full config snapshot."""
        from homeassistant.util import dt as dt_util
        now = dt_util.now()
        return {
            "version": "0.3.0",
            "entry_id": self._entry_id,
            "enabled": self.enabled,
            "disabled_zones": sorted(self.disabled_zones),
            "settings": {
                "manual_hold": self.settings["manual_hold"],
                "reassert_interval": self.settings["reassert_interval"],
                "scan_interval": self.settings["scan_interval"],
            },
            "zones": [self._zone_snapshot(zone, now) for zone in self.zones.values()],
            "profiles": [profile.to_dict() for profile in self.profiles.values()],
            "activators": [],
            "bypasses": [
                {**bypass.to_dict(), "remaining": remaining_seconds(bypass, now)}
                for bypass in self.bypasses.values()
                if bypass.until > now
            ],
            "active_profiles": dict(self.active_profiles),
            "pinned_profiles": {
                zone_id: pin.get("profile_id")
                for zone_id, pin in self.pinned_profiles.items()
            },
            "manual_overrides": {
                zone_id: {
                    "temperature": override.get("temperature"),
                    "until": _iso(override.get("until")),
                }
                for zone_id, override in self.manual_overrides.items()
            },
            "hub": {
                "entity_ids": {
                    key: self._entity_id(domain, "hub", key)
                    for key, domain in _ENTITY_DOMAINS.items()
                },
                "enabled": self.enabled,
                "bypass_active": any(
                    bypass.until > now for bypass in self.bypasses.values()
                ),
            },
        }

    def _zone_snapshot(
        self, zone: Zone, now: datetime
    ) -> dict[str, Any]:
        """Get zone snapshot."""
        pin = self.pinned_profiles.get(zone.id) or {}
        return {
            "id": zone.id,
            "name": zone.name,
            "climate_entity": zone.climate_entity,
            "temperature_sensor": zone.temperature_sensor,
            "min_temp": zone.min_temp,
            "max_temp": zone.max_temp,
            "default_temp": zone.default_temp,
            "current_temperature": self.current_temperature(zone),
            "target_temperature": self.target_temperature(zone.id),
            "active_profile": self.active_profile_id(zone.id),
            "active_profile_name": self.active_profile_name(zone.id),
            "pinned": self.is_pinned(zone.id),
            "bypass_active": self.bypass_for_zone(zone.id) is not None,
            "bypass_remaining": self.bypass_remaining(zone.id),
            "override_active": self.is_override_active(zone.id),
            "enabled": self.is_zone_enabled(zone.id),
            "next_change": _iso(self.next_change_for(zone.id)),
            "forecast": self.target_forecast(zone),
            "entity_ids": {
                key: self._entity_id(domain, zone.id, key)
                for key, domain in _ENTITY_DOMAINS.items()
            },
        }

    def _entity_id(self, domain: str, zone_id: str, key: str) -> str | None:
        """Resolve entity ID from registry."""
        unique = entity_unique_id(self._entry_id, zone_id, key)
        ent_reg = er.async_get(self.hass)
        entity = ent_reg.async_get_entity_id(domain, DOMAIN, unique)
        return entity

    def next_change_for(self, zone_id: str) -> datetime | None:
        """Get next scheduled change (simplified: next hour boundary)."""
        now = dt_util.now()
        return now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)

    def target_forecast(self, zone: Zone, now: datetime | None = None) -> list[float]:
        """Get 24h forecast."""
        from homeassistant.util import dt as dt_util
        now = now or dt_util.now()
        if not self.enabled or zone.id in self.disabled_zones:
            current = self._climate_target(zone)
            return [current if current is not None else zone.default_temp] * 24
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        out: list[float] = []
        for hour in range(24):
            moment = start + timedelta(hours=hour)
            profile_id = self.active_profiles.get(zone.id)
            profile = self.profiles.get(profile_id)
            if profile:
                curve = profile.curves.get(zone.id, {}).get(_day_key(moment))
                if curve and 0 <= hour < 24:
                    out.append(round(curve[hour], 2))
                else:
                    out.append(zone.default_temp)
            else:
                climate = self._climate_target(zone)
                out.append(climate if climate is not None else zone.default_temp)
        return out


def _parse_datetime(value: Any) -> datetime | None:
    """Parse ISO datetime string."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _iso(value: Any) -> str | None:
    """Convert to ISO string."""
    return value.isoformat() if isinstance(value, datetime) else None


def _day_key(moment: datetime) -> str:
    """Get day key."""
    days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    return days[moment.weekday()]


_ENTITY_DOMAINS = {
    "current_temperature": "sensor",
    "target_temperature": "sensor",
    "next_change": "sensor",
    "bypass_remaining": "sensor",
    "bypass_active": "binary_sensor",
    "override_active": "binary_sensor",
    "profile": "select",
    "enabled": "switch",
}
