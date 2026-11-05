'use strict'

/*
 * The WMO gust: with Gust Calculation set to WMO, the gust is the highest
 * 3-second mean of the wind speed in the reporting interval (WMO-No. 8),
 * the Wind Gust path is not used, and the wind speed is subscribed four
 * times a second. With the default the gust is unchanged.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')
const { schema, resolveOptions } = require('../lib/schema')
const { createSamples } = require('../lib/samples')

const SPEED = 'environment.wind.speedOverGround'
const GUST = 'environment.wind.gust'

const lastParams = (env) => env.gets()[env.gets().length - 1].params
const wmo = () => ({ logic: { interval: 5, minMove: 300, forceUpdate: false, gustMethod: 'wmo' } })

/** Starts the plugin without simulated sensors and waits for the first report. */
async function startedEnv (overrides) {
  const env = createEnv({ tree: fullTree(), live: false })
  env.plugin.start(config(overrides))
  await advance(WARM_UP_MS)
  return env
}

describe('the WMO gust', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is the highest 3-second mean, so that a single spike does not decide it', async () => {
    const env = await startedEnv(wmo())
    env.emit(SPEED, 5.0)
    await advance(100000)
    env.emit(SPEED, 20.0)
    await advance(1000)
    env.emit(SPEED, 5.0)
    await advance(FIVE_MINUTES_MS - 101000)
    // One second of 20 m/s and two of 5 m/s.
    assert.equal(lastParams(env).gust, '10.0')
    assert.equal(lastParams(env).wind, '5.0')
    env.plugin.stop()
  })

  it('is the speed of a burst that lasts at least 3 seconds', async () => {
    const env = await startedEnv(wmo())
    env.emit(SPEED, 5.0)
    await advance(100000)
    env.emit(SPEED, 12.0)
    await advance(5000)
    env.emit(SPEED, 5.0)
    await advance(FIVE_MINUTES_MS - 105000)
    assert.equal(lastParams(env).gust, '12.0')
    env.plugin.stop()
  })

  it('does not use the Wind Gust path', async () => {
    const env = await startedEnv(wmo())
    env.emit(SPEED, 5.0)
    await advance(10000)
    env.emit(GUST, 15.0)
    await advance(FIVE_MINUTES_MS - 10000)
    assert.equal(lastParams(env).gust, '5.0')
    env.plugin.stop()
  })

  it('does not count a burst cut short by a gap as a 3-second mean', async () => {
    const env = await startedEnv(wmo())
    env.emit(SPEED, 5.0)
    await advance(100000)
    env.emit(SPEED, null)
    await advance(1000)
    env.emit(SPEED, 14.0)
    await advance(2000)
    env.emit(SPEED, 5.0)
    await advance(FIVE_MINUTES_MS - 103000)
    // Two seconds of 14 m/s after the gap, then 5 m/s: (2 × 14 + 5) / 3.
    assert.equal(lastParams(env).gust, '11.0')
    env.plugin.stop()
  })

  it('is 0.0 in a calm', async () => {
    const env = await startedEnv(wmo())
    env.emit(SPEED, 0)
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).gust, '0.0')
    env.plugin.stop()
  })

  it('is left out with the wind speed when the wind speed is not sent', async () => {
    const env = await startedEnv(wmo())
    env.emit(SPEED, 250)
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).wind, undefined)
    assert.equal(lastParams(env).gust, undefined)
    env.plugin.stop()
  })

  it('subscribes to the wind speed four times a second and to every other path once a second', () => {
    const env = createEnv()
    env.plugin.start(config(wmo()))
    for (const row of env.subscriptions[0].command.subscribe) {
      assert.equal(row.period, row.path === SPEED ? 250 : 1000, row.path)
    }
    env.plugin.stop()
  })
})

describe('the default gust', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is still the highest value, a single spike included', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 5.0)
    await advance(100000)
    env.emit(SPEED, 20.0)
    await advance(1000)
    env.emit(SPEED, 5.0)
    await advance(FIVE_MINUTES_MS - 101000)
    assert.equal(lastParams(env).gust, '20.0')
    env.plugin.stop()
  })
})

describe('the Gust Calculation setting', () => {
  it('offers the highest value and the WMO gust, with the highest value as the default', () => {
    const setting = schema.properties.logic.properties.gustMethod
    assert.deepEqual(setting.enum, ['peak', 'wmo'])
    assert.equal(setting.default, 'peak')
    assert.match(setting.description, /3 seconds/)
    assert.match(setting.description, /No height correction/)
  })

  it('keeps the highest value for a configuration without the setting or with an unknown value', () => {
    assert.equal(resolveOptions({ logic: {} }).gustMethod, 'peak')
    assert.equal(resolveOptions({ logic: { gustMethod: 'gust3s' } }).gustMethod, 'peak')
    assert.equal(resolveOptions({ logic: { gustMethod: 'wmo' } }).gustMethod, 'wmo')
  })
})

describe('the highest running mean of the samples', () => {
  it('is found between samples, where a stretch overlaps two values', () => {
    const s = createSamples(0)
    s.add('w', 4, 0)
    s.add('w', 10, 10000)
    s.add('w', 4, 11500)
    // At most 1.5 s of 10 fits in any 3 s: (1.5 × 10 + 1.5 × 4) / 3.
    assert.equal(s.maxRunningMean('w', 0, 60000, 3000), 7)
  })

  it('is null for a window shorter than the stretch, or without values', () => {
    const s = createSamples(0)
    assert.equal(s.maxRunningMean('w', 0, 60000, 3000), null)
    s.add('w', 4, 0)
    assert.equal(s.maxRunningMean('w', 0, 2000, 3000), null)
  })

  it('does not count a value the server held at the start', () => {
    const s = createSamples(0)
    s.add('w', 30, 0, false)
    s.add('w', 5, 20000)
    assert.equal(s.maxRunningMean('w', 0, 60000, 3000), 5)
  })

  it('does not count a value after it has stopped standing', () => {
    const s = createSamples(10000)
    s.add('w', 8, 0)
    // The value stands for 10 s, the Maximum Reading Age of this store; the
    // next one arrives at 30 s.
    s.add('w', 5, 30000)
    assert.equal(s.maxRunningMean('w', 0, 60000, 3000), 8)
    assert.equal(s.maxRunningMean('w', 12000, 60000, 3000), 5)
  })
})
