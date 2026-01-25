# Signal K Windy API v2 Reporter
![Signal K Windy Icon](icon.svg)

This plugin gathers environmental data (Wind, Gusts, Temperature, Pressure, and Humidity) from a Signal K server and reports it to Windy.com as a Personal Weather Station (PWS) using the **v2 API**.

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

## License
Apache-2.0