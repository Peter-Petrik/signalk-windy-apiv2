# Signal K Windy API v2 Reporter
![Signal K Windy Icon](icon.svg)

This plugin gathers environmental data from a Signal K server and reports it to Windy.com as a Personal Weather Station (PWS) using the **v2 API**.

A Signal K plugin that reports weather and position data to the **Windy.com Stations API v2**. This plugin is designed specifically for moving vessels, utilizing separate endpoints for data (Wind, Gusts, Temperature, Pressure, and Humidity) and station metadata to ensure reliable map updates and minimal bandwidth usage.

## Features

- **API v2 Compliance**: Uses the latest Windy protocol with separate `GET` (observations) and `PUT` (station management) requests.
- **Movement Guard**: Optimized GPS reporting that only updates your vessel's position on the Windy map after moving a configurable distance (default 300m).
- **State Persistence**: Remembers your position and reporting schedule across Signal K server restarts.
- **Enhanced Status Display**: Real-time feedback in the Signal K dashboard showing exactly which sensors are transmitting.
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

**Format:** `✅ Status: [Data Points] at [Time] [Movement Status] | Delta: [Distance]m`

### Data Point Legend:
The status includes a "Data Map" showing which points were successfully bundled in the last request:
* **T**: Temp
* **W**: Wind
* **G**: Gusts
* **D**: Direction
* **P**: Pressure
* **H**: Humidity

---

## ⚙️ Configuration Groups
Settings are organized into four logical sections to maintain a streamlined user experience:

### 1. Windy API Credentials
* **Station ID**: Unique station identifier.
* **Station Password**: Used for weather observations (GET).
* **Global API Key**: Account-level key for location and metadata syncing (PUT).

### 2. Vessel Identity & Privacy
* **Station Name**: How the vessel station appears on the map.
* **Station Type**: Default is `Boat (Signal K)`.
* **Share Option**: 
    * **Public (Open Data)**: Data is shared under the Windy Open Data License and may be aggregated by third parties.
    * **Private (Only Windy)**: Observations are used only for display and visualization within the Windy platform.

### 3. Transmission & GPS Logic
* **Interval**: Reporting frequency in minutes (Default: `5`).
* **Minimum Movement**: The distance in meters (Default: `300`) a vessel must move before the map pin updates.

### 4. Sensor Path Overrides
* Advanced settings to map specific Signal K paths to Windy parameters (e.g., `environment.wind.gust`).

---

## 💡 Pro Tips
* **Movement Guard**: The **Delta** value tracks distance since the last map update. The location is only sent to the API when it exceeds **Minimum Movement** threshold.
* **State Persistence**: On server restart, the plugin automatically reloads the last reported position and the remaining time on the reporting interval. This ensures the countdown resumes exactly where it left off and the Movement Guard maintains accurate travel distance tracking.
* **GPS Fix**: The plugin will display `Waiting for GPS fix...` and pause transmissions if valid coordinates are unavailable.
* **Native Units**: This plugin utilizes Signal K's native **m/s** for wind and gusts, passing them directly to Windy to ensure 1:1 data accuracy.
* **Open Data**: Choosing `Public` contributes the station's weather data to the global meteorological community via Windy's aggregator.

---

## 🛠️ Troubleshooting & State Management

Starting with v1.0.4, the plugin manages its internal tracking data independently. If you need to inspect or reset the internal movement state without touching your API credentials, the file is located at:

`~/.signalk/plugin-config-data/signalk-windy-apiv2/state.json`

This file contains:
- `lastSentPos`: The last GPS coordinate successfully sent to Windy.
- `currentDistance`: The meters traveled since the last map update.
- `nextRunTime`: The millisecond timestamp for the next scheduled transmission.

If the plugin does not appear to be reporting data, or if you want to verify the new **State Persistence** logic after a restart, you can monitor the logs directly from the server command line.

### Real-Time Log Monitoring
To stream logs specifically for this plugin and see transmissions as they happen:
```bash
journalctl -u signalk-server -f | grep "signalk-windy-apiv2"
```

### Verifying State Persistence (v1.0.1+)
After a Signal K server restart, you can confirm that the plugin has successfully recovered its previous state by checking the server logs. Watch for these specific indicators:

* **`Resuming countdown: X minutes remaining`**: This confirms the plugin reloaded the timer from your last session instead of starting a full new interval.
* **`Movement Guard: Resumed with Delta Xm`**: This confirms the vessel's accumulated travel distance was recovered, ensuring tracking continuity across the reboot.

To stream these logs in real-time on your server, use:
```bash
journalctl -u signalk-server -f | grep "signalk-windy-apiv2"
```

### Common Status Messages
The following messages appear in the Signal K Dashboard to provide a high-level view of the plugin's health:

| Message | Meaning | Recommended Action |
| :--- | :--- | :--- |
| **`Waiting for GPS fix...`** | Plugin is active but has no valid position data. | Ensure your GPS source is connected and sending data. |
| **`Movement Guard: Hold`** | Vessel has moved less than the threshold (default 300m). | No action needed; weather is sent but map location is held. |
| **`Resuming countdown...`** | Waiting for the next interval after a server reboot. | Normal behavior; persistence logic is active. |
| **`API Error: 401`** | Unauthorized access to Windy API. | Double-check your Station Password and API Key. |
| **`API Error: 400`** | Malformed request. | Check for invalid characters in your Station ID or Password. |

### Manual Reset
If you need to clear the persistent state (for example, to reset the accumulated distance counter or force an immediate timer restart), follow these steps:

1.  Open the Signal K **Dashboard**.
2.  Navigate to **Server > Plugin Config**.
3.  Select the **Windy API v2 Reporter** from the list.
4.  Click the **Submit** button at the bottom of the configuration page.
    * *Note: You do not need to change any settings; simply clicking "Submit" triggers the plugin to stop and restart, which clears the session cache and re-initializes all trackers.*
    
### Diagnostic Reporting
If you are reporting a bug or need to analyze the plugin's performance over time, use the following command to generate a clean log summary. This command captures the last 100 entries related specifically to this plugin and removes extra formatting for better readability:

```bash
journalctl -u signalk-server -n 100 --no-pager | grep "signalk-windy-apiv2"
```

When sharing logs for troubleshooting, please ensure you have redacted your **Station Password** and **API Key** if they appear in any custom debug messages or configurations before posting them to public forums or GitHub issues.

#### Key Log Events to Watch
When monitoring the logs, these specific events confirm the plugin's internal logic is operating correctly:

* **`Starting plugin`**: The Signal K server has successfully initialized the Windy API v2 Reporter.
* **`Resuming countdown: X minutes remaining`**: (v1.0.1+) Persistence logic successfully recovered the timer state after a reboot.
* **`Movement Guard: Hold`**: The vessel has not moved the minimum distance (default 300m) required to update the map pin.
* **`Movement Guard: Resetting distance`**: The boat has moved beyond the threshold, and the distance counter has reset for the next cycle.
* **`Sending weather data to Windy...`**: An API request has been triggered based on your configured interval.
* **`API Response: 200`**: Windy has successfully received and processed your data.
* **`API Error: 401`**: Unauthorized access. Check your **Station Password** and **API Key**.

## License
Copyright 2026 Peter Petrik. Licensed under the Apache-2.0 License.