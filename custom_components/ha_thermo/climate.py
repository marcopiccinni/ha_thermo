"""Climate entities that mirror the linked physical thermostat."""

from __future__ import annotations

from homeassistant.components.climate import (
    ClimateEntity,
    ClimateEntityFeature,
    HVACAction,
    HVACMode,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import (
    ATTR_TEMPERATURE,
    STATE_OFF,
    STATE_UNAVAILABLE,
    STATE_UNKNOWN,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_CLIMATE_ENTITY, ENTITY_THERMOSTAT, entity_unique_id
from .entity import ThermoEntity
from .manager import ThermoManager

_HVAC_MAP = {
    "off": HVACMode.OFF,
    "heat": HVACMode.HEAT,
    "cool": HVACMode.COOL,
    "auto": HVACMode.AUTO,
    "heat_cool": HVACMode.HEAT_COOL,
    "dry": HVACMode.DRY,
    "fan_only": HVACMode.FAN_ONLY,
}


def _hvac_from_physical(state) -> HVACMode:
    if state is None or state.state in {STATE_UNAVAILABLE, STATE_UNKNOWN}:
        return HVACMode.OFF
    raw = state.attributes.get("hvac_mode", state.state)
    if raw in {STATE_OFF, "off"}:
        return HVACMode.OFF
    return _HVAC_MAP.get(str(raw), HVACMode.HEAT)


def _hvac_action_from_physical(state) -> HVACAction | None:
    if state is None:
        return None
    raw = state.attributes.get("hvac_action")
    if not raw:
        return None
    try:
        return HVACAction(str(raw))
    except ValueError:
        return None


class ThermoClimate(ThermoEntity, ClimateEntity):
    """Mirror of the physical climate entity for automations and UI."""

    _attr_translation_key = ENTITY_THERMOSTAT
    _attr_icon = "mdi:thermostat"
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE
        | ClimateEntityFeature.TURN_OFF
        | ClimateEntityFeature.TURN_ON
    )

    def __init__(self, coordinator, zone) -> None:
        super().__init__(coordinator, zone)
        assert self.zone is not None

    @property
    def unique_id(self) -> str:
        return entity_unique_id(
            self.manager.entry.entry_id, self.zone.id, ENTITY_THERMOSTAT
        )

    @property
    def extra_state_attributes(self) -> dict[str, str]:
        return {CONF_CLIMATE_ENTITY: self.zone.climate_entity}

    def _physical_state(self):
        return self.hass.states.get(self.zone.climate_entity)

    @property
    def min_temp(self) -> float:
        return float(self.zone.min_temp)

    @property
    def max_temp(self) -> float:
        return float(self.zone.max_temp)

    @property
    def target_temperature_step(self) -> float:
        return 0.5

    @property
    def hvac_modes(self) -> list[HVACMode]:
        physical = self._physical_state()
        if physical is None:
            return [HVACMode.HEAT, HVACMode.OFF]
        modes = physical.attributes.get("hvac_modes")
        if isinstance(modes, list) and modes:
            out: list[HVACMode] = []
            for item in modes:
                mapped = _HVAC_MAP.get(str(item))
                if mapped and mapped not in out:
                    out.append(mapped)
            return out or [HVACMode.HEAT, HVACMode.OFF]
        return [HVACMode.HEAT, HVACMode.OFF]

    @property
    def hvac_mode(self) -> HVACMode:
        return _hvac_from_physical(self._physical_state())

    @property
    def hvac_action(self) -> HVACAction | None:
        return _hvac_action_from_physical(self._physical_state())

    @property
    def current_temperature(self) -> float | None:
        value = self.manager.current_temperature(self.zone)
        return round(value, 1) if value is not None else None

    @property
    def target_temperature(self) -> float | None:
        value = self.manager.physical_setpoint(self.zone.id)
        return round(value, 1) if value is not None else None

    @property
    def available(self) -> bool:
        if not super().available:
            return False
        physical = self._physical_state()
        return physical is not None and physical.state not in {STATE_UNAVAILABLE, STATE_UNKNOWN}

    async def async_set_temperature(self, **kwargs) -> None:
        temperature = kwargs.get(ATTR_TEMPERATURE)
        if temperature is None:
            return
        await self.manager.async_set_temperature(
            [self.zone.climate_entity],
            float(temperature),
        )

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        if hvac_mode == HVACMode.OFF:
            await self.manager.async_set_power(False, [self.zone.climate_entity])
            return
        await self.manager.async_set_power(True, [self.zone.climate_entity])
        physical_mode = hvac_mode.value
        await self.manager.async_set_physical_hvac_mode(self.zone, physical_mode)

    async def async_turn_off(self) -> None:
        await self.manager.async_set_power(False, [self.zone.climate_entity])

    async def async_turn_on(self) -> None:
        await self.manager.async_set_power(True, [self.zone.climate_entity])


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Expose one climate entity per configured zone."""
    manager: ThermoManager = entry.runtime_data
    async_add_entities(
        [ThermoClimate(manager.coordinator, zone) for zone in manager.zones.values()]
    )