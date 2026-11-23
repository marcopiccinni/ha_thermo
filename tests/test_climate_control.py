"""Physical thermostat power, setpoint, and external sync tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("homeassistant")

from homeassistant.const import STATE_OFF
from homeassistant.core import HomeAssistant

from custom_components.ha_thermo.const import CONF_ZONES
from custom_components.ha_thermo.manager import ThermoManager
from custom_components.ha_thermo.models import Zone


def _zone() -> Zone:
    return Zone(
        id="z1",
        name="Sala",
        climate_entity="climate.sala",
        min_temp=5.0,
        max_temp=30.0,
        default_temp=20.0,
    )


@pytest.fixture
async def manager(hass: HomeAssistant) -> ThermoManager:
    hass.states.async_set(
        "climate.sala",
        "heat",
        {"temperature": 20.0, "current_temperature": 19.5, "hvac_mode": "heat"},
    )
    entry = MagicMock()
    entry.entry_id = "test-entry"
    entry.title = "HA Thermo"
    entry.options = {CONF_ZONES: [_zone().to_dict()]}
    mgr = ThermoManager(hass, entry)
    await mgr.async_setup()
    mgr.coordinator = MagicMock()
    mgr.coordinator.async_request_refresh = MagicMock()
    return mgr


@pytest.mark.asyncio
async def test_set_power_off_pauses_auto_and_sends_hvac_off(
    manager: ThermoManager,
) -> None:
    manager._set_hvac_mode = AsyncMock()
    await manager.async_set_power(False, ["climate.sala"])
    assert "z1" in manager.disabled_zones
    assert manager._paused_hvac.get("z1") == "heat"
    manager._set_hvac_mode.assert_awaited_with(manager.zones["z1"], "off")


@pytest.mark.asyncio
async def test_set_power_on_restores_hvac(manager: ThermoManager) -> None:
    manager._set_hvac_mode = AsyncMock()
    await manager.async_set_power(False, ["climate.sala"])
    await manager.async_set_power(True, ["climate.sala"])
    assert "z1" not in manager.disabled_zones
    manager._set_hvac_mode.assert_any_await(manager.zones["z1"], "heat")


@pytest.mark.asyncio
async def test_set_temperature_writes_physical_climate(manager: ThermoManager) -> None:
    manager._set_temperature = AsyncMock()
    await manager.async_set_profile("comfort", ["climate.sala"])
    await manager.async_set_temperature(["climate.sala"], 22.5)
    manager._set_temperature.assert_awaited()
    assert manager.manual_overrides["z1"]["temperature"] == 22.5


@pytest.mark.asyncio
async def test_apply_zone_skips_when_power_off(manager: ThermoManager) -> None:
    manager.disabled_zones.add("z1")
    zone = manager.zones["z1"]
    manager._set_temperature = AsyncMock()
    from homeassistant.util import dt as dt_util

    await manager._apply_zone(zone, dt_util.now())
    manager._set_temperature.assert_not_called()


@pytest.mark.asyncio
async def test_external_setpoint_override_in_auto(manager: ThermoManager, hass: HomeAssistant) -> None:
    manager.settings["manual_hold"] = 30
    old = hass.states.get("climate.sala")
    hass.states.async_set(
        "climate.sala",
        "heat",
        {"temperature": 23.0, "current_temperature": 19.5, "hvac_mode": "heat"},
    )
    new = hass.states.get("climate.sala")
    event = SimpleNamespace(
        data={
            "entity_id": "climate.sala",
            "old_state": old,
            "new_state": new,
        }
    )
    manager._handle_state_change(event)
    assert manager.manual_overrides["z1"]["temperature"] == 23.0


def test_physical_is_off_reads_hvac_mode(manager: ThermoManager, hass: HomeAssistant) -> None:
    hass.states.async_set("climate.sala", STATE_OFF, {"hvac_mode": "off"})
    assert manager._physical_is_off(manager.zones["z1"])