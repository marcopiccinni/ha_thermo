"""Options-flow profile create/duplicate regression tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.data_entry_flow import FlowResultType

pytest.importorskip("homeassistant")

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_thermo.config_flow import ThermoOptionsFlow
from custom_components.ha_thermo.const import CONF_ZONES, DOMAIN
from custom_components.ha_thermo.models import Profile
from custom_components.ha_thermo.profile_flow_helpers import PROFILE_NEW


def _mock_entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="HA Thermo",
        data={"name": "HA Thermo"},
        options={
            CONF_ZONES: [
                {
                    "id": "z1",
                    "name": "Studio",
                    "climate_entity": "climate.studio",
                    "min_temp": 5.0,
                    "max_temp": 30.0,
                    "default_temp": 20.0,
                }
            ],
        },
    )


def _default_profiles() -> dict[str, Profile]:
    return {
        pid: Profile(pid, pid.capitalize(), hourly=[float(19 + i % 3)] * 24)
        for i, pid in enumerate(("comfort", "eco", "night", "away", "summer"))
    }


def _flow_with_manager(
    hass: HomeAssistant, profiles: dict[str, Profile] | None = None
) -> tuple[ThermoOptionsFlow, MagicMock]:
    entry = _mock_entry()
    entry.add_to_hass(hass)
    flow = ThermoOptionsFlow()
    flow.hass = hass
    object.__setattr__(flow, "_config_entry", entry)
    manager = MagicMock()
    manager.profiles = profiles if profiles is not None else _default_profiles()
    async def _create_profile(payload: dict) -> Profile:
        profile = Profile.from_dict(payload)
        manager.profiles[profile.id] = profile
        return profile

    manager.async_create_profile = AsyncMock(side_effect=_create_profile)
    manager.async_clone_profile = AsyncMock()
    manager.async_update_profile = AsyncMock()
    return flow, manager


@pytest.mark.asyncio
async def test_profile_name_new_step_handler_creates_profile(hass: HomeAssistant) -> None:
    """Regression: form step_id profile_name_new must have async_step_profile_name_new."""
    flow, manager = _flow_with_manager(hass)
    with patch.object(flow, "_get_manager", return_value=manager):
        shown = await flow.async_step_profile_name_new()
    assert shown["type"] == FlowResultType.FORM
    assert shown["step_id"] == "profile_name_new"

    with patch.object(flow, "_get_manager", return_value=manager):
        result = await flow.async_step_profile_name_new({"name": "Piano Test"})
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "profile_hours"
    manager.async_create_profile.assert_awaited_once()
    payload = manager.async_create_profile.await_args.args[0]
    assert payload["name"] == "Piano Test"
    assert payload["id"] == "piano_test"


@pytest.mark.asyncio
async def test_profile_name_duplicate_step_handler(hass: HomeAssistant) -> None:
    flow, manager = _flow_with_manager(hass)
    flow._edit_profile_id = "comfort"
    with patch.object(flow, "_get_manager", return_value=manager):
        result = await flow.async_step_profile_name_duplicate({"name": "Comfort Copia"})
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "profiles"
    manager.async_clone_profile.assert_awaited_once_with("comfort", "Comfort Copia")


@pytest.mark.asyncio
async def test_profile_name_rename_step_handler(hass: HomeAssistant) -> None:
    flow, manager = _flow_with_manager(hass)
    flow._edit_profile_id = "eco"
    with patch.object(flow, "_get_manager", return_value=manager):
        result = await flow.async_step_profile_name_rename({"name": "Eco Casa"})
    assert result["type"] == FlowResultType.FORM
    assert result["step_id"] == "profiles"
    manager.async_update_profile.assert_awaited_once()
    assert manager.async_update_profile.await_args.args[0]["name"] == "Eco Casa"


@pytest.mark.asyncio
async def test_profiles_picker_accepts_new_profile_token(hass: HomeAssistant) -> None:
    flow, manager = _flow_with_manager(hass)
    with (
        patch.object(flow, "_get_manager", return_value=manager),
        patch.object(flow, "async_step_profile_name", new_callable=AsyncMock) as name_step,
    ):
        name_step.return_value = {"type": FlowResultType.FORM, "step_id": "profile_name_new"}
        await flow.async_step_profiles({"profile": PROFILE_NEW})
        name_step.assert_awaited_once()


@pytest.mark.asyncio
async def test_profiles_picker_legacy_new_alias(hass: HomeAssistant) -> None:
    flow, manager = _flow_with_manager(hass)
    with (
        patch.object(flow, "_get_manager", return_value=manager),
        patch.object(flow, "async_step_profile_name", new_callable=AsyncMock) as name_step,
    ):
        name_step.return_value = {"type": FlowResultType.FORM, "step_id": "profile_name_new"}
        await flow.async_step_profiles({"profile": "__new__"})
        name_step.assert_awaited_once()