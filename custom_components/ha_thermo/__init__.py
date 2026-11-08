"""HA Thermo integration."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.typing import ConfigType

from .const import (
    ASSET_FILES,
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

CONFIG_SCHEMA = lambda config: {DOMAIN: {}}

_WWW = Path(__file__).parent / "www"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up HA Thermo from yaml configuration."""
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up HA Thermo from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    
    manager = ThermoManager(hass, entry)
    await manager.async_setup()
    hass.data[DOMAIN]["manager"] = manager
    
    coordinator = ThermoCoordinator(hass, manager)
    await coordinator.async_config_entry_first_refresh()
    hass.data[DOMAIN]["coordinator"] = coordinator
    
    await hass.config_entries.async_forward_entry_setups(entry, [
        Platform.SENSOR,
        Platform.BINARY_SENSOR,
        Platform.SELECT,
        Platform.SWITCH,
    ])
    
    entry.async_on_unload(entry.add_update_listener(async_update_options))
    
    async_register_services(hass)
    async_register_websocket(hass)
    
    await _async_register_cards(hass)
    
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, [
        Platform.SENSOR,
        Platform.BINARY_SENSOR,
        Platform.SELECT,
        Platform.SWITCH,
    ])
    if unload_ok:
        hass.data.pop(DOMAIN, None)
    return unload_ok


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Update options."""
    await hass.config_entries.async_reload(entry)


async def _async_register_cards(hass: HomeAssistant) -> None:
    """Register Lovelace cards."""
    http = getattr(hass, "http", None)
    if http is None or not _WWW.is_dir():
        return

    all_files = list(ASSET_FILES) + list(CARD_FILES)
    paths = []
    urls = []
    for name in all_files:
        file_path = _WWW / name
        if not file_path.is_file():
            continue
        url = f"/{DOMAIN}/{name}"
        paths.append((url, str(file_path)))
        urls.append(f"{url}?v={VERSION}")

    if not paths:
        return

    try:
        for url, path in paths:
            http.register_static_path(url, path, False)
        _LOGGER.debug("Registered %d static paths", len(paths))
    except Exception as err:
        _LOGGER.warning("Could not register static paths: %s", err)

    # Register as Lovelace resources - try multiple methods
    await _register_lovelace_resources_force(hass, urls)


async def _register_lovelace_resources_force(hass: HomeAssistant, urls: list[str]) -> None:
    """Force register Lovelace resources using any available method."""
    # Method 1: Try storage-based registration (HA 2023.8+)
    try:
        from homeassistant.components.lovelace import DOMAIN as LL_DOMAIN
        ll_resources = hass.data.get(LL_DOMAIN, {}).get("resources")
        if ll_resources and hasattr(ll_resources, "async_items"):
            existing = ll_resources.async_items() or []
            existing_urls = {r.get("url", "").split("?")[0] for r in existing}
            
            for url in urls:
                url_base = url.split("?")[0]
                if url_base not in existing_urls:
                    try:
                        await ll_resources.async_create_item({
                            "res_type": "module",
                            "url": url,
                        })
                        _LOGGER.info("Registered Lovelace resource: %s", url)
                    except Exception as err:
                        _LOGGER.debug("Could not create resource %s: %s", url, err)
            return
    except ImportError:
        pass
    except Exception as err:
        _LOGGER.debug("Storage registration failed: %s", err)
    
    # Method 2: Try frontend.add_extra_js_url
    try:
        for url in urls:
            try:
                hass.components.frontend.add_extra_js_url(url)
                _LOGGER.debug("Registered via add_extra_js_url: %s", url)
            except Exception:
                pass
        return
    except Exception:
        pass
    
    # Method 3: Just log the URLs for manual registration
    _LOGGER.info("Card URLs (register manually if needed):")
    for url in urls:
        _LOGGER.info("  - %s", url)
