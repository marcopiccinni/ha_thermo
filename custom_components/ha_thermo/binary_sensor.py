"""Binary sensor platform for HA Thermo."""

from __future__ import annotations

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import (
    ATTR_PROFILE_ID,
    ATTR_ZONE_ID,
    ENTITY_BYPASS_ACTIVE,
    ENTITY_OVERRIDE_ACTIVE,
    HUB_ZONE_ID,
    entity_unique_id,
)
from .entity import ThermoEntity
from .manager import ThermoManager


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create bypass/override binary sensors for every zone."""
    manager: ThermoManager = entry.runtime_data
    entities: list[BinarySensorEntity] = [HubBypassActive(manager.coordinator)]
    for zone in manager.zones.values():
        entities.extend(
            [
                ZoneBypassActive(manager.coordinator, zone),
                ZoneOverrideActive(manager.coordinator, zone),
            ]
        )
    async_add_entities(entities)


class _ZoneBinarySensor(ThermoEntity, BinarySensorEntity):
    """Base class for zone binary sensors."""

    def __init__(self, coordinator, zone) -> None:
        super().__init__(coordinator, zone)
        assert self.zone is not None

    @property
    def _key(self) -> str:
        raise NotImplementedError

    @property
    def unique_id(self) -> str:
        return entity_unique_id(
            self.manager.entry.entry_id, self.zone.id, self._key
        )

    @property
    def extra_state_attributes(self) -> dict:
        return {
            ATTR_ZONE_ID: self.zone.id,
            ATTR_PROFILE_ID: self.manager.active_profile_id(self.zone.id),
        }


class ZoneBypassActive(_ZoneBinarySensor):
    """True while a timed bypass is active for the zone."""

    _attr_device_class = BinarySensorDeviceClass.RUNNING
    _attr_icon = "mdi:shield-clock"
    _attr_translation_key = ENTITY_BYPASS_ACTIVE

    @property
    def _key(self) -> str:
        return ENTITY_BYPASS_ACTIVE

    @property
    def is_on(self) -> bool:
        return self.manager.bypass_for_zone(self.zone.id) is not None


class ZoneOverrideActive(_ZoneBinarySensor):
    """True while a manual override is being held."""

    _attr_icon = "mdi:hand-back-right"
    _attr_translation_key = ENTITY_OVERRIDE_ACTIVE

    @property
    def _key(self) -> str:
        return ENTITY_OVERRIDE_ACTIVE

    @property
    def is_on(self) -> bool:
        return self.manager.is_override_active(self.zone.id)


class HubBypassActive(ThermoEntity, BinarySensorEntity):
    """True when at least one bypass is active anywhere."""

    _attr_device_class = BinarySensorDeviceClass.RUNNING
    _attr_icon = "mdi:shield-clock"
    _attr_translation_key = ENTITY_BYPASS_ACTIVE

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator, None)

    @property
    def unique_id(self) -> str:
        return entity_unique_id(
            self.manager.entry.entry_id, HUB_ZONE_ID, ENTITY_BYPASS_ACTIVE
        )

    @property
    def is_on(self) -> bool:
        now = dt_util.now()
        return any(
            bypass.until > now for bypass in self.manager.bypasses.values()
        )

    @property
    def available(self) -> bool:
        return True
