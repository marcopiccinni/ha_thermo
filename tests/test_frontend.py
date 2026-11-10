"""Frontend asset path sanity checks."""

from __future__ import annotations

from pathlib import Path

from ha_thermo.const import CARD_FILES, DOMAIN, VERSION

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "ha_thermo" / "www"


def test_card_files_exist_under_www() -> None:
    for name in CARD_FILES:
        assert (_WWW / name).is_file(), f"missing card bundle: {name}"


def test_version_matches_manifest() -> None:
    import json

    manifest = json.loads(
        (Path(__file__).resolve().parents[1] / "custom_components" / "ha_thermo" / "manifest.json").read_text(
            encoding="utf-8"
        )
    )
    assert manifest["version"] == VERSION


def test_expected_public_urls() -> None:
    assert CARD_FILES[0] == "ha-thermo-card.js"
    assert f"/{DOMAIN}/ha-thermo-card.js" == "/ha_thermo/ha-thermo-card.js"
