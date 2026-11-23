"""Websocket API for HA Thermo."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv

from .const import (
    ATTR_PROFILE_ID,
    ATTR_SOURCE_ID,
    ATTR_THERMOSTATS,
    ATTR_ZONE_ID,
    ATTR_ZONES,
    CONF_CLIMATE_ENTITY,
    DOMAIN,
)
from .manager import ThermoManager
from .models import Profile
from .service_fields import thermostats_from_payload

_THERMOSTATS_WS: dict[Any, Any] = {
    vol.Optional(ATTR_THERMOSTATS): vol.All(cv.ensure_list, [cv.string]),
    vol.Optional(ATTR_ZONES): vol.All(cv.ensure_list, [cv.string]),
}
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
    except (RuntimeError, OSError) as err:
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
        **_THERMOSTATS_WS,
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
            msg["profile"], thermostats_from_payload(msg), msg.get("duration")
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/bypass/start",
        **_THERMOSTATS_WS,
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
            thermostats=thermostats_from_payload(msg),
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
        **_THERMOSTATS_WS,
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
        connection,
        msg,
        lambda: manager.async_stop_bypass(thermostats_from_payload(msg)),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_temperature",
        **_THERMOSTATS_WS,
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
            thermostats_from_payload(msg),
            msg["temperature"],
            msg.get("duration"),
        ),
    )


async def _weekly_zone_id(manager: ThermoManager, msg: dict) -> str:
    zone_id = msg.get(ATTR_ZONE_ID)
    climate_entity = msg.get(CONF_CLIMATE_ENTITY)
    if zone_id:
        return await manager.async_resolve_zone_id(str(zone_id))
    if climate_entity:
        return (await manager.async_ensure_zone_for_climate(str(climate_entity))).id
    raise ValueError("thermostat_required")


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/zone/weekly/set",
        vol.Required("schedule"): dict,
        vol.Optional(ATTR_ZONE_ID): cv.string,
        vol.Optional(CONF_CLIMATE_ENTITY): cv.entity_id,
    }
)
@websocket_api.async_response
async def ws_set_zone_weekly(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    if not msg.get(ATTR_ZONE_ID) and not msg.get(CONF_CLIMATE_ENTITY):
        connection.send_error(msg["id"], "invalid_input", "thermostat_required")
        return

    async def _set_weekly() -> dict[str, str]:
        zone_key = await _weekly_zone_id(manager, msg)
        return await manager.async_set_zone_weekly(zone_key, msg["schedule"])

    await _execute(connection, msg, _set_weekly)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/thermostat/ensure",
        vol.Required(CONF_CLIMATE_ENTITY): cv.entity_id,
    }
)
@websocket_api.async_response
async def ws_thermostat_ensure(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return

    async def _ensure() -> dict[str, Any]:
        zone = await manager.async_ensure_zone_for_climate(msg[CONF_CLIMATE_ENTITY])
        return {"zone_id": zone.id, "climate_entity": zone.climate_entity, "name": zone.name}

    await _execute(connection, msg, _ensure)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/thermostat/power",
        vol.Required("enabled"): bool,
        **_THERMOSTATS_WS,
    }
)
@websocket_api.async_response
async def ws_thermostat_power(
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
        lambda: manager.async_set_power(
            msg["enabled"], thermostats_from_payload(msg)
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/set_enabled",
        vol.Required("enabled"): bool,
        **_THERMOSTATS_WS,
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
        lambda: manager.async_enable(msg["enabled"], thermostats_from_payload(msg)),
    )


async def _created(awaitable: Awaitable[Any]) -> dict[str, Any]:
    item = await awaitable
    return {"id": item.id, "item": item.to_dict()}


async def _updated(awaitable: Awaitable[Any]) -> dict[str, Any]:
    item = await awaitable
    return {"id": item.id, "item": item.to_dict()}


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profile/create",
        vol.Required("profile"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_create_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    async def _create_profile() -> dict[str, Any]:
        return await _created(manager.async_create_profile(msg["profile"]))

    await _execute(connection, msg, _create_profile)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profile/update",
        vol.Required("profile"): dict,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_update_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    async def _update_profile() -> dict[str, Any]:
        return await _updated(manager.async_update_profile(msg["profile"]))

    await _execute(connection, msg, _update_profile)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profile/delete",
        vol.Required(ATTR_PROFILE_ID): cv.string,
    }
)
@websocket_api.require_admin
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
        vol.Required(ATTR_SOURCE_ID): cv.string,
        vol.Required("name"): cv.string,
        **_THERMOSTATS_WS,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_clone_profile(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    async def _clone_profile() -> dict[str, Any]:
        return await _created(
            manager.async_clone_profile(
                msg[ATTR_SOURCE_ID],
                msg["name"],
                thermostats_from_payload(msg),
            )
        )

    await _execute(connection, msg, _clone_profile)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/zone/update",
        vol.Required(ATTR_ZONE_ID): cv.string,
        vol.Optional("name"): cv.string,
        vol.Optional("climate_entity"): cv.entity_id,
        vol.Optional("temperature_sensor"): vol.Any(cv.entity_id, None),
        vol.Optional("min_temp"): vol.Coerce(float),
        vol.Optional("max_temp"): vol.Coerce(float),
        vol.Optional("default_temp"): vol.Coerce(float),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_update_zone(
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
        lambda: manager.async_update_zone(
            zone_id=msg[ATTR_ZONE_ID],
            name=msg.get("name"),
            climate_entity=msg.get("climate_entity"),
            temperature_sensor=msg.get("temperature_sensor"),
            min_temp=msg.get("min_temp"),
            max_temp=msg.get("max_temp"),
            default_temp=msg.get("default_temp"),
        ),
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profiles/export",
    }
)
@websocket_api.async_response
async def ws_export_profiles(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return
    profiles = [p.to_dict() for p in manager.profiles.values()]
    connection.send_result(msg["id"], {"profiles": profiles})


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/profiles/import",
        vol.Required("profiles"): list,
        vol.Optional("mode", default="merge"): vol.In(["merge", "replace"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_import_profiles(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    manager = _manager(hass, connection, msg)
    if manager is None:
        return

    async def _do_import() -> None:
        mode = msg.get("mode", "merge")
        if mode == "replace":
            manager.profiles.clear()
        for item in msg["profiles"]:
            try:
                profile = Profile.from_dict(item)
                profile.validate()
                manager.profiles[profile.id] = profile
            except (TypeError, ValueError) as err:
                raise ValueError(f"invalid_profile: {err}")
        manager._save()
        manager._notify()

    await _execute(connection, msg, _do_import)


COMMANDS = (
    ws_get_config,
    ws_set_profile,
    ws_start_bypass,
    ws_stop_bypass,
    ws_set_temperature,
    ws_set_zone_weekly,
    ws_thermostat_ensure,
    ws_set_enabled,
    ws_thermostat_power,
    ws_create_profile,
    ws_update_profile,
    ws_delete_profile,
    ws_clone_profile,
    ws_update_zone,
    ws_export_profiles,
    ws_import_profiles,
)


@callback
def async_register_websocket(hass: HomeAssistant) -> None:
    for command in COMMANDS:
        websocket_api.async_register_command(hass, command)
