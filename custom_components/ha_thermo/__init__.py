"""The HA Thermo integration."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr

from .const import (
    CARD_FILES,
    CONF_NAME,
    CONF_ZONES,
    DOMAIN,
    VERSION,
)
from .coordinator import ThermoCoordinator
from .manager import ThermoManager, zones_from_options
from .models import Zone
from .services import async_register_services
from .websocket_api import async_register_websocket

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS: list[Platform] = [
    Platform.SENSOR,
    Platform.BINARY_SENSOR,
    Platform.SELECT,
    Platform.SWITCH,
]

type ThermoConfigEntry = ConfigEntry[ThermoManager]

_WWW = Path(__file__).parent / "www"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register cards, services and the websocket API once."""
    await _async_register_cards(hass)
    async_register_services(hass)
    async_register_websocket(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ThermoConfigEntry) -> bool:
    """Set up HA Thermo from a config entry."""
    options = dict(entry.options)
    zones = zones_from_options(options)
    if not zones:
        zones = [
            Zone.from_dict(item)
            for item in entry.data.get(CONF_ZONES, [])
            if isinstance(item, dict)
        ]

    manager = ThermoManager(hass, entry, zones, options)
    coordinator = ThermoCoordinator(
        hass, manager, int(manager.settings["scan_interval"])
    )
    manager.coordinator = coordinator
    await manager.async_initialize()
    await coordinator.async_config_entry_first_refresh()

    entry.runtime_data = manager
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN]["manager"] = manager
    hass.data[DOMAIN]["entry_id"] = entry.entry_id

    dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, entry.entry_id)},
        name=entry.title,
        manufacturer="marcopiccinni",
        model="HA Thermo",
        sw_version=VERSION,
    )

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(
    hass: HomeAssistant, entry: ThermoConfigEntry
) -> bool:
    """Unload the integration and flush its state."""
    unloaded = await hass.config_entries.async_unload_platforms(
        entry, PLATFORMS
    )
    if unloaded:
        manager: ThermoManager | None = entry.runtime_data
        if manager is not None:
            await manager.async_shutdown()
        data = hass.data.get(DOMAIN, {})
        if data.get("entry_id") == entry.entry_id:
            data.pop("manager", None)
            data.pop("entry_id", None)
    return unloaded


async def _async_update_listener(
    hass: HomeAssistant, entry: ThermoConfigEntry
) -> None:
    """Reload the entry when its options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def _async_register_cards(hass: HomeAssistant) -> None:
    """Serve and load the bundled Lovelace cards, if possible."""
    try:
        from homeassistant.components.frontend import add_extra_js_url
        from homeassistant.components.http import StaticPathConfig
    except ImportError:  # pragma: no cover - frontend always present in HA
        return

    http = getattr(hass, "http", None)
    if http is None or not _WWW.is_dir():
        return

    paths = []
    urls = []
    for name in CARD_FILES:
        file_path = _WWW / name
        if not file_path.is_file():
            continue
        url = f"/{DOMAIN}/{name}"
        paths.append(StaticPathConfig(url, str(file_path), False))
        urls.append(f"{url}?v={VERSION}")

    if not paths:
        return

    try:
        await http.async_register_static_paths(paths)
    except (RuntimeError, ValueError):
        # Already registered (e.g. after a reload): safe to ignore.
        pass

    for url in urls:
        try:
            add_extra_js_url(hass, url)
        except (KeyError, RuntimeError):
            _LOGGER.debug("Frontend not ready for %s", url)


__all__ = ["CONF_NAME", "DOMAIN", "async_setup_entry"]
