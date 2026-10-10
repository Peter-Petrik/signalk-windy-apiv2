/*
 * Movement guard: how far the vessel is from the last position sent to Windy.
 *
 * The distance is a radius from that baseline, not the length of the track
 * sailed. A boat swinging at anchor stays inside the radius however long it
 * swings, so its position on the Windy map is left alone.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

// Metres per degree of latitude.
const METERS_PER_DEGREE = 111319

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/**
 * True for a Signal K position that can be used: an object with a latitude
 * and a longitude that are finite numbers inside their valid ranges. A GNSS
 * receiver without a fix can publish a position whose coordinates are null.
 */
function isValidPosition (position) {
  return Boolean(position) &&
    isNumber(position.latitude) && position.latitude >= -90 && position.latitude <= 90 &&
    isNumber(position.longitude) && position.longitude >= -180 && position.longitude <= 180
}

/**
 * Distance in metres between a baseline { lat, lon } and a Signal K position
 * { latitude, longitude }.
 *
 * Equirectangular approximation: longitude differences are scaled by the
 * cosine of the baseline latitude. Over the distances a movement threshold
 * covers, the error is far below the noise of a GNSS fix, and the calculation
 * runs once a second.
 */
function distanceMeters (baseline, position) {
  let dLon = position.longitude - baseline.lon
  // Across the 180° meridian the plain difference is close to 360°. The short
  // way round is the real one.
  if (dLon > 180) dLon -= 360
  if (dLon < -180) dLon += 360
  const dx = dLon * Math.cos(baseline.lat * Math.PI / 180)
  const dy = position.latitude - baseline.lat
  return Math.sqrt(dx * dx + dy * dy) * METERS_PER_DEGREE
}

module.exports = { isValidPosition, distanceMeters }
