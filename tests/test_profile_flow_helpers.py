"""Tests for options-flow profile helpers."""

from __future__ import annotations

from ha_thermo.models import Profile
from ha_thermo.profile_flow_helpers import (
    curve_preview,
    flatten_section_hours,
    notice_message,
    profile_summary_label,
)


def test_profile_summary_label() -> None:
    p = Profile("eco", "Eco", hourly=[17.0] * 12 + [19.0] * 12)
    assert profile_summary_label(p) == "Eco · 17–19 °C"


def test_flatten_section_hours_uniform() -> None:
    hourly = flatten_section_hours({"uniform_temp": 21.5})
    assert hourly == [21.5] * 24


def test_flatten_section_hours_sections() -> None:
    data = {
        "night": {"hour_0": 18.0, "hour_1": 18.0, "hour_2": 18.0, "hour_3": 18.0, "hour_4": 18.0, "hour_5": 18.0},
        "morning": {f"hour_{h}": 19.0 for h in range(6, 12)},
        "afternoon": {f"hour_{h}": 20.0 for h in range(12, 18)},
        "evening": {f"hour_{h}": 18.0 for h in range(18, 24)},
    }
    hourly = flatten_section_hours(data)
    assert hourly[0] == 18.0
    assert hourly[6] == 19.0
    assert hourly[12] == 20.0


def test_curve_preview_runs() -> None:
    text = curve_preview([19.0] * 24)
    assert "00–23h" in text


def test_notice_message_it() -> None:
    assert notice_message("it", "profile_saved").startswith("Profilo")
