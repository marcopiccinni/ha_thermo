"""State manager for HA Thermo."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_TEMPERATURE,
    STATE_OFF,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.util import dt as dt_util

from .bypass import (
    active_bypass,
    parse_duration_minutes,
    remaining_seconds,
    resolve_end,
)
from .const import (
    ATTR_BYPASS,
    ATTR_PROFILE_ID,
    ATTR_PROFILE_NAME,
    ATTR_SOURCE,
    ATTR_TARGET,
    ATTR_UNTIL,
    ATTR_ZONE_ID,
    ATTR_ZONES,
    CONF_AWAY_TEMP,
    CONF_COMFORT_TEMP,
    CONF_ECO_TEMP,
    CONF_MANUAL_HOLD,
    CONF_NIGHT_TEMP,
    CONF_REASSERT_INTERVAL,
    CONF_SCAN_INTERVAL,
    CONF_SUMMER_TEMP,
    CONF_ZONES,
    DAYS,
    DEFAULT_ACTIVATOR_ID,
    DEFAULT_ACTIVATOR_NAME,
    DEFAULT_AWAY_TEMP,
    DEFAULT_COMFORT_TEMP,
    DEFAULT_ECO_TEMP,
    DEFAULT_MANUAL_HOLD,
    DEFAULT_NIGHT_TEMP,
    DEFAULT_PROFILES,
    DEFAULT_REASSERT_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_SUMMER_TEMP,
    DOMAIN,
    ENTITY_BYPASS_ACTIVE,
    ENTITY_BYPASS_REMAINING,
    ENTITY_CURRENT_TEMPERATURE,
    ENTITY_ENABLED,
    ENTITY_NEXT_CHANGE,
    ENTITY_OVERRIDE_ACTIVE,
    ENTITY_PROFILE,
    ENTITY_TARGET_TEMPERATURE,
    EVENT_BYPASS_ENDED,
    EVENT_BYPASS_STARTED,
    EVENT_MANUAL_OVERRIDE,
    EVENT_PROFILE_CHANGED,
    EVENT_TARGET_CHANGED,
    HUB_ZONE_ID,
    PROFILE_AUTO,
    PROFILE_ICON,
    VERSION,
    entity_unique_id,
)
from .models import Activator, Bypass, Profile, Zone, slugify
from .schedule import next_change, pick_activator, resolve_target
from .storage import ThermoStore

_LOGGER = logging.getLogger(__name__)

_ENTITY_DOMAINS: dict[str, str] = {
    ENTITY_CURRENT_TEMPERATURE: "sensor",
    ENTITY_TARGET_TEMPERATURE: "sensor",
    ENTITY_NEXT_CHANGE: "sensor",
    ENTITY_BYPASS_REMAINING: "sensor",
    ENTITY_BYPASS_ACTIVE: "binary_sensor",
    ENTITY_OVERRIDE_ACTIVE: "binary_sensor",
    ENTITY_PROFILE: "select",
    ENTITY_ENABLED: "switch",
}


def zones_from_options(options: dict[str, Any]) -> list[Zone]:
    """Build the configured zones from config-entry options."""
    raw_zones = options.get(CONF_ZONES) or []
    zones: list[Zone] = []
    for item in raw_zones:
        if not isinstance(item, dict):
            continue
        zone = Zone.from_dict(item)
        if zone.id and zone.climate_entity:
            zones.append(zone)
    return zones


def _int_setting(options: dict[str, Any], key: str, default: int) -> int:
    try:
        return int(options.get(key, default))
    except (TypeError, ValueError):
        return default


def _float_setting(options: dict[str, Any], key: str, default: float) -> float:
    try:
        return float(options.get(key, default))
    except (TypeError, ValueError):
        return default


class ThermoManager:
    """Own the profiles, activators, bypasses and the applied targets."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        zones: list[Zone],
        options: dict[str, Any],
    ) -> None:
        self.hass = hass
        self.entry = entry
        self.zones: dict[str, Zone] = {zone.id: zone for zone in zones}
        self.zone_order: list[str] = [zone.id for zone in zones]
        self.settings = {
            "manual_hold": _int_setting(
                options, CONF_MANUAL_HOLD, DEFAULT_MANUAL_HOLD
            ),
            "reassert_interval": _int_setting(
                options, CONF_REASSERT_INTERVAL, DEFAULT_REASSERT_INTERVAL
            ),
            "scan_interval": _int_setting(
                options, CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL
            ),
            "temps": {
                CONF_COMFORT_TEMP: _float_setting(
                    options, CONF_COMFORT_TEMP, DEFAULT_COMFORT_TEMP
                ),
                CONF_ECO_TEMP: _float_setting(
                    options, CONF_ECO_TEMP, DEFAULT_ECO_TEMP
                ),
                CONF_NIGHT_TEMP: _float_setting(
                    options, CONF_NIGHT_TEMP, DEFAULT_NIGHT_TEMP
                ),
                CONF_AWAY_TEMP: _float_setting(
                    options, CONF_AWAY_TEMP, DEFAULT_AWAY_TEMP
                ),
                CONF_SUMMER_TEMP: _float_setting(
                    options, CONF_SUMMER_TEMP, DEFAULT_SUMMER_TEMP
                ),
            },
        }

        self.profiles: dict[str, Profile] = {}
        self.activators: dict[str, Activator] = {}
        self.bypasses: dict[str, Bypass] = {}
        self.active_profiles: dict[str, str] = {}
        self.pinned_profiles: dict[str, dict[str, Any]] = {}
        self.manual_overrides: dict[str, dict[str, Any]] = {}
        self.disabled_zones: set[str] = set()
        self.enabled = True

        self.effective_targets: dict[str, float | None] = {}
        self.coordinator: Any = None
        self._store = ThermoStore(hass, entry.entry_id)
        self._unsub: list[Any] = []
        self._desired: dict[str, float] = {}
        self._last_apply: dict[str, datetime] = {}
        self._ignore_until: dict[str, datetime] = {}
        self._applied_mode: dict[str, str] = {}

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def async_initialize(self) -> None:
        """Load persisted state and start listening to the climate entities."""
        raw = await self._store.async_load()
        if raw:
            self._restore(raw)
        else:
            self._create_defaults()
        changed = self._sync_zones()
        self._expire(dt_util.now())
        self._start_listeners()
        if raw is None or changed:
            await self._store.async_flush(self._serialize())

    async def async_shutdown(self) -> None:
        """Stop listeners and flush the state."""
        for unsub in self._unsub:
            unsub()
        self._unsub.clear()
        await self._store.async_flush(self._serialize())

    def _start_listeners(self) -> None:
        entities = [zone.climate_entity for zone in self.zones.values()]
        if not entities:
            return
        self._unsub.append(
            async_track_state_change_event(
                self.hass, entities, self._handle_state_change
            )
        )

    def _notify(self) -> None:
        if self.coordinator is not None:
            self.hass.async_create_task(self.coordinator.async_request_refresh())

    def _save(self) -> None:
        self._store.async_save(self._serialize())

    def _serialize(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "disabled_zones": sorted(self.disabled_zones),
            "profiles": [profile.to_dict() for profile in self.profiles.values()],
            "activators": [
                activator.to_dict() for activator in self.activators.values()
            ],
            "bypasses": [item.to_dict() for item in self.bypasses.values()],
            "active_profiles": dict(self.active_profiles),
            "pinned_profiles": self._serialize_pins(),
            "manual_overrides": self._serialize_overrides(),
        }

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

    def _restore(self, raw: dict[str, Any]) -> None:
        self.enabled = bool(raw.get("enabled", True))
        self.disabled_zones = {
            str(zone) for zone in raw.get("disabled_zones") or []
        }

        profiles: dict[str, Profile] = {}
        for item in raw.get("profiles") or []:
            if not isinstance(item, dict):
                continue
            try:
                profile = Profile.from_dict(item)
            except (TypeError, ValueError):
                _LOGGER.warning("Ignoring invalid stored profile: %s", item)
                continue
            profiles[profile.id] = profile
        self.profiles = profiles

        activators: dict[str, Activator] = {}
        for item in raw.get("activators") or []:
            if not isinstance(item, dict):
                continue
            try:
                activator = Activator.from_dict(item)
            except (TypeError, ValueError):
                _LOGGER.warning("Ignoring invalid stored activator: %s", item)
                continue
            activators[activator.id] = activator
        self.activators = activators

        bypasses: dict[str, Bypass] = {}
        for item in raw.get("bypasses") or []:
            if not isinstance(item, dict):
                continue
            try:
                bypass = Bypass.from_dict(item)
            except (TypeError, ValueError):
                _LOGGER.warning("Ignoring invalid stored bypass: %s", item)
                continue
            bypasses[bypass.id] = bypass
        self.bypasses = bypasses

        now = dt_util.now()
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

    def _create_defaults(self) -> None:
        temps = self.settings["temps"]
        for profile_id, name, temp_key in DEFAULT_PROFILES:
            profile = Profile(
                id=profile_id,
                name=name,
                icon=PROFILE_ICON,
            )
            for zone in self.zones.values():
                profile.ensure_zone(zone.id, temps[temp_key])
            self.profiles[profile_id] = profile

        default = self._default_profile_id()
        if default:
            for zone in self.zones.values():
                self.active_profiles[zone.id] = default

        self.activators[DEFAULT_ACTIVATOR_ID] = Activator(
            id=DEFAULT_ACTIVATOR_ID,
            name=DEFAULT_ACTIVATOR_NAME,
            profile_id="comfort",
            zones=[],
            days=list(DAYS),
            start="00:00",
            end=None,
            priority=0,
            enabled=True,
        )

    def _sync_zones(self) -> bool:
        """Align stored profiles with the zones configured in options."""
        changed = False
        current = set(self.zones)

        for profile in self.profiles.values():
            for zone_id in list(profile.targets):
                if zone_id not in current:
                    profile.targets.pop(zone_id, None)
                    changed = True
            for zone_id in list(profile.curves):
                if zone_id not in current:
                    profile.curves.pop(zone_id, None)
                    changed = True
            for zone_id in list(profile.days):
                if zone_id not in current:
                    profile.days.pop(zone_id, None)
                    changed = True
            for zone in self.zones.values():
                if profile.ensure_zone(zone.id, zone.default_temp):
                    changed = True

        default_profile = self._default_profile_id()
        for zone_id in list(self.active_profiles):
            if (
                zone_id not in current
                or self.active_profiles[zone_id] not in self.profiles
            ):
                self.active_profiles.pop(zone_id, None)
                changed = True
        for zone_id in current:
            if zone_id not in self.active_profiles and default_profile:
                self.active_profiles[zone_id] = default_profile
                changed = True

        for zone_id in list(self.pinned_profiles):
            pin = self.pinned_profiles.get(zone_id, {})
            if zone_id not in current or pin.get("profile_id") not in self.profiles:
                self.pinned_profiles.pop(zone_id, None)
                changed = True

        for zone_id in list(self.manual_overrides):
            if zone_id not in current:
                self.manual_overrides.pop(zone_id, None)
                changed = True

        self.disabled_zones &= current

        for activator in self.activators.values():
            if activator.zones:
                filtered = [zone for zone in activator.zones if zone in current]
                if filtered != activator.zones:
                    activator.zones = filtered
                    if not filtered:
                        activator.enabled = False
                    changed = True

        for bypass_id, bypass in list(self.bypasses.items()):
            if bypass.zones:
                filtered = [zone for zone in bypass.zones if zone in current]
                if filtered != bypass.zones:
                    bypass.zones = filtered
                    changed = True
                if not filtered:
                    self.bypasses.pop(bypass_id, None)
                    changed = True

        return changed

    # ------------------------------------------------------------------
    # Periodic resolution
    # ------------------------------------------------------------------

    async def async_tick(self) -> None:
        """Resolve activators and apply the effective target to every zone."""
        now = dt_util.now()
        changed = self._expire(now)

        for zone_id in self.zone_order:
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
                changed = True
            await self._apply_zone(zone, now)

        if changed:
            self._save()

    def _expire(self, now: datetime) -> bool:
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
        pin = self.pinned_profiles.get(zone_id)
        if pin:
            profile_id = pin.get("profile_id")
            if profile_id in self.profiles:
                return profile_id
            self.pinned_profiles.pop(zone_id, None)

        activator = pick_activator(
            self.activators.values(),
            zone_id,
            now,
            self._condition_state,
        )
        if activator and activator.profile_id in self.profiles:
            return activator.profile_id

        active = self.active_profiles.get(zone_id)
        if active in self.profiles:
            return active
        return self._default_profile_id()

    def _condition_state(self, entity_id: str) -> str | None:
        state = self.hass.states.get(entity_id)
        return state.state if state is not None else None

    def _effective_target(
        self, zone: Zone, now: datetime
    ) -> tuple[float | None, str]:
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
        profile = self._active_profile_for_zone(zone.id)
        if profile is not None:
            return resolve_target(profile, zone, now, zone.default_temp)
        climate_target = self._climate_target(zone)
        if climate_target is not None:
            return climate_target
        return zone.default_temp

    def _active_profile_for_zone(self, zone_id: str) -> Profile | None:
        profile_id = self.active_profiles.get(zone_id)
        return self.profiles.get(profile_id) if profile_id else None

    async def _apply_zone(self, zone: Zone, now: datetime) -> None:
        target, source = self._effective_target(zone, now)
        if target is not None:
            target = zone.clamp(target)

        previous = self.effective_targets.get(zone.id)
        self.effective_targets[zone.id] = target
        if (
            target is not None
            and (previous is None or abs(previous - target) >= 0.05)
        ):
            self._fire(
                EVENT_TARGET_CHANGED,
                {
                    ATTR_ZONE_ID: zone.id,
                    ATTR_TARGET: target,
                    ATTR_SOURCE: source,
                },
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

        profile = self._active_profile_for_zone(zone.id)
        mode = profile.hvac_mode if profile else None
        if mode and self._applied_mode.get(zone.id) != mode:
            await self._set_hvac_mode(zone, mode)
            self._applied_mode[zone.id] = mode

    async def _set_temperature(
        self, zone: Zone, target: float, now: datetime
    ) -> None:
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
                {
                    ATTR_ENTITY_ID: zone.climate_entity,
                    ATTR_TEMPERATURE: target,
                },
                blocking=False,
            )
        except Exception:  # a broken climate must not stop the other zones
            _LOGGER.exception(
                "Could not set temperature %.1f on %s",
                target,
                zone.climate_entity,
            )

    async def _set_hvac_mode(self, zone: Zone, mode: str) -> None:
        state = self.hass.states.get(zone.climate_entity)
        if state is None or state.state in {STATE_UNAVAILABLE, STATE_UNKNOWN}:
            return
        try:
            await self.hass.services.async_call(
                "climate",
                "set_hvac_mode",
                {ATTR_ENTITY_ID: zone.climate_entity, "hvac_mode": mode},
                blocking=False,
            )
        except Exception:
            _LOGGER.exception(
                "Could not set hvac mode %s on %s", mode, zone.climate_entity
            )

    @callback
    def _handle_state_change(self, event: Event) -> None:
        entity_id = event.data.get("entity_id")
        new_state = event.data.get("new_state")
        old_state = event.data.get("old_state")
        if entity_id is None or new_state is None:
            return
        zone = self._zone_for_climate(entity_id)
        if zone is None:
            return
        if new_state.state in {STATE_UNAVAILABLE, STATE_UNKNOWN, STATE_OFF}:
            return

        now = dt_util.now()
        ignore_until = self._ignore_until.get(zone.id)
        if ignore_until is not None and now < ignore_until:
            return
        if not self.enabled or zone.id in self.disabled_zones:
            return
        if active_bypass(self.bypasses.values(), zone.id, now) is not None:
            return

        actual = new_state.attributes.get(ATTR_TEMPERATURE)
        if actual is None:
            return
        try:
            actual = float(actual)
        except (TypeError, ValueError):
            return

        old_temperature = (
            old_state.attributes.get(ATTR_TEMPERATURE) if old_state else None
        )
        if old_temperature is not None:
            try:
                if abs(float(old_temperature) - actual) < 0.05:
                    return
            except (TypeError, ValueError):
                pass

        desired = self._desired.get(zone.id)
        if desired is None or abs(actual - desired) < 0.3:
            return

        hold = self.settings["manual_hold"]
        if hold <= 0:
            return

        until = now + timedelta(minutes=hold)
        self.manual_overrides[zone.id] = {
            "temperature": zone.clamp(actual),
            "until": until,
        }
        self._desired[zone.id] = zone.clamp(actual)
        self._last_apply[zone.id] = now
        self._fire(
            EVENT_MANUAL_OVERRIDE,
            {
                ATTR_ZONE_ID: zone.id,
                ATTR_TEMPERATURE: zone.clamp(actual),
                ATTR_UNTIL: until.isoformat(),
            },
        )
        self._save()
        self._notify()

    # ------------------------------------------------------------------
    # State exposed to entities and cards
    # ------------------------------------------------------------------

    def _climate_target(self, zone: Zone) -> float | None:
        state = self.hass.states.get(zone.climate_entity)
        if state is None:
            return None
        value = state.attributes.get(ATTR_TEMPERATURE)
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def current_temperature(self, zone: Zone) -> float | None:
        if zone.temperature_sensor:
            state = self.hass.states.get(zone.temperature_sensor)
            if state is not None and state.state not in {
                STATE_UNAVAILABLE,
                STATE_UNKNOWN,
            }:
                try:
                    return float(state.state)
                except (TypeError, ValueError):
                    pass
        state = self.hass.states.get(zone.climate_entity)
        if state is None:
            return None
        value = state.attributes.get("current_temperature")
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def target_temperature(self, zone_id: str) -> float | None:
        return self.effective_targets.get(zone_id)

    def active_profile_id(self, zone_id: str) -> str | None:
        pin = self.pinned_profiles.get(zone_id)
        if pin and pin.get("profile_id") in self.profiles:
            until = pin.get("until")
            if not isinstance(until, datetime) or until > dt_util.now():
                return str(pin["profile_id"])
        return self.active_profiles.get(zone_id)

    def active_profile_name(self, zone_id: str) -> str | None:
        profile = self._active_profile_for_zone(zone_id)
        return profile.name if profile else None

    def is_pinned(self, zone_id: str) -> bool:
        return zone_id in self.pinned_profiles

    def bypass_for_zone(self, zone_id: str) -> Bypass | None:
        return active_bypass(self.bypasses.values(), zone_id, dt_util.now())

    def bypass_remaining(self, zone_id: str) -> float | None:
        bypass = self.bypass_for_zone(zone_id)
        if bypass is None:
            return None
        return remaining_seconds(bypass, dt_util.now())

    def is_override_active(self, zone_id: str) -> bool:
        override = self.manual_overrides.get(zone_id)
        if not override:
            return False
        until = override.get("until")
        return isinstance(until, datetime) and until > dt_util.now()

    def is_zone_enabled(self, zone_id: str) -> bool:
        return self.enabled and zone_id not in self.disabled_zones

    def next_change_for(self, zone_id: str) -> datetime | None:
        zone = self.zones.get(zone_id)
        if zone is None:
            return None
        now = dt_util.now()
        bypass = self.bypass_for_zone(zone_id)
        if bypass is not None:
            return bypass.until
        override = self.manual_overrides.get(zone_id)
        if override and isinstance(override.get("until"), datetime):
            until = override["until"]
            if until > now:
                return until
        pin = self.pinned_profiles.get(zone_id)
        if pin and isinstance(pin.get("until"), datetime):
            until = pin["until"]
            if until > now:
                return until
        profile = self._active_profile_for_zone(zone_id)
        return next_change(
            profile,
            self.activators.values(),
            zone,
            now,
            self._condition_state,
            zone.default_temp,
        )

    def _zone_snapshot(self, zone: Zone) -> dict[str, Any]:
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
            "entity_ids": {
                key: self._entity_id(domain, zone.id, key)
                for key, domain in _ENTITY_DOMAINS.items()
            },
        }

    async def async_get_config(self) -> dict[str, Any]:
        """Return the full snapshot consumed by the Lovelace cards."""
        now = dt_util.now()
        return {
            "version": VERSION,
            "entry_id": self.entry.entry_id,
            "enabled": self.enabled,
            "disabled_zones": sorted(self.disabled_zones),
            "settings": {
                "manual_hold": self.settings["manual_hold"],
                "reassert_interval": self.settings["reassert_interval"],
                "scan_interval": self.settings["scan_interval"],
            },
            "zones": [self._zone_snapshot(zone) for zone in self.zones.values()],
            "profiles": [profile.to_dict() for profile in self.profiles.values()],
            "activators": [
                activator.to_dict() for activator in self.activators.values()
            ],
            "bypasses": [
                {
                    **bypass.to_dict(),
                    "remaining": remaining_seconds(bypass, now),
                }
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
                    key: self._entity_id(domain, HUB_ZONE_ID, key)
                    for key, domain in _ENTITY_DOMAINS.items()
                },
                "enabled": self.enabled,
                "bypass_active": any(
                    bypass.until > now for bypass in self.bypasses.values()
                ),
            },
        }

    def _entity_id(self, domain: str, zone_id: str, key: str) -> str | None:
        registry = er.async_get(self.hass)
        unique_id = entity_unique_id(self.entry.entry_id, zone_id, key)
        return registry.async_get_entity_id(domain, DOMAIN, unique_id)

    # ------------------------------------------------------------------
    # User actions
    # ------------------------------------------------------------------

    async def async_set_profile(
        self,
        profile_id: str,
        zones: list[str] | None = None,
        duration: Any = None,
    ) -> None:
        """Pin a profile on some or all zones."""
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
            self.pinned_profiles[zone_id] = {
                "profile_id": profile_id,
                "until": until,
            }
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
        """Create a timed bypass. Without temp/offset it freezes the target."""
        zone_ids = self._resolve_zone_ids(zones)
        if temperature is not None and offset is not None:
            raise ValueError("bypass_value_ambiguous")
        now = dt_util.now()
        end = resolve_end(duration, until, now)

        created: list[Bypass] = []
        if temperature is None and offset is None:
            # Freeze: remember the current target of every selected zone.
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
                {ATTR_BYPASS: bypass.to_dict(), ATTR_ZONES: zone_ids},
            )
        self._save()
        self._notify()
        return created[0]

    async def async_stop_bypass(self, zones: list[str] | None = None) -> int:
        """Cancel bypasses, optionally limited to some zones."""
        if zones is None:
            selected = set(self.zones)
        else:
            selected = set(self._resolve_zone_ids(zones))
        removed = 0
        for bypass_id, bypass in list(self.bypasses.items()):
            if not bypass.zones or selected & set(bypass.zones):
                self.bypasses.pop(bypass_id, None)
                removed += 1
                self._fire(
                    EVENT_BYPASS_ENDED,
                    {ATTR_BYPASS: bypass.to_dict(), ATTR_ZONES: bypass.zones},
                )
        if removed:
            self._save()
            self._notify()
        return removed

    async def async_set_temperature(
        self,
        zones: list[str] | None,
        temperature: float,
        duration: Any = None,
    ) -> Bypass:
        """Temporary absolute temperature, implemented as a bypass."""
        return await self.async_start_bypass(
            zones=zones,
            temperature=temperature,
            duration=duration,
            source="temperature",
        )

    async def async_enable(
        self, enabled: bool, zones: list[str] | None = None
    ) -> None:
        """Enable/disable automatic control globally or per zone."""
        if zones is None:
            self.enabled = bool(enabled)
        else:
            for zone_id in self._resolve_zone_ids(zones):
                if enabled:
                    self.disabled_zones.discard(zone_id)
                else:
                    self.disabled_zones.add(zone_id)
        self._save()
        self._notify()

    # ------------------------------------------------------------------
    # Profile CRUD
    # ------------------------------------------------------------------

    async def async_create_profile(self, data: dict[str, Any]) -> Profile:
        profile = Profile.from_dict(data)
        profile.id = self._unique_profile_id(profile.name)
        self._prepare_profile(profile)
        self.profiles[profile.id] = profile
        self._save()
        self._notify()
        return profile

    async def async_update_profile(self, data: dict[str, Any]) -> Profile:
        profile_id = str(data.get("id") or "")
        if profile_id not in self.profiles:
            raise ValueError("unknown_profile")
        profile = Profile.from_dict({**data, "id": profile_id})
        self._prepare_profile(profile)
        self.profiles[profile_id] = profile
        for zone_id in self.zone_order:
            if self.active_profiles.get(zone_id) == profile_id:
                self._applied_mode.pop(zone_id, None)
        self._save()
        self._notify()
        return profile

    async def async_delete_profile(self, profile_id: str) -> None:
        if profile_id not in self.profiles:
            raise ValueError("unknown_profile")
        self.profiles.pop(profile_id)
        for key, activator in list(self.activators.items()):
            if activator.profile_id == profile_id:
                self.activators.pop(key, None)
        for zone_id, pin in list(self.pinned_profiles.items()):
            if pin.get("profile_id") == profile_id:
                self.pinned_profiles.pop(zone_id, None)
        default = self._default_profile_id()
        for zone_id in self.zone_order:
            if self.active_profiles.get(zone_id) == profile_id:
                if default:
                    self.active_profiles[zone_id] = default
                else:
                    self.active_profiles.pop(zone_id, None)
                self._applied_mode.pop(zone_id, None)
        self._save()
        self._notify()

    async def async_clone_profile(
        self,
        source_id: str,
        name: str,
        zones: list[str] | None = None,
    ) -> Profile:
        source = self.profiles.get(source_id)
        if source is None:
            raise ValueError("unknown_profile")
        clean_name = str(name or "").strip()
        if not clean_name:
            raise ValueError("profile_name_required")
        selected = self._resolve_zone_ids(zones) if zones else None
        clone = source.clone(self._unique_profile_id(clean_name), clean_name, selected)
        self._prepare_profile(clone, selected)
        self.profiles[clone.id] = clone
        self._save()
        self._notify()
        return clone

    def _prepare_profile(
        self, profile: Profile, zone_ids: list[str] | None = None
    ) -> None:
        targets = (
            [self.zones[zone_id] for zone_id in zone_ids]
            if zone_ids
            else list(self.zones.values())
        )
        for zone in targets:
            profile.ensure_zone(zone.id, zone.default_temp)
        profile.validate()

    def _unique_profile_id(self, name: str, exclude: str | None = None) -> str:
        base = slugify(name, "profilo")
        candidate = base
        index = 2
        while candidate in self.profiles and candidate != exclude:
            candidate = f"{base}_{index}"
            index += 1
        return candidate

    def _default_profile_id(self) -> str | None:
        if "comfort" in self.profiles:
            return "comfort"
        return next(iter(self.profiles), None)

    # ------------------------------------------------------------------
    # Activator CRUD
    # ------------------------------------------------------------------

    async def async_create_activator(self, data: dict[str, Any]) -> Activator:
        activator = Activator.from_dict(data)
        activator.id = self._unique_activator_id(activator.name)
        self._prepare_activator(activator)
        self.activators[activator.id] = activator
        self._save()
        self._notify()
        return activator

    async def async_update_activator(self, data: dict[str, Any]) -> Activator:
        activator_id = str(data.get("id") or "")
        if activator_id not in self.activators:
            raise ValueError("unknown_activator")
        activator = Activator.from_dict({**data, "id": activator_id})
        self._prepare_activator(activator)
        self.activators[activator_id] = activator
        self._save()
        self._notify()
        return activator

    async def async_delete_activator(self, activator_id: str) -> None:
        if activator_id not in self.activators:
            raise ValueError("unknown_activator")
        self.activators.pop(activator_id)
        self._save()
        self._notify()

    def _prepare_activator(self, activator: Activator) -> None:
        if activator.zones:
            activator.zones = [
                self.zones[zone_id].id
                for zone_id in self._resolve_zone_ids(activator.zones)
            ]
        activator.validate(set(self.profiles))

    def _unique_activator_id(self, name: str) -> str:
        base = slugify(name, "attivatore")
        candidate = base
        index = 2
        while candidate in self.activators:
            candidate = f"{base}_{index}"
            index += 1
        return candidate

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _resolve_zone_ids(self, values: list[str] | None) -> list[str]:
        if not values:
            if not self.zone_order:
                raise ValueError("no_zones_configured")
            return list(self.zone_order)
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

    def _zone_for_climate(self, entity_id: str) -> Zone | None:
        for zone in self.zones.values():
            if zone.climate_entity == entity_id:
                return zone
        return None

    def _fire(self, event_type: str, data: dict[str, Any]) -> None:
        self.hass.bus.async_fire(event_type, data)

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
        """Update zone settings and persist to config entry options."""
        if zone_id not in self.zones:
            raise ValueError("unknown_zone")
        zone = self.zones[zone_id]

        new_name = name if name is not None else zone.name
        new_climate = climate_entity if climate_entity is not None else zone.climate_entity
        new_sensor = temperature_sensor if temperature_sensor is not None else zone.temperature_sensor
        new_min = min_temp if min_temp is not None else zone.min_temp
        new_max = max_temp if max_temp is not None else zone.max_temp
        new_default = default_temp if default_temp is not None else zone.default_temp

        if not new_name.strip():
            raise ValueError("zone_name_required")
        if not new_climate or not new_climate.startswith("climate."):
            raise ValueError("zone_invalid_climate")
        if new_max <= new_min:
            raise ValueError("zone_invalid_limits")

        options = dict(self.entry.options)
        zones_list = [dict(z) for z in options.get(CONF_ZONES, [])]
        if not zones_list and self.entry.data.get(CONF_ZONES):
            zones_list = [dict(z) for z in self.entry.data[CONF_ZONES]]

        found = False
        for z in zones_list:
            if z.get("id") == zone_id:
                z["name"] = new_name
                z["climate_entity"] = new_climate
                z["temperature_sensor"] = new_sensor
                z["min_temp"] = float(new_min)
                z["max_temp"] = float(new_max)
                z["default_temp"] = float(new_default)
                found = True
                break

        if not found:
            zones_list.append({
                "id": zone_id,
                "name": new_name,
                "climate_entity": new_climate,
                "temperature_sensor": new_sensor,
                "min_temp": float(new_min),
                "max_temp": float(new_max),
                "default_temp": float(new_default),
            })

        options[CONF_ZONES] = zones_list
        self.hass.config_entries.async_update_entry(self.entry, options=options)

    async def async_reload(self) -> None:
        """Re-evaluate the current state."""
        await self.async_tick()
        self._save()
        self._notify()


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt_util.now().tzinfo)
    return parsed


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None
