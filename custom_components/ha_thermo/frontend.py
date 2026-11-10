"""Register Lovelace card modules and static HTTP paths."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from homeassistant.core import HomeAssistant
from homeassistant.helpers.event import async_call_later

from .const import CARD_FILES, DOMAIN, VERSION

_LOGGER = logging.getLogger(__name__)

_WWW = Path(__file__).parent / "www"
_URL_BASE = f"/{DOMAIN}"


def _path_only(url: str) -> str:
    return urlparse(url).path


def _version_from_url(url: str) -> str | None:
    query = parse_qs(urlparse(url).query)
    values = query.get("v")
    return values[0] if values else None


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Serve card bundles and register them as Lovelace module resources."""
    await _async_register_static_paths(hass)
    await _async_register_lovelace_modules(hass)


async def _async_register_static_paths(hass: HomeAssistant) -> None:
    """Expose the integration www folder at /ha_thermo/."""
    if not _WWW.is_dir():
        _LOGGER.warning("Frontend folder missing: %s", _WWW)
        return

    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [StaticPathConfig(_URL_BASE, str(_WWW), cache_headers=False)]
        )
        _LOGGER.debug("Registered static path %s -> %s", _URL_BASE, _WWW)
        return
    except ImportError:
        pass
    except RuntimeError:
        _LOGGER.debug("Static path already registered: %s", _URL_BASE)
        return

    http = getattr(hass, "http", None)
    if http is None:
        return
    try:
        http.register_static_path(_URL_BASE, str(_WWW), False)
        _LOGGER.debug("Registered legacy static path %s", _URL_BASE)
    except RuntimeError:
        _LOGGER.debug("Static path already registered: %s", _URL_BASE)


async def _async_register_lovelace_modules(hass: HomeAssistant) -> None:
    """Add or update Lovelace module resources (storage mode) or extra_module_url (YAML)."""
    ll_data = hass.data.get("lovelace")
    if ll_data is None:
        async_call_later(hass, 5, lambda _: hass.async_create_task(_async_register_lovelace_modules(hass)))
        _LOGGER.debug("Lovelace not ready yet, retrying module registration")
        return

    resources = getattr(ll_data, "resources", None)
    mode = getattr(ll_data, "mode", "storage")

    if mode == "yaml":
        await _register_yaml_modules(hass)
        return

    if resources is None:
        _LOGGER.debug("Lovelace resources collection unavailable")
        return

    if not getattr(resources, "loaded", False):
        try:
            await resources.async_load()
        except Exception as err:
            _LOGGER.debug("Could not load Lovelace resources: %s", err)
            async_call_later(hass, 5, lambda _: hass.async_create_task(_async_register_lovelace_modules(hass)))
            return

    existing = list(resources.async_items() or [])
    existing_by_path: dict[str, dict[str, Any]] = {}
    for item in existing:
        path = _path_only(item.get("url", ""))
        if path.startswith(_URL_BASE):
            existing_by_path[path] = item

    for filename in CARD_FILES:
        path = f"{_URL_BASE}/{filename}"
        url = f"{path}?v={VERSION}"

        resource = existing_by_path.get(path)
        if resource:
            if _version_from_url(resource.get("url", "")) == VERSION:
                continue
            try:
                await resources.async_update_item(
                    resource["id"],
                    {"res_type": "module", "url": url},
                )
                _LOGGER.info("Updated Lovelace resource %s (%s)", path, VERSION)
            except Exception as err:
                _LOGGER.warning("Could not update Lovelace resource %s: %s", path, err)
            continue

        try:
            await resources.async_create_item({"res_type": "module", "url": url})
            _LOGGER.info("Registered Lovelace resource %s (%s)", path, VERSION)
        except Exception as err:
            _LOGGER.warning("Could not register Lovelace resource %s: %s", path, err)


async def _register_yaml_modules(hass: HomeAssistant) -> None:
    """Fallback for YAML resource mode."""
    try:
        from homeassistant.components import frontend as frontend_comp
    except ImportError:
        _LOGGER.debug("Frontend component unavailable for YAML Lovelace mode")
        return

    add_extra = getattr(frontend_comp, "add_extra_js_url", None)
    if add_extra is None:
        _LOGGER.warning(
            "Lovelace is in YAML mode: add these module resources manually: %s",
            ", ".join(f"{_URL_BASE}/{name}" for name in CARD_FILES),
        )
        return

    for filename in CARD_FILES:
        url = f"{_URL_BASE}/{filename}?v={VERSION}"
        try:
            add_extra(hass, url)
            _LOGGER.info("Registered extra module URL %s", url)
        except Exception as err:
            _LOGGER.warning("Could not register extra module URL %s: %s", url, err)
