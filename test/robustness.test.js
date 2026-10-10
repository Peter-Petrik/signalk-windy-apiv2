'use strict'

/*
 * Bad data: values a sensor path should never hold, positions without
 * coordinates, and readings outside the range Windy accepts. None of them
 * may stop the reporting loop, and none may cost the readings that are sound.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')

/** Runs one cycle on the given tree and returns the observation parameters. */
async function observationFor (tree, overrides) {
  const env = createEnv({ tree })
  env.plugin.start(config(overrides))
  await advance(WARM_UP_MS)
  const get = env.gets()[0]
  env.plugin.stop()
  return { params: get ? get.params : null, env }
}

describe('the reporting loop', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('goes on after a cycle that fails in an unforeseen way', async () => {
    const env = createEnv()
    const read = env.app.getSelfPath
    let broken = true
    env.app.getSelfPath = (skPath) => {
      if (broken) throw new Error('data tree unavailable')
      return read(skPath)
    }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.requests.length, 0)
    assert.deepEqual(env.errors, ['Reporting cycle failed: data tree unavailable'])
    assert.ok(env.errorLines.some((line) => line.startsWith('Reporting cycle failed: ')))

    broken = false
    await advance(FIVE_MINUTES_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    env.plugin.stop()
  })

  it('goes on when the position has no coordinates at the moment a station update is due', async () => {
    const tree = fullTree()
    tree.navigation.position.value = { latitude: null, longitude: null }
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    // No station update, but the observation is sent.
    assert.deepEqual(env.requests.map((r) => r.method), ['GET'])
    assert.deepEqual(env.errors, [])

    env.tree.navigation.position.value = { latitude: 37.5, longitude: 23.4 }
    await advance(FIVE_MINUTES_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['GET', 'PUT', 'GET'])
    env.plugin.stop()
  })

  it('goes on when a sensor path holds text', async () => {
    const tree = fullTree()
    tree.environment.wind.speedOverGround.value = 'n/a'
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.gets().length, 2)
    assert.ok(!('wind' in env.gets()[0].params))
    assert.equal(env.gets()[0].params.temp, '20.0')
    env.plugin.stop()
  })
})

describe('values that are not numbers', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('leaves out each reading that is not a finite number and reports the rest', async () => {
    const tree = fullTree()
    tree.environment.wind.speedOverGround.value = NaN
    tree.environment.wind.gust.value = '7.2'
    tree.environment.wind.directionTrue.value = Infinity
    tree.environment.outside.temperature.value = { celsius: 20 }
    tree.environment.outside.pressure.value = true
    const { params, env } = await observationFor(tree)
    assert.deepEqual(Object.keys(params).sort(), ['id', 'rh', 'ts'])
    assert.equal(params.rh, '65')
    assert.equal(env.debugLines.filter((line) => line.startsWith('Reading ignored: ')).length, 5)
  })

  it('leaves out a reading whose node has no value at all', async () => {
    const tree = fullTree()
    tree.environment.outside.temperature = {}
    const { params } = await observationFor(tree)
    assert.ok(!('temp' in params))
    assert.equal(params.wind, '5.1')
  })

  it('sends elevation 0 when the altitude is not a number', async () => {
    const tree = fullTree()
    tree.navigation.gnss = { antennaAltitude: { value: null } }
    const { env } = await observationFor(tree)
    assert.equal(env.puts()[0].body.elev_m, 0)
  })

  it('uses navigation.altitude when the antenna altitude holds no number', async () => {
    const tree = fullTree()
    tree.navigation.gnss = { antennaAltitude: { value: null } }
    tree.navigation.altitude = { value: 4.6 }
    const { env } = await observationFor(tree)
    assert.equal(env.puts()[0].body.elev_m, 5)
  })

  it('does not take a wind sample that is not a number as the peak', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree })
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 6.0)
    env.emit('environment.wind.speedOverGround', '99')
    env.emit('environment.wind.speedOverGround', NaN)
    env.emit('environment.wind.speedOverGround', null)
    await advance(WARM_UP_MS)
    assert.equal(env.gets()[0].params.gust, '6.0')
    env.plugin.stop()
  })

  it('ignores a delta that is not shaped like one', () => {
    const env = createEnv()
    env.plugin.start(config())
    const { callback } = env.subscriptions[0]
    for (const delta of [null, {}, { updates: null }, { updates: [null] }, { updates: [{}] }, { updates: [{ values: [null] }] }]) {
      assert.doesNotThrow(() => callback(delta))
    }
    env.plugin.stop()
  })
})

