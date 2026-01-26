# Signal K Windy API v2 Reporter
![Signal K Windy Icon](icon.svg)

This plugin gathers environmental data from a Signal K server and reports it to Windy.com as a Personal Weather Station (PWS) using the **v2 API**. It is designed specifically for moving vessels, utilizing separate endpoints for data (Wind, Gusts, Temperature, Pressure, and Humidity) and station metadata to ensure reliable map updates and minimal bandwidth usage.

## Project Purpose
This plugin is developed to support the Windy.com API v2 protocol, offering an alternative to legacy reporting methods. It focuses on the specific needs of maritime users by providing radius-based displacement tracking to maintain position accuracy on weather maps without redundant transmissions during minor vessel movements.

## Features

- **API v2 Compliance**: Uses the latest Windy protocol with separate `GET` (observations) and `PUT` (station management) requests.
- **Live Heartbeat Status**: (v1.1.0+) Enhanced dashboard feedback showing last report data, current radius displacement (Delta), and a per-second countdown.
- **Radius-Based Movement Guard**: (v1.1.0+) Intelligent GPS reporting that triggers map updates only when the vessel moves beyond a set radius from its last position, preventing "phantom movement" while at anchor.
- **State Persistence**: Remembers the movement baseline and reporting schedule across Signal K server restarts via `state.json`.
- **Smart Unit Conversion**: Automatically handles conversion from Signal K base units (Kelvin, Pascal, m/s) to Windy standards (°C, hPa, m/s).

## Mapped Data Paths

The plugin monitors the following Signal K paths to populate Windy observation reports. 
The internal keys are the actual parameters transmitted to the Windy API. Users can override these defaults in the plugin configuration:

| Windy Parameter | Signal K Path (Default) | Internal Key |
| :--- | :--- | :--- |
| Wind Speed | `environment.wind.speedOverGround` | `wind` |
| Wind Gust | `environment.wind.gust` | `gust` |
| Wind Direction | `environment.wind.directionTrue` | `winddir` |
| Temperature | `environment.outside.temperature` | `temp` |
| Pressure | `environment.outside.pressure` | `pressure` |
| Humidity | `environment.outside.relativeHumidity` | `rh` |
| Latitude | `navigation.position.latitude` | `lat` |
| Longitude | `navigation.position.longitude` | `lon` |

## Prerequisites

- **Windy API Key**: A valid API key and Station ID from [stations.windy.com](https://stations.windy.com).
- **Position Data**: A valid GPS source providing `navigation.position`.
- **Derived Data (Optional)**: For vessels without direct SOG or True Wind sensors, the `signalk-derived-data` plugin is recommended to provide the necessary calculated paths.

## 🚀 Quick Start Guide

1. **Register the Station**: Log in to [stations.windy.com](https://stations.windy.com) and click **+ Add Station**.
2. **Collect Credentials**: 
   * Retrieve your **API Key** from the "API Keys" section.
   * Retrieve your **Station ID** (e.g., `f0123456`) from the station list.
3. **Configure the Plugin**:
   * Open the Signal K console.
   * Navigate to **App Store > Available** and install `signalk-windy-apiv2`.
   * Go to **Server > Plugin Config** and enter your credentials.
   * Set your **Station Name** (this will appear on the Windy map).
4. **Set Movement Guard**: Choose a displacement radius (default 300m). Your position on Windy will only update when you move beyond this distance from your last reported point.

## Technical Details

### v1.0.8 Update: Heartbeat & Payload Transparency
* **Live Countdown**: The dashboard now provides a second-by-second countdown until the next scheduled report.
* **Metadata Debugging**: When debugging is enabled, the plugin now logs the exact JSON `PUT` payload sent to Windy, allowing to verify fields like `share_option` and `elev_m`.
* **Integer Validation**: Automatic rounding of elevation and sensor heights is now enforced for API v2 compliance to prevent "400 Bad Request" errors.

### Real-Time Log Monitoring
To stream logs specifically for this plugin:
```bash
journalctl -u signalk-server -f | grep "signalk-windy-apiv2"

```

### Manual Reset
To clear the persistent state (for example, to reset the accumulated distance counter or force an immediate timer restart), follow these steps:

To clear the persistent state (for example, to reset the movement baseline or force an immediate timer restart), follow these steps:

1. Open the Signal K **Dashboard**.
2. Navigate to **Server > Plugin Config**.
3. Select the **Windy API v2 Reporter** from the list.
4. Click the **Submit** button at the bottom of the configuration page.

* *Note: Settings do not need to change; simply clicking "Submit" triggers the plugin to stop and restart, which clears the session cache and re-initializes all trackers.*


### Diagnostic Reporting
If reporting a bug or need to analyze the plugin's performance over time, use the following command to generate a clean log summary. This command captures the last 100 entries related specifically to this plugin and removes extra formatting for better readability:

```bash
journalctl -u signalk-server -n 100 --no-pager | grep "signalk-windy-apiv2"

```

When sharing logs for troubleshooting, please redact the **Station Password** and **API Key** if they appear in any custom debug messages or configurations before posting them to public forums or GitHub issues.

## Future Enhancements

* **Precipitation Support**: The Windy API v2 has updated how it handles rain (mm since midnight). With access to `environment.outside.rainDay`, adding this would be a major feature for users with advanced weather stations.

* **Offline Handling**: Currently, the plugin logs an error if Windy is down. Implement a small "back-off" logic where it tries less frequently if it detects a 500-series error, saving server resources on poor satellite connections.

## Screenshots

### Plugin Configuration
![Credentials](screenshots/configuration-credentials.png)
![Vessel](screenshots/configuration-vessel.png)
![Transmission](screenshots/configuration-transmission.png)
![Path Overrides](screenshots/configuration-path-overrides.png)

### Live Dashboard Heartbeat
![Dashboard Status](screenshots/dashboard-status.png)

### Vessel on Windy Map
![Windy Station View](screenshots/windy-station.png)

## License

Copyright 2026 Peter Petrik. Licensed under the Apache-2.0 License.