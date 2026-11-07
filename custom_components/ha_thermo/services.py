"""Services for HA Thermo."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_ACTIVATOR,
    ATTR_ACTIVATOR_ID,
    ATTR_DURATION,
    ATTR_ENABLED,
    ATTR_OFFSET,
    ATTR_PROFILE,
    ATTR_PROFILE_ID,
    ATTR_SOURCE_ID,
    ATTR_TEMPERATURE,
    ATTR_UNTIL,
    ATTR_ZONES,
    DOMAIN,
    SERVICE_CLONE_PROFILE,
    SERVICE_CREATE_PROFILE,
    SERVICE_DELETE_PROFILE,
    SERVICE_ENABLE,
    SERVICE_RELOAD,
    SERVICE_SET_PROFILE,
    SERVICE_SET_TEMPERATURE,
    SERVICE_START_BYPASS,
    SERVICE_STOP_BYPASS,
    SERVICE_UPDATE_PROFILE,
)
from .manager import ThermoManager

_ZONES = vol.Optional(ATTR_ZONES)
_DURATION = vol.Optional(ATTR_DURATION)
_UNTIL = vol.Optional(ATTR_UNTIL)

SCHEMAS: dict[str, vol.Schema] = {
    SERVICE_SET_PROFILE: vol.Schema(
        {
            vol.Required(ATTR_PROFILE): cv.string,
            _ZONES: vol.All(cv.ensure_list, [cv.string]),
            _DURATION: vol.Any(vol.Coerce(float), cv.string),
        }
    ),
    SERVICE_START_BYPASS: vol.Schema(
        {
            _ZONES: vol.All(cv.ensure_list, [cv.string]),
            vol.Optional(ATTR_TEMPERATURE): vol.Coerce(float),
            vol.Optional(ATTR_OFFSET): vol.Coerce(float),
            _DURATION: vol.Any(vol.Coerce(float), cv.string),
            _UNTIL: cv.string,
            vol.Optional("source"): cv.string,
        }
    ),
    SERVICE_STOP_BYPASS: vol.Schema(
        {_ZONES: vol.All(cv.ensure_list, [cv.string])}
    ),
    SERVICE_SET_TEMPERATURE: vol.Schema(
        {
            _ZONES: vol.All(cv.ensure_list, [cv.string]),
            vol.Required(ATTR_TEMPERATURE): vol.Coerce(float),
            _DURATION: vol.Any(vol.Coerce(float), cv.string),
        }
    ),
    SERVICE_ENABLE: vol.Schema(
        {
            vol.Required(ATTR_ENABLED): bool,
            _ZONES: vol.All(cv.ensure_list, [cv.string]),
        }
    ),
    SERVICE_CREATE_PROFILE: vol.Schema(
        {vol.Required(ATTR_PROFILE): dict}
    ),
    SERVICE_UPDATE_PROFILE: vol.Schema(
        {vol.Required(ATTR_PROFILE): dict}
    ),
    SERVICE_DELETE_PROFILE: vol.Schema(
        {vol.Required(ATTR_PROFILE_ID): cv.string}
    ),
    SERVICE_CLONE_PROFILE: vol.Schema(
        {
            vol.Required(ATTR_SOURCE_ID): cv.string,
            vol.Required("name"): cv.string,
            _ZONES: vol.All(cv.ensure_list, [cv.string]),
        }
    ),
    SERVICE_RELOAD: vol.Schema({}),
}


def _manager(hass: HomeAssistant) -> ThermoManager:
    manager = hass.data.get(DOMAIN, {}).get("manager")
    if manager is None:
        raise HomeAssistantError("HA Thermo is not configured")
    return manager


def _guarded(handler: Any) -> Any:
    async def _run(call: ServiceCall) -> None:
        try:
            await handler(call)
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err

    return _run


def async_register_services(hass: HomeAssistant) -> None:
    async def set_profile(call: ServiceCall) -> None:
        await _manager(hass).async_set_profile(
            call.data[ATTR_PROFILE],
            call.data.get(ATTR_ZONES),
            call.data.get(ATTR_DURATION),
        )

    async def start_bypass(call: ServiceCall) -> None:
        await _manager(hass).async_start_bypass(
            zones=call.data.get(ATTR_ZONES),
            temperature=call.data.get(ATTR_TEMPERATURE),
            offset=call.data.get(ATTR_OFFSET),
            duration=call.data.get(ATTR_DURATION),
            until=call.data.get(ATTR_UNTIL),
            source=str(call.data.get("source") or "service"),
        )

    async def stop_bypass(call: ServiceCall) -> None:
        await _manager(hass).async_stop_bypass(call.data.get(ATTR_ZONES))

    async def set_temperature(call: ServiceCall) -> None:
        await _manager(hass).async_set_temperature(
            call.data.get(ATTR_ZONES),
            call.data[ATTR_TEMPERATURE],
            call.data.get(ATTR_DURATION),
        )

    async def enable(call: ServiceCall) -> None:
        await _manager(hass).async_enable(
            call.data[ATTR_ENABLED], call.data.get(ATTR_ZONES)
        )

    async def create_profile(call: ServiceCall) -> None:
        await _manager(hass).async_create_profile(call.data[ATTR_PROFILE])

    async def update_profile(call: ServiceCall) -> None:
        await _manager(hass).async_update_profile(call.data[ATTR_PROFILE])

    async def delete_profile(call: ServiceCall) -> None:
        await _manager(hass).async_delete_profile(call.data[ATTR_PROFILE_ID])

    async def clone_profile(call: ServiceCall) -> None:
        await _manager(hass).async_clone_profile(
            call.data[ATTR_SOURCE_ID],
            call.data["name"],
            call.data.get(ATTR_ZONES),
        )

    async def reload(call: ServiceCall) -> None:
        await _manager(hass).async_reload()

    handlers = {
        SERVICE_SET_PROFILE: set_profile,
        SERVICE_START_BYPASS: start_bypass,
        SERVICE_STOP_BYPASS: stop_bypass,
        SERVICE_SET_TEMPERATURE: set_temperature,
        SERVICE_ENABLE: enable,
        SERVICE_CREATE_PROFILE: create_profile,
        SERVICE_UPDATE_PROFILE: update_profile,
        SERVICE_DELETE_PROFILE: delete_profile,
        SERVICE_CLONE_PROFILE: clone_profile,
        SERVICE_RELOAD: reload,
    }

    for name, handler in handlers.items():
        hass.services.async_register(
            DOMAIN,
            name,
            _guarded(handler),
            schema=SCHEMAS[name],
        )
