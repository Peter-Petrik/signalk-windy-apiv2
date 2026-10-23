'use strict'

/*
 * The state file: when it is saved, what it holds, and how a saved state
 * changes the next start.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const {
  START_TIME, WARM_UP_MS, FIVE_MINUTES_MS,
  config, createEnv, deferred, advance, settle, setUp, tearDown
} = require('../test-support/harness')
const { resolveOptions } = require('../lib/schema')
const { stationKey } = require('../lib/windy')

const readState = (env) => JSON.parse(fs.readFileSync(env.stateFile, 'utf8'))
const writeState = (env, state) => fs.writeFileSync(env.stateFile, typeof state === 'string' ? state : JSON.stringify(state))

/** The station settings of a configuration, as the plugin writes them to the state file. */
const keyOf = (configuration) => stationKey(resolveOptions(configuration))

describe('saving state', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('logs a state file that cannot be written and goes on reporting', async () => {
    const env = createEnv()
    // A directory where the file should be: every write fails.
    fs.mkdirSync(env.stateFile)
    fs.mkdirSync(`${env.stateFile}.tmp`)
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.gets().length, 2)
    assert.ok(env.errorLines.some((line) => line.startsWith('Failed to save state file: ')))
    env.plugin.stop()
  })

  it('writes the file directly when the file system refuses to rename over it, and removes the temporary file', async () => {
    const env = createEnv()
    const rename = fs.renameSync
    fs.renameSync = () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }) }
    try {
      env.plugin.start(config())
      await advance(WARM_UP_MS)
    } finally {
      fs.renameSync = rename
    }
    assert.equal(readState(env).hasReportedPosition, true)
    assert.ok(!fs.existsSync(`${env.stateFile}.tmp`))
    env.plugin.stop()
  })

  it('keeps the earlier file whole when writing the new one fails', () => {
    const { saveState, loadState, freshState } = require('../lib/state')
    const env = createEnv()
    const state = { ...freshState(), lastSentPos: { lat: 1, lon: 2 }, hasReportedPosition: true }
    saveState(env.stateFile, state)
    const write = fs.writeFileSync
    fs.writeFileSync = (file, ...rest) => {
      if (String(file).endsWith('.tmp')) throw new Error('ENOSPC: no space left on device')
      return write(file, ...rest)
    }
    try {
      assert.throws(() => saveState(env.stateFile, { ...state, lastSentPos: { lat: 3, lon: 4 } }), /ENOSPC/)
    } finally {
      fs.writeFileSync = write
    }
    assert.deepEqual(loadState(env.stateFile, () => {}).lastSentPos, { lat: 1, lon: 2 })
  })

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

  it('writes the state file after every cycle, without waiting for the plugin to be stopped', async () => {
    // The Signal K server does not stop its plugins when the server itself
    // shuts down, so a state saved only in stop() is lost on every reboot.
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    let state = readState(env)
    assert.deepEqual(state.lastSentPos, { lat: 37.5, lon: 23.4 })
    assert.equal(state.hasReportedPosition, true)
    assert.equal(state.nextRunTime, START_TIME + WARM_UP_MS + FIVE_MINUTES_MS)
    await advance(FIVE_MINUTES_MS)
    state = readState(env)
    assert.equal(state.nextRunTime, START_TIME + WARM_UP_MS + 2 * FIVE_MINUTES_MS)
    env.plugin.stop()
  })

  it('saves the new baseline as soon as a station update succeeds, before the observation is answered', async () => {
    // The observation can take up to 30 seconds to time out. A power cut in
    // that time must not cost the record of a position Windy has accepted.
    const env = createEnv()
    const observation = deferred()
    env.get = () => observation.promise
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    const state = readState(env)
    assert.deepEqual(state.lastSentPos, { lat: 37.5, lon: 23.4 })
    assert.equal(state.hasReportedPosition, true)
    observation.resolve()
    await settle()
    env.plugin.stop()
  })

  it('leaves no temporary file behind', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.plugin.stop()
    assert.deepEqual(fs.readdirSync(env.dataDir), ['state.json'])
  })

  it('does not write a state file when the plugin is stopped without having been started', () => {
    const env = createEnv()
    env.plugin.stop()
    assert.equal(fs.existsSync(env.stateFile), false)
    assert.equal(env.lastStatus(), 'Stopped')
  })

  it('does not overwrite a saved state when a plugin without credentials is stopped', () => {
    const env = createEnv()
    const saved = { lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 12, nextRunTime: START_TIME + 60000, hasReportedPosition: true }
    writeState(env, saved)
    env.plugin.start({})
    env.plugin.stop()
    assert.deepEqual(readState(env), saved)
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
    writeState(env, { lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 0, nextRunTime: 0, hasReportedPosition: true, stationKey: keyOf(config()) })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['GET'])
    env.plugin.stop()
  })

  it('updates the station once after an update from a version that did not record the station settings', async () => {
    const env = createEnv()
    writeState(env, { lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 0, nextRunTime: 0, hasReportedPosition: true })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET', 'GET'])
    assert.equal(readState(env).stationKey, keyOf(config()))
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
    assert.ok(env.debugLines.some((line) => line.startsWith('Starting with fresh internal state')))
    env.plugin.stop()
  })

  it('starts fresh when the state file holds something other than a state', async () => {
    for (const content of ['null', '[]', '"text"', '{"lastSentPos":"here","currentDistance":"far","nextRunTime":"soon","hasReportedPosition":"yes"}']) {
      const env = createEnv()
      writeState(env, content)
      env.plugin.start(config())
      await advance(WARM_UP_MS)
      assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'], `state file content: ${content}`)
      env.plugin.stop()
    }
  })

  it('never waits longer than one interval for a saved schedule', async () => {
    // A state saved while the system clock was wrong can name a time days away.
    const env = createEnv()
    writeState(env, { lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 0, nextRunTime: START_TIME + 10 * 24 * 3600 * 1000, hasReportedPosition: true })
    env.plugin.start(config())
    await advance(1000)
    assert.match(env.lastStatus(), /^Resume: 4m59s/)
    await advance(FIVE_MINUTES_MS - 1000)
    assert.equal(env.gets().length, 1)
    env.plugin.stop()
  })

  it('reads the "no position yet" marker of earlier versions', async () => {
    // Versions before 1.5.2 saved { lat: 0, lon: 0 } before any position was sent.
    const env = createEnv()
    writeState(env, { lastSentPos: { lat: 0, lon: 0 }, currentDistance: 0, nextRunTime: 0, hasReportedPosition: true })
    env.plugin.start(config())
    env.emit('navigation.position', { latitude: 37.5, longitude: 23.4 })
    await advance(1000)
    // The first position becomes the baseline; it is not measured from 0, 0.
    assert.match(env.lastStatus(), /Δ0m/)
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
