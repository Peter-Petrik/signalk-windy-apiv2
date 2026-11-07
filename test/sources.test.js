'use strict'

/*
 * Several sources on one path: without a source priority the Signal K server
 * passes the plugin the values of every source that publishes a path, and
 * the readings switch between them. The configuration form shows which
 * source each path is received from and warns of a path whose values switch
 * between sources, and the dashboard line starts with a warning triangle
 * while that lasts. A single pause of a prioritised source, after which the
 * server passes the next source for a while, does not raise the warning.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')
const { schema } = require('../lib/schema')
const { createSources, SWITCHES_FOR_WARNING } = require('../lib/sources')

const SPEED = 'environment.wind.speedOverGround'
const DATETIME = 'navigation.datetime'
const ALTITUDE = 'navigation.gnss.antennaAltitude'
const TRIANGLE = '⚠ '

const logic = (overrides) => ({ logic: { interval: 5, minMove: 300, forceUpdate: false, ...overrides } })
const pathField = (form, key) => form.properties.pathMap.properties[key]

/**
 * Starts the plugin with every path published once a minute by the source
 * "test", and waits for the first of those live values.
 */
async function startedEnv (overrides, envOptions = {}) {
  const env = createEnv({ tree: fullTree(), ...envOptions })
  env.plugin.start(config(overrides))
  await advance(60000)
  return env
}

/** A second source on a path, taking turns with "test" every second, as without a source priority. */
async function takeTurns (env, skPath, other, seconds, value = 4.0) {
  for (let i = 0; i < seconds; i++) {
    env.emit(skPath, value, other)
    env.emit(skPath, value, 'test')
    await advance(1000)
  }
}

describe('a path received from one source', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is named on its configuration field, and the form carries no warning', async () => {
    const env = await startedEnv()
    await advance(15 * 60000)
    const form = env.plugin.schema()
    assert.equal(pathField(form, 'windSpeed').description, 'Received from test in the last 15 minutes.')
    assert.equal(form.description, undefined)
    assert.ok(!env.lastStatus().startsWith(TRIANGLE), env.lastStatus())
    env.plugin.stop()
  })

  it('is counted since the start while the plugin has run for less than the time counted', async () => {
    const env = await startedEnv()
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from test since the plugin started.')
    env.plugin.stop()
  })

  it('says so on a field whose path has received nothing', async () => {
    const env = await startedEnv({ pathMap: { dewPoint: 'environment.outside.nothing' } })
    assert.equal(pathField(env.plugin.schema(), 'dewPoint').description, 'Nothing received since the plugin started.')
    env.plugin.stop()
  })

  it('names the time counted in seconds below two minutes and in minutes above', async () => {
    const env = await startedEnv(logic({ maxAge: 0.5 }))
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from test in the last 30 seconds.')
    env.plugin.stop()
    const longer = await startedEnv(logic({ maxAge: 2.5 }))
    await advance(3 * 60000)
    assert.equal(pathField(longer.plugin.schema(), 'windSpeed').description, 'Received from test in the last 2.5 minutes.')
    longer.plugin.stop()
  })

  it('names the fallback humidity path only when the field takes its values from it', async () => {
    const tree = fullTree()
    delete tree.environment.outside.humidity
    tree.environment.outside.relativeHumidity = { value: 0.65 }
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS + 60000)
    assert.equal(pathField(env.plugin.schema(), 'humidity').description,
      'Received from test on environment.outside.relativeHumidity since the plugin started.')
    env.emit('environment.outside.humidity', 0.7, 'other')
    assert.equal(pathField(env.plugin.schema(), 'humidity').description, 'Received from other since the plugin started.')
    env.plugin.stop()
  })
})

