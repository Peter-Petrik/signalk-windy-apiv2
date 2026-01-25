# Changelog

All notable changes to the Signal K Windy API v2 Reporter will be documented in this file.

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
- **UI Security**: Implemented password-type masking for the Global API Key and Station Password in the Signal K configuration UI.
- **Privacy Controls**: Standardized "Share Options" to allow users to explicitly choose between Public (Open Data) and Private (Windy Only) visibility.

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