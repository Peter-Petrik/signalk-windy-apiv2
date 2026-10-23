'use strict'

/*
 * The reporting cycle: what is sent to Windy, in which order, and when.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  START_TIME, WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')
const { version } = require('../package.json')

describe('reporting cycle', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('sends nothing during the 15-second warm-up', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS - 1)
    assert.equal(env.requests.length, 0)
    assert.match(env.lastStatus(), /^Warm: 0m01s/)
    env.plugin.stop()
  })

  it('sends the station update first and the observation second', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    env.plugin.stop()
  })

  it('sends the complete station record with the API key in a header', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    const put = env.puts()[0]
    assert.equal(put.url, 'https://stations.windy.com/api/v2/pws/f0TEST01')
    assert.deepEqual(put.body, {
      name: 'Test Vessel',
      share_option: 'public',
      lat: 37.5,
      lon: 23.4,
      elev_m: 0,
      agl_wind: 10,
      agl_temp: 2,
      station_type: 'Boat (Signal K)',
      operator_text: 'Test Vessel',
      operator_url: 'https://example.com'
    })
    assert.equal(put.headers['windy-api-key'], 'api-key')
    assert.equal(put.headers['Content-Type'], 'application/json')
    assert.equal(put.timeout, 30000)
    env.plugin.stop()
  })

  it('sends the observation with the station password as a Bearer token, not in the URL', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    const get = env.gets()[0]
    assert.equal(get.path, 'https://stations.windy.com/api/v2/observation/update')
    assert.equal(get.headers.Authorization, 'Bearer station-password')
    assert.equal(get.timeout, 30000)
    assert.ok(!get.url.includes('station-password'), 'the password must not appear in the URL')
    assert.ok(!('PASSWORD' in get.params))
    assert.deepEqual(get.params, {
      id: 'f0TEST01',
      ts: String(Math.floor((START_TIME + WARM_UP_MS) / 1000)),
      wind: '5.1',
      gust: '7.2',
      winddir: '180',
      temp: '20.0',
      pressure: '101325',
      rh: '65',
      softwaretype: `signalk-windy-apiv2/${version}`
    })
    env.plugin.stop()
  })

  it('rounds latitude and longitude to five decimals', async () => {
    const tree = fullTree()
    tree.navigation.position.value = { latitude: 37.123456789, longitude: 23.987654321 }
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.puts()[0].body.lat, 37.12346)
    assert.equal(env.puts()[0].body.lon, 23.98765)
    env.plugin.stop()
  })

  it('sends the GNSS antenna altitude, rounded, as the station elevation', async () => {
    const tree = fullTree()
    tree.navigation.gnss = { antennaAltitude: { value: 3.4 } }
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.puts()[0].body.elev_m, 3)
    env.plugin.stop()
  })

  it('reports again one interval later, with the observation only', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS - 1)
    assert.equal(env.requests.length, 2)
    await advance(1)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET', 'GET'])
    env.plugin.stop()
  })

  it('uses the configured interval', async () => {
    const env = createEnv()
    env.plugin.start(config({ logic: { interval: 15, minMove: 300, forceUpdate: false } }))
    await advance(WARM_UP_MS)
    await advance(3 * FIVE_MINUTES_MS - 1)
    assert.equal(env.gets().length, 1)
    await advance(1)
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })

  it('shows the countdown, the distance and the last reported values on the dashboard', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    // The reported 5.1 m/s is 9.9 kn and 7.2 m/s is 14.0 kn; pressure is shown in kPa.
    assert.match(env.lastStatus(), /^Next: 0m00s \| Δ0m \| W:9\.9 G:14\.0 D:180 T:20\.0 P:101\.3 H:65 \| \d{2}:\d{2}$/)
    await advance(60000)
    assert.match(env.lastStatus(), /^Next: 4m00s \| Δ0m \| W:9\.9 G:14\.0 /)
    env.plugin.stop()
  })

  it('still sends the observation when there is no position', async () => {
    const tree = fullTree()
    delete tree.navigation
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['GET'])
    env.plugin.stop()
  })

  it('sends no observation when no sensor path has a value', async () => {
    const env = createEnv({ tree: { navigation: fullTree().navigation } })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT'])
    assert.ok(env.statuses.includes('Next: 0m00s | Δ0m | No data: environment.wind.speedOverGround +4'))
    env.plugin.stop()
  })
})

describe('movement guard', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  /** Starts the plugin and completes the first cycle, which always updates the station. */
  async function started (overrides) {
    const env = createEnv()
    env.plugin.start(config(overrides))
    await advance(WARM_UP_MS)
    assert.equal(env.puts().length, 1)
    return env
  }

  it('does not update the station while the vessel stays inside the threshold', async () => {
    const env = await started()
    // 0.002 degrees of latitude is about 223 m, below the 300 m default.
    env.emit('navigation.position', { latitude: 37.502, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 1)
    assert.match(env.lastStatus(), /Δ223m/)
    env.plugin.stop()
  })

  it('updates the station once the vessel is beyond the threshold, then starts measuring again', async () => {
    const env = await started()
    // 0.003 degrees of latitude is about 334 m.
    env.tree.navigation.position.value = { latitude: 37.503, longitude: 23.4 }
    env.emit('navigation.position', { latitude: 37.503, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 2)
    assert.equal(env.puts()[1].body.lat, 37.503)
    assert.match(env.lastStatus(), /Δ0m/)
    env.plugin.stop()
  })

  it('measures the straight distance from the last reported position, not the distance travelled', async () => {
    const env = await started()
    // Out 223 m and back again: the track is 446 m long, the distance is zero.
    env.emit('navigation.position', { latitude: 37.502, longitude: 23.4 })
    env.emit('navigation.position', { latitude: 37.5, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 1)
    env.plugin.stop()
  })

  it('scales longitude by the cosine of the latitude', async () => {
    const env = await started()
    // At 37.5 degrees north, 0.003 degrees of longitude is about 265 m.
    env.emit('navigation.position', { latitude: 37.5, longitude: 23.403 })
    await advance(1000)
    assert.match(env.lastStatus(), /Δ265m/)
    env.plugin.stop()
  })

  it('honours a custom threshold', async () => {
    const env = await started({ logic: { interval: 5, minMove: 100, forceUpdate: false } })
    env.emit('navigation.position', { latitude: 37.502, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 2)
    env.plugin.stop()
  })

  it('updates the station on every cycle when Force GPS Updates is on', async () => {
    const env = await started({ logic: { interval: 5, minMove: 300, forceUpdate: true } })
    await advance(FIVE_MINUTES_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 3)
    env.plugin.stop()
  })

  it('measures from the position Windy accepted last, not from the one before', async () => {
    const env = await started()
    // 334 m north: the station is moved there.
    env.tree.navigation.position.value = { latitude: 37.503, longitude: 23.4 }
    env.emit('navigation.position', { latitude: 37.503, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 2)
    // Back to 56 m from the first position, 278 m from the second: inside
    // the threshold only when measured from the second.
    env.tree.navigation.position.value = { latitude: 37.5005, longitude: 23.4 }
    env.emit('navigation.position', { latitude: 37.5005, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 2)
    assert.match(env.lastStatus(), /Δ278m/)
    env.plugin.stop()
  })

  it('measures the short way across the 180° meridian, from west to east', async () => {
    const tree = fullTree()
    tree.navigation.position.value = { latitude: 0, longitude: -179.999 }
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.emit('navigation.position', { latitude: 0, longitude: 179.999 })
    await advance(1000)
    assert.match(env.lastStatus(), /Δ223m/)
    env.plugin.stop()
  })

  it('keeps the distance when the station update fails, and tries again on the next cycle', async () => {
    const env = await started()
    env.put = async () => { throw new Error('socket hang up') }
    env.tree.navigation.position.value = { latitude: 37.503, longitude: 23.4 }
    env.emit('navigation.position', { latitude: 37.503, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 2)
    assert.match(env.lastStatus(), /Δ334m/)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 3)
    env.plugin.stop()
  })
})

describe('requests to Windy', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('are sent with redirects switched off, an answer limit of 64 KB and an overall time limit of 30 seconds', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.requests.length, 2)
    for (const request of env.requests) {
      assert.equal(request.config.maxRedirects, 0, request.method)
      assert.equal(request.config.maxContentLength, 65536, request.method)
      assert.equal(request.config.timeout, 30000, request.method)
      assert.ok(request.config.signal instanceof AbortSignal, request.method)
    }
    // Each request has a signal of its own, so that one that has ended does
    // not end the next.
    assert.notEqual(env.requests[0].config.signal, env.requests[1].config.signal)
    env.plugin.stop()
  })
})
