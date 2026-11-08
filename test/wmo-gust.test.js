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

  it('is marked with a dash on the dashboard when the wind is sent and no 3 seconds of live values give a gust', async () => {
    // At the first report only the values the server held at the start have
    // arrived, and they never count towards the WMO gust.
    const env = await startedEnv(wmo())
    assert.notEqual(lastParams(env).wind, undefined)
    assert.equal(lastParams(env).gust, undefined)
    assert.match(env.lastStatus(), / W:\d+\.\d G:- D:/)
    // Live values with a gap every 2 seconds never cover 3 seconds either.
    for (let i = 0; i < 150; i++) {
      env.emit(SPEED, null)
      await advance(1000)
      env.emit(SPEED, 6.0)
      await advance(1000)
    }
    assert.equal(lastParams(env).wind, '6.0')
    assert.equal(lastParams(env).gust, undefined)
    assert.match(env.lastStatus(), / W:11\.7 G:- D:/)
    // Once 3 seconds are covered, the gust is back.
    env.emit(SPEED, 6.0)
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).gust, '6.0')
    assert.match(env.lastStatus(), / W:11\.7 G:11\.7 D:/)
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

  it('does not subscribe to the Wind Gust path, and the form says that it is not used', async () => {
    const env = createEnv({ tree: fullTree() })
    env.plugin.start(config(wmo()))
    assert.ok(!env.subscriptions[0].paths.includes(GUST))
    await advance(60000)
    env.emit(GUST, 15.0, 'other')
    const field = env.plugin.schema().properties.pathMap.properties.windGust
    assert.equal(field.description, 'Not used with Gust Calculation set to WMO.')
    env.plugin.stop()
  })

  it('still reads a Wind Gust path that is also the wind speed path, as the wind speed', async () => {
    const env = createEnv({ tree: fullTree(), live: false })
    env.plugin.start(config({ ...wmo(), pathMap: { windGust: SPEED } }))
    assert.ok(env.subscriptions[0].paths.includes(SPEED))
    env.emit(SPEED, 6.0)
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).wind, '6.0')
    assert.equal(lastParams(env).gust, '6.0')
    env.plugin.stop()
  })
})

describe('the default gust', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('subscribes to the Wind Gust path', () => {
    const env = createEnv()
    env.plugin.start(config())
    assert.ok(env.subscriptions[0].paths.includes(GUST))
    env.plugin.stop()
  })

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

describe('the highest running mean of the samples, more cases', () => {
  it('is null when no 3 seconds of values lie between the gaps', () => {
    const s = createSamples(0)
    s.add('w', null, 0)
    s.add('w', 14, 10000)
    s.add('w', null, 12000)
    assert.equal(s.maxRunningMean('w', 0, 60000, 3000), null)
  })

  it('is found where a stretch ends on a step, after a burst shorter than 3 seconds', () => {
    const s = createSamples(0)
    s.add('w', 8, 0)
    s.add('w', 10, 10000)
    s.add('w', 2, 12000)
    // The stretch 9 s to 12 s: (1 × 8 + 2 × 10) / 3.
    assert.equal(s.maxRunningMean('w', 0, 60000, 3000), 28 / 3)
  })

  it('does not count a stretch with a gap of a few milliseconds', () => {
    const s = createSamples(0)
    s.add('w', 20, 0)
    s.add('w', null, 1000)
    s.add('w', 20, 1003)
    assert.equal(s.maxRunningMean('w', 0, 3500, 3000), null)
  })
})

describe('the WMO gust with a stale wind speed', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is left out with the wind speed, although the interval holds earlier values', async () => {
    const env = createEnv({ tree: fullTree(), live: false })
    env.plugin.start(config({ logic: { interval: 5, minMove: 300, forceUpdate: false, gustMethod: 'wmo', maxAge: 1 } }))
    await advance(WARM_UP_MS)
    env.emit(SPEED, 7.0)
    await advance(FIVE_MINUTES_MS - 10000)
    // The temperature stays fresh, so that the report is sent.
    env.emit('environment.outside.temperature', 293.15)
    await advance(10000)
    assert.equal(env.gets().length, 2)
    assert.equal(lastParams(env).wind, undefined)
    assert.equal(lastParams(env).gust, undefined)
    env.plugin.stop()
  })
})
