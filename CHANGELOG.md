# Changelog

All notable changes to the Signal K Windy API v2 Reporter will be documented in this file.

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

[Unreleased]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Peter-Petrik/signalk-windy-apiv2/compare/v0.1.0...v1.0.0