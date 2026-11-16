"""Tests for service thermostat field normalization."""

from __future__ import annotations

import logging

import pytest
from ha_thermo.const import ATTR_THERMOSTATS, ATTR_ZONES
from ha_thermo.service_fields import thermostats_from_payload


def test_thermostats_from_payload_primary() -> None:
    data = {ATTR_THERMOSTATS: ["climate.studio", "climate.sala"]}
    assert thermostats_from_payload(data) == ["climate.studio", "climate.sala"]


def test_thermostats_from_payload_legacy_zones_alias(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.WARNING)
    data = {ATTR_ZONES: ["climate.cucina"]}
    assert thermostats_from_payload(data) == ["climate.cucina"]
    assert "deprecated" in caplog.text.lower()


def test_thermostats_from_payload_prefers_thermostats_over_zones(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.WARNING)
    data = {
        ATTR_THERMOSTATS: ["climate.a"],
        ATTR_ZONES: ["climate.b"],
    }
    assert thermostats_from_payload(data) == ["climate.a"]
    assert "thermostats" in caplog.text.lower()


def test_thermostats_from_payload_absent() -> None:
    assert thermostats_from_payload({}) is None