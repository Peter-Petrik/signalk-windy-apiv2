'use strict'

/*
 * The sources of each path on the configuration form. The form shows which
 * sources each path is received from, and a note says where to set a source
 * priority. The plugin does not judge the sources: several sources on a
 * path raise no warning, on the form or on the dashboard.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  WARM_UP_MS,
  config, fullTree, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')
const { schema, uiSchema, DEFAULTS } = require('../lib/schema')
const { createSources } = require('../lib/sources')

const SPEED = 'environment.wind.speedOverGround'
const TRIANGLE = '\u26A0'
const NOTE = 'Under each path are the Signal K sources it was received from. ' +
  'When a path lists more than one source and its readings should come from only one, set a source priority for it under Data > Priorities.'

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

/** A second source on a path, sending in the same seconds as "test", as without a source priority. */
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

  it('is named on its configuration field, under a note that says where to set a source priority', async () => {
    const env = await startedEnv()
    await advance(15 * 60000)
    const form = env.plugin.schema()
    assert.equal(form.properties.pathMap.description, NOTE)
    assert.equal(pathField(form, 'windSpeed').description, 'Received from `test` in the last 15 minutes.')
    assert.equal(form.description, undefined)
    env.plugin.stop()
  })

  it('is counted since the start while the plugin has run for less than the time counted', async () => {
    const env = await startedEnv()
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from `test` since the plugin started.')
    env.plugin.stop()
  })

  it('says so on a field whose path has received nothing', async () => {
    const env = await startedEnv({ pathMap: { dewPoint: 'environment.outside.nothing' } })
    assert.equal(pathField(env.plugin.schema(), 'dewPoint').description, 'Nothing received since the plugin started.')
    env.plugin.stop()
  })

  it('names the time counted in seconds below two minutes and in minutes above', async () => {
    const env = await startedEnv(logic({ maxAge: 0.5 }))
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from `test` in the last 30 seconds.')
    env.plugin.stop()
    const longer = await startedEnv(logic({ maxAge: 2.5 }))
    await advance(3 * 60000)
    assert.equal(pathField(longer.plugin.schema(), 'windSpeed').description, 'Received from `test` in the last 2.5 minutes.')
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
      'Received from `test` on `environment.outside.relativeHumidity` since the plugin started.')
    env.emit('environment.outside.humidity', 0.7, 'other')
    assert.equal(pathField(env.plugin.schema(), 'humidity').description, 'Received from `other` since the plugin started.')
    env.plugin.stop()
  })
})

describe('a path received from several sources', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('lists them all on its field, and raises no warning on the form or the dashboard', async () => {
    const env = await startedEnv()
    await takeTurns(env, SPEED, 'derived-data', 120)
    const form = env.plugin.schema()
    assert.equal(pathField(form, 'windSpeed').description, 'Received from `derived-data`, `test` since the plugin started.')
    assert.equal(pathField(form, 'windDir').description, 'Received from `test` since the plugin started.')
    assert.equal(form.description, undefined)
    assert.ok(!JSON.stringify(form).includes(TRIANGLE))
    assert.match(env.lastStatus(), /^Next: /)
    assert.ok(env.statuses.every((line) => !line.includes(TRIANGLE)), env.lastStatus())
    env.plugin.stop()
  })

  it('lists a source that took over during a pause of another one until it has been silent for the time counted', async () => {
    const env = await startedEnv(logic({ maxAge: 5 }))
    env.emit(SPEED, 4.0, 'backup')
    await advance(1000)
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from `backup`, `test` since the plugin started.')
    await advance(5 * 60000 - 1000)
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from `backup`, `test` in the last 5 minutes.')
    await advance(1000)
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from `test` in the last 5 minutes.')
    env.plugin.stop()
  })
})

describe('what is not listed', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('a value the server held from another source when the plugin started', async () => {
    const env = await startedEnv({}, { held: [{ path: SPEED, value: 3.0, timestamp: new Date().toISOString(), source: 'old' }] })
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from `test` since the plugin started.')
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
    assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, 'Received from `test` since the plugin started.')
    env.plugin.stop()
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

  it('counts a value without a source under one name', () => {
    const sources = createSources()
    sources.note('a', undefined, 0)
    sources.note('a', null, 0)
    assert.deepEqual(sources.list('a', 0, 1000), ['unknown'])
  })
})

describe('code style for source names', () => {
  it('is switched on for the line under each Sensor Path Overrides field, and not for the section, whose note is plain text', () => {
    for (const key of Object.keys(DEFAULTS.pathMap)) {
      assert.deepEqual(uiSchema.pathMap[key], { 'ui:enableMarkdownInDescription': true }, key)
    }
    assert.equal(uiSchema.pathMap['ui:enableMarkdownInDescription'], undefined)
    assert.equal(uiSchema['ui:enableMarkdownInDescription'], undefined)
    assert.ok(!/[`*]/.test(NOTE))
  })

  it('shows a backtick or a backslash in a source name as an apostrophe, so that the code span holds', async () => {
    setUp()
    try {
      const env = await startedEnv()
      env.emit(SPEED, 4.0, 'odd`name')
      env.emit(SPEED, 4.0, 'end\\')
      assert.equal(pathField(env.plugin.schema(), 'windSpeed').description, "Received from `end'`, `odd'name`, `test` since the plugin started.")
      env.plugin.stop()
    } finally {
      tearDown()
    }
  })
})
