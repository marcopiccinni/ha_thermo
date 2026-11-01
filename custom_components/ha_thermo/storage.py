"""Persistent storage for HA Thermo."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION


class ThermoStore:
    """Small wrapper around Home Assistant's Store helper."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(
            hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry_id}"
        )

    async def async_load(self) -> dict[str, Any] | None:
        """Load the stored state, if any."""
        data = await self._store.async_load()
        return data if isinstance(data, dict) else None

    def async_save(self, data: dict[str, Any]) -> None:
        """Schedule a debounced save."""
        self._store.async_delay_save(lambda: data, 2.0)

    async def async_flush(self, data: dict[str, Any]) -> None:
        """Write the state immediately."""
        await self._store.async_save(data)

    async def async_remove(self) -> None:
        """Remove the stored state."""
        await self._store.async_remove()
