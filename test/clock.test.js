'use strict'

/*
 * The clock check: the system clock compared with GNSS time from
 * navigation.datetime. Windy refuses an observation stamped more than about
 * 2 minutes ahead of its own clock, and a clock behind stamps every
 * observation with the wrong time.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')

const DATETIME = 'navigation.datetime'
const AHEAD = 'System clock is more than 60 s ahead of GNSS time. Windy refuses observations stamped a few minutes ahead of its own clock. Set the clock, for example with the set-system-time plugin.'
const BEHIND = 'System clock is more than 60 s behind GNSS time, so observations carry the wrong time. Set the clock, for example with the set-system-time plugin.'

/** GNSS time `offsetMs` away from the system clock, as a receiver sends it. */
const gnss = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()

describe('the clock check', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('shows an error when the system clock is more than 60 s ahead of GNSS time, and still reports', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.emit(DATETIME, gnss(-61000))
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().type, 'error')
    assert.equal(env.dashboard().message, AHEAD)
    assert.equal(env.gets().length, 1)
    env.plugin.stop()
  })

  it('shows an error when the system clock is more than 60 s behind GNSS time', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.emit(DATETIME, gnss(61000))
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().message, BEHIND)
    assert.equal(env.gets().length, 1)
    env.plugin.stop()
  })

  it('shows nothing while the two agree within 60 s', async () => {
    for (const offsetMs of [-59000, 0, 59000]) {
      const env = createEnv({ live: false })
      env.plugin.start(config())
      env.emit(DATETIME, gnss(offsetMs))
      await advance(WARM_UP_MS)
      assert.equal(env.dashboard().type, 'status')
      assert.deepEqual(env.errors, [])
      env.plugin.stop()
    }
  })

  it('keeps one text while the difference wanders, so that the dashboard does not flicker', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.emit(DATETIME, gnss(-61000))
    await advance(1000)
    env.emit(DATETIME, gnss(-75000))
    await advance(1000)
    env.emit(DATETIME, gnss(-3600000))
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, [AHEAD])
    env.plugin.stop()
  })

  it('clears the error once the clock agrees with GNSS time again', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.emit(DATETIME, gnss(-61000))
    await advance(WARM_UP_MS)
    env.emit(DATETIME, gnss(0))
    await advance(1000)
    assert.equal(env.dashboard().type, 'status')
    assert.equal(env.dashboard().lastError, AHEAD)
    env.plugin.stop()
  })

  it('stops judging the clock once GNSS time is older than the age limit', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.emit(DATETIME, gnss(-61000))
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().message, AHEAD)
    await advance(3 * FIVE_MINUTES_MS + 1000)
    assert.equal(env.dashboard().type, 'status')
    env.plugin.stop()
  })

  it('stops judging the clock after 15 minutes without GNSS time when the age check is switched off', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config({ logic: { interval: 5, minMove: 300, forceUpdate: false, maxAge: 0 } }))
    env.emit(DATETIME, gnss(-61000))
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().message, AHEAD)
    await advance(3 * FIVE_MINUTES_MS)
    assert.equal(env.dashboard().type, 'status')
    env.plugin.stop()
  })

  it('takes one source that agrees as enough, so that a device with its own clock does not turn the error on and off', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    for (let i = 0; i < 30; i++) {
      env.emit(DATETIME, gnss(0), 'gnss')
      env.emit(DATETIME, gnss(-120000), 'display')
      await advance(1000)
    }
    assert.deepEqual(env.errors, [])
    env.plugin.stop()
  })

  it('shows the error when every source is off, and names the direction of the closest one', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.emit(DATETIME, gnss(-90000), 'gnss')
    env.emit(DATETIME, gnss(300000), 'display')
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().message, AHEAD)
    env.plugin.stop()
  })

  it('does not take a GNSS time before October 2026, which a receiver without a fix may send', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.emit(DATETIME, '1980-01-06T00:00:00.000Z')
    env.emit(DATETIME, 'not a time')
    env.emit(DATETIME, 1792000000)
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().type, 'status')
    env.plugin.stop()
  })

  it('does not take the GNSS time the server held before the plugin started', async () => {
    const tree = fullTree()
    // Sent by the receiver an hour ago; as a value it says nothing about
    // the clock now.
    tree.navigation.datetime = { value: new Date(Date.now() - 3600000).toISOString(), timestamp: new Date(Date.now() - 3600000).toISOString() }
    const env = createEnv({ tree, live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().type, 'status')
    env.plugin.stop()
  })

  it('does nothing when no GNSS time is published', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.dashboard().type, 'status')
    assert.deepEqual(env.errors, [])
    env.plugin.stop()
  })

  it('subscribes to navigation.datetime', () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    assert.ok(env.subscriptions[0].paths.includes(DATETIME))
    env.plugin.stop()
  })
})
