/*
 * Windy: the two requests of the Stations API v2, and what their answers mean.
 *
 *   PUT /api/v2/pws/{id}             the station record: name, position,
 *                                    sensor heights. Authenticated with the
 *                                    Global API Key in the `windy-api-key`
 *                                    header. Replaces the whole record.
 *   GET /api/v2/observation/update   one weather observation. Authenticated
 *                                    with the Station Password as a Bearer
 *                                    token, which keeps the secret out of the
 *                                    request URL and out of proxy logs.
 *
 * The meaning of each answer below was confirmed against the live API with a
 * test station on 2026-10-10.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

const axios = require('axios')

const BASE_URL = 'https://stations.windy.com/api/v2'
const TIMEOUT_MS = 30000

// A 429 names the moment the next observation is accepted. Windy's window is
// 5 minutes, so anything further away than 10 minutes is not believed.
const MAX_RETRY_DELAY_MS = 600000

/**
 * Builds the body of a station update.
 *
 * Windy replaces the whole record on every update and offers no way to send a
 * position alone, so every field is sent every time. The operator logo is
 * deliberately not among them.
 */
function stationPayload (options, position, elevation) {
  return {
    name: options.stationName,
    share_option: options.shareOption,
    lat: Number(position.latitude.toFixed(5)),
    lon: Number(position.longitude.toFixed(5)),
    elev_m: elevation, // Windy rejects an elevation that is not a whole number
    agl_wind: options.agl_wind, // Windy requires at least one of the two sensor heights
    agl_temp: options.agl_temp,
    station_type: options.station_type,
    operator_text: options.stationName,
    operator_url: options.operator_url
  }
}

/** Sends the station record. Rejects with the axios error on any failure. */
function updateStation (options, payload) {
  return axios.put(`${BASE_URL}/pws/${encodeURIComponent(options.stationId)}`, payload, {
    headers: {
      'windy-api-key': options.apiKey,
      'Content-Type': 'application/json'
    },
    timeout: TIMEOUT_MS
  })
}

/** Sends one observation. Rejects with the axios error on any failure. */
function sendObservation (options, fields, timestampSeconds) {
  // Only values that are not secret go into the query string.
  const query = new URLSearchParams({ id: options.stationId, ts: timestampSeconds, ...fields }).toString()
  return axios.get(`${BASE_URL}/observation/update?${query}`, {
    headers: { Authorization: `Bearer ${options.stationPassword}` },
    timeout: TIMEOUT_MS
  })
}

const bodyText = (data) => (typeof data === 'string' ? data : JSON.stringify(data || ''))

/**
 * Explains a failed station update.
 *
 * Returns { log, dashboard }. `dashboard` is null for a failure that needs no
 * attention: an error without an HTTP answer is a network failure (DNS, TLS,
 * timeout, reset), which is routine on a boat and clears on a later cycle.
 * An HTTP answer means Windy refused the request, and that does not clear by
 * itself.
 */
function describeStationError (err) {
  if (!err.response) {
    return { log: `Windy Metadata Error (network): ${err.message}`, dashboard: null }
  }
  const status = err.response.status
  const log = `Windy Metadata Error (${status}): ${JSON.stringify(err.response.data)}`
  // 403 "Forbidden resource": the API key is wrong or missing.
  if (status === 403) {
    return { log, dashboard: 'Windy rejected the Global API Key (403) — verify the Global API Key in the plugin configuration' }
  }
  // 404 "PWS not found": no station has this ID. In May 2026 Windy still
  // answered 403 here as well.
  if (status === 404) {
    return { log, dashboard: 'Windy does not know this Station ID (404) — verify the Station ID in the plugin configuration' }
  }
  return { log, dashboard: `Metadata update failed (${status})` }
}

/**
 * Explains a failed observation.
 *
 * Returns { kind, log, dashboard, retryDelayMs }:
 *
 *   rateLimit  429. Expected after a restart, when the plugin's schedule and
 *              Windy's 5-minute window are not aligned. `retryDelayMs` is the
 *              wait until the moment Windy names, or null when the answer
 *              names none that can be believed.
 *   duplicate  409. Windy already holds an observation with this time. The
 *              data is there, so nothing is wrong and nothing is retried.
 *   network    no HTTP answer. Routine at sea; the next cycle tries again.
 *   api        any other HTTP answer. Windy refused the observation.
 */
function describeObservationError (err, now) {
  if (!err.response) {
    return { kind: 'network', log: `Windy Observation Error (network): ${err.message}`, dashboard: null, retryDelayMs: null }
  }

  const status = err.response.status
  const data = err.response.data

  if (status === 429) {
    // `retry_after` is a point in time (ISO 8601), not a number of seconds.
    let retryDelayMs = null
    const retryAfter = data && data.retry_after
    if (retryAfter) {
      const delay = new Date(retryAfter).getTime() - now
      if (Number.isFinite(delay) && delay > 0 && delay <= MAX_RETRY_DELAY_MS) retryDelayMs = delay
    }
    return { kind: 'rateLimit', log: null, dashboard: null, retryDelayMs }
  }

  if (status === 409) {
    return { kind: 'duplicate', log: null, dashboard: null, retryDelayMs: null }
  }

  const detail = `Status ${status}: ${JSON.stringify(data)}`
  const log = `Windy Observation Error: ${detail}`
  const text = bodyText(data)

  // Windy answers 400 to a rejected Station Password, never 401 or 403, and
  // tells two cases apart in the message. The checks look for a few words and
  // not the whole sentence, so that a small rewording on Windy's side does
  // not turn a clear message back into a generic one.
  if (status === 400 && /does not match/i.test(text) && /station/i.test(text)) {
    // "Provided password does not match with station id"
    return { kind: 'api', log, dashboard: 'Station ID and Station Password do not belong together — verify both in the plugin configuration', retryDelayMs: null }
  }
  if (status === 400 && /password/i.test(text)) {
    // "Provided password is invalid"
    return { kind: 'api', log, dashboard: 'Station Password rejected by Windy — verify the Station Password in the plugin configuration', retryDelayMs: null }
  }
  return { kind: 'api', log, dashboard: `Observation failed: ${detail}`, retryDelayMs: null }
}

module.exports = { stationPayload, updateStation, sendObservation, describeStationError, describeObservationError, BASE_URL, TIMEOUT_MS }