describe('values outside the range Windy accepts', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  // Windy rejects the whole observation when one field is out of range.

  it('leaves out humidity published as a percentage instead of a ratio', async () => {
    const tree = fullTree()
    tree.environment.outside.humidity.value = 65
    const { params, env } = await observationFor(tree)
    assert.ok(!('rh' in params))
    assert.equal(params.pressure, '101325')
    assert.ok(env.debugLines.some((line) => /environment\.outside\.humidity gives rh=6500, outside Windy's range 0 to 100/.test(line)))
  })

  it('leaves out pressure published in hectopascal instead of pascal', async () => {
    const tree = fullTree()
    tree.environment.outside.pressure.value = 1013.25
    const { params } = await observationFor(tree)
    assert.ok(!('pressure' in params))
    assert.equal(params.temp, '20.0')
  })

  it('leaves out temperature published in degrees Celsius instead of kelvin', async () => {
    const tree = fullTree()
    tree.environment.outside.temperature.value = 20
    const { params } = await observationFor(tree)
    assert.ok(!('temp' in params))
    assert.equal(params.wind, '5.1')
  })

  it('leaves out a negative wind speed and a wind speed beyond 200 m/s', async () => {
    for (const speed of [-0.5, 200.1]) {
      const tree = fullTree()
      tree.environment.wind.speedOverGround.value = speed
      const { params } = await observationFor(tree)
      assert.ok(!('wind' in params), `wind ${speed} was sent`)
    }
  })

  it('keeps values on the edge of each range', async () => {
    const tree = fullTree()
    tree.environment.wind.speedOverGround.value = 0
    tree.environment.wind.gust.value = 0
    tree.environment.outside.humidity.value = 1
    tree.environment.outside.pressure.value = 50000
    tree.environment.outside.temperature.value = 173.15
    const { params } = await observationFor(tree)
    assert.equal(params.wind, '0.0')
    assert.equal(params.gust, '0.0')
    assert.equal(params.rh, '100')
    assert.equal(params.pressure, '50000')
    assert.equal(params.temp, '-100.0')
  })

  it('falls back to the observed peak when the gust path is out of range', async () => {
    const tree = fullTree()
    tree.environment.wind.gust.value = 999
    const env = createEnv({ tree })
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 8.0)
    await advance(WARM_UP_MS)
    assert.equal(env.gets()[0].params.gust, '8.0')
    env.plugin.stop()
  })

  it('does not take a wind sample beyond the gust range as the peak', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree })
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 9.0)
    env.emit('environment.wind.speedOverGround', 5000)
    await advance(WARM_UP_MS)
    assert.equal(env.gets()[0].params.gust, '9.0')
    env.plugin.stop()
  })

  it('folds a negative or oversized wind direction into 0 to 359', async () => {
    const cases = [[-0.5, '331'], [-Math.PI / 2, '270'], [3 * Math.PI, '180'], [-2 * Math.PI, '0']]
    for (const [radians, degrees] of cases) {
      const tree = fullTree()
      tree.environment.wind.directionTrue.value = radians
      const { params } = await observationFor(tree)
      assert.equal(params.winddir, degrees, `direction ${radians} rad`)
    }
  })
})

describe('positions', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  /** Starts the plugin and completes the first cycle at 37.5 N, 23.4 E. */
  async function started (tree) {
    const env = createEnv(tree ? { tree } : {})
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    return env
  }

  it('ignores a position without coordinates instead of measuring to it', async () => {
    const env = await started()
    env.emit('navigation.position', { latitude: null, longitude: null })
    env.emit('navigation.position', { latitude: 'x', longitude: 23.4 })
    env.emit('navigation.position', { latitude: 37.5 })
    env.emit('navigation.position', 'no fix')
    env.emit('navigation.position', { latitude: 95, longitude: 23.4 })
    await advance(1000)
    assert.match(env.lastStatus(), /Δ0m/)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 1)
    env.plugin.stop()
  })

  it('does not take a position without coordinates as the baseline', async () => {
    const tree = fullTree()
    delete tree.navigation
    const env = createEnv({ tree })
    env.plugin.start(config())
    env.emit('navigation.position', { latitude: null, longitude: null })
    env.emit('navigation.position', { latitude: 37.5, longitude: 23.4 })
    env.emit('navigation.position', { latitude: 37.501, longitude: 23.4 })
    await advance(1000)
    assert.match(env.lastStatus(), /Δ111m/)
    env.plugin.stop()
  })

  it('measures the short way across the 180° meridian', async () => {
    const tree = fullTree()
    tree.navigation.position.value = { latitude: 0, longitude: 179.9999 }
    const env = await started(tree)
    // 0.0002 degrees of longitude on the equator is about 22 m.
    env.emit('navigation.position', { latitude: 0, longitude: -179.9999 })
    await advance(1000)
    assert.match(env.lastStatus(), /Δ22m/)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 1)
    env.plugin.stop()
  })

  it('takes a position on the equator as a baseline like any other', async () => {
    const tree = fullTree()
    tree.navigation.position.value = { latitude: 0, longitude: 10 }
    const env = await started(tree)
    // 0.001 degrees of latitude is about 111 m.
    env.emit('navigation.position', { latitude: 0.001, longitude: 10 })
    await advance(1000)
    assert.match(env.lastStatus(), /Δ111m/)
    env.plugin.stop()
  })
})
