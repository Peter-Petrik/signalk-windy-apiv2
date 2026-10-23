/*
 * Samples: the recent values of the wind paths, so that a report can send
 * the wind of the whole reporting interval instead of a single moment.
 *
 * Weather stations report wind as a mean over a period, with the gust as the
 * highest value in that period. Windy's specification does not say which it
 * expects. Software that uploads to Windy, such as WeeWX, sends the mean of
 * its archive interval, and the World Meteorological Organization defines
 * reported wind as a mean over 10 minutes. This plugin uses its reporting
 * interval as the period.
 *
 * Each path keeps its values as a step function: a value stands from the
 * moment it arrived until the next one. A null marks a gap: the source has
 * no value, or the server has declared it timed out. The mean of a path is
 * weighted by time, so that a sensor that sends only when its value changes
 * is weighted correctly and a burst of samples does not outweigh a steady
 * minute.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

/**
 * Creates an empty store. A value stands until the next one arrives, but for
 * no longer than `limitMs` after it was last delivered, the Maximum Reading
 * Age: a sensor that has sent nothing for that long has stopped, and its last
 * value does not belong to the wind of a later interval. 0 sets no limit.
 *
 *   add(path, value, timeMs, live)  notes a number, or null for a gap. `live`
 *                                   is false for a value the server held
 *                                   before the plugin subscribed.
 *   prune(beforeMs)                 forgets what lies wholly before beforeMs
 *   mean(path, fromMs, toMs)        time-weighted mean, or null
 *   max(path, fromMs, toMs)         highest live value that arrived in the
 *                                   window or stood at its start, or null
 *   directionMean(dirPath, speedPath, fromMs, toMs)
 *                                   vector mean of the direction in radians,
 *                                   weighted by time and by the wind speed
 *                                   standing at each moment, or null
 */
function createSamples (limitMs = 0) {
  const series = new Map()

  const list = (skPath) => {
    if (!series.has(skPath)) series.set(skPath, [])
    return series.get(skPath)
  }

  /** The moment the value of samples[i] stops standing. */
  const until = (samples, i) => {
    const next = i + 1 < samples.length ? samples[i + 1].t : Infinity
    return limitMs > 0 ? Math.min(next, samples[i].seen + limitMs) : next
  }

  /**
   * The pieces of a path's step function inside [fromMs, toMs]:
   * { from, to, value }, value null for a gap. A value that arrived before
   * fromMs stands from fromMs, while it still stands.
   */
  function pieces (skPath, fromMs, toMs) {
    const out = []
    const samples = series.get(skPath) || []
    for (let i = 0; i < samples.length; i++) {
      const start = Math.max(samples[i].t, fromMs)
      const end = Math.min(until(samples, i), toMs)
      if (end > start) out.push({ from: start, to: end, value: samples[i].v })
    }
    return out
  }

  /**
   * A reader of the value standing at a moment, or null, for moments asked
   * in increasing order. It walks the samples once, so that a window of a
   * day takes no longer than one pass over it.
   */
  function standing (skPath) {
    const samples = series.get(skPath) || []
    let i = -1
    return (timeMs) => {
      while (i + 1 < samples.length && samples[i + 1].t <= timeMs) i++
      return i >= 0 && timeMs < until(samples, i) ? samples[i].v : null
    }
  }

  return {
    add (skPath, value, timeMs, live = true) {
      const samples = list(skPath)
      const last = samples[samples.length - 1]
      const sample = { t: timeMs, seen: timeMs, v: value, live }
      if (!live) {
        // The server hands over one cached value per source when the plugin
        // subscribes, each with its own time stamp. Only the newest is the
        // value of the path; an older one is from a source that has since
        // been replaced or has stopped.
        if (last && !last.live) {
          if (timeMs > last.t) samples[samples.length - 1] = sample
          return
        }
      } else if (last && last.seen > timeMs) {
        // Live values arrive in time order. One older than the value before
        // it means the system clock has been set back: the earlier values
        // would then seem to arrive after it, so the path starts again from
        // this value.
        samples.length = 0
      } else if (last && last.v === value && last.live && (limitMs === 0 || timeMs <= last.seen + limitMs)) {
        // The same value again, while the last one still stands, changes
        // nothing but how long it stands.
        last.seen = timeMs
        return
      }
      samples.push(sample)
    },

    prune (beforeMs) {
      for (const samples of series.values()) {
        // Keep the last value before the cut: it may stand at the start of
        // the window.
        let keepFrom = 0
        for (let i = 0; i < samples.length; i++) {
          if (samples[i].t < beforeMs) keepFrom = i
          else break
        }
        if (keepFrom > 0) samples.splice(0, keepFrom)
      }
    },

    mean (skPath, fromMs, toMs) {
      let sum = 0
      let duration = 0
      for (const p of pieces(skPath, fromMs, toMs)) {
        if (p.value === null) continue
        sum += p.value * (p.to - p.from)
        duration += p.to - p.from
      }
      return duration > 0 ? sum / duration : null
    },

    max (skPath, fromMs, toMs) {
      let highest = null
      const samples = series.get(skPath) || []
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        if (!s.live || s.v === null || s.t > toMs) continue
        // A value counts when it arrived in the window, or arrived before it
        // and still stood at its start.
        if (s.t < fromMs && until(samples, i) <= fromMs) continue
        if (highest === null || s.v > highest) highest = s.v
      }
      return highest
    },

    directionMean (dirPath, speedPath, fromMs, toMs) {
      // The moments at which either path changes, or a value stops standing,
      // split the window into stretches with one direction and one speed
      // each.
      const cuts = new Set([fromMs, toMs])
      for (const skPath of [dirPath, speedPath]) {
        const samples = series.get(skPath) || []
        for (let i = 0; i < samples.length; i++) {
          for (const t of [samples[i].t, until(samples, i)]) if (t > fromMs && t < toMs) cuts.add(t)
        }
      }
      const times = [...cuts].sort((a, b) => a - b)

      const sumUp = (weighted) => {
        const directionAt = standing(dirPath)
        const speedAt = standing(speedPath)
        let x = 0
        let y = 0
        for (let i = 0; i + 1 < times.length; i++) {
          const direction = directionAt(times[i])
          const speed = speedAt(times[i])
          if (direction === null) continue
          let weight = times[i + 1] - times[i]
          if (weighted) {
            if (speed === null) continue
            weight *= speed
          }
          x += weight * Math.cos(direction)
          y += weight * Math.sin(direction)
        }
        return { x, y }
      }

      // Weighted by speed when a speed is known; with none, or in a calm
      // where every weight is zero, every moment counts the same.
      let v = sumUp(true)
      if (Math.hypot(v.x, v.y) < 1e-9) v = sumUp(false)
      if (Math.hypot(v.x, v.y) < 1e-9) return null
      return Math.atan2(v.y, v.x)
    }
  }
}

module.exports = { createSamples }
