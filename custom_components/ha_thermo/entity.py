"""Shared entity helpers for HA Thermo."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, VERSION
from .coordinator import ThermoCoordinator
from .manager import ThermoManager
from .models import Zone


class ThermoEntity(CoordinatorEntity[ThermoCoordinator]):
    """Base entity tied to a zone or to the hub device."""

    _attr_has_entity_name = True

    def __init__(
        self, coordinator: ThermoCoordinator, zone: Zone | None = None
    ) -> None:
        super().__init__(coordinator)
        self.manager: ThermoManager = coordinator.manager
        self.zone = zone

    @property
    def device_info(self) -> DeviceInfo:
        entry = self.manager.entry
        if self.zone is None:
            return DeviceInfo(
                identifiers={(DOMAIN, entry.entry_id)},
                name=entry.title,
                manufacturer="marcopiccinni",
                model="HA Thermo",
                sw_version=VERSION,
            )
        return DeviceInfo(
            identifiers={(DOMAIN, f"{entry.entry_id}:{self.zone.id}")},
            via_device=(DOMAIN, entry.entry_id),
            name=self.zone.name,
            manufacturer="marcopiccinni",
            model="Zona termostato",
            sw_version=VERSION,
            suggested_area=self.zone.name,
        )

    @property
    def available(self) -> bool:
        if not super().available:
            return False
        if self.zone is None:
            return True
        return self.hass.states.get(self.zone.climate_entity) is not None
