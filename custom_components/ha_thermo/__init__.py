"""HA Thermo integration - Simplified version 0.3.2."""

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
    
    # Register cards AFTER platforms are loaded
    await hass.async_add_executor_job(_register_static_paths, hass)
    await _register_lovelace_resources(hass)
    
    return True


def _register_static_paths(hass: HomeAssistant) -> None:
    """Register static paths for card files."""
    http = getattr(hass, "http", None)
    if http is None or not _WWW.is_dir():
        return

    all_files = list(ASSET_FILES) + list(CARD_FILES)
    for name in all_files:
        file_path = _WWW / name
        if not file_path.is_file():
            continue
        url = f"/{DOMAIN}/{name}"
        try:
            http.register_static_path(url, str(file_path), False)
            _LOGGER.debug("Registered static path: %s", url)
        except Exception as err:
            _LOGGER.warning("Could not register static path %s: %s", url, err)


async def _register_lovelace_resources(hass: HomeAssistant) -> None:
    """Register card modules as Lovelace resources."""
    try:
        from homeassistant.components.lovelace import DOMAIN as LL_DOMAIN
        
        ll_resources = hass.data.get(LL_DOMAIN, {}).get("resources")
        if not ll_resources or not hasattr(ll_resources, "async_items"):
            _LOGGER.debug("Lovelace resources not available")
            return
        
        # Get existing resources
        try:
            existing = ll_resources.async_items() or []
        except Exception:
            existing = []
        
        existing_urls = {r.get("url", "").split("?")[0] for r in existing}
        
        # Register card files
        for name in CARD_FILES:
            url = f"/{DOMAIN}/{name}?v={VERSION}"
            url_base = url.split("?")[0]
            
            if url_base in existing_urls:
                _LOGGER.debug("Resource already exists: %s", url_base)
                continue
            
            try:
                await ll_resources.async_create_item({
                    "res_type": "module",
                    "url": url,
                })
                _LOGGER.info("✓ Registered Lovelace resource: %s", url)
            except Exception as err:
                _LOGGER.warning("Could not register resource %s: %s", url, err)
                
    except ImportError as err:
        _LOGGER.debug("Could not import Lovelace components: %s", err)
    except Exception as err:
        _LOGGER.warning("Error registering Lovelace resources: %s", err)


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
