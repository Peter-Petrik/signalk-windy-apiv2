/*
 * Readings: the latest value of every subscribed Signal K path, with the
 * time it arrived.
 *
 * Signal K keeps the last value of a path for as long as the server runs. A
 * sensor that was switched off or lost its connection an hour ago still has
 * a value there, and nothing in the value says so. What does say so is that
 * nothing has arrived since: a subscription delivers a value only when the
 * path is updated (confirmed on Signal K 2.31.1, 2.33.0 and 2.34.0, where a
 * path updated once was delivered once). So the plugin takes every reading from
 * its subscription and notes when it came. A reading older than the limit
 * the owner has set is stale and is not reported.
 *
 * The time of arrival is taken from the server's own clock, so that a source
 * whose clock is wrong cannot make a live reading look old.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

/**
 * Creates an empty store.
 *
 *   record(path, value, timeMs, source)
 *                                 notes the latest value of a path and the
 *                                 source it came from
 *   markTimedOut(path, timeMs, source)
 *                                 notes that the Signal K server has declared
 *                                 the path of that source timed out
 *   read(path, nowMs, maxAgeMs)   returns { state, value, ageMs, timedOut }:
 *       'none'   nothing has arrived, or the latest value is null. Signal K
 *                publishes null for a path whose source has reported "no
 *                value".
 *       'stale'  the latest value is older than maxAgeMs, or the server has
 *                declared the path timed out (`timedOut` is then true)
 *       'ok'     the value can be used
 *     A maxAgeMs of 0 switches the age check off. It does not bring back a
 *     path the server has declared timed out.
 *
 * A server with "enforce data timeouts" switched on publishes null for a
 * path whose source has stopped sending, marked as timed out. That is a
 * sensor that has stopped, not one that has no value, so it is stale. The
 * timeout is per source: when several sources publish the path and the
 * latest value came from another one, that value is still current and the
 * timeout is ignored. The same holds for a plain null: a source that has no
 * value does not take away the value of another source.
 */
function createReadings () {
  const latest = new Map()

  return {
    record (skPath, value, timeMs, source) {
      const entry = latest.get(skPath)
      if (value === null && entry && !entry.timedOut && entry.value !== null && entry.source !== source) return
      latest.set(skPath, { value, timeMs, source, timedOut: false })
    },

    markTimedOut (skPath, timeMs, source) {
      const entry = latest.get(skPath)
      if (entry && !entry.timedOut && entry.source !== source) return
      latest.set(skPath, { value: null, timeMs, source, timedOut: true })
    },

    read (skPath, nowMs, maxAgeMs) {
      const entry = latest.get(skPath)
      // A clock that was set back gives a negative age. Such a reading is
      // recent, not old.
      const ageMs = entry ? Math.max(0, nowMs - entry.timeMs) : undefined
      if (entry && entry.timedOut) {
        return { state: 'stale', value: undefined, ageMs, timedOut: true }
      }
      if (!entry || entry.value === null || entry.value === undefined) {
        return { state: 'none', value: undefined, ageMs: undefined, timedOut: false }
      }
      if (maxAgeMs > 0 && ageMs > maxAgeMs) {
        return { state: 'stale', value: entry.value, ageMs, timedOut: false }
      }
      return { state: 'ok', value: entry.value, ageMs, timedOut: false }
    }
  }
}

module.exports = { createReadings }
