"""Regression tests for manual profile selection and persistence."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("homeassistant")

from homeassistant.core import HomeAssistant

from custom_components.ha_thermo.const import CONF_ZONES, PROFILE_AUTO
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
    """ThermoManager with one zone and default profiles (no full integration deps)."""
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
async def test_set_profile_pins_and_persists(manager: ThermoManager) -> None:
    """Manual profile choice pins the zone and survives storage round-trip."""
    manager.weekly_profiles["z1"] = {day: "eco" for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}

    await manager.async_set_profile("night", ["climate.sala"])

    assert manager.is_pinned("z1")
    assert manager.pinned_profiles["z1"]["profile_id"] == "night"
    assert manager.active_profile_id("z1") == "night"
    manager.coordinator.async_request_refresh.assert_called()

    stored = await manager._store.async_load()
    assert stored is not None
    assert stored["pinned_profiles"]["z1"]["profile_id"] == "night"

    restored = ThermoManager(manager.hass, manager.entry)
    restored._restore(stored)
    restored._sync_zones()
    assert restored.is_pinned("z1")
    assert restored.active_profile_id("z1") == "night"


@pytest.mark.asyncio
async def test_set_profile_auto_unpins(manager: ThermoManager) -> None:
    """Automatico clears pin; storage no longer lists the zone as pinned."""
    await manager.async_set_profile("comfort", ["climate.sala"])
    assert manager.is_pinned("z1")

    await manager.async_set_profile(PROFILE_AUTO, ["climate.sala"])
    assert not manager.is_pinned("z1")

    stored = await manager._store.async_load()
    assert stored is not None
    assert "z1" not in (stored.get("pinned_profiles") or {})


@pytest.mark.asyncio
async def test_pinned_survives_tick_without_unpinning(manager: ThermoManager) -> None:
    """Coordinator tick must not drop a manual pin (regression: UI showing Eco again)."""
    manager.weekly_profiles["z1"] = {day: "eco" for day in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}
    await manager.async_set_profile("summer", ["climate.sala"])
    manager._apply_zone = AsyncMock()  # type: ignore[method-assign]

    await manager.async_tick()

    assert manager.is_pinned("z1")
    assert manager.active_profile_id("z1") == "summer"