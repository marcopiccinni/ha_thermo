"""Select platform for HA Thermo."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    ENTITY_PROFILE,
    HUB_ZONE_ID,
    PROFILE_AUTO,
    entity_unique_id,
)
from .entity import ThermoEntity
from .manager import ThermoManager
from .models import Zone


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create the hub and per-zone profile selectors."""
    manager: ThermoManager = entry.runtime_data
    entities: list[SelectEntity] = [HubProfileSelect(manager.coordinator)]
    for zone in manager.zones.values():
        entities.append(ZoneProfileSelect(manager.coordinator, zone))
    async_add_entities(entities)


class _ProfileSelect(ThermoEntity, SelectEntity):
    """Base profile selector."""

    _attr_icon = "mdi:home-thermometer"
    _attr_translation_key = ENTITY_PROFILE

    def __init__(self, coordinator, zone: Zone | None = None) -> None:
        super().__init__(coordinator, zone)
        self._zone_id = zone.id if zone else HUB_ZONE_ID

    @property
    def unique_id(self) -> str:
        return entity_unique_id(
            self.manager.entry.entry_id, self._zone_id, ENTITY_PROFILE
        )

    @property
    def options(self) -> list[str]:
        profile_ids = sorted(
            self.manager.profiles.values(), key=lambda item: item.name
        )
        return [PROFILE_AUTO, *[profile.id for profile in profile_ids]]

    @property
    def current_option(self) -> str | None:
        return PROFILE_AUTO

    @property
    def extra_state_attributes(self) -> dict[str, str | None]:
        if self.zone is None:
            return {}
        return {
            "profile_source": self.manager.profile_source(self.zone.id),
            "weekly_profile_today": self.manager.weekly_profile_today(
                self.zone.id
            ),
            "pinned_until": self._pinned_until(),
        }

    def _pinned_until(self) -> str | None:
        if self.zone is None:
            return None
        pin = self.manager.pinned_profiles.get(self.zone.id) or {}
        until = pin.get("until")
        return until.isoformat() if hasattr(until, "isoformat") else None

    async def async_select_option(self, option: str) -> None:
        zones = [self.zone.id] if self.zone is not None else None
        try:
            await self.manager.async_set_profile(option, zones)
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err


class ZoneProfileSelect(_ProfileSelect):
    """Active profile for a single zone (Auto = follow activators)."""

    @property
    def current_option(self) -> str | None:
        if self.manager.is_pinned(self.zone.id):
            profile_id = self.manager.active_profile_id(self.zone.id)
            if profile_id:
                return profile_id
        return PROFILE_AUTO


class HubProfileSelect(_ProfileSelect):
    """Profile applied to every zone (Auto = follow activators)."""

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, None)

    @property
    def current_option(self) -> str | None:
        if self.zone is not None:
            return PROFILE_AUTO
        pinned = [
            self.manager.pinned_profiles.get(zone_id, {}).get("profile_id")
            for zone_id in self.manager.zone_order
        ]
        if pinned and len(set(pinned)) == 1 and pinned[0]:
            return str(pinned[0])
        return PROFILE_AUTO

    @property
    def available(self) -> bool:
        return True
