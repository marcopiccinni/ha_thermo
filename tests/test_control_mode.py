"""Control mode (automatic vs manual) and storage migration."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("homeassistant")

from homeassistant.core import HomeAssistant

from custom_components.ha_thermo.const import CONF_ZONES, CONTROL_MODE_AUTO, CONTROL_MODE_MANUAL
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
        {"temperature": 20, "current_temperature": 19, "hvac_modes": ["heat", "off"]},
    )
    entry = MagicMock()
    entry.entry_id = "test-entry"
    entry.title = "HA Thermo"
    entry.options = {CONF_ZONES: [_zone().to_dict()]}
    manager = ThermoManager(hass, entry)
    await manager.async_setup()
    manager.coordinator = MagicMock()
    manager.coordinator.async_request_refresh = MagicMock()
    manager._apply_zone = AsyncMock()  # type: ignore[method-assign]
    return manager


@pytest.mark.asyncio
async def test_manual_mode_persists(manager: ThermoManager) -> None:
    await manager.async_set_control_mode(CONTROL_MODE_MANUAL, ["climate.sala"])
    assert manager.is_manual_mode("z1")
    stored = await manager._store.async_load()
    assert stored is not None
    assert stored["control_modes"]["z1"] == CONTROL_MODE_MANUAL
    assert "pinned_profiles" not in stored or not stored.get("pinned_profiles")

    restored = ThermoManager(manager.hass, manager.entry)
    restored._restore(stored)
    restored._sync_zones()
    assert restored.is_manual_mode("z1")


@pytest.mark.asyncio
async def test_auto_mode_clears_override_and_applies_profile(manager: ThermoManager) -> None:
    manager.weekly_profiles["z1"] = {day: "eco" for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}
    await manager.async_set_control_mode(CONTROL_MODE_MANUAL, ["climate.sala"])
    manager.manual_overrides["z1"] = {"temperature": 23.0, "until": None}
    await manager.async_set_control_mode(CONTROL_MODE_AUTO, ["climate.sala"])
    assert not manager.is_manual_mode("z1")
    assert "z1" not in manager.manual_overrides
    manager._apply_zone.assert_awaited()


@pytest.mark.asyncio
async def test_tick_skips_manual_zone(manager: ThermoManager) -> None:
    await manager.async_set_control_mode(CONTROL_MODE_MANUAL, ["climate.sala"])
    manager._set_temperature = AsyncMock()  # type: ignore[method-assign]
    await manager.async_tick()
    manager._set_temperature.assert_not_called()


@pytest.mark.asyncio
async def test_migrate_pinned_profiles_to_manual(manager: ThermoManager) -> None:
    raw = {
        "schema_version": 2,
        "pinned_profiles": {"z1": {"profile_id": "night", "until": None}},
        "profiles": [p.to_dict() for p in manager.profiles.values()],
        "zones": [_zone().to_dict()],
    }
    mig = ThermoManager(manager.hass, manager.entry)
    mig._restore(raw)
    mig._sync_zones()
    mig._migrate_storage_schema(raw)
    assert mig.control_modes.get("z1") == CONTROL_MODE_MANUAL


@pytest.mark.asyncio
async def test_set_profile_auto_only(manager: ThermoManager) -> None:
    await manager.async_set_control_mode(CONTROL_MODE_MANUAL, ["climate.sala"])
    await manager.async_set_profile("__auto__", ["climate.sala"])
    assert not manager.is_manual_mode("z1")

    with pytest.raises(ValueError, match="set_profile_deprecated"):
        await manager.async_set_profile("comfort", ["climate.sala"])