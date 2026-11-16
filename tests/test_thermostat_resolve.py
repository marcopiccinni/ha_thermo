"""Thermostat / climate entity resolution helpers."""

from __future__ import annotations

from ha_thermo.models import Zone


def test_zone_for_climate_lookup_pattern() -> None:
    zones = {
        "abc": Zone(id="abc", name="Sala", climate_entity="climate.sala"),
    }
    entity = "climate.sala"
    found = next(
        (z for z in zones.values() if z.climate_entity == entity),
        None,
    )
    assert found is not None
    assert found.id == "abc"


def test_legacy_zone_id_still_maps() -> None:
    zones = {
        "legacy12": Zone(id="legacy12", name="Studio", climate_entity="climate.studio"),
    }
    key = "legacy12"
    assert key in zones