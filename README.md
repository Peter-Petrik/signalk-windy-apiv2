# Signal K Windy API v2 Reporter
![Signal K Windy Icon](icon.svg)

This plugin gathers environmental data from a Signal K server and reports it to Windy.com as a Personal Weather Station (PWS) using the **v2 API**. It is designed specifically for moving vessels, utilizing separate endpoints for data (Wind, Gusts, Temperature, Pressure, Humidity and Dew Point) and station metadata to ensure reliable map updates and minimal bandwidth usage.

## Project Status

Stable and actively maintained. See [CHANGELOG.md](CHANGELOG.md) for release history and [Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues) for planned work.

This is the only Signal K plugin targeting the Windy v2 API. Users of the legacy [signalk-windy](https://github.com/Saillogger/signalk-windy-plugin) plugin can follow the [Migration Guide](MIGRATION.md) to switch.

## Features

- **API v2 Compliance**: Uses the latest Windy protocol with separate `GET` (observations) and `PUT` (station management) requests.
- **Rate Limit Awareness**: (v1.3.0+) Handles Windy's 429 rate limit responses by rescheduling precisely to the provided `retry_after` window instead of discarding observations or reporting errors.
- **Stale Reading Protection**: (v1.6.0+) A sensor reading that has not been updated for 15 minutes is left out of the report, so a sensor that has stopped is not reported as current weather. The limit is a setting and can be switched off.
- **Live Heartbeat Status**: Enhanced dashboard feedback showing countdown to next report, distance from baseline, current sensor readings, and last submission time. See [Dashboard Status](#dashboard-status).
- **Radius-Based Movement Guard**: Intelligent GPS reporting that triggers map updates only when the vessel moves beyond a set radius from its last position, preventing "phantom movement" while at anchor.
- **Wind Over the Reporting Interval**: (v1.8.0+) The wind speed sent is the mean of the reporting interval, the gust the highest value in it and the direction the mean direction, as weather stations report wind. Earlier versions sent the wind speed and direction of the moment of the report. See [Wind Over the Reporting Interval](#wind-over-the-reporting-interval).
- **Clock Check**: (v1.8.0+) The system clock is compared with GNSS time from `navigation.datetime`, and the dashboard shows an error while the two differ by more than 60 seconds. See [Clock Check](#clock-check).
- **Position Precision**: (v1.8.0+) The position on the Windy map can be rounded to about 100 m or about 1 km. See [Station Record](#station-record).
- **State Persistence**: (v1.5.2+) Saves the movement baseline and reporting schedule to `state.json` after every reporting cycle, so both survive a plugin restart, a server restart, a reboot and a power loss.
- **Station Record Kept Current**: (v1.7.0+) A change to a setting the station record is built from, such as the Display Name or a sensor height, is sent to Windy at the next report, whether or not the vessel has moved. See [Station Record](#station-record).
- **Smart Unit Conversion**: Automatically handles conversion from Signal K base units (Kelvin, Pascal, m/s) to Windy standards (°C, Pa, m/s).

## Mapped Data

### Observations

Each reporting cycle sends one observation built from the Signal K paths below. The paths are defaults and can be changed under **Sensor Path Overrides (Advanced)** in the plugin configuration. A path with no value is left out of the observation. So is a reading older than the **Maximum Reading Age** (see [Stale Readings](#stale-readings)), and a value that is not a number or, rounded as it is sent, lies outside the range Windy accepts for its field; Windy rejects a whole observation for one such field, so leaving it out keeps the other readings reported. The debug log names every reading that was left out.

| Measurement | Signal K Path (Default) | Windy Parameter | Conversion |
| :--- | :--- | :--- | :--- |
| Wind speed | `environment.wind.speedOverGround` | `wind` | None (m/s). (v1.8.0+) The mean of the reporting interval |
| Wind gust | `environment.wind.gust` | `gust` | None (m/s). The highest value of this path or of the wind speed in the reporting interval, whichever is higher. The gust is never sent below the wind speed of the same report |
| Wind direction | `environment.wind.directionTrue` | `winddir` | Radians to whole degrees, folded into 0 to 359. (v1.8.0+) The mean direction of the reporting interval. A value beyond ±2π is not an angle in radians and is left out |
| Temperature | `environment.outside.temperature` | `temp` | Kelvin to °C |
| Pressure | `environment.outside.pressure` | `pressure` | None (Pa) |
| Humidity | `environment.outside.humidity` | `rh` | Ratio to percent |
| Dew point | `environment.outside.dewPointTemperature` | `dewpoint` | (v1.8.0+) Kelvin to °C. Not shown on the dashboard, also when it is left out |

`environment.outside.humidity` is the humidity path of the Signal K specification and the one Signal K's own NMEA 0183 and NMEA 2000 converters publish. Versions before 1.5.2 read `environment.outside.relativeHumidity`. When the configured path is one of these two and holds no value, the other is read, so an existing configuration needs no change. `environment.wind.gust` is not a path in the Signal K specification; where no source publishes it, the gust is the highest wind speed of the reporting interval.

Windy expects the wind over ground: speed and direction relative to the ground, the direction in degrees from true north. `environment.wind.speedOverGround` and `environment.wind.directionTrue` are published by the `signalk-derived-data` plugin and by Signal K's NMEA 2000 converter for wind data referenced to true north. (v1.8.0+) These wind paths, which cannot give it, are named on the dashboard as an error: apparent wind speed (`environment.wind.speedApparent`), which includes the vessel's own speed, and the magnetic direction (`environment.wind.directionMagnetic`) are still sent; an angle from the bow (`environment.wind.angleApparent`, `environment.wind.angleTrueWater` or `environment.wind.angleTrueGround`) is not a compass direction, and no direction is sent.

### Station Record

The plugin sends the station record to Windy before the observation when one of these holds:

1. No station update has succeeded yet, as after an installation or a full reset.
2. The vessel has moved beyond the movement threshold from the position last sent.
3. (v1.7.0+) One of these settings has changed since the last update Windy accepted: **Station ID**, **Display Name**, **Station Type**, **Operator Website URL**, **Share Option**, **Wind Sensor Height**, **Temperature Sensor Height**, **Station Elevation** or (v1.8.0+) **Position Precision**. A change of the GNSS altitude does not count. The first report after an update from a version earlier than 1.7.0 sends the record once for this reason, even at anchor.
4. **Force GPS Updates** is on: the record is sent with every report.

Windy replaces the whole record with each update (see [Known Limitations](#known-limitations)).

| Station Field | Source |
| :--- | :--- |
| `lat`, `lon` | `navigation.position`, rounded to five decimals, or as set by **Position Precision** |
| `elev_m` | **Station Elevation** if set. Otherwise `navigation.gnss.antennaAltitude` if it holds a current number, otherwise `navigation.altitude`, otherwise 0; rounded to a whole metre |
| `name`, `operator_text` | **Display Name** |
| `station_type` | **Station Type** |
| `operator_url` | **Operator Website URL** |
| `share_option` | **Share Option**: `public` for **Public**, `only_windy` for **Windy only** |
| `agl_wind`, `agl_temp` | **Wind Sensor Height** and **Temperature Sensor Height** |

The two sensor heights describe how far each sensor is above the waterline. They are not the station elevation. The elevation Windy shows for the station ("AMSL") is `elev_m`. It is taken from the GNSS altitude, which can be several metres off and on a sailing vessel may be the height of an antenna; the **Station Elevation** setting (v1.6.0+) replaces it with a fixed value. A receiver on NMEA 2000 reports its altitude above the WGS-84 ellipsoid, not above sea level, so on such a vessel the GNSS altitude differs from the elevation above sea level by the geoidal separation, which Signal K publishes as `navigation.gnss.geoidalSeparation`. NMEA 0183 receivers report the altitude above sea level. A vessel at sea is at an elevation of 0.

A station update is not sent with a position older than the **Maximum Reading Age**, since the vessel may have moved in the meantime.

Windy shows the position of a public station to anyone. **Position Precision** (v1.8.0+) sets how exactly it is placed on the map: **Exact** sends five decimals (about 1 m), **About 100 m** three and **About 1 km** two. Rounding moves the station on the map by less than the stated distance. The Movement Guard still measures from the real position, and observations carry no position.

## Compatibility

| | |
| :--- | :--- |
| Node.js | 20 or later (`engines` in `package.json`). Signal K server 2.24.0 and later require Node.js 22 or later |
| Automated tests | Run on Node.js 20.20.2, 22.22.0 and 24.21.0 |
| Signal K server | Loaded and started on Signal K server 2.31.1, 2.32.0, 2.33.0 and 2.34.0. On each, reporting cycles were run with every request to Windy intercepted: a reading timed out by the server, a changed setting sent without movement, a refused station update, a lost connection and the recovery, and (v1.8.0+) a wind changing every two seconds, a dew point, a GNSS time 90 seconds behind the system clock and a rounded position. On 2.33.0 the runs also had a position published by several sources |
| Plugin CI | The [Signal K plugin CI](https://github.com/SignalK/signalk-server/blob/master/.github/workflows/plugin-ci.yml) runs on every push: the tests on Linux, Linux arm64, macOS and Windows with Node.js 22 and 24, and an integration check against Signal K server 2.32.0, 2.33.0 and the latest release |

Signal K server versions older than 2.31.1 have not been tested with this release. Earlier releases of the plugin were developed on Signal K server 2.21 and 2.22.

## Prerequisites

- **Windy station**: A station registered at [stations.windy.com](https://stations.windy.com), which provides the **Station ID** and the **Station Password**. Both are shown on the station's **Connection** tab under **My Stations**.
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
4. **Configure the Plugin**: Open **Apps & Plugins > Configuration**, select **Windy API v2 Reporter**, enter the three credentials and set the **Display Name**, which is the name shown on the Windy map. Click **Save Configuration** below the form; saving the configuration for the first time also enables the plugin.
5. **Set Movement Guard**: Choose a distance threshold (default 300m). The station position on Windy is updated only when the vessel moves beyond this distance from the last reported point.
6. **Check the Dashboard**: After 15 seconds the plugin status shows the reported readings and a countdown to the next report. Until all three credentials are entered, the status reads "Not configured" and nothing is sent.

Windy publishes the same setup in its own documentation: [Signal K guide on Windy Stations](https://stations.windy.com/docs/guides/Signal%20K).

Users migrating from the legacy signalk-windy plugin should follow the [Migration Guide](MIGRATION.md).

## Technical Details

### Dashboard Status

The plugin's line on the Signal K dashboard has this form:

```
Next: 4m53s | Δ6m | W:4.1 G:5.6 D:306 T:20.5 P:101.9 H:64 | 20:43
```

| Part | Meaning |
| :--- | :--- |
| `Next: 4m53s` | Time until the next report. `Warm:` during the 15 seconds after a start, `Resume:` when a countdown from before a restart is continued |
| `Δ6m` | Distance from the position last sent to Windy. `Forced` in its place (v1.6.0+) while **Force GPS Updates** is on |
| `W:` `G:` `D:` `T:` `P:` `H:` | The readings of the last report: wind and gust in knots, direction in degrees, temperature in °C, pressure in kPa, humidity in percent |
| `H:-` | (v1.6.0+) A reading exists for this field but was left out: older than the Maximum Reading Age, not a number, or outside the range Windy accepts. A field with no reading at all is not shown |
| `20:43` | Time of the last report, in the time zone of the server. A Raspberry Pi set to UTC shows UTC |

When a cycle has nothing to send, the readings give way to the first path without a usable reading and the number of further ones (v1.6.0+):

```
Next: 4m53s | Δ6m | No data: environment.wind.speedOverGround +4
```

While Windy cannot be reached, the readings give way to the reason and the time the first failure became known (v1.7.0+). `No connection to Windy` covers a request without an answer, `No answer from Windy` one that ran out of its 30 seconds, `Answer from Windy too large` an answer of more than 64 KB, and `Windy not available (503)` an answer of 408 or 502 to 599, the codes a gateway in front of Windy sends. The line is kept across a restart of the plugin until Windy answers again:

```
Next: 4m53s | Δ6m | No connection to Windy since 14:05
```

Both are shown as a plain status, not as an error: instruments that are switched off and a lost connection at sea are routine, and both clear by themselves.

A request that Windy refuses, a share option Windy does not accept, (v1.8.0+) a wind path that cannot give the wind Windy expects, a system clock more than 60 seconds off GNSS time and an unforeseen failure are shown as an error, in place of the countdown and the readings, until the cause is gone: a refused station update until an update succeeds or none is due any more, a refused observation until Windy accepts or answers the next one (v1.7.0+). A refused station update is sent again at every report while it is due. When several errors apply, they are shown together, separated by `|`. When the error has cleared, the line returns to the countdown, and the server keeps the error in the **Last Error** column until the plugin is restarted.

### Stale Readings

Signal K keeps the last value of a path for as long as the server runs, so a sensor that was switched off an hour ago still has a value there. From v1.6.0 the plugin takes every reading from its live subscription and notes when it arrived. A reading that has not been updated within the **Maximum Reading Age** (default 15 minutes) is not sent, and the dashboard shows it with a dash.

A sensor that sends a value only when the value changes can exceed the limit while working correctly, for example a humidity sensor on a steady night. For such a sensor the limit can be raised, or set to 0 to switch the check off.

### Wind Over the Reporting Interval

Weather stations report wind as a mean over a period, with the gust as the highest value in it: the World Meteorological Organization defines the reported wind as a mean over 10 minutes, and weather station software such as WeeWX sends the mean of its archive interval. From v1.8.0 the plugin takes its reporting interval as the period:

1. **Wind speed**: the mean of the values in the interval, each weighted by how long it stood until the next one arrived, but for no longer than the **Maximum Reading Age** after it was last delivered. A sensor that sends only when its value changes is weighted correctly, and a burst of values does not outweigh a steady minute. A time in which the sensor had no value, or which the Signal K server declared timed out, is left out.
2. **Gust**: the highest value of the gust path or of the wind speed in the interval, including a value that arrived earlier and still stood when the interval began. The gust is never sent below the wind speed, and in a calm it is 0.
3. **Direction**: the mean of the directions taken as vectors, so that 350° and 10° give 0°, each weighted by the wind speed at the time, so that the wandering direction of a near calm counts little. In a calm, or with no wind speed at all, every moment counts the same.

The interval is the one before the report, for a retry after a rate limit as well, extended back over the time the previous report took to be answered. Whether the wind is sent at all is decided by its latest reading, as for every other field: a wind speed older than the **Maximum Reading Age** is left out, and so is the gust it gives. A value from before a sensor stopped for longer than the **Maximum Reading Age** does not count once it comes back. The Signal K server delivers at most one value a second from each source, the latest of that second. A value outside the range Windy accepts is not taken, and the value before it goes on standing; when the latest value is outside the range, the wind speed is left out. A wind speed the server held before the plugin started counts for the mean from its own time stamp, but not as the gust, and a value of the gust path counts as the gust only when it arrived in the interval or stood live at its start. When the server held values of a path from several sources, only the newest counts. After the system clock has been set back, the values of the interval start again.

Windy's documentation does not say whether it expects a mean or a moment. Versions before 1.8.0 sent the wind speed and direction of the moment of the report, and the highest wind speed since the previous report as the gust.

### Clock Check

The observation time sent to Windy is the system clock of the Signal K server. Windy accepted an observation stamped 2 minutes ahead of its own clock and refused one stamped 5 minutes ahead (tested 2026-10-23); it accepts none more than two hours in the past. A clock that is behind stamps every observation with the wrong time.

From v1.8.0 the plugin compares the system clock with GNSS time from `navigation.datetime` as each value arrives, and shows an error on the dashboard while the two differ by more than 60 seconds. Observations are still sent. The [set-system-time](https://github.com/SignalK/set-system-time) plugin sets the system clock from GNSS time. Without `navigation.datetime` there is no check. Each source of `navigation.datetime` is judged on its own, and one that agrees with the system clock is enough, so that a device publishing the time of its own clock does not turn the error on and off. A GNSS time that has not been updated within the **Maximum Reading Age**, or within 15 minutes when the age check is off, is not used, nor is a time before October 2026, such as a receiver without a fix may send.

### Real-Time Log Monitoring
To stream logs specifically for this plugin on an installation created with `signalk-server-setup`:
```bash
journalctl -u signalk -f | grep "signalk-windy-apiv2"
```

Errors are always logged. The debug lines, which name every reading left out and show each request sent, appear only while **Enable debug log** is switched on for the plugin in **Apps & Plugins > Configuration**.

### Restart vs Full Reset

The plugin maintains persistent state in a `state.json` file within the Signal K data directory, saved after every reporting cycle. There are two levels of reset depending on the situation.

**Restart (apply config changes):** Open **Apps & Plugins > Configuration**, select the Windy API v2 Reporter, and click **Save Configuration** below the form. This restarts the plugin with the current settings. The movement baseline, reporting timer, and position establishment state are preserved. A changed setting of the station record is sent to Windy at the next report with a current position (v1.7.0+); earlier versions sent it only when the vessel next moved beyond the movement threshold.

**Full reset (clear all state):** Disable the plugin, delete its `state.json` file, and enable the plugin again. The plugin has to be disabled first, because a running plugin saves its state again at the next cycle and when it stops. This clears the movement baseline, resets the reporting timer, and forces a fresh position update to Windy on the next reporting cycle. The state file is located at:

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

**Confirming credentials are valid.** The plugin validates credentials implicitly on each reporting cycle: a successful submission means the credentials are correct. There is no separate "test" action — if the dashboard shows sensor readings and a normal countdown after the warm-up period, the Station Password, API Key, and Station ID are all working. The verdict appears on the first reporting cycle after the plugin starts or is restarted by saving its configuration (after the 15-second warm-up on a fresh start, or after the remaining interval on a resume), not at the moment the configuration is saved.

**Error messages.** The messages below were checked against the Windy API on 2026-10-10.

1. **"Not configured: enter ..."** — One or more of the three credentials is missing. The message names them. Nothing is sent until all three are entered.
2. **"Station Password rejected by Windy"** — The Station Password is incorrect. Verify it against the station detail page at [stations.windy.com](https://stations.windy.com).
3. **"Station ID and Station Password do not belong together"** — The Station ID and the Station Password are not those of the same station. Verify both against the station detail page.
4. **"Windy rejected the Global API Key (403)"** — The Global API Key is incorrect. Verify it on the API Keys page.
5. **"Windy does not know this Station ID (404)"** — No station has this ID. Verify it on the station list.
6. **"No data: ..."** — Not an error. No sensor path has a usable reading, so there is nothing to send. The line names the first such path. A path that is not published at all needs a source or a different path under **Sensor Path Overrides (Advanced)**; a path whose sensor has stopped is reported again when the sensor resumes.
7. **"Station position not updated: Share Option ..."** — The saved Share Option is one Windy does not accept, or none is saved. Observations are still sent, but the position on the map is not updated until **Public** or **Windy only** is selected. Versions before 1.5.2 offered a **Private** option, which Windy rejects.
8. **"Metadata update failed (400): ..."** — Windy rejected the station record and gives its reason after the status (v1.7.0+; earlier versions showed the status only). The server log holds Windy's answer.
9. **"Observation failed: Status 400: ..."** — Windy rejected the observation and names the field in the message. A message about `ts` means the system clock of the server is wrong: Windy refuses a time a few minutes in the future and any time more than two hours in the past (see [Clock Check](#clock-check)). A status of 500 is shown the same way.
10. **"Reporting cycle failed: ..."** — An error the plugin did not foresee. The plugin reports again at the next cycle; the server log holds the details, which are worth including in a bug report.
11. **"No connection to Windy since ..."**, **"No answer from Windy since ..."**, **"Answer from Windy too large since ..."** and **"Windy not available (503) since ..."** — Not an error. Windy could not be reached from the time named; the plugin goes on trying at every report. A connection that works for other services points to Windy being down; Windy's own status is not known to the plugin.
12. **"Wind Speed path ..."** and **"Wind Direction path ..."** — (v1.8.0+) The configured wind path cannot give the wind Windy expects. The message names the path and the path to choose under **Sensor Path Overrides (Advanced)** (see [Observations](#observations)).
13. **"System clock is more than 60 s ahead of GNSS time ..."** and **"System clock is more than 60 s behind GNSS time ..."** — (v1.8.0+) The system clock of the server is wrong (see [Clock Check](#clock-check)).

At most 200 characters of an answer from Windy are shown on the dashboard and at most 500 are logged. An HTML page in place of an answer, as a gateway sends, is shown as `(HTML page)`.

**Pressure not shown on the Windy station page.** Pressure data is transmitted correctly but may not appear in the Windy station UI. Windy displays pressure only for professional stations; for personal weather stations the value is accepted and stored (visible in the data graph) but not shown in the station inspector. This is a Windy display limitation, not a plugin issue — the data is being reported.

## Known Limitations

1. **Station details edited on Windy are replaced by the plugin's settings.** Windy replaces the whole station record on every update and offers no way to send a position alone. Every station update sends the name, station type, website, share option, sensor heights and elevation from the plugin configuration, so changes made to these at [stations.windy.com](https://stations.windy.com) are overwritten at the next update. The plugin does not resend an operator logo, so a logo uploaded at stations.windy.com is removed at the next update.
2. **One source per path.** When several sources publish the same path and no source priority is set for it in the Signal K server, the server passes the values of all of them to the plugin: the wind of a report is taken from the values of all of them, and every other reading is whichever arrived last. Setting a source priority for the path makes the server pass only the preferred source.
3. **The Global API Key controls every station on the Windy account.** The Signal K server keeps it, with the Station Password, in the plugin configuration (`~/.signalk/plugin-config-data/signalk-windy-apiv2.json`). A server whose security is switched off lets anyone who can reach it read that configuration, credentials included, and change it.

## Future Enhancements

* **Precipitation Support**: The Windy API v2 accepts a `precip` parameter for rain in mm for the last 60 minutes. With access to a rain gauge providing the appropriate Signal K path, this would extend the reported data set.

* **Offline Observation Queue**: Buffer observations when connectivity is unavailable and replay them when the connection returns. Windy accepts an observation time up to two hours in the past, which bounds what a queue can replay.

## Support

For bug reports and feature requests, open an issue at [GitHub Issues](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues). Include the Signal K server version, plugin version, and relevant log output (see Diagnostic Reporting above).

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Screenshots

### Vessel on Windy Map
![Windy Station View](screenshots/windy-station.png)

### Dashboard Status
![Dashboard Status](screenshots/dashboard-status.png)

### Plugin Configuration
![Credentials](screenshots/configuration-credentials.png)
![Vessel](screenshots/configuration-vessel.png)
![Transmission](screenshots/configuration-transmission.png)
![Path Overrides](screenshots/configuration-path-overrides.png)

## License

Copyright 2026 Peter Petrik. Licensed under the [GNU General Public License v3.0 or later](LICENSE).
