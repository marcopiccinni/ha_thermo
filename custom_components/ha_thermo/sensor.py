"""Sensor platform for HA Thermo."""

from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    ATTR_BYPASS,
    ATTR_NEXT_CHANGE,
    ATTR_OVERRIDE,
    ATTR_PROFILE_ID,
    ATTR_PROFILE_NAME,
    ATTR_ZONE_ID,
    ENTITY_BYPASS_REMAINING,
    ENTITY_CURRENT_TEMPERATURE,
    ENTITY_NEXT_CHANGE,
    ENTITY_TARGET_TEMPERATURE,
    entity_unique_id,
)
from .entity import ThermoEntity
from .manager import ThermoManager


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create the sensor entities for every configured zone."""
    manager: ThermoManager = entry.runtime_data
    entities: list[SensorEntity] = []
    for zone in manager.zones.values():
        entities.extend(
            [
                ZoneCurrentTemperature(manager.coordinator, zone),
                ZoneTargetTemperature(manager.coordinator, zone),
                ZoneNextChange(manager.coordinator, zone),
                ZoneBypassRemaining(manager.coordinator, zone),
            ]
        )
    async_add_entities(entities)


class _ZoneSensor(ThermoEntity, SensorEntity):
    """Base class for zone sensors."""

    _attr_has_entity_name = True

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


class ZoneCurrentTemperature(_ZoneSensor):
    """Current temperature of the room."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1
    _attr_icon = "mdi:thermometer"
    _attr_translation_key = ENTITY_CURRENT_TEMPERATURE

    @property
    def _key(self) -> str:
        return ENTITY_CURRENT_TEMPERATURE

    @property
    def native_unit_of_measurement(self) -> str:
        return self.hass.config.units.temperature_unit

    @property
    def native_value(self) -> float | None:
        value = self.manager.current_temperature(self.zone)
        return round(value, 2) if value is not None else None


class ZoneTargetTemperature(_ZoneSensor):
    """Effective target written to the climate entity."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_suggested_display_precision = 1
    _attr_icon = "mdi:thermometer-check"
    _attr_translation_key = ENTITY_TARGET_TEMPERATURE

    @property
    def _key(self) -> str:
        return ENTITY_TARGET_TEMPERATURE

    @property
    def native_unit_of_measurement(self) -> str:
        return self.hass.config.units.temperature_unit

    @property
    def native_value(self) -> float | None:
        value = self.manager.target_temperature(self.zone.id)
        return round(value, 2) if value is not None else None

    @property
    def extra_state_attributes(self) -> dict:
        bypass = self.manager.bypass_for_zone(self.zone.id)
        next_change = self.manager.next_change_for(self.zone.id)
        return {
            ATTR_ZONE_ID: self.zone.id,
            "climate_entity": self.zone.climate_entity,
            ATTR_PROFILE_ID: self.manager.active_profile_id(self.zone.id),
            ATTR_PROFILE_NAME: self.manager.active_profile_name(self.zone.id),
            ATTR_BYPASS: bypass.to_dict() if bypass else None,
            ATTR_OVERRIDE: self.manager.is_override_active(self.zone.id),
            ATTR_NEXT_CHANGE: (
                next_change.isoformat() if next_change else None
            ),
        }


class ZoneNextChange(_ZoneSensor):
    """Next scheduled profile or bypass change."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:clock-outline"
    _attr_translation_key = ENTITY_NEXT_CHANGE

    @property
    def _key(self) -> str:
        return ENTITY_NEXT_CHANGE

    @property
    def native_value(self) -> datetime | None:
        return self.manager.next_change_for(self.zone.id)


class ZoneBypassRemaining(_ZoneSensor):
    """Seconds left on the active bypass."""

    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS
    _attr_icon = "mdi:timer-sand"
    _attr_translation_key = ENTITY_BYPASS_REMAINING

    @property
    def _key(self) -> str:
        return ENTITY_BYPASS_REMAINING

    @property
    def native_value(self) -> float | None:
        return self.manager.bypass_remaining(self.zone.id)
