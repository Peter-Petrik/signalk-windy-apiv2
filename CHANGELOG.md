# Changelog

All notable changes to the Signal K Windy API v2 Reporter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.3] - 2026-10-12

### Changed
- **Global API Key Description**: The description of the **Global API Key** field in the plugin configuration said the key is found in the Windy account settings. It now says the key is created on the API Keys page at stations.windy.com, which is where Windy's API reference and this README point, and that the plugin uses the key to update the position of the station.
- **Credentials Screenshot**: The screenshot of the **Windy API Credentials** section was retaken on Signal K server 2.33.0 and shows the new description.

## [1.6.2] - 2026-10-12

### Changed
- **README Names the Save Configuration Button**: The README told the reader to click **Submit** to save the plugin configuration. Current Signal K servers label that button **Save Configuration**, so the Quick Start, the restart instructions and the troubleshooting text now use that name or describe the action without a button name. The Quick Start also states that saving the configuration for the first time enables the plugin.
- **Transmission Settings Screenshot**: The screenshot of the **Transmission & Movement Guard** section was retaken with 1.6.1. It shows the description of the **Reporting Interval** as reworded in that version.

## [1.6.1] - 2026-10-11

### Changed
- **Reporting Interval Is a Whole Number**: The **Reporting Interval** field of the plugin configuration now accepts whole minutes only, like the other whole-number settings. Before, the form accepted a fraction such as 7.5. An interval saved with a fraction keeps its schedule after the update; the form asks for a whole number when that configuration is next saved.
- **Path Overrides Screenshot**: The screenshot of the **Sensor Path Overrides (Advanced)** section was retaken on Signal K server 2.33.0. It shows the full paths and the humidity default `environment.outside.humidity`, where the earlier screenshot showed the default from before 1.5.2.

## [1.6.0] - 2026-10-11

### Added
- **Stale Readings Are Left Out**: A sensor reading that has not been updated within the new **Maximum Reading Age** setting is no longer sent. The default is 15 minutes, and it applies to existing installations after the update; 0 switches the check off. Before, the last value of a sensor that had been switched off or had lost its connection was reported as current weather for as long as the Signal K server ran. A sensor that sends a value only when the value changes can exceed the limit while working correctly; for such a sensor the limit can be raised or switched off.
- **Left-Out Readings Shown on the Dashboard**: A field whose reading was left out, because it is too old, not a number, or outside the range Windy accepts, is shown with a dash, for example `H:-`. A field with no reading at all is not shown, as before.
- **Force GPS Updates Indicator**: While **Force GPS Updates** is on, the dashboard shows `Forced` in place of the distance. The setting sends the position at every report, and nothing on the dashboard showed that it was on.
- **Station Elevation Setting**: The elevation sent to Windy, shown there as AMSL, can now be set in the plugin configuration. Left empty, the GNSS antenna altitude is sent as before.
- **Software Identification**: Each observation carries `softwaretype=signalk-windy-apiv2/<version>`, a field of Windy's API, so that Windy can tell which stations report through this plugin.

