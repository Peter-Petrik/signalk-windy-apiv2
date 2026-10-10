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
| Humidity | `environment.outside.humidity` | `environment.outside.relativeHumidity` |

**Wind Direction**: The legacy plugin uses `directionGround`, which is not a path in the Signal K specification. This plugin defaults to `directionTrue`, the specification's path for wind direction relative to true north. If the vessel's instrument setup provides `directionGround` and not `directionTrue`, the path can be overridden in the "Sensor Path Overrides" section of the plugin configuration.

**Humidity**: The legacy plugin uses `environment.outside.humidity`, which is the path in the Signal K specification and the one Signal K's NMEA 0183 and NMEA 2000 converters publish. This plugin defaults to `environment.outside.relativeHumidity`. An installation that reported humidity with the legacy plugin therefore needs the humidity path changed to `environment.outside.humidity` in the "Sensor Path Overrides" section; without that change humidity is not reported.

### Features Not in the Legacy Plugin

These are available after migration with no additional configuration:

- **Movement Guard** — radius-based position tracking that only updates the Windy map when the vessel moves beyond a configurable threshold (default 300m). Prevents unnecessary API calls and map pin jitter while at anchor.
- **Peak Gust Tracking** — captures the highest wind speed reading between reporting intervals at 1Hz, ensuring short-lived gusts are not missed.
- **State Persistence** — the reporting timer, movement baseline, and distance tracking are kept when the plugin is restarted from the admin UI.
- **Dashboard Heartbeat** — live countdown to next report with current sensor readings and distance from baseline.
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

5. **Check path overrides.** Expand the "Sensor Path Overrides" section and set the Relative Humidity path to `environment.outside.humidity` if the legacy plugin reported humidity. If the vessel provides `environment.wind.directionGround` instead of `directionTrue`, update the Wind Direction path as well.

6. **Disable the legacy plugin.** In **Apps & Plugins > Configuration**, disable signalk-windy to prevent both plugins from reporting simultaneously. The legacy plugin can be uninstalled in **Apps & Plugins > Store** once the new plugin is confirmed working.

7. **Verify operation.** After enabling the new plugin, check the Signal K dashboard for the heartbeat status showing sensor readings and countdown. Confirm the station appears on [windy.com](https://www.windy.com) with current data.

## Troubleshooting

If the station does not appear on Windy after migration:

- **Check credentials.** The v2 API uses three separate credentials (Station ID, Station Password, Global API Key). Verify each is entered in the correct field.
- **Check the dashboard message.** The plugin names the credential to check: "Station Password rejected by Windy" for the Station Password or a Station ID that does not match it, "Windy rejected the API Key or Station ID (403)" for the Global API Key, and "Metadata update failed (404)" for a Station ID that does not exist. The README's Troubleshooting section lists every message.
- **Check the server log.** Switch on **Enable debug** for the plugin in **Apps & Plugins > Configuration** and look at **Server > Server Logs** for the HTTP status codes. A 400 on an observation with a message about the password indicates a wrong Station Password; a 403 on the station update indicates a wrong API Key.
- **Allow time for Windy processing.** According to Windy's documentation, a newly created station can take up to 15 minutes to appear on the map, and data sent during that time is lost.

For bug reports and questions, open an issue at [GitHub Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues).
