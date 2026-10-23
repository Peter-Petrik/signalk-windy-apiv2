'use strict'

/*
 * When the station record is sent again although the vessel has not moved:
 * after a change to a setting it is built from.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, createEnv, httpError, advance, setUp, tearDown
} = require('../test-support/harness')

const readState = (env) => JSON.parse(fs.readFileSync(env.stateFile, 'utf8'))

/** A configuration with some identity fields replaced. */
const withIdentity = (fields) => config({ identity: { ...config().identity, ...fields } })

/**
 * Reports once with `first`, then saves `second` as the server does (stop,
 * start) and waits for the next report. Returns the requests of that report.
 */
async function afterSaving (first, second) {
  const env = createEnv()
  env.plugin.start(first)
  await advance(WARM_UP_MS)
  env.plugin.stop()
  env.requests.length = 0
  env.plugin.start(second)
  await advance(FIVE_MINUTES_MS)
  env.plugin.stop()
  return env
}

describe('a setting the station record is built from', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  const changes = {
    'Display Name': withIdentity({ stationName: 'New Name' }),
    'Share Option': withIdentity({ shareOption: 'only_windy' }),
    'Wind Sensor Height': withIdentity({ agl_wind: 18 }),
    'Temperature Sensor Height': withIdentity({ agl_temp: 3 }),
    'Station Type': withIdentity({ station_type: 'Catamaran' }),
    'Operator Website URL': withIdentity({ operator_url: 'https://example.org' }),
    'Station Elevation': withIdentity({ elevation: 4 }),
    'Station ID': config({ credentials: { ...config().credentials, stationId: 'f0TEST02' } }),
    'Position Precision': withIdentity({ positionPrecision: '100m' })
  }

  for (const [name, changed] of Object.entries(changes)) {
    it(`sends the record again when the ${name} has changed, although the vessel has not moved`, async () => {
      const env = await afterSaving(config(), changed)
      assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    })
  }

  it('sends the new values', async () => {
    const env = await afterSaving(config(), withIdentity({ stationName: 'New Name', agl_wind: 18 }))
    assert.equal(env.puts()[0].body.name, 'New Name')
    assert.equal(env.puts()[0].body.operator_text, 'New Name')
    assert.equal(env.puts()[0].body.agl_wind, 18)
  })

  it('sends nothing after an update from a version without the Position Precision setting, while it stays Exact', async () => {
    // The key as 1.7.0 wrote it for config().
    const key = JSON.stringify(['f0TEST01', 'Test Vessel', 'public', 10, 2, 'Boat (Signal K)', 'https://example.com', null])
    for (const saved of [config(), withIdentity({ positionPrecision: 'exact' })]) {
      const env = createEnv()
      fs.writeFileSync(env.stateFile, JSON.stringify({ lastSentPos: { lat: 37.5, lon: 23.4 }, currentDistance: 0, nextRunTime: 0, hasReportedPosition: true, stationKey: key }))
      env.plugin.start(saved)
      await advance(WARM_UP_MS)
      env.plugin.stop()
      assert.deepEqual(env.requests.map((r) => r.method), ['GET'])
    }
  })

  it('sends the record again when the Position Precision goes back to Exact', async () => {
    const env = await afterSaving(withIdentity({ positionPrecision: '1km' }), config())
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    assert.equal(env.puts()[0].body.lat, 37.5)
  })

  it('sends nothing more when the configuration is saved unchanged', async () => {
    const env = await afterSaving(config(), config())
    assert.deepEqual(env.requests.map((r) => r.method), ['GET'])
  })

  it('does not count a change of a setting that is not sent to Windy', async () => {
    const env = await afterSaving(config(), config({ logic: { interval: 10, minMove: 500, forceUpdate: false, maxAge: 30 } }))
    assert.deepEqual(env.requests.map((r) => r.method), ['GET'])
  })

  it('does not count a change of the GNSS altitude, which follows the vessel', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.emit('navigation.gnss.antennaAltitude', 31)
    await advance(FIVE_MINUTES_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET', 'GET'])
    env.plugin.stop()
  })

  it('is sent again on every cycle until Windy accepts it, and recorded only then', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    const before = readState(env).stationKey
    env.plugin.stop()
    env.put = async () => { throw httpError(400, { message: ['name must be shorter'] }) }
    env.plugin.start(withIdentity({ stationName: 'New Name' }))
    await advance(FIVE_MINUTES_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 3)
    assert.equal(readState(env).stationKey, before)
    env.put = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 4)
    assert.notEqual(readState(env).stationKey, before)
    env.plugin.stop()
  })

  it('is recorded in the state file without any secret', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.plugin.stop()
    const saved = fs.readFileSync(env.stateFile, 'utf8')
    assert.ok(saved.includes('stationKey'))
    assert.ok(saved.includes('f0TEST01'))
    assert.ok(!saved.includes('station-password'))
    assert.ok(!saved.includes('api-key'))
  })
})
