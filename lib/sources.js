/*
 * Sources: which Signal K sources each subscribed path has received values
 * from recently, for the configuration form. The plugin does not judge
 * them: which source a path should come from is set in Signal K with a
 * source priority.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

/**
 * Creates an empty store.
 *
 *   note(path, source, timeMs)  notes a value of a path from a source
 *   list(path, nowMs, windowMs) the sources the path received a value from
 *                               within windowMs before nowMs, sorted by name
 */
function createSources () {
  // Per path: Map(source → time of its latest value)
  const paths = new Map()

  return {
    note (skPath, source, timeMs) {
      const name = source === undefined || source === null ? 'unknown' : String(source)
      if (!paths.has(skPath)) paths.set(skPath, new Map())
      paths.get(skPath).set(name, timeMs)
    },

    list (skPath, nowMs, windowMs) {
      const bySource = paths.get(skPath)
      if (!bySource) return []
      const recent = []
      for (const [source, timeMs] of bySource) {
        if (nowMs - timeMs <= windowMs) recent.push(source)
        else bySource.delete(source)
      }
      return recent.sort()
    }
  }
}

module.exports = { createSources }
