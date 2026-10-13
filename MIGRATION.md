# Migrating from signalk-windy to signalk-windy-apiv2

This guide covers switching from the legacy [signalk-windy](https://github.com/Saillogger/signalk-windy-plugin) plugin (by Saillogger/itemir) to signalk-windy-apiv2.

## Why Migrate

Windy launched their v2 API in January 2026. The legacy plugin uses the previous API, which Windy describes as no longer supported: according to the [Windy Stations API reference](https://stations.windy.com/api-reference), it remains operational only until the end of 2026 and is then shut down. signalk-windy-apiv2 is built from the ground up for the v2 API with features designed for mobile marine platforms.

## What Changes

### Credential Model

The v2 API uses a different authentication structure than v1.

| | Legacy (v1) | This Plugin (v2) |
|--|-------------|------------------|
| **API Key** | Single key used for all requests | Global API Key — used for station metadata updates (PUT) |
| **Station Password** | Not required | Required — used for observation submissions (GET) |
| **Station ID** | Required | Required (same ID, no change) |

To find the new credentials, log in to [stations.windy.com](https://stations.windy.com):
- **API Key**: Created on the API Keys page.
- **Station Password**: Shown on the station detail page of each registered station.
- **Station ID**: Same ID used with the legacy plugin (e.g., `f0123456`).

### Signal K Path Differences

| Data | Legacy Plugin Path | This Plugin Default |
|------|-------------------|-------------------|
| Wind Direction | `environment.wind.directionGround` | `environment.wind.directionTrue` |
| Wind Speed | `environment.wind.speedOverGround` | `environment.wind.speedOverGround` |
| Temperature | `environment.outside.temperature` | `environment.outside.temperature` |
| Pressure | `environment.outside.pressure` | `environment.outside.pressure` |
| Humidity | `environment.outside.humidity` | `environment.outside.humidity` |

**Wind Direction**: The legacy plugin uses `directionGround`, which is not a path in the Signal K specification. This plugin defaults to `directionTrue`, the specification's path for wind direction relative to true north. If the vessel's instrument setup provides `directionGround` and not `directionTrue`, the path can be overridden in the "Sensor Path Overrides" section of the plugin configuration.

**Humidity**: Both plugins read `environment.outside.humidity`, the path in the Signal K specification and the one Signal K's NMEA 0183 and NMEA 2000 converters publish. Versions of this plugin before 1.5.2 defaulted to `environment.outside.relativeHumidity`; from 1.5.2 that path is read only as a fallback when the first holds no value. No path override is needed for humidity.

### Features Not in the Legacy Plugin

These are available after migration with no additional configuration:

- **Movement Guard** — radius-based position tracking that only updates the Windy map when the vessel moves beyond a configurable threshold (default 300m). Prevents unnecessary API calls and map pin jitter while at anchor.
- **Peak Gust Tracking** — captures the highest wind speed reading between reporting intervals at 1Hz, ensuring short-lived gusts are not missed.
- **State Persistence** — the reporting timer, movement baseline, and distance tracking are saved after every reporting cycle and survive plugin restarts, server restarts and reboots.
- **Dashboard Heartbeat** — live countdown to next report with current sensor readings and distance from baseline.
- **Stale Reading Protection** — a reading from a sensor that has stopped updating is left out of the report after 15 minutes (configurable).
- **Rate Limit Awareness** — handles Windy's 429 responses by rescheduling precisely to the provided retry window.

## Migration Steps

1. **Note existing settings.** Open the legacy plugin configuration and record the API Key and Station ID. The Station ID carries over; the API Key may or may not be the same as the v2 Global API Key.

2. **Collect v2 credentials.** Log in to [stations.windy.com](https://stations.windy.com) and locate the Global API Key (API Keys page) and Station Password (station details). These are separate from the legacy API key.

3. **Install signalk-windy-apiv2.** In the Signal K admin UI, open **Apps & Plugins > Store** and search for `signalk-windy-apiv2`. Install the plugin and restart the Signal K server.

4. **Configure the new plugin.** Open **Apps & Plugins > Configuration**, select "Windy API v2 Reporter", and enter:
   - Station ID (same as before)
   - Station Password (new for v2)
   - Global API Key (from the API Keys page)
   - Display Name (the name shown on the Windy map)

   Then click **Save Configuration** below the form. Saving the configuration for the first time also enables the plugin.

5. **Check path overrides.** If the vessel provides `environment.wind.directionGround` instead of `directionTrue`, open the "Sensor Path Overrides" section and update the Wind Direction path. The other defaults match the paths the legacy plugin reads.

6. **Disable the legacy plugin.** In **Apps & Plugins > Configuration**, disable signalk-windy to prevent both plugins from reporting simultaneously. The legacy plugin can be uninstalled in **Apps & Plugins > Store** once the new plugin is confirmed working.

7. **Verify operation.** After enabling the new plugin, check the Signal K dashboard for the heartbeat status showing sensor readings and countdown. Confirm the station appears on [windy.com](https://www.windy.com) with current data.

## Troubleshooting

If the station does not appear on Windy after migration:

- **Check credentials.** The v2 API uses three separate credentials (Station ID, Station Password, Global API Key). Verify each is entered in the correct field.
- **Check the dashboard message.** The plugin names the credential to check: "Not configured" when a credential is missing, "Station Password rejected by Windy" for the Station Password, "Station ID and Station Password do not belong together" when the two are not from the same station, "Windy rejected the Global API Key (403)" for the Global API Key, and "Windy does not know this Station ID (404)" for a Station ID that does not exist. The README's Troubleshooting section lists every message.
- **Check the server log.** Switch on **Enable debug log** for the plugin in **Apps & Plugins > Configuration** and look at **Server > Server Logs** for the HTTP status codes. A 400 on an observation with a message about the password indicates a wrong Station Password; a 403 on the station update indicates a wrong API Key.
- **Allow time for Windy processing.** According to Windy's documentation, a newly created station can take up to 15 minutes to appear on the map, and data sent during that time is lost.

For bug reports and questions, open an issue at [GitHub Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues).