### Changed
- **All Readings Come From the Live Subscription**: Wind speed, direction, temperature, pressure, humidity, altitude and the position sent in a station update are now taken from the plugin's subscription, each with the time it arrived. Before, they were read from the server's stored values at the moment of the report, and only the gust and the distance came from the subscription. The stored values carry no arrival time, which the age check needs.
- **Gust Never Below Wind**: Wind speed and gust now come from the same samples, and a gust is never sent below the wind speed of the same report. A report such as wind 8.6 kn with gust 0.2 kn, as described in [#9](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues/9), can no longer be produced. The cause of that report has not been established, so the issue stays open.
- **"No data" Line Replaces "Waiting for sensor data"**: When a cycle has nothing to send, the dashboard names the first path without a usable reading and the number of further ones, for example `No data: environment.wind.speedOverGround +4`, and keeps showing it through the countdown. The earlier message was replaced by the countdown after one second, and the readings of the last report stayed on the line as if they were current.
- **No Station Update From an Old Position**: A station update is not sent when the last position is older than the Maximum Reading Age. The vessel may have moved since, and the station would be placed where the vessel no longer is.
- **Screenshots**: The screenshots of the dashboard status, the vessel settings and the transmission settings were retaken with this version on Signal K server 2.33.0. The dashboard status and the transmission settings are shown in the Signal K App Store again; they had been left out of the store's list since 1.5.1 because they showed an earlier version.
- **Settings Help Text**: The descriptions of Station Type, Operator Website URL, the two sensor heights and the Min Movement Threshold now say what each value does. The sensor heights are described as heights above the water line and not the station elevation, which was the misunderstanding behind one part of [#9](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues/9).

## [1.5.2] - 2026-10-10

### Added
- **"Not configured" Status**: A plugin that is enabled before its credentials are entered now shows "Not configured" on the dashboard, names the credentials that are missing, and sends nothing. Before, it sent a station update and an observation without credentials every cycle and showed the resulting credential error.
- **Integration Check in CI**: The Signal K plugin CI now also installs the plugin into a running Signal K server and runs `npm run test:integration`, which confirms that the server loads the plugin and that the plugin reports itself as not configured. The check saves no configuration, so no CI run sends a request to Windy.

### Changed
- **Default Humidity Path**: The default path for humidity is now `environment.outside.humidity`, the path in the Signal K specification and the one Signal K's NMEA 0183 and NMEA 2000 converters publish. When the configured path is that one or the earlier default `environment.outside.relativeHumidity` and holds no value, the other of the two is read. Humidity from a standard instrument is now reported without a path override, and an installation that reported humidity before continues to do so. No reconfiguration is required.
- **Error Messages Follow Windy's Current Answers**: The dashboard messages were rechecked against the live API on 2026-10-10. A 403 on the station update now names the Global API Key only, because Windy answers an unknown Station ID with 404, which has its own message naming the Station ID. A 400 on the observation saying that the password does not match the station now names both the Station ID and the Station Password. A 409, which Windy sends for an observation it already holds, is no longer shown as an error.
- **Share Option Label**: The option that sends `only_windy` is now labelled "Windy only" instead of "Windy".
- **Credentials Are Trimmed**: White space around the Station ID, the Station Password and the Global API Key is removed before they are used, so a space or line break picked up while copying a key no longer causes a rejection.
- **Source Layout**: The code is split into `index.js` (start, stop and the schedule) and five modules under `lib/` (settings, conversion, movement, state, and the requests to Windy). The split is internal and changes nothing for a running installation.

### Removed
- **Private Share Option**: The **Private** choice has been removed from the Share Option setting. Windy accepts `public` and `only_windy` only and answered every station update carrying `private` with a 400, so with Private selected the position on the map was never updated while observations were still sent; the option did not make a station private. **An installation that has Private saved keeps behaving as before**: no station update is sent and observations continue. The difference is that the dashboard now shows the reason as an error ("Share Option "Private" is not accepted by Windy. Choose Public or Windy only in the plugin configuration.") until one of the two accepted options is chosen. The plugin does not choose one on the owner's behalf. The same applies to a configuration that holds no share option at all.

### Fixed
- **Reporting Stopped After One Unexpected Value**: A position without coordinates at the moment a station update was due, or a sensor path holding something other than a number, raised an error inside the reporting cycle. The next cycle was never scheduled and the plugin stayed silent, with a frozen dashboard, until it was restarted. Every reading is now checked before use, and an error in a cycle is logged, shown on the dashboard and followed by the next cycle.
- **Out-of-Range Readings Rejected the Whole Observation**: Windy rejects an observation when one field lies outside its documented range, for example humidity published as a percentage instead of a ratio, or pressure in hectopascal instead of pascal. Such a reading is now left out and named in the debug log, and the remaining readings are reported. A negative wind direction is folded into 0 to 359.
- **A Stopped Plugin Kept Reporting**: When the plugin was stopped or disabled while a request to Windy was in progress, the request's completion scheduled the next cycle, and the plugin went on sending observations until the server was restarted. Stopping is now final.
- **Subscriptions Were Never Released**: Every restart of the plugin, including every Submit in its configuration, left another pair of once-a-second subscriptions running for the life of the server process. They are now released when the plugin stops.
- **State Was Saved Only When the Plugin Was Stopped From the Admin UI**: The Signal K server does not stop plugins when the server itself shuts down or restarts, so after a reboot or a power loss the plugin resumed from whatever state the last Submit had saved, possibly months earlier. The state is now saved after every reporting cycle and after every successful station update. The file is written under a temporary name and renamed, so an interrupted write cannot leave a damaged file.
- **A Saved Schedule Could Silence the Plugin**: A state saved while the system clock was wrong could name a next report days away, and the plugin waited for it. A start now never waits longer than one reporting interval.
- **Zero Was Replaced by the Default**: A sensor height of 0 was sent as 10 (wind) or 2 (temperature), and a movement threshold of 0 behaved as 300. Zero is now honoured: a height of 0 is sent as 0, and a threshold of 0 updates the position at every report.
- **Distance Errors at the Edges**: A position without coordinates was measured as millions of metres from the baseline and triggered a station update, as did a small move across the 180° meridian. A position on the equator was not accepted as a baseline. All three are handled.
- **Reporting Faster Than Windy Allows**: A reporting interval below 5 minutes in a configuration file, which the form does not allow, is now raised to 5.

## [1.5.1] - 2026-10-10

### Added
- **Automated Test Suite**: `npm test` now runs a test suite with the Node.js built-in test runner in addition to the syntax check. The tests drive the plugin through a mock Signal K `app` object with the two requests to Windy intercepted and the clock controlled, and cover the reporting cycle, the movement guard, unit conversion, the gust rule, rate-limit and error handling, the state file, the configuration form, and the App Store metadata. No test contacts Windy. Previously the only automated check was `node --check index.js`.
- **Signal K Plugin CI**: Added `.github/workflows/signalk-ci.yml`, which runs the shared Signal K plugin CI on Linux, Linux arm64, macOS and Windows with Node.js 22 and 24 on every push. The integration job is switched off: it enables the plugin with an empty configuration, and this version would then send requests without credentials to Windy.
- **App Store Screenshots**: Declared `signalk.screenshots` in `package.json`. The screenshots were already part of the package but were not listed, so the Signal K App Store showed none.
- **Node.js Version Declaration**: Declared `engines.node` as `>=20` in `package.json`. No minimum was declared before; the requirement itself is unchanged.
- **Compatibility and Known Limitations in README**: The README now states what the plugin was tested with, and lists four known limitations: the Private share option is rejected by Windy, an operator logo set on Windy is removed by position updates, state is saved only when the plugin is stopped from the admin UI, and readings are not checked for age. Each was confirmed by testing; none is new in this version.

### Changed
- **Publish Workflow**: The release workflow now runs on Node.js 24, runs the tests before publishing, refuses a tag that does not match the version in `package.json`, ends the GitHub Release text with a link to the comparison with the previous version, skips the npm step when that version is already published, and uses `softprops/action-gh-release@v3`. The previous workflow ran on Node.js 20, which is below the minimum npm documents for Trusted Publishing, and published without running any test.
- **Documentation Corrections**: Menu names in `README.md`, `MIGRATION.md` and `CONTRIBUTING.md` now match the current Signal K admin UI (**Apps & Plugins > Store**, **Apps & Plugins > Configuration**, **Server > Server Logs**). Log commands use the `signalk` service name that `signalk-server-setup` creates. The data tables in the README separate observation parameters from station record fields and state each conversion. The troubleshooting section lists every dashboard error message against the responses Windy returned on 2026-10-10: a Station ID that does not exist is now answered with 404 and no longer with 403. The migration guide no longer describes `environment.outside.relativeHumidity` as the standard Signal K humidity path; the specification path, and the one Signal K's NMEA converters publish, is `environment.outside.humidity`.
- **App Icon Size Attributes**: `icon.svg` now declares a size of 128 by 128, the minimum the Signal K publishing guide asks for. The drawing is unchanged.
- **Stale Comments in `index.js`**: Replaced leftover change notes with comments that describe the current code. The executable code is identical to 1.5.0.

### Fixed
- **App Store Icon Not Shown**: `package.json` declared the icon as `signalk.icon`. Signal K server reads `signalk.appIcon`, so the App Store showed generated initials instead of the icon. The key is now `signalk.appIcon`.
- **Stale `package-lock.json`**: The lock file still recorded version 1.2.0 and the Apache-2.0 license. It has been regenerated.

## [1.5.0] - 2026-05-30

### Changed
- **Credential-Aware Error Messages**: Failed submissions now produce dashboard messages that name the credential to check. A rejected Station Password (HTTP 400 with a password-related message body on the observation endpoint) reports "Station Password rejected by Windy". A rejected metadata update (HTTP 403 on the station endpoint) reports "Windy rejected the API Key or Station ID" — the Windy API returns the same 403 whether the API Key is wrong or the Station ID does not exist, so both candidates are named rather than guessing. These changes affect only the wording of error messages; the conditions under which the dashboard shows the red error indicator are unchanged. Error-code behavior was confirmed against the production Windy API via live testing.

### Security
- **Bearer Token Authentication for Observations**: The Station Password is now sent to the observation endpoint as a Bearer token in the `Authorization` header rather than as a `PASSWORD` query parameter. This keeps the credential out of the request URL, where it could otherwise be exposed in intermediary or proxy logs. Both authentication forms are accepted by the Windy v2 API; the header form is the more defensive choice. Verified against the production Windy API via live testing. No user action or reconfiguration is required — the change is internal to how the plugin authenticates.

## [1.4.0] - 2026-04-05

### Added
- **First-Run Position Establishment ([#8](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues/8))**: On fresh install, migration from the legacy plugin, or manual state reset (deleting `state.json`), the plugin now sends a station position update (PUT) on the first reporting cycle regardless of the movement guard. Previously, the first cycle would set the GPS baseline to the current position and find zero distance, skipping the PUT entirely — leaving the station at whatever position was last reported by a previous plugin (or blank for new registrations). A `hasReportedPosition` flag is persisted in `state.json` so subsequent restarts do not re-trigger this behavior.

### Changed
- **README Reset Documentation**: Replaced the "Manual Reset" section with "Restart vs Full Reset", clarifying the distinction between a plugin restart (Submit — preserves state) and a full reset (deleting `state.json` — clears movement baseline and forces position re-establishment on Windy).

### Fixed
- **Force GPS Updates Not Working ([#8](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues/8))**: The "Force GPS Updates" configuration toggle was only applied on the very first reporting cycle after a cold start with no saved state. On all subsequent cycles — and on every resume from saved state (including after a configuration save) — the toggle was silently ignored. The root cause was a `force` parameter on the internal `reportToWindy` function that only one of three call sites passed correctly. The fix removes the redundant parameter and reads the `forceUpdate` setting directly from the options object, ensuring the toggle works on every reporting cycle in every code path. Reported by @CruisingSpirit.

## [1.3.2] - 2026-03-13

### Changed
- **Quieter Network Error Handling ([#7](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues/7))**: Transient network errors (DNS failures, TLS handshake interruptions, connection timeouts, socket resets) no longer trigger the red error indicator on the Signal K dashboard. These errors are expected in marine connectivity environments (Starlink handovers, cellular gaps, marina WiFi) and self-correct on the next reporting cycle. Network errors are still logged at error level for server log visibility. API-level errors (4xx, 5xx) continue to trigger the red indicator as before. This follows the same design principle established for 429 rate limit handling in v1.3.0: expected operational conditions should not produce false error indicators. Inspired by [#6](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues/6).

## [1.3.1] - 2026-03-06

### Fixed
- **Wind Direction Boundary Error ([#5](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues/5))**: When the wind is from due north, the Signal K true wind direction value at or near 2π radians converts to exactly 360° after rounding. Windy's validator rejects this with a 400 Bad Request (`winddir must not be greater than 359`). The result is now constrained to the 0–359 range so 360 maps correctly to 0.

## [1.3.0] - 2026-02-17

### Added
- **Rate Limit Awareness**: The plugin now handles Windy's HTTP 429 rate limit responses by parsing the `retry_after` timestamp from the response body and rescheduling the next observation attempt at precisely the right time. Rate limit responses are treated as expected flow (debug log only) rather than errors, preventing false red indicators on the Signal K dashboard — particularly after a server restart when the plugin's timer may not be aligned with Windy's rate limit window.
- **Migration Guide**: Added [MIGRATION.md](MIGRATION.md) with step-by-step instructions for users switching from the legacy signalk-windy plugin, including credential model differences and Signal K path mapping.
- **Contributing Guidelines**: Added [CONTRIBUTING.md](CONTRIBUTING.md) with development setup, testing, and pull request guidance.

### Changed
- **Compact Dashboard Format**: Redesigned the heartbeat status string to fit within the Signal K dashboard display width (~84 characters). Countdown and distance from baseline appear first (most time-sensitive), followed by sensor readings without units (labels are self-explanatory), with the last submission timestamp at the end (degrades gracefully if truncated). Example: `Next: 3m12s | Δ3m | W:23.9 G:29.7 D:314 T:9.0 P:100.8 H:65 | 12:33`
- **Pressure Display Precision**: Dashboard pressure display reduced from 2 decimal places to 1 (e.g., `P:100.8` instead of `P:100.78kPa`). Transmitted API values are unchanged.
- **README Improvements**: Added Project Status section, Support section, corrected precipitation documentation (mm for the last 60 minutes, not since midnight), added link to Migration Guide and Contributing Guidelines, and updated Future Enhancements to reflect current roadmap.

## [1.2.0] - 2026-02-17

### Fixed
- **Station Offline When Underway ([#4](https://github.com/Peter-Petrik/signalk-windy-apiv2/issues/4))**: Restructured the reporting cycle to send the station metadata PUT before the observation GET. Previously, the observation could land against the old station position when the vessel was moving, causing Windy to mark the station as offline immediately after a location update. The PUT now completes before the observation is sent, ensuring Windy receives weather data at the newly registered position. Credit to @jaredko2 for the detailed bug report and diagnosis, and @LeaseOnLife for confirming that PUTs do not count against Windy's observation rate limit.

### Changed
- **Explicit Timestamp Parameter**: Switched from `time: 'now'` to `ts` with a Unix epoch value in observation submissions. The `ts` parameter is the confirmed and documented Windy API v2 parameter, verified via live testing. This change also enables future offline queue support where queued observations require real timestamps.
- **Dashboard Error Indicators**: Error states (failed PUT or GET) now use `app.setPluginError()` in addition to `app.error()`, causing the Signal K dashboard to display a red indicator when something is wrong instead of remaining green.
- **Minimum Reporting Interval**: The interval configuration now enforces a 5-minute minimum via JSON Schema validation, matching Windy's rate limit of one observation per 5 minutes per station.
- **Request Timeouts**: Both PUT and GET requests to Windy now have a 30-second timeout, preventing hanging requests on slow satellite connections from delaying subsequent reporting cycles.
- **Async Reporting Engine**: The `reportToWindy` function is now `async/await` based, replacing fire-and-forget promise chains with sequential execution. This ensures correct ordering of the PUT and GET within each reporting cycle.
- **Terminology Corrections**: Replaced "displacement" with "distance from baseline" in comments and debug log messages to avoid confusion with the marine term for hull displacement.

## [1.1.1] - 2026-01-26

### Added
- **Asset Bundling**: Updated `package.json` to include screenshots and icons in the npm package for better visibility in the Signal K App Store.
- **Enhanced Documentation**: Expanded the README with a Project Purpose, Prerequisites, and a detailed Mapped Data Paths table including internal API keys.

## [1.1.0] - 2026-01-26

### Added
- **Radius-Based Displacement Logic**: Refactored the Movement Guard to use a radius calculation (distance from the last reported point) instead of cumulative distance, preventing "anchor swing" from triggering unnecessary GPS updates.
- **Station Identity Metadata**: Added `operator_text` to the metadata payload, mapping it to the Station Name for better visibility on Windy.
- **UI Schema Integration**: Introduced a dedicated `uiSchema` to separate visual presentation (help text, widget types) from the data validation logic.
- **Enhanced Observation Diagnostics**: Refined the `.catch` block for weather reports to log specific HTTP status codes and error responses from Windy, assisting in debugging "Windy Observation Errors".

### Fixed
- **Double Description UI Bug**: Resolved an issue where help text for "Force GPS Updates" and "Share Option" appeared twice in the Signal K settings.
- **Layout Alignment**: Moved all descriptive legends into the `uiSchema` to ensure they render cleanly only under their respective fields.

### Changed
- **Metadata Key Update**: Updated the `station_type` parameter in the metadata `PUT` payload to ensure compatibility with the latest Windy API v2 requirements.
- **Refined Dashboard Status**: Improved the live heartbeat display to show a combined view of the last successful sensor data, current displacement (Delta), and the reporting countdown.
- **Share Option Formatting**: Updated the `shareOption` legend into a concatenated string to describe Public, Windy-only, and Private data policies in the user interface.

## [1.0.9] - 2026-01-26

### Fixed
- **Pressure Parameter**: Corrected the observation parameter name to `pressure` for Windy API v2 compliance. Updated documentation to match.

## [1.0.8] - 2026-01-26

### Added
- **Live Heartbeat Countdown**: Added a 1-second interval status timer that displays a live "Next report in" countdown and accumulated distance directly on the Signal K dashboard.
- **Persistent Dashboard Telemetry**: Updated the status display to maintain the last-submitted weather data string visible throughout the countdown cycle.
- **PUT Payload Logging**: Added an `app.debug` message to output the full JSON metadata payload into the server log immediately before transmission for easier verification.

### Changed
- **API v2 Privacy Key**: Updated the metadata `PUT` payload to use the `share_option` key for privacy settings as required by the Windy API v2 validator.
- **Strict Data Formatting**: Enforced integer rounding for elevation (`elev_m`) and sensor heights (`agl_temp`, `agl_wind`) to prevent API rejection.
- **Unit Precision**: Standardized weather observation values to one decimal place (`toFixed(1)`) for better data consistency.
- **Dynamic Peak Gust Selection**: Improved logic to prioritize the tracked 1Hz peak gust over the Signal K path if the tracked value is higher.

### Fixed
- **Status Reporting Persistence**: Refined the heartbeat logic to ensure the countdown accurately reflects the `nextRunTime` persisted in the `state.json` file after a server restart.
- **Directory Initialization**: Added recursive directory creation for the state file to prevent crashes on fresh installations.

## [1.0.7] - 2026-01-26

### Added
- **Detailed PUT Diagnostics**: Improved error handling for station metadata updates. The plugin now logs the specific HTTP status code and the full JSON error response from Windy's API.
- **Explicit API Headers**: Added `Content-Type: application/json` to the metadata `PUT` request to ensure strict compliance with Windy API v2 requirements.
- **Movement Guard Debugging**: Added debug logging to track accumulated distance (in meters) since the last successful map update.

### Changed
- **GPS Coordinate Precision**: Latitude and longitude are now rounded to exactly **5 decimal places** before transmission.
- **Type Safety**: Coordinates are explicitly cast to numeric types (`Number`) to prevent API rejection caused by string formatting.

### Fixed
- **Metadata Update Failures**: Resolved issues where metadata updates were ignored or rejected due to missing JSON headers or excessive coordinate precision.
- **Neutral tone in README.md**: Reviewed text for proper grammar.

## [1.0.6] - 2026-01-26

### Added
- **Persistent State Management**: Implemented an independent `state.json` file in the Signal K data directory. This ensures that movement tracking (`currentDistance`), the reporting timer (`nextRunTime`), and the last known position are preserved across server restarts.
- **"Gap Closer" Peak Gust Tracking**: Added a 1Hz background subscription to wind speed. The plugin now captures and reports the highest wind speed observed between reporting intervals, ensuring short-lived gusts are not missed.
- **Startup "Warm-up" Delay**: Introduced a 15-second delay upon plugin start. This allows the Signal K data tree to fully populate from NMEA/Seatalk sensors before the first report is attempted, preventing empty data transmissions.
- **Diagnostic Logging**: Migrated critical submission logs to `console.log` to ensure visibility in the main Signal K Server Log without requiring specific debug keys to be enabled.

### Changed
- **Status Reporting**: Updated the dashboard status logic to show "Warming up (15s)..." on restart and "Waiting for sensor data" if the Signal K tree is empty, rather than showing empty brackets `[]`.
- **Movement Guard Precision**: Refined distance calculations using Equirectangular projection (Cheap Ruler) with a latitude scaling factor (`kx`) for better accuracy across different geographical regions.
- **Unit Conversions**: Hardened the conversion logic for Kelvin to Celsius and Pascal to hPa to handle null or invalid sensor paths gracefully.

### Fixed
- Fixed an issue where the plugin would report empty brackets `[]` immediately following a Signal K restart.
- Fixed a race condition where the reporting timer would reset to the full interval on every restart regardless of previous state.

## [1.0.5] - 2026-01-26

### Fixed
- **Startup Crash**: Resolved `app.getDataDirPath is not a function` error by deferring path resolution until the plugin `start()` lifecycle event.
- **State Persistence**: Relocated state file path initialization to ensure Signal K helper functions are fully available before use.

## [1.0.4] - 2026-01-26

### Fixed
* **State Persistence Conflict**: Resolved a race condition where the plugin's internal state updates (position, distance, and timers) could overwrite user configuration settings (API keys, credentials) during server restarts or configuration changes.
* **Separation of Concerns**: Migrated internal plugin state (GPS tracking and reporting schedule) to a dedicated `state.json` file in the plugin's data directory, independent of the main Signal K `settings.json` file.

## [1.0.3] - 2026-01-25

### Added
* **API v2 Compliance**: Fully transitioned to the separate **GET** (observations) and **PUT** (station metadata) architecture required by the Windy Stations API v2.
* **Enhanced Status Display**: Added a real-time sensor flag readout (e.g., `[W|G|D|T|P|H]`) to the plugin status, indicating which data types were successfully transmitted.
* **Metadata Restoration**: Restored the `operator_url` field to allow public links to be displayed on station pages.
* **Strict Descriptive Text**: Updated all schema descriptions to remove conversational language and improve technical clarity.

### Changed
* **Data Sharing Descriptions**: Updated `shareOption` text to precisely define the "Aggregator Open Data License" for public stations and internal usage for private ones.
* **Endpoint Routing**: Replaced the legacy monolithic `POST` endpoint with the new v2-specific observation and management URLs.

### Fixed
* **Position Update Reliability**: Corrected an issue where boat positions would not update on the map due to API v1 legacy payloads being used in a v2 environment.
* **Unit Conversion Validation**: Re-verified and locked mathematical conversions for Pressure (Pa to hPa), Temperature (K to °C), and Humidity (Ratio to %).

## [1.0.2] - 2026-01-25

### Added
- **Movement Guard**: Implemented Equirectangular (Cheap Ruler) projection logic to track vessel movement.
- **State Persistence**: Added logic to save `currentDistance` and `nextRunTime` to `settings.json` so reporting resumes accurately after a restart.
- **Force Update Toggle**: Added a configuration option to bypass the movement guard and send GPS data on every interval.

### Fixed
- **UI Persistence**: Corrected the JSON schema structure (nested properties) to fix the bug where configuration fields appeared blank upon page refresh.
- **Unit Conversions**: 
  - Barometric pressure now correctly converts from Pa to hPa.
  - Humidity now correctly converts from ratio (0..1) to percentage (0..100).
- **Identity Sync**: Aligned `plugin.id` with `package.json` to ensure Signal K correctly maps settings and state.

### Changed
- **Schema Documentation**: Rewrote all UI descriptions to a neutral, third-person professional standard, removing all "you/your" phrasing.
- **Performance**: Optimized position subscription to use the Cheap Ruler scaler (`kx`) to minimize trig calculations.

### Maintenance
- **Diagnostic Documentation**: Expanded the `README.md` with a comprehensive Troubleshooting section, including `journalctl` diagnostic commands, detailed log event explanations, and status message definitions.
- **Support Workflows**: Formalized diagnostic reporting procedures to assist users in providing clean, redacted log summaries for troubleshooting.

## [1.0.1] - 2026-01-25
### Added
- **State Persistence Layer**: Integrated native Signal K persistence using `app.savePluginOptions` and `app.readPluginOptions` to store the plugin's operational state (last position, distance, and timer) across server reboots.
- **Resume-Aware Timer**: Developed a "Next Run" timestamp logic that calculates the remaining interval time upon restart, allowing the plugin to resume its countdown exactly where it left off rather than resetting.
- **Vessel Tracking Continuity**: Persists `currentDistance` and `lastSentPos` to the server's configuration file, ensuring the Movement Guard maintains accurate tracking and does not lose accumulated travel distance after a power cycle.
- **Dynamic Status Feedback**: Added a "Resuming countdown" status message to the dashboard to provide immediate user feedback following a plugin restart.

### Changed
- **Async Logic Flow**: Transitioned from a standard `setInterval` to a recursive `setTimeout` paired with a persisted `nextRunTime` to support smart resumption logic.
- **Documentation Refinement**: Updated the "Pro Tips" section in `README.md` to explain persistence and ensured all second-person pronouns were removed to maintain a professional, neutral tone.

---

## [1.0.0] - 2026-01-24 (Gold Release)
### Added
- **Production Standard**: Official release of the Windy API v2 Reporter, graduating from draft concepts to a validated production-grade tool.
- **Dual-Mode API Support**: Implemented the required Windy v2 protocol using GET for telemetry (observations) and PUT for station metadata and location syncing.
- **Movement Guard Engine**: Introduced logic to calculate planar distance between coordinates, updating the map pin only when the vessel exceeds the defined movement threshold (default 300m).
- **Telemetry Data Map**: Created a high-resolution status display with a sensor legend `[T|W|G|D|P|H]` to indicate which data points were successfully bundled in the last request.
- **Flexible Path Mapping**: Added `pathMap` configuration to allow users to override default Signal K paths for wind, temperature, pressure, and humidity.

### Changed
- **Native m/s Integrity**: Standardized all wind speed and gust reporting to utilize Signal K's native meters-per-second metric, ensuring 1:1 accuracy without rounding errors from unit conversion.
- **Privacy Controls**: Standardized "Share Options" to allow users to explicitly choose between Public (Open Data) and Private (Windy Only) visibility.

### Security
- **Credential Masking**: Forced sensitive fields (`apikey`, `password`) to use the `password` format in the HTML schema to prevent shoulder-surfing and browser autocomplete exposure.

### Fixed
- **Temperature Unit Correction**: Fixed a mapping error where temperature was being reported in Kelvin; values are now correctly converted to Celsius for Windy compatibility.
- **GPS Fix Validation**: Added checks to prevent the plugin from attempting transmissions when valid navigation coordinates are unavailable, displaying a `Waiting for GPS fix` status instead.

---

## [0.1.0] - 2026-01-23 (Beta Phase)
### Added
- **Core Specification**: Defined the initial data mapping between Signal K paths and Windy PWS variables (wind, gust, temp, baro, rh).
- **Identity Logic**: Established the first schema for vessel name and type as it appears on the Windy station list.
- **API Proof of Concept**: Validated basic GET requests to Windy's `/pws/update/` endpoint using standard station credentials.
- **Dynamic Location Foundation**: Developed the initial code for handling "moving" stations (Boats/Vessels) within the Windy ecosystem.

[Unreleased]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.6.0...HEAD
[1.6.3]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.5.2...v1.6.0
[1.5.2]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.9...v1.1.0
[1.0.9]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v0.1.0...v1.0.0
