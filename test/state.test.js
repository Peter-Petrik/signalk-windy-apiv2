'use strict'

/*
 * The state file: what is saved when the plugin stops, and how a saved state
 * changes the next start.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const {
  START_TIME, WARM_UP_MS, FIVE_MINUTES_MS,
  config, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')

const readState = (env) => JSON.parse(fs.readFileSync(env.stateFile, 'utf8'))
const writeState = (env, state) => fs.writeFileSync(env.stateFile, typeof state === 'string' ? state : JSON.stringify(state))

describe('saving state', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('writes the baseline, the distance, the schedule and the first-run flag when the plugin stops', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.emit('navigation.position', { latitude: 37.501, longitude: 23.4 })
    env.plugin.stop()
    const state = readState(env)
    assert.deepEqual(state.lastSentPos, { lat: 37.5, lon: 23.4 })
    assert.equal(Math.round(state.currentDistance), 111)
    assert.equal(state.nextRunTime, START_TIME + WARM_UP_MS + FIVE_MINUTES_MS)
    assert.equal(state.hasReportedPosition, true)
  })

  it('does not write the state file while the plugin is running', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(fs.existsSync(env.stateFile), false)
    env.plugin.stop()
  })

  it('sets the status to Stopped', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(1000)
    env.plugin.stop()
    assert.equal(env.lastStatus(), 'Stopped')
  })
})

describe('starting from a saved state', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('waits for the saved schedule instead of reporting after the warm-up', async () => {
    const env = createEnv()
    writeState(env, { lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 0, nextRunTime: START_TIME + 120000, hasReportedPosition: true })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.requests.length, 0)
    assert.match(env.lastStatus(), /^Resume: 1m45s/)
    await advance(120000 - WARM_UP_MS)
    assert.equal(env.gets().length, 1)
    env.plugin.stop()
  })

  it('does not update the station again when the position was already reported and the vessel has not moved', async () => {
    const env = createEnv()
    writeState(env, { lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 0, nextRunTime: 0, hasReportedPosition: true })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['GET'])
    env.plugin.stop()
  })

  it('updates the station on the first cycle when the saved state has no first-run flag', async () => {
    const env = createEnv()
    writeState(env, { lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 0, nextRunTime: 0 })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    env.plugin.stop()
  })

  it('measures distance from the saved baseline', async () => {
    const env = createEnv()
    writeState(env, { lastSentPos: { lat: 37.497, lon: 23.4 }, currentDistance: 0, nextRunTime: 0, hasReportedPosition: true })
    env.plugin.start(config())
    // The vessel is at 37.5; the saved baseline is 334 m to the south.
    env.emit('navigation.position', { latitude: 37.5, longitude: 23.4 })
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    env.plugin.stop()
  })

  it('reports after the warm-up when the saved schedule is in the past', async () => {
    const env = createEnv()
    writeState(env, { lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 0, nextRunTime: START_TIME - 3600000, hasReportedPosition: true })
    env.plugin.start(config())
    await advance(WARM_UP_MS - 1)
    assert.equal(env.requests.length, 0)
    await advance(1)
    assert.equal(env.gets().length, 1)
    env.plugin.stop()
  })

  it('starts fresh when the state file is not valid JSON', async () => {
    const env = createEnv()
    writeState(env, '{"lastSentPos":')
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    assert.ok(env.debugLines.includes('Starting with fresh internal state.'))
    env.plugin.stop()
  })

  it('starts fresh when there is no state file', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    env.plugin.stop()
  })
})

describe('restart', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('keeps the schedule across stop and start, as happens when the configuration is saved', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(60000)
    env.plugin.stop()
    env.plugin.start(config())
    await advance(FIVE_MINUTES_MS - 60000 - 1)
    assert.equal(env.gets().length, 1)
    await advance(1)
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })
})
