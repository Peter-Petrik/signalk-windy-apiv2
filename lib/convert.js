/*
 * Conversion: from the latest Signal K readings to the fields of a Windy
 * observation.
 *
 * Signal K stores values in base units (m/s, radians, kelvin, pascal, ratio).
 * Windy expects m/s, whole degrees, degrees Celsius, pascal and percent.
 *
 * A reading is used only when it passes three checks. It has to be recent
 * (see lib/readings.js). It has to be a finite number, because a sensor path
 * can hold a string or an object, and a single such value used to end the
 * reporting loop. After conversion and rounding it has to lie inside the
 * range Windy documents for the field, because Windy rejects the whole
 * observation when one field is out of range (confirmed on a test station,
 * 2026-10-10). The value checked is the value sent: a humidity of 100.4 %
 * is sent as 100 and is accepted. A
 * reading that fails a check is left out and named in the debug log; the
 * other readings are still reported.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

// Ranges from Windy's Stations API specification, in the units Windy expects.
// Wind direction is not listed: it is normalised into 0 to 359 instead.

// A wind direction in radians lies between -2π and 2π. A value beyond that
// is not an angle in radians, for example an angle in degrees published
// without conversion, and folding it into 0 to 359 would report a direction
// that no instrument measured. The margin allows for rounding at 2π.
const MAX_DIRECTION_RAD = 2 * Math.PI + 0.01
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

const minutes = (ms) => Math.round(ms / 60000)

/**
 * Builds the observation fields from the latest readings.
 *
 *   readings  the store of lib/readings.js
 *   pathMap   the six sensor paths, already resolved to defaults
 *   peakGust  the highest wind speed seen since the last report, in m/s
 *   nowMs     the current time
 *   maxAgeMs  the age beyond which a reading is stale; 0 for no limit
 *   debug     function receiving one line per reading that was left out
 *
 * Returns { fields, leftOut, missingPaths }:
 *
 *   fields        only the fields that have a usable value. The value types
 *                 are the ones the request and the dashboard line were built
 *                 around: wind, gust and temp as strings with one decimal;
 *                 winddir, pressure and rh as whole numbers.
 *   leftOut       the names of the fields for which a reading exists but was
 *                 not used: too old, not a number, or outside Windy's range.
 *                 The dashboard marks these, so that a missing value is not
 *                 mistaken for a sensor the vessel does not have.
 *   missingPaths  the paths without a usable reading, in the order of the
 *                 dashboard line. The gust path is not among them: few
 *                 vessels publish one, and the gust then comes from the wind
 *                 speed.
 */
