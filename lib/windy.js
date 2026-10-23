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

const { version } = require('../package.json')

const BASE_URL = 'https://stations.windy.com/api/v2'
const TIMEOUT_MS = 30000

// Options shared by both requests.
//
//   maxRedirects 0      Windy's API does not redirect. On a redirect to
//                       another host, axios forwards every header except
//                       Authorization, Proxy-Authorization and Cookie, so
//                       the windy-api-key header would go with it. A
//                       redirect is reported as a failed request instead.
//   maxContentLength    Windy's answers are a few hundred bytes. A larger
//                       answer is an error page, which is not worth reading
//                       in full.
//   signal              axios's own timeout runs while the connection is
//                       idle, so an answer that trickles in byte by byte
//                       would keep the cycle waiting without end. The signal
//                       ends the request after TIMEOUT_MS whatever happens.
const MAX_ANSWER_BYTES = 65536
const requestOptions = () => ({
  timeout: TIMEOUT_MS,
  maxRedirects: 0,
  maxContentLength: MAX_ANSWER_BYTES,
  signal: AbortSignal.timeout(TIMEOUT_MS)
})

// Sent with every observation in the `softwaretype` field of Windy's API, so
// that Windy can tell which stations report through this plugin.
const SOFTWARE = `signalk-windy-apiv2/${version}`

// A 429 names the moment the next observation is accepted. Windy's window is
// 5 minutes, so anything further away than 10 minutes is not believed.
const MAX_RETRY_DELAY_MS = 600000

// The retry is made this long after the moment Windy names. A retry made
// exactly at that moment by a clock that runs slightly ahead of Windy's is
// refused again, and the second refusal names a moment that has already
// passed, which would cost a whole interval.
const RETRY_MARGIN_MS = 2000

// How much of an answer from Windy is shown on the dashboard and written to
// the log.
const DASHBOARD_TEXT = 200
const LOG_TEXT = 500

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
    // Rounded to the Position Precision setting: five decimals (about 1 m)
    // unless the owner has chosen a coarser position.
    lat: Number(position.latitude.toFixed(options.positionDecimals)),
    lon: Number(position.longitude.toFixed(options.positionDecimals)),
    elev_m: elevation, // Windy rejects an elevation that is not a whole number
    agl_wind: options.agl_wind, // Windy requires at least one of the two sensor heights
    agl_temp: options.agl_temp,
    station_type: options.station_type,
    operator_text: options.stationName,
    operator_url: options.operator_url
  }
}

/**
 * The settings the station record is built from, apart from the position
 * and an elevation taken from GNSS, as one string. When they differ from the
 * ones of the last update that succeeded, the record on Windy is out of
 * date. The string holds no secret: it is saved in the state file.
 */
function stationKey (options) {
  const parts = [
    options.stationId,
    options.stationName,
    options.shareOption,
    options.agl_wind,
    options.agl_temp,
    options.station_type,
    options.operator_url,
    options.elevation
  ]
  // The exact position leaves the key as versions without the setting wrote
  // it, so that an update to this version sends no station record. Any
  // other precision is part of the key, so that choosing it does.
  if (options.positionDecimals !== 5) parts.push(`position:${options.positionDecimals}`)
  return JSON.stringify(parts)
}

/** Sends the station record. Rejects with the axios error on any failure. */
function updateStation (options, payload) {
  return axios.put(`${BASE_URL}/pws/${encodeURIComponent(options.stationId)}`, payload, {
    ...requestOptions(),
    headers: {
      'windy-api-key': options.apiKey,
      'Content-Type': 'application/json'
    }
  })
}

/** Sends one observation. Rejects with the axios error on any failure. */
function sendObservation (options, fields, timestampSeconds) {
  // Only values that are not secret go into the query string.
  const query = new URLSearchParams({ id: options.stationId, ts: timestampSeconds, ...fields, softwaretype: SOFTWARE }).toString()
  return axios.get(`${BASE_URL}/observation/update?${query}`, {
    ...requestOptions(),
    headers: { Authorization: `Bearer ${options.stationPassword}` }
  })
}

const shorten = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text)

/**
 * An answer body as one line of text, at most `length` characters long. An
 * HTML page, which a proxy or a gateway sends in place of Windy's answer, is
 * named and not shown.
 */
function bodyText (data, length) {
  if (typeof data === 'string' && /<(!doctype|html|head|body)\b/i.test(data)) return '(HTML page)'
  return shorten(typeof data === 'string' ? data : JSON.stringify(data === undefined ? '' : data), length)
}

/**
 * Windy's own explanation in an answer body, or the body itself. Windy puts
 * it in `message`, as a string or as a list of strings.
 */
function messageText (data, length) {
  const message = data && typeof data === 'object' ? data.message : undefined
  if (typeof message === 'string' && message) return shorten(message, length)
  if (Array.isArray(message) && message.length > 0) return shorten(message.join('; '), length)
  return bodyText(data, length)
}

/**
 * Whether an HTTP answer means that Windy cannot be reached at the moment,
 * as opposed to Windy refusing the request: a gateway or proxy in front of
 * Windy that has no answer from it (502 to 599), or a request timeout (408).
 * Like a network failure, this clears by itself. A 500 is not among them,
 * because it may be caused by the request. None of these answers has been
 * seen from Windy; the codes are the ones gateways and proxies use.
 */
