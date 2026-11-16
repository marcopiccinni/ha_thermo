"""Normalize thermostat targeting fields for services and WebSocket commands."""

from __future__ import annotations

import logging
from typing import Any

from .const import ATTR_THERMOSTATS, ATTR_ZONES

_LOGGER = logging.getLogger(__name__)

DEPRECATION_ZONES_FIELD = (
    "The HA Thermo field 'zones' is deprecated; use 'thermostats' instead."
)


def thermostats_from_payload(data: dict[str, Any]) -> list[str] | None:
    """Return thermostat targets from service or WS payload (thermostats preferred)."""
    has_thermostats = ATTR_THERMOSTATS in data and data[ATTR_THERMOSTATS] is not None
    has_zones = ATTR_ZONES in data and data[ATTR_ZONES] is not None
    if has_thermostats:
        if has_zones:
            _LOGGER.warning(
                "%s Both fields were provided; using 'thermostats'.",
                DEPRECATION_ZONES_FIELD,
            )
        raw = data[ATTR_THERMOSTATS]
    elif has_zones:
        _LOGGER.warning("%s", DEPRECATION_ZONES_FIELD)
        raw = data[ATTR_ZONES]
    else:
        return None
    if raw is None:
        return None
    if isinstance(raw, str):
        return [raw]
    return [str(item) for item in raw]