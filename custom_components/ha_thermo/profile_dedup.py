"""Merge duplicate HA Thermo profiles (migration day-copies and identical curves)."""

from __future__ import annotations

import logging
import re
from typing import TYPE_CHECKING

from .const import DAYS, DEFAULT_PROFILE_IDS
from .profile_migration import _DAY_SUFFIX

if TYPE_CHECKING:
    from .models import Profile

_LOGGER = logging.getLogger(__name__)

_DAY_LABELS = set(_DAY_SUFFIX.values())
_NAME_DAY_PATTERN = re.compile(r"^(.+)\s+\((Lun|Mar|Mer|Gio|Ven|Sab|Dom)\)$")


def curves_equal(a: list[float], b: list[float], eps: float = 0.05) -> bool:
    """Return True if two hourly curves match within tolerance."""
    if len(a) != len(b):
        return False
    return all(abs(float(x) - float(y)) <= eps for x, y in zip(a, b))


def _hourly_key(hourly: list[float]) -> tuple[float, ...]:
    return tuple(round(float(v), 2) for v in hourly)


def _survivor_rank(profile_id: str, profile: Profile) -> tuple[int, int, int, str]:
    """Lower rank wins as canonical profile for a curve group."""
    name = profile.name or ""
    score = 0
    if profile_id in DEFAULT_PROFILE_IDS:
        score -= 1000
    if "_" in profile_id and any(profile_id.endswith(f"_{d}") for d in DAYS):
        score += 50
    if "(" in name:
        score += 40
    if _NAME_DAY_PATTERN.match(name):
        score += 30
    return (score, len(profile_id), len(name), profile_id)


def _resolve_base_id(profile_id: str, profiles: dict[str, Profile]) -> str | None:
    """Map migration ids like eco_mon or names 'Eco (Dom)' to a base profile."""
    for day in DAYS:
        suffix = f"_{day}"
        if profile_id.endswith(suffix):
            base = profile_id[: -len(suffix)]
            if base in profiles:
                return base
    profile = profiles.get(profile_id)
    if profile is None:
        return None
    match = _NAME_DAY_PATTERN.match(profile.name.strip())
    if not match:
        return None
    base_name = match.group(1).strip()
    for pid, candidate in profiles.items():
        if candidate.name.strip() == base_name and curves_equal(candidate.hourly, profile.hourly):
            return pid
    return None


def build_profile_merge_map(profiles: dict[str, Profile]) -> dict[str, str]:
    """
    Build old_id -> canonical_id for profiles that should be merged away.

    Merges: identical 24h curves; migration copies eco_dom / 'Eco (Dom)' when curve matches base.
    """
    if not profiles:
        return {}

    remap: dict[str, str] = {}

    # Curve-equivalence groups
    groups: dict[tuple[float, ...], list[str]] = {}
    for pid, profile in profiles.items():
        profile.ensure_hourly()
        groups.setdefault(_hourly_key(profile.hourly), []).append(pid)

    survivors: dict[str, str] = {}
    for _key, pids in groups.items():
        ordered = sorted(pids, key=lambda pid: _survivor_rank(pid, profiles[pid]))
        keep = ordered[0]
        survivors[keep] = keep
        for pid in ordered[1:]:
            remap[pid] = keep

    # Explicit migration copy -> base when curves match
    for pid in list(profiles):
        if pid in remap:
            continue
        base = _resolve_base_id(pid, profiles)
        if base and base in profiles and curves_equal(profiles[pid].hourly, profiles[base].hourly):
            target = remap.get(base, base)
            if pid != target:
                remap[pid] = target

    # Transitive closure
    def canonical(pid: str) -> str:
        seen = set()
        while pid in remap and pid not in seen:
            seen.add(pid)
            pid = remap[pid]
        return pid

    return {old: canonical(new) for old, new in remap.items() if canonical(old) != old}


def apply_profile_merge(
    profiles: dict[str, Profile],
    weekly_profiles: dict[str, dict[str, str]],
    active_profiles: dict[str, str],
    pinned_profiles: dict[str, dict[str, object]],
) -> dict[str, str]:
    """Merge duplicates in place; returns merge map applied."""
    merge = build_profile_merge_map(profiles)
    if not merge:
        return {}

    def _remap(pid: str | None) -> str | None:
        if not pid:
            return pid
        return merge.get(str(pid), str(pid))

    for zone_id, schedule in weekly_profiles.items():
        for day in list(schedule):
            schedule[day] = _remap(schedule.get(day)) or schedule[day]

    for zone_id, pid in list(active_profiles.items()):
        active_profiles[zone_id] = _remap(pid) or pid

    for zone_id, pin in list(pinned_profiles.items()):
        if isinstance(pin, dict) and pin.get("profile_id"):
            pin["profile_id"] = _remap(str(pin["profile_id"])) or pin["profile_id"]

    removed: list[str] = []
    for old_id, new_id in merge.items():
        if old_id in profiles and old_id != new_id:
            profiles.pop(old_id, None)
            removed.append(f"{old_id}→{new_id}")

    if removed:
        _LOGGER.info(
            "HA Thermo: merged %d duplicate profile(s): %s",
            len(removed),
            ", ".join(removed[:20]) + ("…" if len(removed) > 20 else ""),
        )
    return merge
