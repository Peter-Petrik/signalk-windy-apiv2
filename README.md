# Signal K Windy API v2 Reporter
![Signal K Windy Icon](icon.svg)

This plugin gathers environmental data from a Signal K server and reports it to Windy.com as a Personal Weather Station (PWS) using the **v2 API**. It is designed specifically for moving vessels, utilizing separate endpoints for data (Wind, Gusts, Temperature, Pressure, and Humidity) and station metadata to ensure reliable map updates and minimal bandwidth usage.

## Project Status

Stable and actively maintained. See [CHANGELOG.md](CHANGELOG.md) for release history and [Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues) for planned work.

This is the only Signal K plugin targeting the Windy v2 API. Users of the legacy [signalk-windy](https://github.com/Saillogger/signalk-windy-plugin) plugin can follow the [Migration Guide](MIGRATION.md) to switch.

## Features

- **API v2 Compliance**: Uses the latest Windy protocol with separate `GET` (observations) and `PUT` (station management) requests.
- **Rate Limit Awareness**: (v1.3.0+) Handles Windy's 429 rate limit responses by rescheduling precisely to the provided `retry_after` window instead of discarding observations or reporting errors.
- **Live Heartbeat Status**: Enhanced dashboard feedback showing countdown to next report, distance from baseline, current sensor readings, and last submission time.
- **Radius-Based Movement Guard**: Intelligent GPS reporting that triggers map updates only when the vessel moves beyond a set radius from its last position, preventing "phantom movement" while at anchor.
- **Peak Gust Tracking**: Captures the highest wind speed reading at 1Hz between reporting intervals, ensuring short-lived gusts are not missed by the 5-minute reporting cycle.
- **State Persistence**: Keeps the movement baseline and reporting schedule in `state.json` when the plugin is restarted from the admin UI. See [Known Limitations](#known-limitations) for server restarts.
- **Smart Unit Conversion**: Automatically handles conversion from Signal K base units (Kelvin, Pascal, m/s) to Windy standards (°C, Pa, m/s).

## Mapped Data

### Observations

Each reporting cycle sends one observation built from the Signal K paths below. The paths are defaults and can be changed under **Sensor Path Overrides (Advanced)** in the plugin configuration. A path with no value is left out of the observation.

| Measurement | Signal K Path (Default) | Windy Parameter | Conversion |
| :--- | :--- | :--- | :--- |
| Wind speed | `environment.wind.speedOverGround` | `wind` | None (m/s) |
| Wind gust | `environment.wind.gust` | `gust` | None (m/s). The highest wind speed seen since the last report is sent when it is higher, or when the path has no value |
| Wind direction | `environment.wind.directionTrue` | `winddir` | Radians to whole degrees, 0 to 359 |
| Temperature | `environment.outside.temperature` | `temp` | Kelvin to °C |
| Pressure | `environment.outside.pressure` | `pressure` | None (Pa) |
| Humidity | `environment.outside.relativeHumidity` | `rh` | Ratio to percent |

Signal K's own NMEA 0183 and NMEA 2000 converters publish outside humidity on `environment.outside.humidity`, and `environment.wind.gust` is not a path in the Signal K specification. On an installation whose humidity comes from a standard instrument, the humidity path has to be changed to `environment.outside.humidity` for humidity to be reported.

### Station Record

When the vessel has moved beyond the movement threshold, the plugin updates the station record on Windy before sending the observation.

| Station Field | Source |
| :--- | :--- |
| `lat`, `lon` | `navigation.position`, rounded to five decimals |
| `elev_m` | `navigation.gnss.antennaAltitude` if present, otherwise `navigation.altitude`, otherwise 0; rounded to a whole metre |
| `name`, `operator_text` | **Display Name** |
| `station_type` | **Station Type** |
| `operator_url` | **Operator Website URL** |
| `share_option` | **Share Option** |
| `agl_wind`, `agl_temp` | **Wind Sensor Height** and **Temperature Sensor Height** |

The two sensor heights describe how far each sensor is above the waterline. They are not the station elevation. The elevation Windy shows for the station ("AMSL") is `elev_m`, which the plugin takes from the GNSS altitude and which is normally close to zero for a vessel.

## Compatibility

| | |
| :--- | :--- |
| Node.js | 20 or later (`engines` in `package.json`) |
| Automated tests | Run on Node.js 20.20.2, 22.22.0 and 24.21.0 |
| Signal K server | Loaded and run against Signal K server 2.33.0 |
| Plugin CI | The [Signal K plugin CI](https://github.com/SignalK/signalk-server/blob/master/.github/workflows/plugin-ci.yml) runs on Linux, Linux arm64, macOS and Windows with Node.js 22 and 24 on every push |

Signal K server versions older than 2.33.0 have not been tested with this release. Earlier releases of the plugin were developed on Signal K server 2.21 and 2.22.

## Prerequisites

- **Windy station**: A station registered at [stations.windy.com](https://stations.windy.com), which provides the **Station ID** and the **Station Password**.
- **Windy API key**: A key created on the API Keys page at [stations.windy.com](https://stations.windy.com).
- **Position Data**: A valid GPS source providing `navigation.position`.
- **Derived Data (Optional)**: For vessels without direct SOG or True Wind sensors, the `signalk-derived-data` plugin is recommended to provide the necessary calculated paths.

## Quick Start Guide

1. **Register the Station**: Log in to [stations.windy.com](https://stations.windy.com) and click **+ Add Station**.
2. **Collect Credentials**:
   * Create an **API Key** on the API Keys page.
   * Copy the **Station Password** from the station details.
   * Copy the **Station ID** (e.g., `f0123456`) from the station list.
3. **Install the Plugin**: In the Signal K admin UI, open **Apps & Plugins > Store**, search for `signalk-windy-apiv2`, install it, and restart the Signal K server.
4. **Configure the Plugin**: Open **Apps & Plugins > Configuration**, select **Windy API v2 Reporter**, enter the three credentials and set the **Display Name**, which is the name shown on the Windy map.
5. **Set Movement Guard**: Choose a distance threshold (default 300m). The station position on Windy is updated only when the vessel moves beyond this distance from the last reported point.
6. **Check the Dashboard**: After 15 seconds the plugin status shows the reported readings and a countdown to the next report.

Users migrating from the legacy signalk-windy plugin should follow the [Migration Guide](MIGRATION.md).

## Technical Details

### Real-Time Log Monitoring
To stream logs specifically for this plugin on an installation created with `signalk-server-setup`:
```bash
journalctl -u signalk -f | grep "signalk-windy-apiv2"
```

### Restart vs Full Reset

The plugin maintains persistent state in a `state.json` file within the Signal K data directory. There are two levels of reset depending on the situation.

**Restart (apply config changes):** Open **Apps & Plugins > Configuration**, select the Windy API v2 Reporter, and click **Submit**. This restarts the plugin with the current settings. The movement baseline, reporting timer, and position establishment state are preserved — only configuration changes (credentials, interval, thresholds) take effect.

**Full reset (clear all state):** Delete the plugin's `state.json` file and restart. This clears the movement baseline, resets the reporting timer, and forces a fresh position update to Windy on the next reporting cycle. The state file is located at:

```
~/.signalk/plugin-config-data/signalk-windy-apiv2/state.json
```

A full reset is useful after migration from the legacy plugin, when the station position on Windy needs to be re-established, or when troubleshooting position-related issues.

### Diagnostic Reporting
To generate a log summary for troubleshooting:

```bash
journalctl -u signalk -n 100 --no-pager | grep "signalk-windy-apiv2"
```

When sharing logs, redact the **Station Password** and **API Key** before posting to public forums or GitHub issues.

### Troubleshooting

**Confirming credentials are valid.** The plugin validates credentials implicitly on each reporting cycle: a successful submission means the credentials are correct. There is no separate "test" action — if the dashboard shows sensor readings and a normal countdown after the warm-up period, the Station Password, API Key, and Station ID are all working. The verdict appears on the first reporting cycle after the plugin starts or is restarted via Submit (after the 15-second warm-up on a fresh start, or after the remaining interval on a resume), not instantly on Submit.

**Error messages.** The messages below were checked against the Windy API on 2026-10-10.

1. **"Station Password rejected by Windy"** — The Station Password is incorrect, or the Station ID does not belong to that password. Windy answers both with a message about the password. Verify both against the station detail page at [stations.windy.com](https://stations.windy.com).
2. **"Windy rejected the API Key or Station ID (403)"** — The Global API Key is incorrect or missing. Windy now answers a Station ID that does not exist with a different code, shown as the next message.
3. **"Metadata update failed (404)"** — The Station ID does not exist. Verify it on the station list.
4. **"Metadata update failed (400)"** — Windy rejected the station record. The usual cause is the **Private** share option; see [Known Limitations](#known-limitations).
5. **"Observation failed: Status 400: ..."** — Windy rejected the observation and names the field in the message. A message about `ts` means the system clock of the server is wrong: Windy accepts no time in the future and none more than two hours in the past.

**Pressure not shown on the Windy station page.** Pressure data is transmitted correctly but may not appear in the Windy station UI. Windy displays pressure only for professional stations; for personal weather stations the value is accepted and stored (visible in the data graph) but not shown in the station inspector. This is a Windy display limitation, not a plugin issue — the data is being reported.

## Known Limitations

1. **The Private share option is rejected by Windy.** Windy accepts `public` and `only_windy` only. With **Private** selected, every station update fails and the position on the map is not updated. Select **Public** or **Windy** instead.
2. **An operator logo set on Windy is removed by position updates.** Windy replaces the whole station record on every update and offers no way to send a position alone. The plugin does not resend a logo, so a logo uploaded at [stations.windy.com](https://stations.windy.com) is removed the next time the vessel moves beyond the movement threshold.
3. **State is saved only when the plugin is stopped from the admin UI.** The Signal K server does not stop plugins when the server itself shuts down or restarts. After a server restart, reboot or power loss the plugin continues from the state saved at the last Submit, or from a fresh state if there is none. The first reporting cycle then sends a station update if the vessel has moved, and the countdown starts again from the 15-second warm-up.
4. **Readings are not checked for age.** A sensor path that has stopped updating keeps its last value in Signal K, and that value is reported as current.

## Future Enhancements

* **Precipitation Support**: The Windy API v2 accepts a `precip` parameter for rain in mm for the last 60 minutes. With access to a rain gauge providing the appropriate Signal K path, this would extend the reported data set.

* **Offline Observation Queue**: Buffer observations when connectivity is unavailable and replay them when the connection returns. Windy accepts an observation time up to two hours in the past, which bounds what a queue can replay.

* **Data Staleness Detection**: Flag sensor readings that have not updated within a configurable window and optionally omit them rather than reporting stale data.

## Support

For bug reports and feature requests, open an issue at [GitHub Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues). Include the Signal K server version, plugin version, and relevant log output (see Diagnostic Reporting above).

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Screenshots

### Vessel on Windy Map
![Windy Station View](screenshots/windy-station.png)

### Plugin Configuration
![Credentials](screenshots/configuration-credentials.png)
![Vessel](screenshots/configuration-vessel.png)
![Path Overrides](screenshots/configuration-path-overrides.png)

## License

Copyright 2026 Peter Petrik. Licensed under the [GNU General Public License v3.0 or later](LICENSE).
