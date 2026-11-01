"""Websocket API used by the bundled Lovelace cards."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv

from .const import ATTR_ACTIVATOR_ID, ATTR_PROFILE_ID, DOMAIN
from .manager import ThermoManager

_ZONES = vol.Optional("zones")
_DURATION = vol.Optional("duration")
_DURATION_SCHEMA = vol.Any(vol.Coerce(float), cv.string)


def _manager(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> ThermoManager | None:
    manager = hass.data.get(DOMAIN, {}).get("manager")
    if manager is None:
        connection.send_error(
            msg["id"], "not_loaded", "HA Thermo is not configured"
        )
    return manager


AsyncHandler = Callable[[], Awaitable[Any]]


async def _execute(
    connection: websocket_api.ActiveConnection,
    msg: dict,
    awaitable: AsyncHandler | Awaitable[Any],
) -> None:
    try:
        result = await (awaitable() if callable(awaitable) else awaitable)
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_input", str(err))
        return
    except Exception as err:  # noqa: BLE001 - report failures to the card
        connection.send_error(msg["id"], "failed", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/get_config"}
)
@websocket_api.async_response
async def ws_get_config(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    connection.send_result(msg["id"], await manager.async_get_config())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_profile",
        vol.Required("profile"): vol.Any(cv.string, vol.Equal("__auto__")),
        _ZONES: vol.All(cv.ensure_list, [cv.string]),
        _DURATION: _DURATION_SCHEMA,
    }
)
@websocket_api.async_response
async def ws_set_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: manager.async_set_profile(
            msg["profile"], msg.get("zones"), msg.get("duration")
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/bypass/start",
        _ZONES: vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("temperature"): vol.Coerce(float),
        vol.Optional("offset"): vol.Coerce(float),
        _DURATION: _DURATION_SCHEMA,
        vol.Optional("until"): cv.string,
        vol.Optional("source"): cv.string,
    }
)
@websocket_api.async_response
async def ws_start_bypass(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: manager.async_start_bypass(
            zones=msg.get("zones"),
            temperature=msg.get("temperature"),
            offset=msg.get("offset"),
            duration=msg.get("duration"),
            until=msg.get("until"),
            source=str(msg.get("source") or "card"),
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/bypass/stop",
        _ZONES: vol.All(cv.ensure_list, [cv.string]),
    }
)
@websocket_api.async_response
async def ws_stop_bypass(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection, msg, lambda: manager.async_stop_bypass(msg.get("zones"))
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_temperature",
        _ZONES: vol.All(cv.ensure_list, [cv.string]),
        vol.Required("temperature"): vol.Coerce(float),
        _DURATION: _DURATION_SCHEMA,
    }
)
@websocket_api.async_response
async def ws_set_temperature(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: manager.async_set_temperature(
            msg.get("zones"), msg["temperature"], msg.get("duration")
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_enabled",
        vol.Required("enabled"): bool,
        _ZONES: vol.All(cv.ensure_list, [cv.string]),
    }
)
@websocket_api.async_response
async def ws_set_enabled(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: manager.async_enable(msg["enabled"], msg.get("zones")),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profile/create",
        vol.Required("profile"): dict,
    }
)
@websocket_api.async_response
async def ws_create_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: _created(manager.async_create_profile(msg["profile"])),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profile/update",
        vol.Required("profile"): dict,
    }
)
@websocket_api.async_response
async def ws_update_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: _updated(manager.async_update_profile(msg["profile"])),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profile/delete",
        vol.Required(ATTR_PROFILE_ID): cv.string,
    }
)
@websocket_api.async_response
async def ws_delete_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: manager.async_delete_profile(msg[ATTR_PROFILE_ID]),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profile/clone",
        vol.Required("source_id"): cv.string,
        vol.Required("name"): cv.string,
        _ZONES: vol.All(cv.ensure_list, [cv.string]),
    }
)
@websocket_api.async_response
async def ws_clone_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: _created(
            manager.async_clone_profile(
                msg["source_id"], msg["name"], msg.get("zones")
            )
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/activator/create",
        vol.Required("activator"): dict,
    }
)
@websocket_api.async_response
async def ws_create_activator(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: _created(manager.async_create_activator(msg["activator"])),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/activator/update",
        vol.Required("activator"): dict,
    }
)
@websocket_api.async_response
async def ws_update_activator(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: _updated(manager.async_update_activator(msg["activator"])),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/activator/delete",
        vol.Required(ATTR_ACTIVATOR_ID): cv.string,
    }
)
@websocket_api.async_response
async def ws_delete_activator(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    await _execute(
        connection,
        msg,
        lambda: manager.async_delete_activator(msg[ATTR_ACTIVATOR_ID]),
    )


async def _created(awaitable: Awaitable[Any]) -> dict[str, Any]:
    item = await awaitable
    return {"id": item.id, "item": item.to_dict()}


async def _updated(awaitable: Awaitable[Any]) -> dict[str, Any]:
    item = await awaitable
    return {"id": item.id, "item": item.to_dict()}


COMMANDS = (
    ws_get_config,
    ws_set_profile,
    ws_start_bypass,
    ws_stop_bypass,
    ws_set_temperature,
    ws_set_enabled,
    ws_create_profile,
    ws_update_profile,
    ws_delete_profile,
    ws_clone_profile,
    ws_create_activator,
    ws_update_activator,
    ws_delete_activator,
)


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    """Register all websocket commands."""
    for command in COMMANDS:
        websocket_api.async_register_command(hass, command)
