"""Config and options flow for HA Thermo."""

from __future__ import annotations

import uuid
from typing import Any

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector

from .const import (
    CONF_AWAY_TEMP,
    CONF_CLIMATE_ENTITIES,
    CONF_CLIMATE_ENTITY,
    CONF_COMFORT_TEMP,
    CONF_DEFAULT_TEMP,
    CONF_ECO_TEMP,
    CONF_MANUAL_HOLD,
    CONF_MAX_TEMP,
    CONF_MIN_TEMP,
    CONF_NAME,
    CONF_NIGHT_TEMP,
    CONF_REASSERT_INTERVAL,
    CONF_SCAN_INTERVAL,
    CONF_SUMMER_TEMP,
    CONF_TEMPERATURE_SENSOR,
    CONF_ZONE_ID,
    CONF_ZONE_NAME,
    CONF_ZONES,
    DEFAULT_AWAY_TEMP,
    DEFAULT_COMFORT_TEMP,
    DEFAULT_ECO_TEMP,
    DEFAULT_MANUAL_HOLD,
    DEFAULT_NIGHT_TEMP,
    DEFAULT_REASSERT_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_SUMMER_TEMP,
    DEFAULT_PROFILE_IDS,
    DOMAIN,
    MAX_MANUAL_HOLD,
    MAX_REASSERT_INTERVAL,
    MAX_SCAN_INTERVAL,
    MAX_TEMP,
    MIN_MANUAL_HOLD,
    MIN_REASSERT_INTERVAL,
    MIN_SCAN_INTERVAL,
    MIN_TEMP,
    TEMP_STEP,
)
from .manager import ThermoManager
from .models import Profile, Zone, slugify

_AWAY = "away"
_BACK = "back"
_ADD = "add"


def _climate_selector() -> selector.EntitySelector:
    return selector.EntitySelector(
        selector.EntitySelectorConfig(domain="climate")
    )


def _temperature_sensor_selector() -> selector.EntitySelector:
    return selector.EntitySelector(
        selector.EntitySelectorConfig(
            domain="sensor", device_class="temperature"
        )
    )


def _number(
    minimum: float,
    maximum: float,
    step: float,
    unit: str = "°C",
) -> selector.NumberSelector:
    return selector.NumberSelector(
        selector.NumberSelectorConfig(
            min=minimum,
            max=maximum,
            step=step,
            mode=selector.NumberSelectorMode.BOX,
            unit_of_measurement=unit,
        )
    )


def _settings_schema(options: dict[str, Any]) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_MANUAL_HOLD,
                default=options.get(CONF_MANUAL_HOLD, DEFAULT_MANUAL_HOLD),
            ): _number(MIN_MANUAL_HOLD, MAX_MANUAL_HOLD, 5, "min"),
            vol.Required(
                CONF_REASSERT_INTERVAL,
                default=options.get(
                    CONF_REASSERT_INTERVAL, DEFAULT_REASSERT_INTERVAL
                ),
            ): _number(
                MIN_REASSERT_INTERVAL, MAX_REASSERT_INTERVAL, 1, "min"
            ),
            vol.Required(
                CONF_SCAN_INTERVAL,
                default=options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
            ): _number(MIN_SCAN_INTERVAL, MAX_SCAN_INTERVAL, 5, "s"),
            vol.Required(
                CONF_COMFORT_TEMP,
                default=options.get(CONF_COMFORT_TEMP, DEFAULT_COMFORT_TEMP),
            ): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
            vol.Required(
                CONF_ECO_TEMP,
                default=options.get(CONF_ECO_TEMP, DEFAULT_ECO_TEMP),
            ): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
            vol.Required(
                CONF_NIGHT_TEMP,
                default=options.get(CONF_NIGHT_TEMP, DEFAULT_NIGHT_TEMP),
            ): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
            vol.Required(
                CONF_AWAY_TEMP,
                default=options.get(CONF_AWAY_TEMP, DEFAULT_AWAY_TEMP),
            ): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
            vol.Required(
                CONF_SUMMER_TEMP,
                default=options.get(CONF_SUMMER_TEMP, DEFAULT_SUMMER_TEMP),
            ): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
        }
    )


