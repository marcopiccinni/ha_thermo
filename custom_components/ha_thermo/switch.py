"""Switch platform for HA Thermo."""

from __future__ import annotations

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    ENTITY_ENABLED,
    HUB_ZONE_ID,
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
    """Create the master and per-zone automation switches."""
    manager: ThermoManager = entry.runtime_data
    entities: list[SwitchEntity] = [HubEnabledSwitch(manager.coordinator)]
    for zone in manager.zones.values():
        entities.append(ZoneEnabledSwitch(manager.coordinator, zone))
    async_add_entities(entities)


class _EnabledSwitch(ThermoEntity, SwitchEntity):
    """Base switch for the automatic control."""

    _attr_icon = "mdi:auto-mode"
    _attr_translation_key = ENTITY_ENABLED

    def __init__(self, coordinator, zone: Zone | None = None) -> None:
        super().__init__(coordinator, zone)
        self._zone_id = zone.id if zone else HUB_ZONE_ID

    @property
    def unique_id(self) -> str:
        return entity_unique_id(
            self.manager.entry.entry_id, self._zone_id, ENTITY_ENABLED
        )

    @property
    def is_on(self) -> bool:
        raise NotImplementedError

    async def async_turn_on(self, **kwargs) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._set(False)

    async def _set(self, enabled: bool) -> None:
        raise NotImplementedError


class ZoneEnabledSwitch(_EnabledSwitch):
    """Enable/disable automatic control for a zone."""

    @property
    def is_on(self) -> bool:
        return self.manager.is_zone_enabled(self.zone.id)

    async def _set(self, enabled: bool) -> None:
        await self.manager.async_enable(enabled, [self.zone.id])


class HubEnabledSwitch(_EnabledSwitch):
    """Master switch for the whole integration."""

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, None)

    @property
    def is_on(self) -> bool:
        return self.manager.enabled

    @property
    def available(self) -> bool:
        return True

    async def _set(self, enabled: bool) -> None:
        await self.manager.async_enable(enabled)