const isUnavailable = (status) => status === 408 || (status >= 502 && status <= 599)

/**
 * A failure without an HTTP answer, in words: the time limit, an answer too
 * large to read, or the network error itself. `reason` is the short form for
 * the dashboard.
 */
function failureWithoutAnswer (err) {
  if (err.code === 'ERR_CANCELED' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    return { reason: 'No answer from Windy', text: `no answer within ${TIMEOUT_MS / 1000} seconds` }
  }
  if (/maxContentLength/.test(err.message || '')) {
    return { reason: 'Answer from Windy too large', text: `answer larger than ${MAX_ANSWER_BYTES / 1024} KB` }
  }
  return { reason: 'No connection to Windy', text: err.message }
}

/** ": " and Windy's explanation, or nothing when the answer has no body. */
function explanation (data) {
  const text = messageText(data, DASHBOARD_TEXT)
  return text && text !== '""' ? `: ${text}` : ''
}

/**
 * Explains a failed station update.
 *
 * Returns { kind, log, dashboard }:
 *
 *   unreachable  no HTTP answer (DNS, TLS, timeout, reset), or an answer
 *                that says Windy is not available. Routine on a boat; a
 *                later cycle tries again. `dashboard` is the short reason
 *                shown as a plain status.
 *   refused      Windy refused the request. That does not clear by itself;
 *                `dashboard` is shown as an error until an update succeeds.
 */
function describeStationError (err) {
  if (!err.response) {
    const failure = failureWithoutAnswer(err)
    return { kind: 'unreachable', log: `Windy Metadata Error (network): ${failure.text}`, dashboard: failure.reason }
  }
  const status = err.response.status
  const data = err.response.data
  const log = `Windy Metadata Error (${status}): ${bodyText(data, LOG_TEXT)}`
  if (isUnavailable(status)) {
    return { kind: 'unreachable', log, dashboard: `Windy not available (${status})` }
  }
  // 403 "Forbidden resource": the API key is wrong or missing.
  if (status === 403) {
    return { kind: 'refused', log, dashboard: 'Windy rejected the Global API Key (403) — verify the Global API Key in the plugin configuration' }
  }
  // 404 "PWS not found": no station has this ID. In May 2026 Windy still
  // answered 403 here as well.
  if (status === 404) {
    return { kind: 'refused', log, dashboard: 'Windy does not know this Station ID (404) — verify the Station ID in the plugin configuration' }
  }
  return { kind: 'refused', log, dashboard: `Metadata update failed (${status})${explanation(data)}` }
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
 *   unreachable  no HTTP answer, or an answer that says Windy is not
 *                available. Routine at sea; the next cycle tries again.
 *                `dashboard` is the short reason shown as a plain status.
 *   refused      any other HTTP answer. Windy refused the observation;
 *                `dashboard` is shown as an error.
 */
function describeObservationError (err, now) {
  if (!err.response) {
    const failure = failureWithoutAnswer(err)
    return { kind: 'unreachable', log: `Windy Observation Error (network): ${failure.text}`, dashboard: failure.reason, retryDelayMs: null }
  }

  const status = err.response.status
  const data = err.response.data

  if (status === 429) {
    // `retry_after` is a point in time (ISO 8601), not a number of seconds.
    let retryDelayMs = null
    const retryAfter = data && data.retry_after
    if (retryAfter) {
      const delay = new Date(retryAfter).getTime() - now
      if (Number.isFinite(delay) && delay > 0 && delay <= MAX_RETRY_DELAY_MS) retryDelayMs = delay + RETRY_MARGIN_MS
    }
    return { kind: 'rateLimit', log: null, dashboard: null, retryDelayMs }
  }

  if (status === 409) {
    return { kind: 'duplicate', log: null, dashboard: null, retryDelayMs: null }
  }

  const log = `Windy Observation Error: Status ${status}: ${bodyText(data, LOG_TEXT)}`

  if (isUnavailable(status)) {
    return { kind: 'unreachable', log, dashboard: `Windy not available (${status})`, retryDelayMs: null }
  }

  // Windy answers 400 to a rejected Station Password, never 401 or 403, and
  // tells two cases apart in the message. The checks look for a few words and
  // not the whole sentence, so that a small rewording on Windy's side does
  // not turn a clear message back into a generic one.
  const text = messageText(data, LOG_TEXT)
  if (status === 400 && /does not match/i.test(text) && /station/i.test(text)) {
    // "Provided password does not match with station id"
    return { kind: 'refused', log, dashboard: 'Station ID and Station Password do not belong together — verify both in the plugin configuration', retryDelayMs: null }
  }
  if (status === 400 && /password/i.test(text)) {
    // "Provided password is invalid"
    return { kind: 'refused', log, dashboard: 'Station Password rejected by Windy — verify the Station Password in the plugin configuration', retryDelayMs: null }
  }
  return { kind: 'refused', log, dashboard: `Observation failed: Status ${status}${explanation(data)}`, retryDelayMs: null }
}

module.exports = { stationPayload, stationKey, updateStation, sendObservation, describeStationError, describeObservationError, BASE_URL, TIMEOUT_MS, SOFTWARE, RETRY_MARGIN_MS }
