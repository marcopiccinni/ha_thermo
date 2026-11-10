"""Additional migration coverage."""

from __future__ import annotations

from ha_thermo.const import DAYS
from ha_thermo.profile_migration import migrate_legacy_profile_dict


def test_builtin_defaults_from_empty_curves() -> None:
    legacy = {"id": "eco", "name": "Eco", "targets": {}, "curves": {}}
    out = migrate_legacy_profile_dict(legacy)
    assert out[0]["hourly"][0] == 19.0
