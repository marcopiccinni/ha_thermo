"""Constants for HA Thermo."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "ha_thermo"
STORAGE_KEY: Final = "ha_thermo.state"
STORAGE_VERSION: Final = 1
VERSION: Final = "0.3.1"

# Configuration
CONF_ZONES: Final = "zones"
CONF_NAME: Final = "name"
CONF_COMFORT_TEMP: Final = "comfort_temp"
CONF_ECO_TEMP: Final = "eco_temp"
CONF_AWAY_TEMP: Final = "away_temp"
CONF_NIGHT_TEMP: Final = "night_temp"
CONF_SUMMER_TEMP: Final = "summer_temp"
CONF_SCAN_INTERVAL: Final = "scan_interval"
CONF_REASSERT_INTERVAL: Final = "reassert_interval"
CONF_MANUAL_HOLD: Final = "manual_hold"

DEFAULT_COMFORT_TEMP: Final = 20.0
DEFAULT_ECO_TEMP: Final = 19.0
DEFAULT_AWAY_TEMP: Final = 17.0
DEFAULT_NIGHT_TEMP: Final = 18.0
DEFAULT_SUMMER_TEMP: Final = 26.0
DEFAULT_SCAN_INTERVAL: Final = 30
DEFAULT_REASSERT_INTERVAL: Final = 120
DEFAULT_MANUAL_HOLD: Final = 30

# Entity attributes
ENTITY_CURRENT_TEMPERATURE: Final = "current_temperature"
ENTITY_TARGET_TEMPERATURE: Final = "target_temperature"
ENTITY_NEXT_CHANGE: Final = "next_change"
ENTITY_BYPASS_REMAINING: Final = "bypass_remaining"
ENTITY_BYPASS_ACTIVE: Final = "bypass_active"
ENTITY_OVERRIDE_ACTIVE: Final = "override_active"
ENTITY_PROFILE: Final = "profile"
ENTITY_ENABLED: Final = "enabled"

# Events
EVENT_PROFILE_CHANGED: Final = f"{DOMAIN}_profile_changed"
EVENT_BYPASS_STARTED: Final = f"{DOMAIN}_bypass_started"
EVENT_BYPASS_ENDED: Final = f"{DOMAIN}_bypass_ended"
EVENT_TARGET_CHANGED: Final = f"{DOMAIN}_target_changed"
EVENT_MANUAL_OVERRIDE: Final = f"{DOMAIN}_manual_override"

# Services
SERVICE_SET_PROFILE: Final = "set_profile"
SERVICE_SET_TEMPERATURE: Final = "set_temperature"
SERVICE_START_BYPASS: Final = "start_bypass"
SERVICE_STOP_BYPASS: Final = "stop_bypass"
SERVICE_ENABLE: Final = "enable"
SERVICE_CREATE_PROFILE: Final = "create_profile"
SERVICE_UPDATE_PROFILE: Final = "update_profile"
SERVICE_DELETE_PROFILE: Final = "delete_profile"
SERVICE_CLONE_PROFILE: Final = "clone_profile"
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
    SERVICE_RELOAD: "Reload profiles",
}

# Attributes
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

# Profile constants
PROFILE_AUTO: Final = "__auto__"
PROFILE_AUTO_LABEL: Final = "Auto"
PROFILE_ICON: Final = "mdi:home-thermometer"

HUB_ZONE_ID: Final = "hub"


def entity_unique_id(entry_id: str, zone_id: str, key: str) -> str:
    """Generate unique ID."""
    return f"{entry_id}_{zone_id}_{key}".replace("-", "_")

# Asset files
ASSET_FILES: Final = [
    "manifest.json",
    "strings.json",
    "services.yaml",
    "translations/en.json",
    "translations/it.json",
]

CARD_FILES: Final = [
    "www/ha-thermo-card.js",
    "www/ha-thermo-graph-card.js",
    "www/ha-thermo-common.js",
]

# Time constants
DAYS: Final = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
HOURS_IN_DAY: Final = 24
MIN_TEMP: Final = 5
MAX_TEMP: Final = 35

# Additional config
CONF_CLIMATE_ENTITIES: Final = "climate_entities"
CONF_CLIMATE_ENTITY: Final = "climate_entity"
CONF_DEFAULT_TEMP: Final = "default_temp"
CONF_MIN_TEMP: Final = "min_temp"
CONF_MAX_TEMP: Final = "max_temp"
CONF_AWAY_TEMP: Final = "away_temp"
CONF_COMFORT_TEMP: Final = "comfort_temp"
CONF_ECO_TEMP: Final = "eco_temp"
CONF_NIGHT_TEMP: Final = "night_temp"
CONF_REASSERT_INTERVAL: Final = "reassert_interval"
CONF_SCAN_INTERVAL: Final = "scan_interval"

# Storage
STORAGE_KEY: Final = "ha_thermo.state"
STORAGE_VERSION: Final = 1

# Config flow constants
CONF_CLIMATE_ENTITIES: Final = "climate_entities"
CONF_CLIMATE_ENTITY: Final = "climate_entity"
CONF_DEFAULT_TEMP: Final = "default_temp"
CONF_TEMPERATURE_SENSOR: Final = "temperature_sensor"
CONF_ZONE_ID: Final = "zone_id"
CONF_ZONE_NAME: Final = "zone_name"
CONF_SUMMER_TEMP: Final = "summer_temp"

# Config flow defaults
DEFAULT_AWAY_TEMP: Final = 17.0
DEFAULT_COMFORT_TEMP: Final = 20.0
DEFAULT_ECO_TEMP: Final = 19.0
DEFAULT_NIGHT_TEMP: Final = 18.0
DEFAULT_SUMMER_TEMP: Final = 26.0
MIN_TEMP: Final = 5.0
MAX_TEMP: Final = 35.0
TEMP_STEP: Final = 0.5
MIN_SCAN_INTERVAL: Final = 10
MAX_SCAN_INTERVAL: Final = 300
MIN_REASSERT_INTERVAL: Final = 30
MAX_REASSERT_INTERVAL: Final = 240
MIN_MANUAL_HOLD: Final = 0
MAX_MANUAL_HOLD: Final = 120
