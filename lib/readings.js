/*
 * Readings: the latest value of every subscribed Signal K path, with the
 * time it arrived.
 *
 * Signal K keeps the last value of a path for as long as the server runs. A
 * sensor that was switched off or lost its connection an hour ago still has
 * a value there, and nothing in the value says so. What does say so is that
 * nothing has arrived since: a subscription delivers a value only when the
 * path is updated (confirmed on Signal K 2.31.1 and 2.33.0, where a path
 * updated once was delivered once). So the plugin takes every reading from
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
 *   record(path, value, timeMs)   notes the latest value of a path
 *   read(path, nowMs, maxAgeMs)   returns { state, value, ageMs }:
 *       'none'   nothing has arrived, or the latest value is null. Signal K
 *                publishes null for a path whose source has reported "no
 *                value".
 *       'stale'  the latest value is older than maxAgeMs
 *       'ok'     the value can be used
 *     A maxAgeMs of 0 switches the age check off.
 */
function createReadings () {
  const latest = new Map()

  return {
    record (skPath, value, timeMs) {
      latest.set(skPath, { value, timeMs })
    },

    read (skPath, nowMs, maxAgeMs) {
      const entry = latest.get(skPath)
      if (!entry || entry.value === null || entry.value === undefined) {
        return { state: 'none', value: undefined, ageMs: undefined }
      }
      // A clock that was set back gives a negative age. Such a reading is
      // recent, not old.
      const ageMs = Math.max(0, nowMs - entry.timeMs)
      if (maxAgeMs > 0 && ageMs > maxAgeMs) {
        return { state: 'stale', value: entry.value, ageMs }
      }
      return { state: 'ok', value: entry.value, ageMs }
    }
  }
}

module.exports = { createReadings }
