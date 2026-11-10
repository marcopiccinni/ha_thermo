"""HA Thermo integration."""

from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .coordinator import ThermoCoordinator
from .frontend import async_register_frontend
from .manager import ThermoManager
from .services import async_register_services
from .websocket_api import async_register_websocket

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = lambda config: {DOMAIN: {}}

_FRONTEND_REGISTERED = False


async def _ensure_frontend(hass: HomeAssistant) -> None:
    global _FRONTEND_REGISTERED
    if _FRONTEND_REGISTERED:
        return
    await async_register_frontend(hass)
    _FRONTEND_REGISTERED = True


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up HA Thermo from yaml configuration."""
    hass.data.setdefault(DOMAIN, {})
    await _ensure_frontend(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up HA Thermo from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    await _ensure_frontend(hass)

    manager = ThermoManager(hass, entry)
    await manager.async_setup()
    hass.data[DOMAIN]["manager"] = manager

    coordinator = ThermoCoordinator(
        hass, manager, int(manager.settings.get("scan_interval", 30))
    )
    await coordinator.async_config_entry_first_refresh()
    hass.data[DOMAIN]["coordinator"] = coordinator

    await hass.config_entries.async_forward_entry_setups(
        entry,
        [
            Platform.SENSOR,
            Platform.BINARY_SENSOR,
            Platform.SELECT,
            Platform.SWITCH,
        ],
    )

    entry.async_on_unload(entry.add_update_listener(async_update_options))

    async_register_services(hass)
    async_register_websocket(hass)

    # Re-run registration so resources pick up after Lovelace finishes loading.
    await async_register_frontend(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(
        entry,
        [
            Platform.SENSOR,
            Platform.BINARY_SENSOR,
            Platform.SELECT,
            Platform.SWITCH,
        ],
    )
    if unload_ok:
        hass.data.pop(DOMAIN, None)
    return unload_ok


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Update options."""
    await hass.config_entries.async_reload(entry)
