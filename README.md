# Signal K Windy API v2 Reporter
![Signal K Windy Icon](icon.svg)

This plugin gathers environmental data from a Signal K server and reports it to Windy.com as a Personal Weather Station (PWS) using the **v2 API**.

A Signal K plugin that reports weather and position data to the **Windy.com Stations API v2**. This plugin is designed specifically for moving vessels, utilizing separate endpoints for data (Wind, Gusts, Temperature, Pressure, and Humidity) and station metadata to ensure reliable map updates and minimal bandwidth usage.

## Features

- **API v2 Compliance**: Uses the latest Windy protocol with separate `GET` (observations) and `PUT` (station management) requests.
- **Live Heartbeat Status**: (v1.1.0+) Enhanced dashboard feedback showing last report data, current radius displacement (Delta), and a per-second countdown.
- **Radius-Based Movement Guard**: (v1.1.0+) Intelligent GPS reporting that triggers map updates only when the vessel moves beyond a set radius from its last position, preventing "phantom movement" while at anchor.
- **State Persistence**: Remembers the movement baseline and reporting schedule across Signal K server restarts via `state.json`.
- **Smart Unit Conversion**: Automatically handles conversion from Signal K base units (Kelvin, Pascal, m/s) to Windy standards (°C, hPa, m/s).

