'use strict'

/*
 * Conversion from Signal K base units to the units Windy expects, the
 * handling of missing values, the gust rule and the path overrides.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { WARM_UP_MS, FIVE_MINUTES_MS, config, fullTree, createEnv, advance, setUp, tearDown } = require('../test-support/harness')

/** Runs one cycle on the given tree and returns the observation parameters. */
async function observationFor (tree, overrides) {
  const env = createEnv({ tree })
  env.plugin.start(config(overrides))
  await advance(WARM_UP_MS)
  const get = env.gets()[0]
  env.plugin.stop()
  return get ? get.params : null
}

describe('unit conversion', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('sends wind speed and gust in metres per second with one decimal', async () => {
    const tree = fullTree()
    tree.environment.wind.speedOverGround.value = 12.3456
    tree.environment.wind.gust.value = 15.55
    const params = await observationFor(tree)
    assert.equal(params.wind, '12.3')
    assert.equal(params.gust, '15.6')
  })

  it('converts temperature from kelvin to degrees Celsius', async () => {
    const tree = fullTree()
    tree.environment.outside.temperature.value = 273.15
    assert.equal((await observationFor(tree)).temp, '0.0')
    tree.environment.outside.temperature.value = 268.05
    assert.equal((await observationFor(tree)).temp, '-5.1')
  })

  it('sends pressure in pascals, rounded to a whole number', async () => {
    const tree = fullTree()
    tree.environment.outside.pressure.value = 100876.6
    assert.equal((await observationFor(tree)).pressure, '100877')
  })

  it('converts humidity from a ratio to a percentage', async () => {
    const tree = fullTree()
    tree.environment.outside.relativeHumidity.value = 0.726
    assert.equal((await observationFor(tree)).rh, '73')
  })

  it('converts wind direction from radians to whole degrees', async () => {
    const tree = fullTree()
    tree.environment.wind.directionTrue.value = Math.PI / 2
    assert.equal((await observationFor(tree)).winddir, '90')
  })

  it('reports wind from due north as 0, never as 360', async () => {
    const tree = fullTree()
    tree.environment.wind.directionTrue.value = 2 * Math.PI
    assert.equal((await observationFor(tree)).winddir, '0')
    tree.environment.wind.directionTrue.value = 6.28
    assert.equal((await observationFor(tree)).winddir, '0')
    tree.environment.wind.directionTrue.value = 0
    assert.equal((await observationFor(tree)).winddir, '0')
  })
})

describe('missing values', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('leaves out a parameter whose path is absent', async () => {
    const tree = fullTree()
    delete tree.environment.outside.relativeHumidity
    delete tree.environment.outside.pressure
    const params = await observationFor(tree)
    assert.ok(!('rh' in params))
    assert.ok(!('pressure' in params))
    assert.equal(params.temp, '20.0')
  })

  it('leaves out a parameter whose value is null', async () => {
    const tree = fullTree()
    tree.environment.outside.temperature.value = null
    tree.environment.wind.directionTrue.value = null
    const params = await observationFor(tree)
    assert.ok(!('temp' in params))
    assert.ok(!('winddir' in params))
    assert.equal(params.wind, '5.1')
  })
})

describe('gust', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('reports the highest wind speed seen since the last report when it exceeds the gust path', async () => {
    const env = createEnv()
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 6.0)
    env.emit('environment.wind.speedOverGround', 9.44)
    env.emit('environment.wind.speedOverGround', 4.0)
    await advance(WARM_UP_MS)
    assert.equal(env.gets()[0].params.gust, '9.4')
    env.plugin.stop()
  })

  it('keeps the gust path value when it is the higher of the two', async () => {
    const env = createEnv()
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 6.0)
    await advance(WARM_UP_MS)
    assert.equal(env.gets()[0].params.gust, '7.2')
    env.plugin.stop()
  })

  it('reports the observed peak when there is no gust path', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree })
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 8.26)
    await advance(WARM_UP_MS)
    assert.equal(env.gets()[0].params.gust, '8.3')
    env.plugin.stop()
  })

  it('starts a new peak after each successful report', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree })
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 12.0)
    await advance(WARM_UP_MS)
    assert.equal(env.gets()[0].params.gust, '12.0')
    env.emit('environment.wind.speedOverGround', 3.0)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.gets()[1].params.gust, '3.0')
    env.plugin.stop()
  })

  it('keeps the peak when the report fails, so the next report still carries it', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree })
    env.get = async () => { throw new Error('socket hang up') }
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 12.0)
    await advance(WARM_UP_MS)
    env.get = async () => ({ status: 200, data: {} })
    env.emit('environment.wind.speedOverGround', 3.0)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.gets()[1].params.gust, '12.0')
    env.plugin.stop()
  })
})

describe('path overrides', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('reads every sensor from its configured path', async () => {
    const tree = {
      navigation: fullTree().navigation,
      custom: {
        ws: { value: 3.0 },
        wg: { value: 4.0 },
        wd: { value: Math.PI / 4 },
        t: { value: 283.15 },
        p: { value: 99000 },
        h: { value: 0.4 }
      }
    }
    const params = await observationFor(tree, {
      pathMap: { windSpeed: 'custom.ws', windGust: 'custom.wg', windDir: 'custom.wd', temp: 'custom.t', pressure: 'custom.p', humidity: 'custom.h' }
    })
    assert.deepEqual(
      { wind: params.wind, gust: params.gust, winddir: params.winddir, temp: params.temp, pressure: params.pressure, rh: params.rh },
      { wind: '3.0', gust: '4.0', winddir: '45', temp: '10.0', pressure: '99000', rh: '40' }
    )
  })

  it('subscribes to position and to the configured wind speed path once a second', () => {
    const env = createEnv()
    env.plugin.start(config({ pathMap: { windSpeed: 'custom.ws' } }))
    assert.equal(env.subscriptions.length, 1)
    assert.deepEqual(env.subscriptions[0].command, {
      context: 'vessels.self',
      subscribe: [
        { path: 'navigation.position', period: 1000 },
        { path: 'custom.ws', period: 1000 }
      ]
    })
    env.plugin.stop()
  })
})
