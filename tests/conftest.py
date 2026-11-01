"""Pytest bootstrap for the integration's pure modules.

Importing ``custom_components.ha_thermo`` would execute ``__init__.py`` which
pulls in Home Assistant. The modules under test (const, models, schedule,
bypass) have no HA imports, so we register a synthetic package pointing at the
component directory.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "ha_thermo"

if "ha_thermo" not in sys.modules:
    package = types.ModuleType("ha_thermo")
    package.__path__ = [str(COMPONENT)]
    sys.modules["ha_thermo"] = package