## 🚀 Quick Start Guide
1. **Register the Station**: Log in to [stations.windy.com](https://stations.windy.com) and click **+ Add Station**.
2. **Collect Credentials**:
    - **Station ID**: Alphanumeric ID (e.g., `f1a2b3c4`) from the station list.
    - **Station Password**: Found in the station's detail page; used for weather data (GET).
    - **Global API Key**: Found in the **API Keys** tab; required for location syncing (PUT).
3. **Configure Signal K**: 
    - Enter credentials in the **Windy API Credentials** section.
    - Select a **Share Option** based on privacy preference.
4. **Submit**: The plugin begins reporting based on the defined **Interval**.

---

## 📟 Enhanced Status Display
The plugin provides a high-resolution status string in the Signal K dashboard to monitor transmissions.

**Format:** `[Data Map] at [Time] | Delta: [Distance]m | Next report in: [Min]m [Sec]s`

### Data Point Legend:
The last-submitted weather data remains visible on the dashboard while the heartbeat timer counts down to the next report.

The status includes a "Data Map" showing which points were successfully bundled in the last request. For user convenience, dashboard values are converted to common units:
* **W (Wind)**: Knots (kn)
* **G (Gusts)**: Knots (kn)
* **D (Direction)**: Degrees (°)
* **T (Temp)**: Celsius (°C)
* **P (Pressure)**: kiloPascals (kPa)
* **H (Humidity)**: Percentage (%)

**Note**: These conversions apply only to the dashboard status display for user convenience. The plugin continues to transmit raw data to Windy using the specific units required by the API v2 specification (e.g., raw Pascals for barometric pressure) to ensure maximum data integrity.

---

## ⚙️ Configuration Groups
Settings are organized into four logical sections:

### 1. Windy API Credentials
* **Station ID**: Unique station identifier.
* **Station Password**: Used for weather observations (GET).
* **Global API Key**: Account-level key for location and metadata syncing (PUT).

### 2. Vessel Identity & Privacy
* **Station Name**: How the vessel station appears on the map.
* **Station Type**: Default is `Boat (Signal K)`.
* **Share Option**: 
    * **Public**: Aggregate data under the Aggregator Open Data License.
    * **Windy**: Observations used only by Windy.com.
    * **Private**: Private non-public use.
* **Sensor Heights**: Configurable AGL (Above Ground Level) heights for temperature and wind sensors, rounded to integers per API v2 requirements.

### 3. Transmission & GPS Logic
* **Interval**: Reporting frequency in minutes (Default: `5`).
* **Minimum Movement**: The distance in meters (Default: `300`) a vessel must move before the map pin updates.

### 4. Sensor Path Overrides
* Advanced settings to map specific Signal K paths to Windy parameters (e.g., `environment.wind.gust`).

---

## 💡 Pro Tips
* **Data Stabilization (Warm-up)**: To ensure only valid, non-null data is transmitted, the plugin performs a 15-second warm-up upon startup. During this time, the dashboard will display `Warming up: [countdown]`. This allows the Signal K server to aggregate initial sensor readings from the network before the first API submission.
* **Movement Guard**: The **Delta** value tracks distance since the last map update. The location is only sent to the API when it exceeds the **Minimum Movement** threshold.
* **State Persistence**: On server restart, the plugin automatically reloads the last reported position and the remaining time on the reporting interval.
* **GPS Fix**: The plugin will display `Waiting for GPS fix...` and pause transmissions if valid coordinates are unavailable.
* **Native Units**: This plugin utilizes Signal K's native **m/s** for wind and gusts, passing them directly to Windy to ensure 1:1 data accuracy.
* **Open Data**: Choosing `Public` contributes the station's weather data to the global meteorological community via Windy's aggregator.

---

## 🛠️ Troubleshooting & Logs

Starting with v1.0.4, the plugin manages its internal tracking data independently. The file is located at:
`~/.signalk/plugin-config-data/signalk-windy-apiv2/state.json`

This file contains:
- `lastSentPos`: The last GPS coordinate successfully sent to Windy.
- `currentDistance`: The meters traveled since the last map update.
- `nextRunTime`: The millisecond timestamp for the next scheduled transmission.

If the plugin does not appear to be reporting data, or if verification of the new **State Persistence** logic after a restart is needed, the logs can be monitored directly from the server command line.

### Key Log Events to Watch
When monitoring the logs, these specific events confirm the plugin's internal logic is operating correctly:

* **`Starting plugin`**: The Signal K server has successfully initialized the Windy API v2 Reporter.
* **`Resuming: Xm Xs`**: Persistence logic successfully recovered the timer state after a reboot. Shown in Signal K Dashboard status.
* **`Windy Metadata Submission (PUT)`**: (v1.0.8+) Logged specifically when the vessel has moved past the threshold and is updating its position/identity on the Windy map.
* **`Windy Submission (GET)`**: Confirms weather variables are being sent to the observation endpoint.

| Log Message / Error | Meaning & Resolution |
| :--- | :--- |
| **`API Error: 400`** | **Invalid Data Format**: Windy's API v2 is strict about types. v1.0.8+ automatically rounds elevation and AGL heights to integers to fix this. |
| **`API Error: 401`** | **Authentication Failed**: The **Station Password** (for observations) or **Global API Key** (for metadata) is incorrect. |
| **`API Error: 403`** | **Forbidden**: Station ID mismatch or the station hasn't been fully activated on Windy. |
| **`Waiting for sensor data`** | **Sensor Issue**: Plugin is active but cannot find the required Signal K paths to form a report. |


### v1.0.7 Update: Enhanced Diagnostics & Precision
The following improvements have been added to the troubleshooting and reporting logic:

* **Detailed API Feedback**: If a station metadata update (`PUT` request) fails, the Signal K logs now display the exact HTTP status code and the JSON error message returned by Windy. This is critical for diagnosing "401 Unauthorized" or "403 Forbidden" issues.
* **Coordinate Optimization**: Vessel coordinates are now rounded to **5 decimal places** before transmission to ensure compatibility with Windy's mapping engine and prevent API rejection due to excessive precision.
* **Protocol Compliance**: Metadata transmissions now explicitly include `application/json` headers to ensure 100% compatibility with the Windy API v2 specification.
* **Distance Tracking Logs**: Ability to monitor the accumulated distance (Delta) in the server logs to see exactly how close the vessel is to triggering a map position update.

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

1.  Open the Signal K **Dashboard**.
2.  Navigate to **Server > Plugin Config**.
3.  Select the **Windy API v2 Reporter** from the list.
4.  Click the **Submit** button at the bottom of the configuration page.
    * *Note: Settings do not need to change; simply clicking "Submit" triggers the plugin to stop and restart, which clears the session cache and re-initializes all trackers.*
    
### Diagnostic Reporting
If reporting a bug or need to analyze the plugin's performance over time, use the following command to generate a clean log summary. This command captures the last 100 entries related specifically to this plugin and removes extra formatting for better readability:

```bash
journalctl -u signalk-server -n 100 --no-pager | grep "signalk-windy-apiv2"
```

When sharing logs for troubleshooting, please redact the **Station Password** and **API Key** if they appear in any custom debug messages or configurations before posting them to public forums or GitHub issues.

## License
Copyright 2026 Peter Petrik. Licensed under the Apache-2.0 License.