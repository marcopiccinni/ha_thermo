"""Tests for profile deduplication."""

from custom_components.ha_thermo.models import Profile
from custom_components.ha_thermo.profile_dedup import apply_profile_merge, build_profile_merge_map


def _p(pid: str, name: str, temp: float) -> Profile:
    return Profile(id=pid, name=name, hourly=[temp] * 24)


def test_merge_identical_curves_prefers_default_id():
    profiles = {
        "eco": _p("eco", "Eco", 19),
        "eco_dom": _p("eco_dom", "Eco (Dom)", 19),
        "eco_gio": _p("eco_gio", "Eco (Gio)", 19),
    }
    merge = build_profile_merge_map(profiles)
    assert merge["eco_dom"] == "eco"
    assert merge["eco_gio"] == "eco"


def test_apply_repoints_weekly():
    profiles = {
        "eco": _p("eco", "Eco", 19),
        "eco_mon": _p("eco_mon", "Eco (Lun)", 19),
    }
    weekly = {"z1": {"mon": "eco_mon", "tue": "eco"}}
    active = {"z1": "eco_mon"}
    pinned: dict = {}
    merge = apply_profile_merge(profiles, weekly, active, pinned)
    assert merge["eco_mon"] == "eco"
    assert "eco_mon" not in profiles
    assert weekly["z1"]["mon"] == "eco"
    assert active["z1"] == "eco"
