/*
 * Signal K Windy API v2 Reporter
 * v1.8.0 - wind over the reporting interval, dew point, clock check, position precision, wind path check
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
 *   lib/samples.js   the values of the wind paths over the reporting interval
 *   lib/convert.js   readings to observation fields, with range checks
 *   lib/movement.js  distance from the last position sent to Windy
 *   lib/state.js     loading and saving state.json
 *   lib/windy.js     the two requests and the meaning of Windy's answers
 */

'use strict'

const path = require('node:path')

const { schema, uiSchema, resolveOptions } = require('./lib/schema')
const { createReadings } = require('./lib/readings')
const { createSamples } = require('./lib/samples')
const { buildObservation, dashboardText, noDataText, humidityPaths, isNumber, inRange, MAX_DIRECTION_RAD } = require('./lib/convert')
const { isValidPosition, distanceMeters } = require('./lib/movement')
const { loadState, saveState } = require('./lib/state')
const windy = require('./lib/windy')

// Signal K needs a moment after a start to receive its first sensor values.
const WARM_UP_MS = 15000

const POSITION_PATH = 'navigation.position'

// GNSS time, compared with the system clock. Windy refuses an observation
// stamped a few minutes ahead of its own clock (tested on a test station,
// 2026-10-23: 120 s ahead accepted, 300 s ahead refused), and a clock behind
// stamps every observation with the wrong time.
const DATETIME_PATH = 'navigation.datetime'
const CLOCK_TOLERANCE_MS = 60000
// How long a GNSS time counts when the Maximum Reading Age is 0.
const CLOCK_DEFAULT_AGE_MS = 15 * 60000
// A receiver without a fix may publish a time such as the GPS epoch of 1980.
// A GNSS time before this plugin's release cannot be right and is ignored.
const EARLIEST_GNSS_TIME = Date.parse('2026-10-01T00:00:00Z')

// The wind window of a report reaches back to where the previous one ended
// when that lies at most this far before the interval, so that a sample
// arriving while the previous report was on its way to Windy is not missed.
// Two requests of at most 30 s each fit.
const WINDOW_GAP_MS = 2 * 60000

// Where the station elevation comes from when the owner has set none.
const ALTITUDE_PATHS = ['navigation.gnss.antennaAltitude', 'navigation.altitude']