describe('a path whose values switch between sources', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('puts a warning at the top of the form and a triangle at the start of the dashboard line', async () => {
    const env = await startedEnv()
    await takeTurns(env, SPEED, 'derived-data', 2)
    const form = env.plugin.schema()
    assert.match(form.description, /^⚠ Values switching between several sources since the plugin started: environment\.wind\.speedOverGround \(derived-data, test\)\. /)
    assert.match(form.description, /Data > Priorities/)
    assert.equal(pathField(form, 'windSpeed').description, 'Received from derived-data, test since the plugin started.')
    assert.ok(env.lastStatus().startsWith(`${TRIANGLE}Next: `), env.lastStatus())
    env.plugin.stop()
  })

  it('clears both once the values have not switched for the Maximum Reading Age', async () => {
    const env = await startedEnv(logic({ maxAge: 5 }))
    await takeTurns(env, SPEED, 'derived-data', 2)
    assert.ok(env.lastStatus().startsWith(TRIANGLE))
    await advance(5 * 60000)
    assert.equal(env.plugin.schema().description, undefined)
    assert.ok(!env.lastStatus().startsWith(TRIANGLE), env.lastStatus())
    env.plugin.stop()
  })

  it('is counted over 15 minutes when the age check is switched off', async () => {
    const env = await startedEnv(logic({ maxAge: 0 }))
    await takeTurns(env, SPEED, 'derived-data', 2)
    await advance(14 * 60000)
    assert.match(env.plugin.schema().description, /\(derived-data, test\)/)
    await advance(2 * 60000)
    assert.equal(env.plugin.schema().description, undefined)
    env.plugin.stop()
  })

  it('names every such path, and keeps the dashboard line within 80 characters', async () => {
    const env = await startedEnv()
    for (let i = 0; i < 2; i++) {
      env.emit('navigation.position', { latitude: 37.5, longitude: 23.4 }, 'gps2')
      env.emit('navigation.position', { latitude: 37.5, longitude: 23.4 }, 'test')
      await takeTurns(env, SPEED, 'derived-data', 1)
    }
    await advance(FIVE_MINUTES_MS)
    assert.match(env.plugin.schema().description, /environment\.wind\.speedOverGround \(derived-data, test\); navigation\.position \(gps2, test\)\./)
    assert.ok(env.lastStatus().startsWith(TRIANGLE))
    assert.ok(env.lastStatus().length <= 80, `${env.lastStatus().length}: ${env.lastStatus()}`)
    env.plugin.stop()
  })

  it('leaves an error line as it is', async () => {
    const env = await startedEnv({ pathMap: { windSpeed: 'environment.wind.speedApparent' } })
    await takeTurns(env, 'environment.wind.speedApparent', 'other', 2, 6.0)
    assert.match(env.plugin.schema().description, /environment\.wind\.speedApparent \(other, test\)/)
    assert.equal(env.dashboard().type, 'error')
    assert.ok(!env.dashboard().message.startsWith(TRIANGLE), env.dashboard().message)
    env.plugin.stop()
  })
})

describe('what does not raise the warning', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('one pause of the preferred source, during which the server passes the next one', async () => {
    const env = await startedEnv()
    // "test" pauses; the server passes "backup" for a while, then "test" again.
    env.emit(SPEED, 4.0, 'backup')
    await advance(1000)
    env.emit(SPEED, 4.1, 'backup')
    await advance(60000)
    const form = env.plugin.schema()
    assert.equal(pathField(form, 'windSpeed').description, 'Received from backup, test since the plugin started.')
    assert.equal(form.description, undefined)
    assert.ok(!env.lastStatus().startsWith(TRIANGLE), env.lastStatus())
    env.plugin.stop()
  })

  it('a value the server held from another source when the plugin started', async () => {
    const env = await startedEnv({}, { held: [{ path: SPEED, value: 3.0, timestamp: new Date().toISOString(), source: 'old' }] })
    assert.equal(env.plugin.schema().description, undefined)
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from test since the plugin started.')
    env.plugin.stop()
  })

  it('a null or a missing value from another source', async () => {
    const env = await startedEnv()
    for (let i = 0; i < 3; i++) {
      env.emit(SPEED, null, 'other')
      env.emit(SPEED, undefined, 'third')
      env.emit(SPEED, 4.0, 'test')
      await advance(1000)
    }
    assert.equal(env.plugin.schema().description, undefined)
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from test since the plugin started.')
    env.plugin.stop()
  })

  it('GNSS time from several sources, which the clock check judges one by one', async () => {
    const env = await startedEnv()
    for (let i = 0; i < 3; i++) {
      const now = new Date().toISOString()
      env.emit(DATETIME, now, 'gps1')
      env.emit(DATETIME, now, 'gps2')
      await advance(1000)
    }
    assert.equal(env.plugin.schema().description, undefined)
    env.plugin.stop()
  })

  it('the altitude while a Station Elevation is set, because it is then not read', async () => {
    const elevation = { identity: { ...config().identity, elevation: 3 } }
    const env = await startedEnv(elevation)
    await takeTurns(env, ALTITUDE, 'gps2', 3, 12)
    assert.equal(env.plugin.schema().description, undefined)
    env.plugin.stop()
    const withoutElevation = await startedEnv()
    await takeTurns(withoutElevation, ALTITUDE, 'gps2', 3, 12)
    assert.match(withoutElevation.plugin.schema().description, /navigation\.gnss\.antennaAltitude \(gps2, test\)/)
    withoutElevation.plugin.stop()
  })
})

