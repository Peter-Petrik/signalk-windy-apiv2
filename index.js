/*
 * Signal K Windy API v2 Reporter
 * v1.6.2 - README names the Save Configuration button, transmission settings screenshot retaken
 * Reports data to Windy using separate observation (GET) and metadata (PUT) endpoints.
 * Includes Movement Guard and Independent State Persistence.
 *
 * Copyright (C) 2026 Peter Petrik
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * This file holds the plugin's lifecycle and its schedule: start, stop, the
 * countdown, and the order of the two requests in one reporting cycle. The
 * parts with no notion of time live in lib/:
 *
 *   lib/schema.js    the configuration form and the reading of saved settings
 *   lib/readings.js  the latest value of every subscribed path, with its age
 *   lib/convert.js   readings to observation fields, with range checks
 *   lib/movement.js  distance from the last position sent to Windy
 *   lib/state.js     loading and saving state.json
 *   lib/windy.js     the two requests and the meaning of Windy's answers
 */

'use strict'

const path = require('node:path')

const { schema, uiSchema, resolveOptions } = require('./lib/schema')
const { createReadings } = require('./lib/readings')
const { buildObservation, dashboardText, noDataText, humidityPaths, isNumber, inRange } = require('./lib/convert')
const { isValidPosition, distanceMeters } = require('./lib/movement')
const { loadState, saveState } = require('./lib/state')
const windy = require('./lib/windy')

// Signal K needs a moment after a start to receive its first sensor values.
const WARM_UP_MS = 15000

const POSITION_PATH = 'navigation.position'

// Where the station elevation comes from when the owner has set none.
const ALTITUDE_PATHS = ['navigation.gnss.antennaAltitude', 'navigation.altitude']