class ThermoConfigFlow(ConfigFlow, domain=DOMAIN):
    """Create the integration and its initial zones."""

    VERSION = 1
    MINOR_VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            entities = user_input.get(CONF_CLIMATE_ENTITIES) or []
            if not entities:
                errors["base"] = "no_entities"
            else:
                await self.async_set_unique_id(DOMAIN)
                self._abort_if_unique_id_configured()
                zones = []
                for entity_id in dict.fromkeys(entities):
                    state = self.hass.states.get(entity_id)
                    name = state.name if state is not None else entity_id
                    zone = Zone(
                        id=uuid.uuid4().hex[:12],
                        name=name,
                        climate_entity=entity_id,
                    )
                    zones.append(zone.to_dict())
                options = {
                    CONF_ZONES: zones,
                    CONF_MANUAL_HOLD: DEFAULT_MANUAL_HOLD,
                    CONF_REASSERT_INTERVAL: DEFAULT_REASSERT_INTERVAL,
                    CONF_SCAN_INTERVAL: DEFAULT_SCAN_INTERVAL,
                    CONF_COMFORT_TEMP: DEFAULT_COMFORT_TEMP,
                    CONF_ECO_TEMP: DEFAULT_ECO_TEMP,
                    CONF_NIGHT_TEMP: DEFAULT_NIGHT_TEMP,
                    CONF_AWAY_TEMP: DEFAULT_AWAY_TEMP,
                    CONF_SUMMER_TEMP: DEFAULT_SUMMER_TEMP,
                }
                return self.async_create_entry(
                    title=str(user_input.get(CONF_NAME) or "HA Thermo"),
                    data={CONF_NAME: user_input.get(CONF_NAME) or "HA Thermo"},
                    options=options,
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_NAME, default="HA Thermo"): str,
                vol.Required(CONF_CLIMATE_ENTITIES): selector.EntitySelector(
                    selector.EntitySelectorConfig(
                        domain="climate", multiple=True
                    )
                ),
            }
        )
        return self.async_show_form(
            step_id="user",
            data_schema=schema,
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return ThermoOptionsFlow()


class ThermoOptionsFlow(OptionsFlow):
    """Settings and zones manager."""

    def __init__(self) -> None:
        self._options: dict[str, Any] = {}
        self._zones: list[dict[str, Any]] = []
        self._edit_zone_id: str | None = None
        self._edit_profile_id: str | None = None
        self._clone_profile_id: str | None = None
        self._loaded = False

    def _get_manager(self) -> ThermoManager | None:
        manager = self.hass.data.get(DOMAIN, {}).get("manager")
        if manager is None or manager.entry.entry_id != self.config_entry.entry_id:
            return None
        return manager

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        if not self._loaded:
            self._options = dict(self.config_entry.options)
            self._zones = [
                dict(zone) for zone in self._options.get(CONF_ZONES, [])
            ]
            self._loaded = True
        return self.async_show_menu(
            step_id="init",
            menu_options=["settings", "zones", "finish"],
        )

    async def async_step_settings(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        if user_input is not None:
            self._options.update(user_input)
            return await self.async_step_init()
        return self.async_show_form(
            step_id="settings",
            data_schema=_settings_schema(self._options),
        )

    async def async_step_zones(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        choices: dict[str, str] = {_ADD: "Aggiungi zona"}
        for zone in self._zones:
            zone_id = str(zone.get(CONF_ZONE_ID) or zone.get("id"))
            name = str(zone.get(CONF_ZONE_NAME) or zone_id)
            climate = str(zone.get(CONF_CLIMATE_ENTITY) or "")
            choices[f"edit:{zone_id}"] = f"Modifica {name} ({climate})"
            choices[f"remove:{zone_id}"] = f"Rimuovi {name}"
        choices[_BACK] = "Indietro"

        if user_input is not None:
            action = str(user_input.get("zone_action"))
            if action == _ADD:
                self._edit_zone_id = None
                return await self.async_step_zone_add()
            if action == _BACK:
                return await self.async_step_init()
            kind, _, zone_id = action.partition(":")
            if kind == "edit":
                self._edit_zone_id = zone_id
                return await self.async_step_zone_edit()
            if kind == "remove":
                self._zones = [
                    zone
                    for zone in self._zones
                    if str(zone.get(CONF_ZONE_ID)) != zone_id
                ]
                return await self.async_step_zones()

        return self.async_show_form(
            step_id="zones",
            data_schema=vol.Schema(
                {
                    vol.Required("zone_action"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                selector.SelectOptionDict(value=value, label=label)
                                for value, label in choices.items()
                            ],
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    )
                }
            ),
        )

    async def async_step_zone_add(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        return await self._zone_form("zone_add", user_input, None)

    async def async_step_zone_edit(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        current = self._current_zone()
        return await self._zone_form("zone_edit", user_input, current)

    async def _zone_form(
        self,
        step_id: str,
        user_input: dict[str, Any] | None,
        current: Zone | None,
    ) -> FlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                zone = self._zone_from_input(user_input, current)
            except ValueError as err:
                errors["base"] = str(err)
            else:
                self._zones = [
                    item
                    for item in self._zones
                    if str(item.get(CONF_ZONE_ID)) != zone.id
                ]
                self._zones.append(zone.to_dict())
                return await self.async_step_zones()

        return self.async_show_form(
            step_id=step_id,
            data_schema=self._zone_schema(current),
            errors=errors,
        )

    def _current_zone(self) -> Zone | None:
        for item in self._zones:
            if str(item.get(CONF_ZONE_ID) or item.get("id")) == self._edit_zone_id:
                return Zone.from_dict(item)
        return None

    def _zone_from_input(
        self, user_input: dict[str, Any], current: Zone | None
    ) -> Zone:
        name = str(user_input.get(CONF_ZONE_NAME) or "").strip()
        climate_entity = str(user_input.get(CONF_CLIMATE_ENTITY) or "").strip()
        if not name:
            raise ValueError("zone_name_required")
        if not climate_entity.startswith("climate."):
            raise ValueError("zone_invalid_climate")
        for item in self._zones:
            if (
                str(item.get(CONF_CLIMATE_ENTITY)) == climate_entity
                and str(item.get(CONF_ZONE_ID)) != (current.id if current else None)
            ):
                raise ValueError("zone_duplicate_climate")
        min_temp = float(user_input.get(CONF_MIN_TEMP, MIN_TEMP))
        max_temp = float(user_input.get(CONF_MAX_TEMP, MAX_TEMP))
        if max_temp <= min_temp:
            raise ValueError("zone_invalid_limits")
        zone = Zone(
            id=current.id if current else uuid.uuid4().hex[:12],
            name=name,
            climate_entity=climate_entity,
            temperature_sensor=user_input.get(CONF_TEMPERATURE_SENSOR) or None,
            min_temp=min_temp,
            max_temp=max_temp,
            default_temp=float(
                user_input.get(
                    CONF_DEFAULT_TEMP,
                    current.default_temp if current else 20.0,
                )
            ),
        )
        return zone

    def _zone_schema(self, current: Zone | None) -> vol.Schema:
        fields: dict[Any, Any] = {
            vol.Required(
                CONF_ZONE_NAME, default=current.name if current else ""
            ): str,
            vol.Required(
                CONF_CLIMATE_ENTITY,
                default=current.climate_entity if current else vol.UNDEFINED,
            ): _climate_selector(),
            vol.Required(
                CONF_MIN_TEMP,
                default=current.min_temp if current else MIN_TEMP,
            ): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
            vol.Required(
                CONF_MAX_TEMP,
                default=current.max_temp if current else MAX_TEMP,
            ): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
            vol.Required(
                CONF_DEFAULT_TEMP,
                default=current.default_temp if current else 20.0,
            ): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
        }
        sensor_key = (
            vol.Optional(
                CONF_TEMPERATURE_SENSOR,
                default=current.temperature_sensor,
            )
            if current and current.temperature_sensor
            else vol.Optional(CONF_TEMPERATURE_SENSOR)
        )
        fields[sensor_key] = _temperature_sensor_selector()
        return vol.Schema(fields)

    def _profile_hourly_schema(self, profile: Profile | None) -> vol.Schema:
        default_temp = DEFAULT_COMFORT_TEMP
        fields: dict[Any, Any] = {
            vol.Required(
                "name",
                default=profile.name if profile else "Nuovo profilo",
            ): str,
            vol.Optional("uniform_temp"): _number(MIN_TEMP, MAX_TEMP, TEMP_STEP),
        }
        if profile:
            profile.ensure_hourly(default_temp)
            hourly = list(profile.hourly)
        else:
            hourly = [default_temp] * 24
        for hour in range(24):
            fields[
                vol.Required(f"hour_{hour}", default=hourly[hour])
            ] = _number(MIN_TEMP, MAX_TEMP, TEMP_STEP)
        return vol.Schema(fields)

    def _profile_dict_from_input(
        self, user_input: dict[str, Any], profile_id: str | None
    ) -> dict[str, Any]:
        name = str(user_input.get("name") or "").strip()
        if not name:
            raise ValueError("profile_name_required")
        pid = profile_id or slugify(name)
        if user_input.get("uniform_temp") is not None:
            hourly = [float(user_input["uniform_temp"])] * 24
        else:
            hourly = [float(user_input[f"hour_{h}"]) for h in range(24)]
        icon = "mdi:home-thermometer"
        if profile_id:
            manager = self._get_manager()
            if manager and profile_id in manager.profiles:
                icon = manager.profiles[profile_id].icon
        return {
            "id": pid,
            "name": name,
            "icon": icon,
            "hourly": hourly,
        }

    def _profile_error(self, err: ValueError) -> str:
        code = str(err)
        mapping = {
            "profile_default_protected": "profile_default_protected",
            "profile_last_one": "profile_last_one",
            "profile_exists": "profile_exists",
            "unknown_profile": "unknown_profile",
            "profile_name_required": "profile_name_required",
        }
        return mapping.get(code, "unknown")

    async def async_step_profiles(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        manager = self._get_manager()
        errors: dict[str, str] = {}
        if manager is None:
            return self.async_show_menu(step_id="profiles", menu_options=["init"])

        choices: dict[str, str] = {_ADD: "Aggiungi profilo", _BACK: "Indietro"}
        for profile in sorted(manager.profiles.values(), key=lambda p: p.name.lower()):
            pid = profile.id
            avg = round(sum(profile.hourly) / max(len(profile.hourly), 1), 1)
            choices[f"edit:{pid}"] = f"Modifica {profile.name} (~{avg}°)"
            choices[f"clone:{pid}"] = f"Duplica {profile.name}"
            if pid not in DEFAULT_PROFILE_IDS:
                choices[f"delete:{pid}"] = f"Elimina {profile.name}"

        if user_input is not None:
            action = str(user_input.get("profile_action"))
            if action == _ADD:
                self._edit_profile_id = None
                return await self.async_step_profile_add()
            if action == _BACK:
                return await self.async_step_init()
            kind, _, pid = action.partition(":")
            if kind == "edit":
                self._edit_profile_id = pid
                return await self.async_step_profile_edit()
            if kind == "clone":
                self._clone_profile_id = pid
                return await self.async_step_profile_clone()
            if kind == "delete":
                try:
                    await manager.async_delete_profile(pid)
                except ValueError as err:
                    errors["base"] = self._profile_error(err)
                else:
                    return await self.async_step_profiles()

        return self.async_show_form(
            step_id="profiles",
            data_schema=vol.Schema(
                {
                    vol.Required("profile_action"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                selector.SelectOptionDict(value=value, label=label)
                                for value, label in choices.items()
                            ],
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_profile_add(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        return await self._profile_form("profile_add", user_input, None)

    async def async_step_profile_edit(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        manager = self._get_manager()
        profile = (
            manager.profiles.get(self._edit_profile_id)
            if manager and self._edit_profile_id
            else None
        )
        return await self._profile_form("profile_edit", user_input, profile)

    async def _profile_form(
        self,
        step_id: str,
        user_input: dict[str, Any] | None,
        profile: Profile | None,
    ) -> FlowResult:
        errors: dict[str, str] = {}
        manager = self._get_manager()
        if manager is None:
            return await self.async_step_profiles()

        if user_input is not None:
            try:
                payload = self._profile_dict_from_input(
                    user_input,
                    profile.id if profile else None,
                )
                if profile is None:
                    await manager.async_create_profile(payload)
                else:
                    await manager.async_update_profile(payload)
            except ValueError as err:
                errors["base"] = self._profile_error(err)
            else:
                return await self.async_step_profiles()

        return self.async_show_form(
            step_id=step_id,
            data_schema=self._profile_hourly_schema(profile),
            errors=errors,
            description_placeholders={
                "hint": "Imposta le temperature per ogni ora (00-23). Opzionale: uniforma tutte le ore."
            },
        )

    async def async_step_profile_clone(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        manager = self._get_manager()
        errors: dict[str, str] = {}
        if manager is None or not self._clone_profile_id:
            return await self.async_step_profiles()
        source = manager.profiles.get(self._clone_profile_id)
        if source is None:
            return await self.async_step_profiles()

        if user_input is not None:
            name = str(user_input.get("name") or "").strip()
            if not name:
                errors["base"] = "profile_name_required"
            else:
                try:
                    await manager.async_clone_profile(self._clone_profile_id, name)
                except ValueError as err:
                    errors["base"] = self._profile_error(err)
                else:
                    self._clone_profile_id = None
                    return await self.async_step_profiles()

        return self.async_show_form(
            step_id="profile_clone",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "name",
                        default=f"{source.name} (copia)",
                    ): str,
                }
            ),
            errors=errors,
        )

    async def async_step_finish(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        self._options[CONF_ZONES] = self._zones
        return self.async_create_entry(title="", data=self._options)
