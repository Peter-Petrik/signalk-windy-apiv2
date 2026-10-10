/*
 * State: what the plugin remembers between runs.
 *
 * The state lives in `state.json` in the plugin's own data directory, apart
 * from the plugin configuration. It holds four things:
 *
 *   lastSentPos          the position last sent to Windy, as { lat, lon },
 *                        or null when none has been sent
 *   currentDistance      metres between that position and the vessel
 *   nextRunTime          when the next report is due, in milliseconds since
 *                        the epoch
 *   hasReportedPosition  whether a station update has ever succeeded
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const freshState = () => ({ lastSentPos: null, currentDistance: 0, nextRunTime: 0, hasReportedPosition: false })

/**
 * Loads the state, field by field.
 *
 * A missing, empty or damaged file gives a fresh state, and so does any
 * single field that is not what it should be. Versions before 1.5.2 wrote
 * { lat: 0, lon: 0 } for "no position sent yet"; that is read as null.
 */
function loadState (file, debug) {
  const state = freshState()
  try {
    if (!fs.existsSync(file)) return state
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!saved || typeof saved !== 'object') return state

    const pos = saved.lastSentPos
    if (pos && isNumber(pos.lat) && isNumber(pos.lon) && !(pos.lat === 0 && pos.lon === 0)) {
      state.lastSentPos = { lat: pos.lat, lon: pos.lon }
    }
    if (isNumber(saved.currentDistance) && saved.currentDistance >= 0) state.currentDistance = saved.currentDistance
    if (isNumber(saved.nextRunTime) && saved.nextRunTime > 0) state.nextRunTime = saved.nextRunTime
    state.hasReportedPosition = saved.hasReportedPosition === true
  } catch (err) {
    debug(`Starting with fresh internal state: ${err.message}`)
    return freshState()
  }
  return state
}

/**
 * Saves the state.
 *
 * The file is written under a temporary name and then renamed over the real
 * one. A rename replaces the file in one step, so a power cut during the
 * write leaves either the old state or the new one, never half a file. Boats
 * lose power without warning, and the Signal K server does not stop its
 * plugins when the server itself shuts down, so the plugin cannot rely on
 * being asked to save.
 */
function saveState (file, state) {
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const body = JSON.stringify({
    lastSentPos: state.lastSentPos,
    currentDistance: state.currentDistance,
    nextRunTime: state.nextRunTime,
    hasReportedPosition: state.hasReportedPosition
  })
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, body)
  try {
    fs.renameSync(temporary, file)
  } catch (err) {
    // Some file systems refuse to rename over an existing file. Writing the
    // file directly is the behaviour of earlier versions and still saves it.
    fs.writeFileSync(file, body)
    fs.rmSync(temporary, { force: true })
  }
}

module.exports = { loadState, saveState, freshState }
