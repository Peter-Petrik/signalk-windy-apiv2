/*
 * Sources: which Signal K sources each subscribed path has received values
 * from recently, and whether the values switch between them.
 *
 * Without a source priority for a path, the Signal K server passes the
 * plugin the values of every source that publishes it, at most one value of
 * each source per subscription period (one second; 250 ms for the wind speed
 * with the WMO gust), the newest first (confirmed in the source of Signal K
 * 2.36.0 and on a real 2.36.0 server). The plugin keeps one value per path,
 * so its readings then switch between the sources all the time, and the
 * wind of a report can come from one source and the gust from another.
 *
 * With a source priority the server passes the preferred source, and a
 * lower-ranked source only after the preferred one has been silent for that
 * source's timeout (deltaPriority.js, isPreferredValue()). A pause of the
 * preferred source therefore switches the path to the next source and back:
 * two changes. A path is reported only when its values changed source more
 * often than that within the time counted, so that a single pause of a
 * prioritised source does not raise the warning, while a path without a
 * priority, whose sources take turns every period, does.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

// More changes of source than one pause of a prioritised source makes.
const SWITCHES_FOR_WARNING = 3

/**
 * Creates an empty store.
 *
 *   note(path, source, timeMs)  notes a value of a path from a source
 *   list(path, nowMs, windowMs) the sources the path received a value from
 *                               within windowMs before nowMs, sorted by name
 *   several(nowMs, windowMs)    [{ path, sources }] for every path whose
 *                               values changed source at least
 *                               SWITCHES_FOR_WARNING times within windowMs,
 *                               sorted by path
 */
function createSources () {
  // Per path: { bySource: Map(source → time of its latest value),
  //             last: the source of the latest value,
  //             switches: the times at which the source changed }
  const paths = new Map()

  const list = (skPath, nowMs, windowMs) => {
    const entry = paths.get(skPath)
    if (!entry) return []
    const recent = []
    for (const [source, timeMs] of entry.bySource) {
      if (nowMs - timeMs <= windowMs) recent.push(source)
      else entry.bySource.delete(source)
    }
    return recent.sort()
  }

  return {
    note (skPath, source, timeMs) {
      const name = source === undefined || source === null ? 'unknown' : String(source)
      if (!paths.has(skPath)) paths.set(skPath, { bySource: new Map(), last: null, switches: [] })
      const entry = paths.get(skPath)
      if (entry.last !== null && entry.last !== name) entry.switches.push(timeMs)
      entry.last = name
      entry.bySource.set(name, timeMs)
    },

    list,

    several (nowMs, windowMs) {
      const out = []
      for (const skPath of [...paths.keys()].sort()) {
        const entry = paths.get(skPath)
        while (entry.switches.length > 0 && nowMs - entry.switches[0] > windowMs) entry.switches.shift()
        // A change of source within the window means both sources sent
        // within it, so a path reported here always lists two or more.
        if (entry.switches.length >= SWITCHES_FOR_WARNING) out.push({ path: skPath, sources: list(skPath, nowMs, windowMs) })
      }
      return out
    }
  }
}

module.exports = { createSources, SWITCHES_FOR_WARNING }