describe('the form while the plugin is not running', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is the plain form, before a start, without credentials and after a stop', async () => {
    const env = createEnv({ tree: fullTree() })
    assert.equal(env.plugin.schema(), schema)
    env.plugin.start({})
    assert.equal(env.plugin.schema(), schema)
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.notEqual(env.plugin.schema(), schema)
    env.plugin.stop()
    assert.equal(env.plugin.schema(), schema)
  })

  it('leaves the plain form unchanged when a form with sources is built', async () => {
    const before = JSON.stringify(schema)
    const env = await startedEnv()
    await takeTurns(env, SPEED, 'derived-data', 2)
    env.plugin.schema()
    assert.equal(JSON.stringify(schema), before)
    env.plugin.stop()
  })

  it('falls back to the plain form, and logs why, when building the form fails', async () => {
    const env = await startedEnv()
    // An unexpected value in the store of sources makes the form fail.
    const originalSort = Array.prototype.sort
    Array.prototype.sort = function () { throw new Error('broken store') } // eslint-disable-line no-extend-native
    let form
    try {
      form = env.plugin.schema()
    } finally {
      Array.prototype.sort = originalSort // eslint-disable-line no-extend-native
    }
    assert.equal(form, schema)
    assert.ok(env.errorLines.some((line) => line.startsWith('Building the configuration form failed: Error: broken store')), env.errorLines.join('\n'))
    env.plugin.stop()
  })
})

describe('the store of sources', () => {
  it('lists the sources of a path within the window, sorted, and forgets older ones', () => {
    const sources = createSources()
    sources.note('a', 'z', 0)
    sources.note('a', 'y', 5000)
    sources.note('b', 'x', 5000)
    assert.deepEqual(sources.list('a', 6000, 10000), ['y', 'z'])
    assert.deepEqual(sources.list('a', 12000, 10000), ['y'])
    assert.deepEqual(sources.list('none', 0, 10000), [])
  })

  it('reports a path only once its values have changed source often enough within the window', () => {
    const sources = createSources()
    sources.note('a', 'x', 0)
    for (let i = 1; i < SWITCHES_FOR_WARNING; i++) sources.note('a', i % 2 ? 'y' : 'x', i * 1000)
    assert.deepEqual(sources.several(SWITCHES_FOR_WARNING * 1000, 60000), [])
    sources.note('a', SWITCHES_FOR_WARNING % 2 ? 'y' : 'x', SWITCHES_FOR_WARNING * 1000)
    assert.deepEqual(sources.several(SWITCHES_FOR_WARNING * 1000, 60000), [{ path: 'a', sources: ['x', 'y'] }])
    // The changes age out of the window.
    assert.deepEqual(sources.several(SWITCHES_FOR_WARNING * 1000 + 59500, 60000), [])
  })

  it('does not add up changes of source that lie further apart than the window', () => {
    const sources = createSources()
    // Three changes in the first seconds, then a long quiet spell from both.
    sources.note('a', 'x', 0)
    sources.note('a', 'y', 1000)
    sources.note('a', 'x', 2000)
    sources.note('a', 'y', 3000)
    sources.note('a', 'y', 100000)
    // One more change, long after the first three: both sources are recent,
    // but only one change lies within the window.
    sources.note('a', 'x', 101000)
    assert.deepEqual(sources.list('a', 101000, 60000), ['x', 'y'])
    assert.deepEqual(sources.several(101000, 60000), [])
  })

  it('counts a value without a source under one name', () => {
    const sources = createSources()
    sources.note('a', undefined, 0)
    sources.note('a', null, 0)
    assert.deepEqual(sources.list('a', 0, 1000), ['unknown'])
  })
})