/** A time as HH:MM on the server's clock, the same with every Node.js version and locale. */
const clockText = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

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

  // Kept across a restart for the same reason: { reason, since } while Windy
  // cannot be reached, otherwise null. A restart while offline would
  // otherwise bring back the readings of the last report as if they were
  // current, until the next cycle failed again.
  let unreachable = null

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
   * Writes the dashboard line.
   *
   * While something needs the owner's attention, the line is an error and
   * says what: a request Windy refused, a share option Windy does not accept,
   * a cycle that failed. The text stays the same for as long as the problem
   * lasts and carries no countdown. The server moves an error to "Last
   * Error" as soon as a different message replaces it, so an error text that
   * changed every second would push the real error out of that column and
   * leave a copy of itself there. Once the problem is gone, the line goes
   * back to the countdown and the error remains as "Last Error".
   *
   * Otherwise the line is a plain status with the countdown:
   * "Next: XmXXs | Δ###m | W:## G:## D:### T:## P:### H:## | HH:MM"
   * Ordered by time-sensitivity: countdown first, sensor data in the middle,
   * time of the last report at the end, where a narrow dashboard cuts it off
   * first. In place of the readings it shows, in this order of precedence:
   * that Windy cannot be reached and since when, or which reading is missing
   * after a cycle in which nothing could be sent. The readings of an earlier
   * report would look like current weather.
   */
  const render = (s, countdown) => {
    const problems = [
      s.problems.cycle,
      s.problems.observation,
      s.problems.station,
      s.options.shareProblem ? `Station position not updated: ${s.options.shareProblem}` : null,
      ...s.options.pathProblems,
      clockProblem(s)
    ].filter(Boolean)
    if (problems.length > 0) {
      show(s, 'error', problems.join(' | '))
      return
    }
    const detail = unreachable
      ? `${unreachable.reason} since ${unreachable.since}`
      : s.noData || lastReportString
    show(s, 'status', detail
      ? `${countdown} | ${movementText(s)} | ${detail}`
      : `${countdown} | ${movementText(s)}`)
  }

  /**
   * The difference between the system clock and GNSS time as a dashboard
   * error, or null. The text names only the direction, so that it stays the
   * same while the difference wanders by a second. Each source of GNSS time
   * is judged on its own, and one that agrees with the system clock is
   * enough: a device that publishes the time of its own clock beside a GNSS
   * receiver would otherwise turn the error on and off with every message.
   * A GNSS time that has not been updated within the Maximum Reading Age, or
   * within 15 minutes when the age check is off, no longer says anything
   * about the clock.
   */
  const clockProblem = (s) => {
    const limitMs = s.options.maxAge > 0 ? s.options.maxAge * 60000 : CLOCK_DEFAULT_AGE_MS
    const now = Date.now()
    let closest = null
    for (const clock of s.clocks.values()) {
      if (now - clock.at > limitMs) continue
      if (closest === null || Math.abs(clock.offsetMs) < Math.abs(closest.offsetMs)) closest = clock
    }
    if (closest === null) return null
    if (closest.offsetMs > CLOCK_TOLERANCE_MS) {
      return 'System clock is more than 60 s ahead of GNSS time. Windy refuses observations stamped a few minutes ahead of its own clock. Set the clock, for example with the set-system-time plugin.'
    }
    if (closest.offsetMs < -CLOCK_TOLERANCE_MS) {
      return 'System clock is more than 60 s behind GNSS time, so observations carry the wrong time. Set the clock, for example with the set-system-time plugin.'
    }
    return null
  }

  /** Sets the dashboard line, unless it already shows exactly this. */
  const show = (s, type, text) => {
    if (s.shown.type === type && s.shown.text === text) return
    s.shown = { type, text }
    if (type === 'error') app.setPluginError(text)
    else app.setPluginStatus(text)
  }

  /**
   * Heartbeat: updates the dashboard once a second with the countdown.
   *
   * The countdown is kept by the timer and not read from the clock. A clock
   * that is set forward while the plugin runs, as happens when a boat's
   * computer gets the time from GNSS or the network after a start, would
   * otherwise end the countdown early and freeze the line until the cycle
   * is due.
   */
  const updateHeartbeatStatus = (s, label) => {
    if (!s.active) return
    s.remainingMs -= 1000
    if (s.remainingMs <= 0) return

    const min = Math.floor(s.remainingMs / 60000)
    const sec = Math.floor((s.remainingMs % 60000) / 1000)
    render(s, `${label}: ${min}m${sec < 10 ? '0' : ''}${sec}s`)
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
    s.remainingMs = delayMs
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
      s.problems.cycle = null
    } catch (err) {
      app.error(`Reporting cycle failed: ${err && err.stack ? err.stack : err}`)
      s.problems.cycle = `Reporting cycle failed: ${err && err.message ? err.message : err}`
      if (s.active) render(s, 'Next: 0m00s')
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
      // The recent values of the wind paths, which the wind, the gust and
      // the direction of a report are taken from.
      samples: createSamples(options.maxAge * 60000),
      // When the wind window of the last report ended; null before the first.
      windowEnd: null,
      // Per source of GNSS time, { offsetMs, at }: the system clock minus
      // GNSS time, and when it was last measured.
      clocks: new Map(),
      timer: null,
      statusTimer: null,
      unsubscribes: [],
      // Dashboard text of a cycle in which nothing could be sent, or ''.
      noData: '',
      // What needs the owner's attention, one text per source, or null.
      // A refused station update is cleared by the next one that succeeds,
      // a refused observation by the next answer that is not a refusal.
      problems: { station: null, observation: null, cycle: null },
      // Milliseconds left in the countdown, kept by the heartbeat timer.
      remainingMs: 0,
      // What the dashboard shows, so that the same line is not sent twice.
      shown: { type: null, text: null }
    }
    session = s

    if (options.shareProblem) {
      app.error(`Station position will not be updated: ${options.shareProblem}`)
    }
    for (const problem of options.pathProblems) app.error(problem)

    // One subscription for everything the plugin reports: the position, the
    // seven sensor paths, the altitude and the GNSS time. Every value that
    // arrives is noted in `s.readings` with the time it came, which is what
    // lets a reading that has stopped arriving be recognised as stale. The
    // values of the three wind paths are also kept in `s.samples`, for the
    // mean, the gust and the direction of the reporting interval. Reports
    // are built from these alone, so the wind speed and the gust always come
    // from the same samples.
    //
    // `period: 1000` asks the server for at most one value per second and
    // path. A path that is not updated delivers nothing.
    //
    // The server appends a function to `s.unsubscribes` for each path;
    // stop() calls them. Without that, every restart of the plugin left its
    // subscriptions running for the life of the server process.
    const paths = [...new Set([
      POSITION_PATH,
      options.pathMap.windSpeed,
      options.pathMap.windGust,
      options.pathMap.windDir,
      options.pathMap.temp,
      options.pathMap.pressure,
      ...humidityPaths(options.pathMap.humidity),
      options.pathMap.dewPoint,
      ...ALTITUDE_PATHS,
      DATETIME_PATH
    ])]

    // Which samples of the wind paths are kept. A value outside Windy's
    // range for its field is a sensor glitch and is not kept: the value
    // before it goes on standing. A value that is not a number at all marks
    // a gap.
    // Listed so that the wind range wins when one path is configured for both
    // the wind speed and the gust.
    const plausible = {
      [options.pathMap.windGust]: (value) => inRange('gust', value),
      [options.pathMap.windSpeed]: (value) => inRange('wind', value),
      [options.pathMap.windDir]: (value) => Math.abs(value) <= MAX_DIRECTION_RAD
    }

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

        // The source that sent the values. The server sets `$source` on every
        // update it delivers to a subscription.
        const source = update.$source

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
          // A server with "enforce data timeouts" switched on publishes null,
          // marked as timed out, for a path whose source has stopped.
          const timedOut = v.value === null && v.state && v.state.timedOut === true
          const taken = timedOut
            ? s.readings.markTimedOut(v.path, time, source)
            : s.readings.record(v.path, v.value, time, source)
          if (!taken) continue
          if (v.path in plausible) {
            // The server's cached value counts for the mean from its own time
            // stamp, but never as the gust: it may be hours old.
            if (!isNumber(v.value)) s.samples.add(v.path, null, time, !fromCache)
            else if (plausible[v.path](v.value)) s.samples.add(v.path, v.value, time, !fromCache)
          }
          if (v.path === POSITION_PATH) handlePositionUpdate(s, v.value)
          if (v.path === DATETIME_PATH && !fromCache) noteClock(s, v.value, arrived, source)
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
   * Notes the difference between the system clock and a GNSS time that has
   * just arrived. The GNSS time is that of the fix, so the difference
   * includes the delay of the message, which is well under a second.
   */
  function noteClock (s, value, arrivedMs, source) {
    const gnss = typeof value === 'string' ? Date.parse(value) : NaN
    if (!Number.isFinite(gnss) || gnss < EARLIEST_GNSS_TIME) return
    s.clocks.set(String(source), { offsetMs: arrivedMs - gnss, at: arrivedMs })
  }

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
   * Notes that a request could not reach Windy. The time is that of the
   * first failure since Windy last answered, taken when the failure is
   * known, which is up to the request time limit after it was sent.
   */
  function markUnreachable (reason) {
    if (!unreachable) unreachable = { reason, since: clockText(new Date()) }
    else unreachable.reason = reason
  }

  /**
   * Sends one report: the station record when it is due, then the observation.
   *
   * A station update is due when any of four conditions holds:
   *   1. Force GPS Updates is switched on.
   *   2. No station update has succeeded yet. This places the station on the
   *      map after a fresh install, a migration from the legacy plugin, or a
   *      reset of the state.
   *   3. The vessel is at least the movement threshold away from the position
   *      last sent.
   *   4. A setting the station record is built from has changed since the
   *      last update that succeeded: the Station ID, the name, the share
   *      option, a sensor height, the station type, the website, the
   *      elevation setting or the position precision. The first cycle after
   *      an update from a version that did not record these settings counts
   *      as a change.
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

    // The wind, the gust and the direction are taken over the last interval,
    // the same for every report, a retry after a rate limit included. The
    // window starts earlier only to close the gap the previous report left
    // while it was on its way (see WINDOW_GAP_MS). Older samples are no
    // longer needed.
    let windowStart = now - options.interval * 60000
    if (s.windowEnd !== null && s.windowEnd < windowStart && windowStart - s.windowEnd <= WINDOW_GAP_MS) windowStart = s.windowEnd
    s.windowEnd = now
    s.samples.prune(windowStart)

    const { fields, leftOut, missingPaths } = buildObservation({
      readings: s.readings,
      samples: s.samples,
      pathMap: options.pathMap,
      nowMs: now,
      maxAgeMs,
      fromMs: windowStart,
      sendDirection: options.sendDirection
    }, debug)

    const positionReading = s.readings.read(POSITION_PATH, now, maxAgeMs)
    const position = positionReading.value

    const key = windy.stationKey(options)
    const updateDue = options.forceUpdate || !state.hasReportedPosition || state.currentDistance >= options.minMove || state.stationKey !== key

    // A refused station update stays on the dashboard while an update is
    // still due. Once none is, for example because the vessel is back
    // within the threshold of the position Windy holds, the record on
    // Windy is current and the refusal no longer applies.
    if (!updateDue) s.problems.station = null

    // --- STEP 1: STATION UPDATE (PUT) ---
    if (updateDue && options.shareProblem) {
      // The owner has not chosen a share option Windy accepts. No value is
      // chosen for them; the dashboard keeps the reason in view.
      app.debug(`Station update not sent: ${options.shareProblem}`)
    } else if (updateDue && positionReading.timedOut) {
      app.debug('Station update not sent: the Signal K server reports that navigation.position has timed out')
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
        state.stationKey = key
        s.problems.station = null
        unreachable = null
        persist(s)
        app.debug('Station metadata updated successfully')
      } catch (err) {
        if (!s.active) return null
        const problem = windy.describeStationError(err)
        app.error(problem.log)
        if (problem.kind === 'unreachable') {
          markUnreachable(problem.dashboard)
        } else {
          s.problems.station = problem.dashboard
          // An answer, even a refusal, shows that Windy can be reached.
          unreachable = null
        }
        // The observation is still sent: weather data is worth having even
        // when the position could not be updated.
      }
    }

    // --- STEP 2: OBSERVATION (GET) ---
    if (Object.keys(fields).length === 0) {
      // Instruments switched off at anchor are the usual reason, so this is
      // a plain status and not an error. The heartbeat keeps it on the line.
      s.noData = noDataText(missingPaths)
      render(s, 'Next: 0m00s')
      return null
    }
    // Readings are back, whatever becomes of this report.
    s.noData = ''

    app.debug(`Windy Submission (GET): ${JSON.stringify(fields)}`)

    try {
      await windy.sendObservation(options, fields, Math.floor(Date.now() / 1000))
      if (!s.active) return null

      // The dew point is not on the line, so a report of it alone leaves no
      // readings to show.
      lastReportString = [dashboardText(fields, leftOut), clockText(new Date())].filter(Boolean).join(' | ')
      s.problems.observation = null
      unreachable = null
      render(s, 'Next: 0m00s')
    } catch (err) {
      if (!s.active) return null
      const problem = windy.describeObservationError(err, Date.now())

      if (problem.kind === 'unreachable') {
        app.error(problem.log)
        markUnreachable(problem.dashboard)
        render(s, 'Next: 0m00s')
        return null
      }

      // Every other answer shows that Windy can be reached.
      unreachable = null

      if (problem.kind === 'rateLimit') {
        // Expected flow, not an error: nothing is shown on the dashboard. The
        // observation is dropped, not queued.
        s.problems.observation = null
        if (problem.retryDelayMs) {
          app.debug(`Rate limited by Windy. Retry after ${Math.ceil(problem.retryDelayMs / 1000)}s (from retry_after timestamp)`)
          return problem.retryDelayMs
        }
        app.debug('Rate limited by Windy (429). Could not parse retry_after, using normal interval.')
        return null
      }

      if (problem.kind === 'duplicate') {
        s.problems.observation = null
        app.debug('Windy already holds an observation with this time (409). Nothing to resend.')
        return null
      }

      app.error(problem.log)
      s.problems.observation = problem.dashboard
      render(s, 'Next: 0m00s')
    }

    return null
  }

  return plugin
}
