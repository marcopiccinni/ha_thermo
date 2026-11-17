"""Pytest bootstrap for ha_thermo unit and HA integration tests."""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "ha_thermo"

try:
    import homeassistant  # noqa: F401

    _HAS_HA = True
except ImportError:
    _HAS_HA = False

if _HAS_HA:
    pytest_plugins = ["pytest_homeassistant_custom_component.common"]

if not _HAS_HA and "ha_thermo" not in sys.modules:
    package = types.ModuleType("ha_thermo")
    package.__path__ = [str(COMPONENT)]
    sys.modules["ha_thermo"] = package