module.exports = function (app) {
  // Everything that belongs to one run of the plugin, from start() to stop().
  // null while the plugin is stopped or not configured.
  //
  // A new object is created on every start. Each timer and each request holds
  // on to the session it was started in and checks `session.active` before it
  // does anything further. That is what makes stop() final: a request that is
  // still on its way to Windy when the plugin is stopped comes back to a
  // session that is no longer active, and neither reschedules the cycle nor
  // touches the dashboard.
  let session = null

  // Kept across a restart of the plugin, so that the dashboard goes on showing
  // the last report while the countdown to the next one runs.
  let lastReportString = ''

  const plugin = {}
  plugin.id = 'signalk-windy-apiv2'
  plugin.name = 'Windy API v2 Reporter'
  plugin.description = 'Reports weather and position data to Windy.com API v2'
  plugin.schema = schema
  plugin.uiSchema = uiSchema

  // Resolved on use and not at load time: the data directory is known to the
  // app object only once the server has set the plugin up.
  const stateFile = () => path.join(app.getDataDirPath(), 'state.json')

  /** Saves the state of a session. A failure is logged and never thrown. */
  const persist = (s) => {
    try {
      saveState(stateFile(), s.state)
    } catch (err) {
      app.error(`Failed to save state file: ${err.message}`)
    }
  }

  /**
   * The second field of the dashboard line: the distance from the position
   * last sent to Windy, or "Forced" while Force GPS Updates is on. With that
   * setting on, the position is sent at every report whatever the distance,
   * and nothing else on the dashboard would show it.
   */
  const movementText = (s) => (s.options.forceUpdate ? 'Forced' : `Δ${Math.round(s.state.currentDistance)}m`)

  /**
   * Heartbeat: updates the dashboard status once a second with a countdown.
   * Format: "Next: XmXXs | Δ###m | W:## G:## D:### T:## P:### H:## | HH:MM"
   * Ordered by time-sensitivity: countdown first, sensor data in the middle,
   * time of the last report at the end, where a narrow dashboard cuts it off
   * first.
   */
  const updateHeartbeatStatus = (s, label) => {
    if (!s.active) return
    const remainingMs = s.state.nextRunTime - Date.now()
    if (remainingMs <= 0) return

    const min = Math.floor(remainingMs / 60000)
    const sec = Math.floor((remainingMs % 60000) / 1000)
    const heartbeat = `${label}: ${min}m${sec < 10 ? '0' : ''}${sec}s`

    // While the share option stops station updates, the reason takes the
    // place of the readings and is shown as an error. A status set as an
    // error is replaced by the next plain status, so it has to be repeated
    // with every heartbeat to stay visible.
    if (s.options.shareProblem) {
      app.setPluginError(`Station position not updated: ${s.options.shareProblem} | ${heartbeat}`)
      return
    }

    // After a cycle in which nothing could be sent, the line says which
    // reading is missing for as long as that lasts. The readings of an
    // earlier report would look like current weather.
    const detail = s.noData || lastReportString
    app.setPluginStatus(detail
      ? `${heartbeat} | ${movementText(s)} | ${detail}`
      : `${heartbeat} | ${movementText(s)}`)
  }

  /**
   * Arms the next reporting cycle `delayMs` from now and starts the countdown
   * that leads up to it.
   */
  const schedule = (s, delayMs, label) => {
    if (!s.active) return
    if (s.statusTimer) clearInterval(s.statusTimer)
    if (s.timer) clearTimeout(s.timer)

    s.state.nextRunTime = Date.now() + delayMs
    s.statusTimer = setInterval(() => updateHeartbeatStatus(s, label), 1000)
    s.timer = setTimeout(() => runCycle(s), delayMs)
  }

  /**
   * One reporting cycle, and whatever happens in it, the next one after it.
   *
   * The report is wrapped so that no error can end the loop. Before 1.5.2 a
   * single unexpected value, such as a position without coordinates, threw
   * inside the timer callback; the next cycle was never scheduled and the
   * plugin stayed silent until it was restarted.
   */
  const runCycle = async (s) => {
    if (!s.active) return
    clearInterval(s.statusTimer) // the countdown has reached zero

    let retryDelayMs = null
    try {
      retryDelayMs = await reportToWindy(s)
    } catch (err) {
      app.error(`Reporting cycle failed: ${err && err.stack ? err.stack : err}`)
      if (s.active) app.setPluginError(`Reporting cycle failed: ${err && err.message ? err.message : err}`)
    }

    if (!s.active) return
    // After a 429 the cycle is repeated at the moment Windy named, not a full
    // interval later.
    schedule(s, retryDelayMs || s.options.interval * 60000, 'Next')
    persist(s)
  }

  // --- LIFECYCLE ---

  plugin.start = function (settings) {
    // The server stops a plugin before it starts it again. Should a start
    // ever arrive without that stop, the earlier session must not go on
    // running next to the new one.
    if (session) plugin.stop()

    const options = resolveOptions(settings)

    // Without all three credentials nothing can be accepted by Windy. Nothing
    // is subscribed and nothing is scheduled, so no request leaves the
    // server. This is also the state of a plugin that has been enabled but
    // not filled in yet, and of every automated check that starts a plugin
    // with an empty configuration.
    if (options.missingCredentials.length > 0) {
      app.setPluginStatus(`Not configured: enter ${options.missingCredentials.join(', ')} in the plugin configuration`)
      return
    }

    const s = {
      active: true,
      options,
      state: loadState(stateFile(), (line) => app.debug(line)),
      readings: createReadings(),
      timer: null,
      statusTimer: null,
      unsubscribes: [],
      // The highest wind speed delivered since the last report, and when.
      peakGust: 0,
      peakTime: 0,
      // Dashboard text of a cycle in which nothing could be sent, or ''.
      noData: ''
    }
    session = s

    if (options.shareProblem) {
      app.error(`Station position will not be updated: ${options.shareProblem}`)
    }

    // One subscription for everything the plugin reports: the position, the
    // six sensor paths and the altitude. Every value that arrives is noted
    // in `s.readings` with the time it came, which is what lets a reading
    // that has stopped arriving be recognised as stale. Reports are built
    // from these readings alone, so the wind speed and the gust always come
    // from the same samples.
    //
    // `period: 1000` asks the server for at most one value per second and
    // path. A path that is not updated delivers nothing.
    //
    // The server appends a function to `s.unsubscribes` for each path;
    // stop() calls them. Without that, every restart of the plugin left its
    // subscriptions running for the life of the server process.
    const windPath = options.pathMap.windSpeed
    const paths = [...new Set([
      POSITION_PATH,
      windPath,
      options.pathMap.windGust,
      options.pathMap.windDir,
      options.pathMap.temp,
      options.pathMap.pressure,
      ...humidityPaths(options.pathMap.humidity),
      ...ALTITUDE_PATHS
    ])]

    // While subscribe() runs, the server hands over the value it holds for
    // each path, however old that value is. Those deliveries are told apart
    // from live ones by this flag: they are synchronous, so they all happen
    // before subscribe() returns.
    let fromCache = true

    app.subscriptionmanager.subscribe({
      context: 'vessels.self',
      subscribe: paths.map((skPath) => ({ path: skPath, period: 1000 }))
    }, s.unsubscribes, (err) => app.error(err), (delta) => {
      if (!s.active || !delta || !Array.isArray(delta.updates)) return
      const arrived = Date.now()
      for (const update of delta.updates) {
        if (!update || !Array.isArray(update.values)) continue

        // A live value is as old as its arrival, by this server's clock. A
        // value from the server's cache is as old as its own timestamp says,
        // unless that timestamp is missing or lies in the future, in which
        // case nothing better is known than "now".
        let time = arrived
        if (fromCache) {
          const stamped = Date.parse(update.timestamp)
          if (Number.isFinite(stamped) && stamped <= arrived) time = stamped
        }

        for (const v of update.values) {
          if (!v || typeof v.path !== 'string') continue
          s.readings.record(v.path, v.value, time)
          if (v.path === POSITION_PATH) handlePositionUpdate(s, v.value)
          // The peak is built from live samples only. A sample outside
          // Windy's gust range is a sensor glitch; taking it as the peak
          // would cost the real peak of the interval.
          if (v.path === windPath && !fromCache && isNumber(v.value) && inRange('gust', v.value) && v.value > s.peakGust) {
            s.peakGust = v.value
            s.peakTime = arrived
          }
        }
      }
    })
    fromCache = false

    // Continue the countdown that was running when the state was last saved,
    // or begin with the warm-up when that moment has passed.
    const intervalMs = options.interval * 60000
    const remainingMs = s.state.nextRunTime - Date.now()
    if (remainingMs <= 0) {
      schedule(s, WARM_UP_MS, 'Warm')
    } else {
      // A saved time further away than one interval cannot be right; it comes
      // from a state saved while the system clock was wrong. Waiting for it
      // could keep the plugin silent for days.
      schedule(s, Math.min(remainingMs, intervalMs), 'Resume')
    }
  }

  plugin.stop = function () {
    const s = session
    session = null

    // A plugin that was never started, or was not configured, has loaded no
    // state. Saving here would overwrite the real state file with an empty one.
    if (s) {
      s.active = false
      if (s.timer) clearTimeout(s.timer)
      if (s.statusTimer) clearInterval(s.statusTimer)
      for (const unsubscribe of s.unsubscribes) {
        try { unsubscribe() } catch (err) { app.debug(`Unsubscribe failed: ${err.message}`) }
      }
      s.unsubscribes.length = 0
      persist(s)
    }

    app.setPluginStatus('Stopped')
  }

  // --- ENGINE ---

  /**
   * Movement guard: records how far the vessel is from the last position sent
   * to Windy. The first usable position becomes the baseline.
   */
  function handlePositionUpdate (s, position) {
    // A receiver without a fix can publish a position with null coordinates.
    if (!isValidPosition(position)) return
    if (!s.state.lastSentPos) {
      s.state.lastSentPos = { lat: position.latitude, lon: position.longitude }
      return
    }
    s.state.currentDistance = distanceMeters(s.state.lastSentPos, position)
  }

  /**
   * Station elevation in whole metres: the value the owner has set, otherwise
   * the GNSS antenna altitude where Signal K has a current one, otherwise 0.
   * Windy rejects an elevation that is not a whole number.
   */
  function stationElevation (s, nowMs, maxAgeMs) {
    if (s.options.elevation !== null) return s.options.elevation
    for (const skPath of ALTITUDE_PATHS) {
      const reading = s.readings.read(skPath, nowMs, maxAgeMs)
      if (reading.state === 'ok' && isNumber(reading.value)) return Math.round(reading.value)
    }
    return 0
  }

  /**
   * Sends one report: the station record when it is due, then the observation.
   *
   * A station update is due when any of three conditions holds:
   *   1. Force GPS Updates is switched on.
   *   2. No station update has succeeded yet. This places the station on the
   *      map after a fresh install, a migration from the legacy plugin, or a
   *      reset of the state.
   *   3. The vessel is at least the movement threshold away from the position
   *      last sent.
   *
   * The station update goes first, so that the observation that follows is
   * shown at the new position. Station updates do not count against Windy's
   * limit of one observation per 5 minutes.
   *
   * Returns the number of milliseconds to wait before repeating the cycle
   * when Windy answered 429 and named a moment, otherwise null.
   */
  async function reportToWindy (s) {
    const { options, state } = s
    const debug = (line) => app.debug(line)

    const now = Date.now()
    const maxAgeMs = options.maxAge * 60000

    // The peak is the highest wind speed since the last successful report,
    // so it may be as old as one reporting interval and still belong to this
    // report. It is older than that only when reports have been failing, for
    // example during a long loss of connectivity; a peak from before then is
    // no longer current weather. The limit is the interval or the Maximum
    // Reading Age, whichever is longer, and none when the age check is off.
    const peakLimitMs = Math.max(maxAgeMs, options.interval * 60000)
    const peak = maxAgeMs > 0 && now - s.peakTime > peakLimitMs ? 0 : s.peakGust

    const { fields, leftOut, missingPaths } = buildObservation(s.readings, options.pathMap, peak, now, maxAgeMs, debug)

    const positionReading = s.readings.read(POSITION_PATH, now, maxAgeMs)
    const position = positionReading.value

    const updateDue = options.forceUpdate || !state.hasReportedPosition || state.currentDistance >= options.minMove

    // --- STEP 1: STATION UPDATE (PUT) ---
    if (updateDue && options.shareProblem) {
      // The owner has not chosen a share option Windy accepts. No value is
      // chosen for them; the heartbeat keeps the reason on the dashboard.
      app.debug(`Station update not sent: ${options.shareProblem}`)
    } else if (updateDue && positionReading.state === 'stale') {
      // The vessel may have moved since. Sending the old position would put
      // the station where the vessel no longer is.
      app.debug(`Station update not sent: the position was last updated ${Math.round(positionReading.ageMs / 60000)} minutes ago`)
    } else if (updateDue && !isValidPosition(position)) {
      app.debug('Station update not sent: navigation.position holds no usable position')
    } else if (updateDue) {
      const payload = windy.stationPayload(options, position, stationElevation(s, now, maxAgeMs))
      app.debug(`Movement Guard: ${Math.round(state.currentDistance)}m from baseline position`)
      app.debug(`Windy Metadata Submission (PUT): ${JSON.stringify(payload)}`)

      try {
        await windy.updateStation(options, payload)
        if (!s.active) return null
        // The baseline moves only after Windy has accepted the new position.
        state.lastSentPos = { lat: position.latitude, lon: position.longitude }
        state.currentDistance = 0
        state.hasReportedPosition = true
        persist(s)
        app.debug('Station metadata updated successfully')
      } catch (err) {
        if (!s.active) return null
        const problem = windy.describeStationError(err)
        app.error(problem.log)
        if (problem.dashboard) app.setPluginError(problem.dashboard)
        // The observation is still sent: weather data is worth having even
        // when the position could not be updated.
      }
    }

    // --- STEP 2: OBSERVATION (GET) ---
    if (Object.keys(fields).length === 0) {
      // Instruments switched off at anchor are the usual reason, so this is
      // a plain status and not an error. The heartbeat keeps it on the line.
      s.noData = noDataText(missingPaths)
      app.setPluginStatus(`Next: 0m00s | ${movementText(s)} | ${s.noData}`)
      return null
    }

    app.debug(`Windy Submission (GET): ${JSON.stringify(fields)}`)

    try {
      await windy.sendObservation(options, fields, Math.floor(Date.now() / 1000))
      if (!s.active) return null

      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
      lastReportString = `${dashboardText(fields, leftOut)} | ${time}`
      s.noData = ''
      app.setPluginStatus(`Next: 0m00s | ${movementText(s)} | ${lastReportString}`)

      // The peak belongs to the interval that has just been reported.
      s.peakGust = 0
      s.peakTime = 0
    } catch (err) {
      if (!s.active) return null
      const problem = windy.describeObservationError(err, Date.now())

      if (problem.kind === 'rateLimit') {
        // Expected flow, not an error: nothing is shown on the dashboard. The
        // observation is dropped, not queued.
        if (problem.retryDelayMs) {
          app.debug(`Rate limited by Windy. Retry after ${Math.ceil(problem.retryDelayMs / 1000)}s (from retry_after timestamp)`)
          return problem.retryDelayMs
        }
        app.debug('Rate limited by Windy (429). Could not parse retry_after, using normal interval.')
        return null
      }

      if (problem.kind === 'duplicate') {
        app.debug('Windy already holds an observation with this time (409). Nothing to resend.')
        return null
      }

      app.error(problem.log)
      if (problem.dashboard) app.setPluginError(problem.dashboard)
    }

    return null
  }

  return plugin
}
