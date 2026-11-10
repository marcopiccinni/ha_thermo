"""Legacy scheduler tests (module removed in simplified 0.3.x)."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.skip(
    reason="Scheduler module removed in HA Thermo 0.3.x simplified rewrite"
)