function buildObservation (readings, pathMap, peakGust, nowMs, maxAgeMs, debug) {
  const fields = {}
  const leftOut = []
  const missingPaths = []

  /**
   * The number on a path, or undefined. `problem` says why there is none:
   * 'none' when nothing usable has arrived, 'leftOut' when a reading exists
   * and was rejected.
   */
  const number = (skPath) => {
    const reading = readings.read(skPath, nowMs, maxAgeMs)
    if (reading.state === 'none') return { problem: 'none' }
    if (reading.state === 'stale') {
      debug(reading.timedOut
        ? `Reading ignored: the Signal K server reports that ${skPath} has timed out`
        : `Reading ignored: ${skPath} was last updated ${minutes(reading.ageMs)} minutes ago`)
      return { problem: 'leftOut' }
    }
    if (!isNumber(reading.value)) {
      debug(`Reading ignored: ${skPath} holds ${JSON.stringify(reading.value)}, which is not a number`)
      return { problem: 'leftOut' }
    }
    return { value: reading.value }
  }

  /** Checks a converted value against Windy's range for the field. */
  const accepted = (field, value, skPath) => {
    if (inRange(field, value)) return true
    debug(`Reading ignored: ${skPath} gives ${field}=${value}, outside Windy's range ${RANGES[field][0]} to ${RANGES[field][1]}`)
    return false
  }

  const same = (value) => value
  const oneDecimal = (value) => value.toFixed(1)
  const whole = (value) => Math.round(value)

  /**
   * Reads, converts, rounds and range-checks one field. Returns the value as
   * it is sent, or undefined.
   */
  const field = (name, skPath, convert, round) => {
    const read = number(skPath)
    if (read.value !== undefined) {
      const sent = round(convert(read.value))
      if (accepted(name, Number(sent), skPath)) return sent
      read.problem = 'leftOut'
    }
    if (read.problem === 'leftOut') leftOut.push(name)
    return undefined
  }

  const wind = field('wind', pathMap.windSpeed, same, oneDecimal)
  if (wind === undefined) missingPaths.push(pathMap.windSpeed)
  else fields.wind = wind

  // Gust: the sensor's own gust value, unless the highest wind speed seen
  // since the last report is higher or the sensor provides no gust at all.
  // Most instruments publish no gust path, and a 5-minute report would
  // otherwise miss every short peak. A gust is never reported below the wind
  // speed sent with it: by definition it is the highest speed of the period.
  // The peak comes from samples that passed the wind range, and the wind is
  // within it, so neither can take the gust outside the gust range.
  const gustPath = field('gust', pathMap.windGust, same, oneDecimal)
  let gust = gustPath === undefined ? undefined : Number(gustPath)
  if (isNumber(peakGust) && peakGust > (gust || 0)) gust = peakGust
  if (gust !== undefined && wind !== undefined && gust < Number(wind)) gust = Number(wind)
  if (gust !== undefined) {
    fields.gust = oneDecimal(gust)
    // A usable gust was found after all, so nothing is missing from the line.
    const marked = leftOut.indexOf('gust')
    if (marked !== -1) leftOut.splice(marked, 1)
  }

  // Direction: radians to whole degrees, folded into 0 to 359. Rounding can
  // produce exactly 360 for a value just below 2π, which Windy rejected in
  // March 2026, and a source may publish a negative angle, which is outside
  // the range Windy documents.
  const direction = number(pathMap.windDir)
  if (direction.value !== undefined && Math.abs(direction.value) > MAX_DIRECTION_RAD) {
    debug(`Reading ignored: ${pathMap.windDir} holds ${direction.value}, which is not an angle in radians`)
    direction.value = undefined
    direction.problem = 'leftOut'
  }
  if (direction.value !== undefined) {
    const degrees = Math.round((direction.value * 180) / Math.PI)
    fields.winddir = ((degrees % 360) + 360) % 360
  } else {
    if (direction.problem === 'leftOut') leftOut.push('winddir')
    missingPaths.push(pathMap.windDir)
  }

  const temp = field('temp', pathMap.temp, (kelvin) => kelvin - 273.15, oneDecimal)
  if (temp === undefined) missingPaths.push(pathMap.temp)
  else fields.temp = temp

  // Pressure is passed through: Signal K stores pascal and Windy expects pascal.
  const pressure = field('pressure', pathMap.pressure, same, whole)
  if (pressure === undefined) missingPaths.push(pathMap.pressure)
  else fields.pressure = pressure

  // Humidity: ratio to percent, with the second standard path as a fallback.
  let rh
  let humidityLeftOut = false
  for (const skPath of humidityPaths(pathMap.humidity)) {
    const read = number(skPath)
    if (read.value !== undefined && accepted('rh', whole(read.value * 100), skPath)) {
      rh = whole(read.value * 100)
      break
    }
    if (read.value !== undefined || read.problem === 'leftOut') humidityLeftOut = true
  }
  if (rh !== undefined) {
    fields.rh = rh
  } else {
    if (humidityLeftOut) leftOut.push('rh')
    missingPaths.push(pathMap.humidity)
  }

  return { fields, leftOut, missingPaths }
}

/**
 * The paths humidity is read from: the configured one, and the other
 * standard path when the configured one is one of the two.
 */
function humidityPaths (configured) {
  const paths = [configured]
  if (HUMIDITY_PATHS.includes(configured)) {
    paths.push(HUMIDITY_PATHS.find((p) => p !== configured))
  }
  return paths
}

/**
 * Formats the observation fields for the one-line dashboard status.
 *
 * No units, to stay inside the width of the dashboard: wind and gust in
 * knots, pressure in kilopascal, the rest as sent. A field that has a reading
 * which was left out is shown with a dash. Example:
 * "W:23.9 G:29.7 D:314 T:9.0 P:100.8 H:-"
 */
function dashboardText (fields, leftOut = []) {
  const parts = []
  const show = (label, name, format) => {
    if (fields[name] !== undefined) parts.push(`${label}:${format(fields[name])}`)
    else if (leftOut.includes(name)) parts.push(`${label}:-`)
  }
  const asIs = (value) => value
  show('W', 'wind', (v) => (v * 1.94384).toFixed(1))
  show('G', 'gust', (v) => (v * 1.94384).toFixed(1))
  show('D', 'winddir', asIs)
  show('T', 'temp', asIs)
  show('P', 'pressure', (v) => (v / 1000).toFixed(1))
  show('H', 'rh', asIs)
  return parts.join(' ')
}

/**
 * The dashboard text for a cycle in which nothing could be sent: the first
 * path without a usable reading, and how many more there are. Example:
 * "No data: environment.wind.speedOverGround +4"
 */
function noDataText (missingPaths) {
  const more = missingPaths.length - 1
  return `No data: ${missingPaths[0]}${more > 0 ? ` +${more}` : ''}`
}

module.exports = { buildObservation, dashboardText, noDataText, humidityPaths, isNumber, inRange, RANGES, HUMIDITY_PATHS, MAX_DIRECTION_RAD }
