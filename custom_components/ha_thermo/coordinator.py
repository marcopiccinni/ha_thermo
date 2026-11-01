"""Data update coordinator for HA Thermo."""

from __future__ import annotations

import logging
from datetime import timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import DOMAIN
from .manager import ThermoManager

_LOGGER = logging.getLogger(__name__)


class ThermoCoordinator(DataUpdateCoordinator[None]):
    """Periodically let the manager resolve and apply the active targets."""

    def __init__(
        self, hass: HomeAssistant, manager: ThermoManager, scan_interval: int
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=scan_interval),
        )
        self.manager = manager

    async def _async_update_data(self) -> None:
        await self.manager.async_tick()
