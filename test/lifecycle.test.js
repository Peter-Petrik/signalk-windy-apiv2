'use strict'

/*
 * Start and stop: a plugin without credentials sends nothing, and a stopped
 * plugin stays stopped whatever was in progress when it was stopped.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, createEnv, deferred, advance, settle, setUp, tearDown
} = require('../test-support/harness')

describe('not configured', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('sends nothing and subscribes to nothing when started with an empty configuration', async () => {
    // The Signal K plugin CI and the plugin registry both start a plugin
    // this way, and so does a user who enables it before filling in the form.
    const env = createEnv()
    env.plugin.start({})
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.requests.length, 0)
    assert.equal(env.subscribeCalls, 0)
    assert.deepEqual(env.errors, [])
    env.plugin.stop()
  })

  it('names the three credentials on the dashboard', () => {
    const env = createEnv()
    env.plugin.start({})
    assert.equal(env.lastStatus(), 'Not configured: enter Station ID, Station Password, Global API Key in the plugin configuration')
    env.plugin.stop()
  })

  it('names only the credentials that are missing', () => {
    const env = createEnv()
    env.plugin.start(config({ credentials: { stationId: 'f0TEST01', stationPassword: '', apiKey: 'api-key' } }))
    assert.equal(env.lastStatus(), 'Not configured: enter Station Password in the plugin configuration')
    env.plugin.stop()
  })

  it('treats a credential of white space as missing', async () => {
    const env = createEnv()
    env.plugin.start(config({ credentials: { stationId: '   ', stationPassword: 'station-password', apiKey: 'api-key' } }))
    await advance(WARM_UP_MS)
    assert.equal(env.requests.length, 0)
    assert.match(env.lastStatus(), /^Not configured: enter Station ID /)
    env.plugin.stop()
  })

  it('does not throw when the server passes no configuration at all', () => {
    const env = createEnv()
    assert.doesNotThrow(() => env.plugin.start(undefined))
    assert.match(env.lastStatus(), /^Not configured/)
    env.plugin.stop()
  })

  it('starts reporting once the credentials are saved', async () => {
    const env = createEnv()
    env.plugin.start({})
    env.plugin.stop()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    env.plugin.stop()
  })
})

describe('credentials', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('removes white space picked up around a pasted credential', async () => {
    const env = createEnv()
    env.plugin.start(config({ credentials: { stationId: ' f0TEST01\n', stationPassword: ' station-password ', apiKey: '\tapi-key ' } }))
    await advance(WARM_UP_MS)
    assert.equal(env.puts()[0].url, 'https://stations.windy.com/api/v2/pws/f0TEST01')
    assert.equal(env.puts()[0].headers['windy-api-key'], 'api-key')
    assert.equal(env.gets()[0].params.id, 'f0TEST01')
    assert.equal(env.gets()[0].headers.Authorization, 'Bearer station-password')
    env.plugin.stop()
  })
})

describe('stop', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('sends nothing more when stopped while an observation is on its way', async () => {
    const env = createEnv()
    const request = deferred()
    env.get = () => request.promise
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.gets().length, 1)

    env.plugin.stop()
    request.resolve()
    await settle()
    const sent = env.requests.length
    await advance(6 * FIVE_MINUTES_MS)

    assert.equal(env.requests.length, sent, 'a stopped plugin sent another request')
    assert.equal(env.lastStatus(), 'Stopped')
  })

  it('sends nothing more when stopped while a station update is on its way', async () => {
    const env = createEnv()
    const request = deferred()
    env.put = () => request.promise
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT'])

    env.plugin.stop()
    request.resolve()
    await settle()
    await advance(6 * FIVE_MINUTES_MS)

    assert.deepEqual(env.requests.map((r) => r.method), ['PUT'])
    assert.equal(env.lastStatus(), 'Stopped')
  })

  it('does not write the state file again when a request is answered after the stop', async () => {
    // A run that has ended must not save over the state of the run after it.
    const env = createEnv()
    const request = deferred()
    env.get = () => request.promise
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.plugin.stop()
    fs.rmSync(env.stateFile)
    request.resolve()
    await settle()
    await advance(1000)
    assert.equal(fs.existsSync(env.stateFile), false)
  })

  it('shows no error when a request fails after the plugin was stopped', async () => {
    const env = createEnv()
    const request = deferred()
    env.get = () => request.promise
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.plugin.stop()
    request.reject(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: {} } }))
    await settle()
    assert.deepEqual(env.errors, [])
    assert.equal(env.lastStatus(), 'Stopped')
  })

  it('does not let a request from before a restart disturb the schedule after it', async () => {
    const env = createEnv()
    const request = deferred()
    env.get = () => request.promise
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.plugin.stop()

    // Restarted, as happens when the configuration is saved.
    env.get = async () => ({ status: 200, data: {} })
    env.plugin.start(config())
    request.resolve()
    await settle()
    await advance(FIVE_MINUTES_MS)
    // One request from before the restart, one from the cycle after it.
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })

  it('releases its subscriptions', () => {
    const env = createEnv()
    env.plugin.start(config())
    assert.equal(env.subscriptions.length, 1)
    env.plugin.stop()
    assert.equal(env.subscriptions.length, 0)
  })

  it('leaves no subscription behind after repeated restarts', () => {
    const env = createEnv()
    for (let i = 0; i < 3; i++) {
      env.plugin.start(config())
      env.plugin.stop()
    }
    assert.equal(env.subscribeCalls, 3)
    assert.equal(env.subscriptions.length, 0)
  })

  it('ends the earlier run when started twice without a stop in between', async () => {
    const env = createEnv()
    env.plugin.start(config())
    env.plugin.start(config())
    assert.equal(env.subscriptions.length, 1)
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    env.plugin.stop()
  })

  it('ignores a value delivered after the plugin was stopped', () => {
    const env = createEnv()
    env.plugin.start(config())
    const { callback } = env.subscriptions[0]
    env.plugin.stop()
    assert.doesNotThrow(() => callback({ updates: [{ values: [{ path: 'navigation.position', value: { latitude: 1, longitude: 1 } }] }] }))
  })
})
