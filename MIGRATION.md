# Migrating from signalk-windy to signalk-windy-apiv2

This guide covers switching from the legacy [signalk-windy](https://github.com/Saillogger/signalk-windy-plugin) plugin (by Saillogger/itemir) to signalk-windy-apiv2.

## Why Migrate

Windy launched their v2 API in January 2026. The legacy plugin uses the v1 API, which no longer supports new station registration and has known issues with position updates. signalk-windy-apiv2 is built from the ground up for the v2 API with features designed for mobile marine platforms.

## What Changes

### Credential Model

The v2 API uses a different authentication structure than v1.

| | Legacy (v1) | This Plugin (v2) |
|--|-------------|------------------|
| **API Key** | Single key used for all requests | Global API Key — used for station metadata updates (PUT) |
| **Station Password** | Not required | Required — used for observation submissions (GET) |
| **Station ID** | Required | Required (same ID, no change) |

To find the new credentials, log in to [stations.windy.com](https://stations.windy.com):
- **API Key**: Navigate to the "API Keys" section in account settings.
- **Station Password**: Listed under the station details for each registered station.
- **Station ID**: Same ID used with the legacy plugin (e.g., `f0123456`).

### Signal K Path Differences

| Data | Legacy Plugin Path | This Plugin Default |
|------|-------------------|-------------------|
| Wind Direction | `environment.wind.directionGround` | `environment.wind.directionTrue` |
| Wind Speed | `environment.wind.speedOverGround` | `environment.wind.speedOverGround` |
| Temperature | `environment.outside.temperature` | `environment.outside.temperature` |
| Pressure | `environment.outside.pressure` | `environment.outside.pressure` |
| Humidity | `environment.outside.humidity` | `environment.outside.relativeHumidity` |

**Wind Direction**: The legacy plugin uses `directionGround`, which is deprecated in Signal K. This plugin defaults to `directionTrue`. If the vessel's instrument setup provides `directionGround` and not `directionTrue`, the path can be overridden in the "Sensor Path Overrides" section of the plugin configuration.

**Humidity**: The legacy plugin uses `environment.outside.humidity`. This plugin uses `environment.outside.relativeHumidity`, which is the standard Signal K path. If needed, override in the path configuration.

### Features Not in the Legacy Plugin

These are available after migration with no additional configuration:

- **Movement Guard** — radius-based position tracking that only updates the Windy map when the vessel moves beyond a configurable threshold (default 300m). Prevents unnecessary API calls and map pin jitter while at anchor.
- **Peak Gust Tracking** — captures the highest wind speed reading between reporting intervals at 1Hz, ensuring short-lived gusts are not missed.
- **State Persistence** — the reporting timer, movement baseline, and distance tracking survive Signal K server restarts.
- **Dashboard Heartbeat** — live countdown to next report with current sensor readings and distance from baseline.
- **Rate Limit Awareness** — handles Windy's 429 responses by rescheduling precisely to the provided retry window.

## Migration Steps

1. **Note existing settings.** Open the legacy plugin configuration and record the API Key and Station ID. The Station ID carries over; the API Key may or may not be the same as the v2 Global API Key.

2. **Collect v2 credentials.** Log in to [stations.windy.com](https://stations.windy.com) and locate the Global API Key (account settings) and Station Password (station details). These are separate from the legacy API key.

3. **Install signalk-windy-apiv2.** In the Signal K admin UI, navigate to **App Store > Available** and search for `signalk-windy-apiv2`. Install the plugin.

4. **Configure the new plugin.** Go to **Server > Plugin Config**, select "Windy API v2 Reporter", and enter:
   - Station ID (same as before)
   - Station Password (new for v2)
   - Global API Key (from v2 account settings)
   - Station Name (the display name on the Windy map)

5. **Check path overrides.** If the vessel uses `environment.wind.directionGround` instead of `directionTrue`, expand the "Sensor Path Overrides" section and update the Wind Direction path. Same for humidity if the instrument setup provides `environment.outside.humidity`.

6. **Disable the legacy plugin.** In **Server > Plugin Config**, disable signalk-windy to prevent both plugins from reporting simultaneously. The legacy plugin can be uninstalled via the App Store once the new plugin is confirmed working.

7. **Verify operation.** After enabling the new plugin, check the Signal K dashboard for the heartbeat status showing sensor readings and countdown. Confirm the station appears on [windy.com](https://www.windy.com) with current data.

## Troubleshooting

If the station does not appear on Windy after migration:

- **Check credentials.** The v2 API uses three separate credentials (Station ID, Station Password, Global API Key). Verify each is entered in the correct field.
- **Check the server log.** Enable debug logging for the plugin and look for specific HTTP status codes. A 401 indicates an authentication issue; a 400 indicates a malformed request (often a missing required field like share_option).
- **Allow time for Windy processing.** After the first successful submission, the station may take a few minutes to appear or update on the Windy map.

For bug reports and questions, open an issue at [GitHub Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues).
