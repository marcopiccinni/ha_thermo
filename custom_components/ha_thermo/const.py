"""Constants for the HA Thermo integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "ha_thermo"
VERSION: Final = "0.3.0"

STORAGE_VERSION: Final = 1
STORAGE_KEY: Final = f"{DOMAIN}.state"

# ---------------------------------------------------------------------------
# Config entry / options keys
# ---------------------------------------------------------------------------

CONF_NAME: Final = "name"
CONF_ZONES: Final = "zones"
CONF_CLIMATE_ENTITIES: Final = "climate_entities"

CONF_ZONE_ID: Final = "id"
CONF_ZONE_NAME: Final = "name"
CONF_CLIMATE_ENTITY: Final = "climate_entity"
CONF_TEMPERATURE_SENSOR: Final = "temperature_sensor"
CONF_MIN_TEMP: Final = "min_temp"
CONF_MAX_TEMP: Final = "max_temp"
CONF_DEFAULT_TEMP: Final = "default_temp"

CONF_MANUAL_HOLD: Final = "manual_hold"
CONF_REASSERT_INTERVAL: Final = "reassert_interval"
CONF_SCAN_INTERVAL: Final = "scan_interval"

CONF_COMFORT_TEMP: Final = "comfort_temp"
CONF_ECO_TEMP: Final = "eco_temp"
CONF_NIGHT_TEMP: Final = "night_temp"
CONF_AWAY_TEMP: Final = "away_temp"
CONF_SUMMER_TEMP: Final = "summer_temp"

DEFAULT_COMFORT_TEMP: Final = 20.0
DEFAULT_ECO_TEMP: Final = 19.0
DEFAULT_NIGHT_TEMP: Final = 18.0
DEFAULT_AWAY_TEMP: Final = 16.0
DEFAULT_SUMMER_TEMP: Final = 26.0

DEFAULT_MANUAL_HOLD: Final = 60
DEFAULT_REASSERT_INTERVAL: Final = 5
DEFAULT_SCAN_INTERVAL: Final = 30

MIN_MANUAL_HOLD: Final = 0
MAX_MANUAL_HOLD: Final = 1440
MIN_REASSERT_INTERVAL: Final = 1
MAX_REASSERT_INTERVAL: Final = 120
MIN_SCAN_INTERVAL: Final = 10
MAX_SCAN_INTERVAL: Final = 300

MIN_TEMP: Final = 5.0
MAX_TEMP: Final = 35.0
TEMP_STEP: Final = 0.5

# ---------------------------------------------------------------------------
# Profiles / activators / bypasses
# ---------------------------------------------------------------------------

DAYS: Final[tuple[str, ...]] = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

DAY_LABELS: Final[dict[str, str]] = {
    "mon": "Lun",
    "tue": "Mar",
    "wed": "Mer",
    "thu": "Gio",
    "fri": "Ven",
    "sat": "Sab",
    "sun": "Dom",
}

DAYS_LONG: Final[dict[str, str]] = {
    "mon": "Lunedì",
    "tue": "Martedì",
    "wed": "Mercoledì",
    "thu": "Giovedì",
    "fri": "Venerdì",
    "sat": "Sabato",
    "sun": "Domenica",
}

HOURS_IN_DAY: Final = 24

HVAC_MODES: Final[tuple[str, ...]] = (
    "off",
    "heat",
    "cool",
    "heat_cool",
    "auto",
    "dry",
    "fan_only",
)

PROFILE_AUTO: Final = "__auto__"
PROFILE_AUTO_LABEL: Final = "Auto (attivatori)"

PROFILE_ICON: Final = "mdi:home-thermometer"

DEFAULT_PROFILES: Final[tuple[tuple[str, str, str], ...]] = (
    ("comfort", "Comfort", CONF_COMFORT_TEMP),
    ("eco", "Eco", CONF_ECO_TEMP),
    ("notte", "Notte", CONF_NIGHT_TEMP),
    ("fuori_casa", "Fuori casa", CONF_AWAY_TEMP),
    ("estate", "Estate", CONF_SUMMER_TEMP),
)

DEFAULT_ACTIVATOR_ID: Final = "programmazione"
DEFAULT_ACTIVATOR_NAME: Final = "Programmazione"

# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

EVENT_PROFILE_CHANGED: Final = f"{DOMAIN}_profile_changed"
EVENT_BYPASS_STARTED: Final = f"{DOMAIN}_bypass_started"
EVENT_BYPASS_ENDED: Final = f"{DOMAIN}_bypass_ended"
EVENT_TARGET_CHANGED: Final = f"{DOMAIN}_target_changed"
EVENT_MANUAL_OVERRIDE: Final = f"{DOMAIN}_manual_override"
EVENT_PROFILE_OVERRIDE_STARTED: Final = f"{DOMAIN}_profile_override_started"
EVENT_PROFILE_OVERRIDE_ENDED: Final = f"{DOMAIN}_profile_override_ended"
EVENT_WEEKLY_CHANGED: Final = f"{DOMAIN}_weekly_changed"

# ---------------------------------------------------------------------------
# Entity attributes / services
# ---------------------------------------------------------------------------

ATTR_ZONE_ID: Final = "zone_id"
ATTR_PROFILE_ID: Final = "profile_id"
ATTR_PROFILE_NAME: Final = "profile_name"
ATTR_TARGET: Final = "target"
ATTR_BYPASS: Final = "bypass"
ATTR_OVERRIDE: Final = "override"
ATTR_NEXT_CHANGE: Final = "next_change"
ATTR_ZONES: Final = "zones"
ATTR_TEMPERATURE: Final = "temperature"
ATTR_OFFSET: Final = "offset"
ATTR_DURATION: Final = "duration"
ATTR_UNTIL: Final = "until"
ATTR_SOURCE: Final = "source"
ATTR_ENABLED: Final = "enabled"
ATTR_PROFILE: Final = "profile"
ATTR_ACTIVATOR: Final = "activator"
ATTR_ACTIVATOR_ID: Final = "activator_id"
ATTR_SOURCE_ID: Final = "source_id"
ATTR_DAYS: Final = "days"
ATTR_DAY: Final = "day"

SERVICE_SET_PROFILE: Final = "set_profile"
SERVICE_SET_TEMPERATURE: Final = "set_temperature"
SERVICE_START_BYPASS: Final = "start_bypass"
SERVICE_STOP_BYPASS: Final = "stop_bypass"
SERVICE_ENABLE: Final = "enable"
SERVICE_CREATE_PROFILE: Final = "create_profile"
SERVICE_UPDATE_PROFILE: Final = "update_profile"
SERVICE_DELETE_PROFILE: Final = "delete_profile"
SERVICE_CLONE_PROFILE: Final = "clone_profile"
SERVICE_CREATE_ACTIVATOR: Final = "create_activator"
SERVICE_UPDATE_ACTIVATOR: Final = "update_activator"
SERVICE_DELETE_ACTIVATOR: Final = "delete_activator"
SERVICE_SET_WEEKDAY_PROFILE: Final = "set_weekday_profile"
SERVICE_CLEAR_WEEKDAY_PROFILE: Final = "clear_weekday_profile"
SERVICE_SET_PROFILE_OVERRIDE: Final = "set_profile_override"
SERVICE_CLEAR_PROFILE_OVERRIDE: Final = "clear_profile_override"
SERVICE_RELOAD: Final = "reload"

SERVICE_NAMES: Final[dict[str, str]] = {
    SERVICE_SET_PROFILE: "Set the active profile",
    SERVICE_SET_TEMPERATURE: "Temporarily set a temperature",
    SERVICE_START_BYPASS: "Start a timed bypass",
    SERVICE_STOP_BYPASS: "Stop a timed bypass",
    SERVICE_ENABLE: "Enable or disable automatic control",
    SERVICE_CREATE_PROFILE: "Create a profile",
    SERVICE_UPDATE_PROFILE: "Update a profile",
    SERVICE_DELETE_PROFILE: "Delete a profile",
    SERVICE_CLONE_PROFILE: "Clone a profile",
    SERVICE_CREATE_ACTIVATOR: "Create an activator",
    SERVICE_UPDATE_ACTIVATOR: "Update an activator",
    SERVICE_DELETE_ACTIVATOR: "Delete an activator",
    SERVICE_SET_WEEKDAY_PROFILE: "Assign a profile to weekdays",
    SERVICE_CLEAR_WEEKDAY_PROFILE: "Clear weekday profile assignments",
    SERVICE_SET_PROFILE_OVERRIDE: "Temporarily override the profile",
    SERVICE_CLEAR_PROFILE_OVERRIDE: "Clear the profile override",
    SERVICE_RELOAD: "Reload profiles and activators",
}

# ---------------------------------------------------------------------------
# Frontend cards
# ---------------------------------------------------------------------------

ASSET_FILES: Final[tuple[str, ...]] = (
    "ha-thermo-common.js",
)

CARD_FILES: Final[tuple[str, ...]] = (
    "ha-thermo-card.js",
    "ha-thermo-graph-card.js",
    "ha-thermo-manager-card.js",
)

CARD_URLS: Final[tuple[str, ...]] = tuple(
    f"/{DOMAIN}/{name}" for name in CARD_FILES
)

CARD_NAMES: Final[dict[str, str]] = {
    "ha-thermo-card": "HA Thermo Controlli",
    "ha-thermo-graph-card": "HA Thermo Grafico",
    "ha-thermo-manager-card": "HA Thermo Manager",
}

ENTITY_CURRENT_TEMPERATURE: Final = "current_temperature"
ENTITY_TARGET_TEMPERATURE: Final = "target_temperature"
ENTITY_NEXT_CHANGE: Final = "next_change"
ENTITY_BYPASS_REMAINING: Final = "bypass_remaining"
ENTITY_BYPASS_ACTIVE: Final = "bypass_active"
ENTITY_OVERRIDE_ACTIVE: Final = "override_active"
ENTITY_PROFILE: Final = "profile"
ENTITY_ENABLED: Final = "enabled"

HUB_ZONE_ID: Final = "hub"


def entity_unique_id(entry_id: str, zone_id: str, key: str) -> str:
    """Return the stable unique_id used by every platform entity."""
    return f"{entry_id}_{zone_id}_{key}"


ATTRIBUTION: Final = "HA Thermo"

DISCLAIMER: Final = (
    "Progetto personale non ufficiale. Nessuna garanzia di funzionamento o "
    "continuità. Verifica sempre il comportamento dei tuoi termostati."
)
