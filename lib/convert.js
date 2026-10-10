/*
 * Readings: from Signal K values to the fields of a Windy observation.
 *
 * Signal K stores values in base units (m/s, radians, kelvin, pascal, ratio).
 * Windy expects m/s, whole degrees, degrees Celsius, pascal and percent.
 *
 * Every reading is checked twice before it is used. It has to be a finite
 * number, because a sensor path can hold null, a string or an object, and a
 * single such value used to end the reporting loop. After conversion it has
 * to lie inside the range Windy documents for the field, because Windy
 * rejects the whole observation when one field is out of range (confirmed on
 * a test station, 2026-10-10). A reading that fails either check is left out
 * and named in the debug log; the other readings are still reported.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

// Ranges from Windy's Stations API specification, in the units Windy expects.
// Wind direction is not listed: it is normalised into 0 to 359 instead.
const RANGES = {
  wind: [0, 200],
  gust: [0, 300],
  temp: [-100, 100],
  pressure: [50000, 150000],
  rh: [0, 100]
}

// The Signal K specification names the outside humidity path `humidity`, and
// Signal K's own NMEA 0183 and NMEA 2000 converters publish there. Versions
// of this plugin before 1.5.2 read `relativeHumidity`. When the configured
// path is one of the two and holds no value, the other one is tried, so that
// neither a standard instrument nor an existing setup loses humidity.
const HUMIDITY_PATHS = ['environment.outside.humidity', 'environment.outside.relativeHumidity']

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const inRange = (field, value) => value >= RANGES[field][0] && value <= RANGES[field][1]

/**
 * Reads one path from the Signal K data tree.
 *
 * Returns the number stored there, or undefined when the path is absent,
 * holds null, or holds something that is not a finite number. The last case
 * is reported through `debug`, because it points at a misbehaving source.
 */
function readNumber (app, skPath, debug) {
  const node = app.getSelfPath(skPath)
  if (node === undefined || node === null) return undefined
  const value = typeof node === 'object' ? node.value : node
  if (value === undefined || value === null) return undefined
  if (!isNumber(value)) {
    debug(`Reading ignored: ${skPath} holds ${JSON.stringify(value)}, which is not a number`)
    return undefined
  }
  return value
}

/**
 * Builds the observation fields from the current Signal K values.
 *
 *   app       the Signal K app object
 *   pathMap   the six sensor paths, already resolved to defaults
 *   peakGust  the highest wind speed seen since the last report, in m/s
 *   debug     function receiving one line per reading that was left out
 *
 * Returns an object holding only the fields that have a usable value. The
 * value types are the ones the request and the dashboard line were built
 * around: wind, gust and temp as strings with one decimal; winddir, pressure
 * and rh as whole numbers.
 */
function buildObservation (app, pathMap, peakGust, debug) {
  const fields = {}

  // Keeps a converted reading only when Windy would accept it.
  const keep = (field, value, skPath, format) => {
    if (value === undefined) return
    if (!inRange(field, value)) {
      debug(`Reading ignored: ${skPath} gives ${field}=${value}, outside Windy's range ${RANGES[field][0]} to ${RANGES[field][1]}`)
      return
    }
    fields[field] = format(value)
  }

  const oneDecimal = (value) => value.toFixed(1)

  keep('wind', readNumber(app, pathMap.windSpeed, debug), pathMap.windSpeed, oneDecimal)

  // Gust: the sensor's own gust value, unless the highest wind speed seen
  // since the last report is higher or the sensor provides no gust at all.
  // Most instruments publish no gust path, and a 5-minute report would
  // otherwise miss every short peak.
  let gust = readNumber(app, pathMap.windGust, debug)
  if (gust !== undefined && !inRange('gust', gust)) {
    debug(`Reading ignored: ${pathMap.windGust} gives gust=${gust}, outside Windy's range ${RANGES.gust[0]} to ${RANGES.gust[1]}`)
    gust = undefined
  }
  if (isNumber(peakGust) && peakGust > (gust || 0)) gust = peakGust
  keep('gust', gust, pathMap.windGust, oneDecimal)

  // Direction: radians to whole degrees, folded into 0 to 359. Rounding can
  // produce exactly 360 for a value just below 2π, which Windy rejected in
  // March 2026, and a source may publish a negative angle, which is outside
  // the range Windy documents.
  const direction = readNumber(app, pathMap.windDir, debug)
  if (direction !== undefined) {
    const degrees = Math.round((direction * 180) / Math.PI)
    fields.winddir = ((degrees % 360) + 360) % 360
  }

  const kelvin = readNumber(app, pathMap.temp, debug)
  keep('temp', kelvin === undefined ? undefined : kelvin - 273.15, pathMap.temp, oneDecimal)

  // Pressure is passed through: Signal K stores pascal and Windy expects pascal.
  keep('pressure', readNumber(app, pathMap.pressure, debug), pathMap.pressure, Math.round)

  // Humidity: ratio to percent, with the second standard path as a fallback.
  const humidityPaths = [pathMap.humidity]
  if (HUMIDITY_PATHS.includes(pathMap.humidity)) {
    humidityPaths.push(HUMIDITY_PATHS.find((p) => p !== pathMap.humidity))
  }
  for (const skPath of humidityPaths) {
    const ratio = readNumber(app, skPath, debug)
    if (ratio === undefined) continue
    keep('rh', ratio * 100, skPath, Math.round)
    break
  }

  return fields
}

/**
 * Formats the observation fields for the one-line dashboard status.
 *
 * No units, to stay inside the width of the dashboard: wind and gust in
 * knots, pressure in kilopascal, the rest as sent. Example:
 * "W:23.9 G:29.7 D:314 T:9.0 P:100.8 H:65"
 */
function dashboardText (fields) {
  const parts = []
  if (fields.wind !== undefined) parts.push(`W:${(fields.wind * 1.94384).toFixed(1)}`)
  if (fields.gust !== undefined) parts.push(`G:${(fields.gust * 1.94384).toFixed(1)}`)
  if (fields.winddir !== undefined) parts.push(`D:${fields.winddir}`)
  if (fields.temp !== undefined) parts.push(`T:${fields.temp}`)
  if (fields.pressure !== undefined) parts.push(`P:${(fields.pressure / 1000).toFixed(1)}`)
  if (fields.rh !== undefined) parts.push(`H:${fields.rh}`)
  return parts.join(' ')
}

module.exports = { buildObservation, dashboardText, isNumber, inRange, RANGES, HUMIDITY_PATHS }
