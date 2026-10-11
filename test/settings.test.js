'use strict'

/*
 * Saved settings: values the form cannot produce but a configuration file
 * can hold, defaults applied without the form, the share option, and the
 * humidity path.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')

const credentials = { stationId: 'f0TEST01', stationPassword: 'station-password', apiKey: 'api-key' }
const identity = (overrides) => ({ identity: { ...config().identity, ...overrides } })

describe('zero', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('sends a sensor height of 0 as 0, not as the default', async () => {
    const env = createEnv()
    env.plugin.start(config(identity({ agl_wind: 0, agl_temp: 0 })))
    await advance(WARM_UP_MS)
    assert.equal(env.puts()[0].body.agl_wind, 0)
    assert.equal(env.puts()[0].body.agl_temp, 0)
    env.plugin.stop()
  })

  it('updates the station at every report when the movement threshold is 0', async () => {
    const env = createEnv()
    env.plugin.start(config({ logic: { interval: 5, minMove: 0, forceUpdate: false } }))
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 3)
    env.plugin.stop()
  })
})

describe('defaults without the form', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('applies every default when only the credentials and a share option were saved', async () => {
    const env = createEnv()
    env.plugin.start({ credentials, identity: { shareOption: 'only_windy' } })
    await advance(WARM_UP_MS)
    assert.deepEqual(env.puts()[0].body, {
      name: 'Signal K Vessel',
      share_option: 'only_windy',
      lat: 37.5,
      lon: 23.4,
      elev_m: 0,
      agl_wind: 10,
      agl_temp: 2,
      station_type: 'Boat (Signal K)',
      operator_text: 'Signal K Vessel',
      operator_url: ''
    })
    assert.equal(env.gets().length, 1)
    await advance(FIVE_MINUTES_MS - 1)
    assert.equal(env.gets().length, 1)
    await advance(1)
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })

  it('rounds a sensor height that is not a whole number, and falls back to the default for one that is not a number', async () => {
    const env = createEnv()
    env.plugin.start(config(identity({ agl_wind: 23.6, agl_temp: 'high' })))
    await advance(WARM_UP_MS)
    assert.equal(env.puts()[0].body.agl_wind, 24)
    assert.equal(env.puts()[0].body.agl_temp, 2)
    env.plugin.stop()
  })

  it('never reports faster than once in five minutes, whatever interval was saved', async () => {
    const env = createEnv()
    env.plugin.start(config({ logic: { interval: 1, minMove: 300, forceUpdate: false } }))
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS - 1)
    assert.equal(env.gets().length, 1)
    await advance(1)
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })

  it('uses the default path for a sensor whose path was saved empty', async () => {
    const env = createEnv()
    env.plugin.start(config({ pathMap: { windSpeed: '  ', temp: '' } }))
    await advance(WARM_UP_MS)
    assert.equal(env.gets()[0].params.wind, '5.1')
    assert.equal(env.gets()[0].params.temp, '20.0')
    env.plugin.stop()
  })
})

describe('share option', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('sends "Windy only" as only_windy', async () => {
    const env = createEnv()
    env.plugin.start(config(identity({ shareOption: 'only_windy' })))
    await advance(WARM_UP_MS)
    assert.equal(env.puts()[0].body.share_option, 'only_windy')
    env.plugin.stop()
  })

  it('sends no station update for a saved "Private", and never sends another option in its place', async () => {
    // Windy answers 400 to `private`. Sending `only_windy` instead would put
    // a vessel on the map whose owner never chose that.
    const env = createEnv()
    env.plugin.start(config(identity({ shareOption: 'private' })))
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 0)
    env.plugin.stop()
  })

  it('still sends observations for a saved "Private"', async () => {
    const env = createEnv()
    env.plugin.start(config(identity({ shareOption: 'private' })))
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })

  it('keeps the reason on the dashboard as an error for a saved "Private"', async () => {
    const env = createEnv()
    env.plugin.start(config(identity({ shareOption: 'private' })))
    await advance(1000)
    assert.equal(env.errors[env.errors.length - 1], 'Station position not updated: Share Option "Private" is not accepted by Windy. Choose Public or Windy only in the plugin configuration. | Warm: 0m14s')
    await advance(WARM_UP_MS + 60000)
    assert.equal(env.errors[env.errors.length - 1], 'Station position not updated: Share Option "Private" is not accepted by Windy. Choose Public or Windy only in the plugin configuration. | Next: 3m59s')
    // Logged once at start, not once a second.
    assert.equal(env.errorLines.filter((line) => line.includes('Share Option')).length, 1)
    env.plugin.stop()
  })

  it('sends no station update when no share option was saved, and says so', async () => {
    // A share option decides who may use the data. It is never chosen on the
    // owner's behalf, not even the form's default.
    const env = createEnv()
    env.plugin.start({ credentials })
    await advance(WARM_UP_MS)
    assert.equal(env.puts().length, 0)
    assert.equal(env.gets().length, 1)
    assert.match(env.errors[0], /^Station position not updated: Share Option is not set\. Choose Public or Windy only in the plugin configuration\. \| Warm: /)
    env.plugin.stop()
  })

  it('accepts the share option in any letter case', async () => {
    const env = createEnv()
    env.plugin.start(config(identity({ shareOption: 'Public' })))
    await advance(WARM_UP_MS)
    assert.equal(env.puts()[0].body.share_option, 'public')
    env.plugin.stop()
  })

  it('shows no share option error for a valid option', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS + 60000)
    assert.deepEqual(env.errors, [])
    env.plugin.stop()
  })
})

describe('Force GPS Updates', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('shows "Forced" in place of the distance on every form of the dashboard line', async () => {
    const env = createEnv()
    env.plugin.start(config({ logic: { interval: 5, minMove: 300, forceUpdate: true } }))
    await advance(1000)
    assert.equal(env.lastStatus(), 'Warm: 0m14s | Forced')
    await advance(WARM_UP_MS - 1000)
    assert.match(env.lastStatus(), /^Next: 0m00s \| Forced \| W:9\.9 G:14\.0 D:180 T:20\.0 P:101\.3 H:65 \| \d{2}:\d{2}$/)
    await advance(60000)
    assert.match(env.lastStatus(), /^Next: 4m00s \| Forced \| W:9\.9 /)
    env.plugin.stop()
  })

  it('shows the distance when the setting is off', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS + 60000)
    assert.match(env.lastStatus(), /^Next: 4m00s \| Δ0m \| /)
    assert.ok(!env.statuses.some((status) => status.includes('Forced')))
    env.plugin.stop()
  })

  it('shows "Forced" on the no-data line too', async () => {
    const env = createEnv({ tree: { navigation: fullTree().navigation } })
    env.plugin.start(config({ logic: { interval: 5, minMove: 300, forceUpdate: true } }))
    await advance(WARM_UP_MS + 60000)
    assert.equal(env.lastStatus(), 'Next: 4m00s | Forced | No data: environment.wind.speedOverGround +4')
    env.plugin.stop()
  })
})

describe('station elevation', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  async function elevationFor (tree, identityOverrides) {
    const env = createEnv({ tree })
    env.plugin.start(config(identity(identityOverrides)))
    await advance(WARM_UP_MS)
    const sent = env.puts()[0].body.elev_m
    env.plugin.stop()
    return sent
  }

  const treeWithAltitude = (value) => {
    const tree = fullTree()
    tree.navigation.gnss = { antennaAltitude: { value } }
    return tree
  }

  it('sends the value from the settings in place of the GNSS altitude', async () => {
    assert.equal(await elevationFor(treeWithAltitude(27.3), { elevation: 2 }), 2)
  })

  it('sends an elevation of 0 from the settings as 0', async () => {
    assert.equal(await elevationFor(treeWithAltitude(27.3), { elevation: 0 }), 0)
  })

  it('accepts a negative elevation and rounds one that is not a whole number', async () => {
    assert.equal(await elevationFor(fullTree(), { elevation: -3 }), -3)
    assert.equal(await elevationFor(fullTree(), { elevation: 4.6 }), 5)
  })

  it('sends the GNSS altitude when the setting is empty, as before', async () => {
    assert.equal(await elevationFor(treeWithAltitude(27.3), {}), 27)
    assert.equal(await elevationFor(treeWithAltitude(27.3), { elevation: 'high' }), 27)
  })

  it('sends 0 when the setting is empty and the GNSS altitude is older than the limit', async () => {
    const env = createEnv({ live: false })
    env.hold('navigation.gnss.antennaAltitude', 27.3, 60 * 60000)
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.puts()[0].body.elev_m, 0)
    env.plugin.stop()
  })
})

describe('humidity path', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  /** A tree with humidity on the given path only. */
  function treeWithHumidityOn (skPath, value) {
    const tree = fullTree()
    delete tree.environment.outside.humidity
    const keys = skPath.split('.')
    let node = tree
    for (const key of keys.slice(0, -1)) node = node[key] = node[key] || {}
    node[keys[keys.length - 1]] = { value }
    return tree
  }

  async function humidityFor (tree, pathMap) {
    const env = createEnv({ tree })
    env.plugin.start(config(pathMap ? { pathMap } : {}))
    await advance(WARM_UP_MS)
    const params = env.gets()[0].params
    env.plugin.stop()
    return params.rh
  }

  it('reads environment.outside.humidity by default, the path Signal K\'s NMEA converters publish', async () => {
    assert.equal(await humidityFor(treeWithHumidityOn('environment.outside.humidity', 0.71)), '71')
  })

  it('falls back to environment.outside.relativeHumidity, the default of earlier versions', async () => {
    assert.equal(await humidityFor(treeWithHumidityOn('environment.outside.relativeHumidity', 0.72)), '72')
  })

  it('reads environment.outside.humidity for a configuration that still holds the earlier default', async () => {
    // The form saves its defaults, so a configuration saved by an earlier
    // version names relativeHumidity explicitly.
    const rh = await humidityFor(treeWithHumidityOn('environment.outside.humidity', 0.73), { humidity: 'environment.outside.relativeHumidity' })
    assert.equal(rh, '73')
  })

  it('prefers the configured path when both hold a value', async () => {
    const tree = treeWithHumidityOn('environment.outside.relativeHumidity', 0.5)
    tree.environment.outside.humidity = { value: 0.6 }
    assert.equal(await humidityFor(tree), '60')
    assert.equal(await humidityFor(tree, { humidity: 'environment.outside.relativeHumidity' }), '50')
  })

  it('does not fall back from a path the owner chose', async () => {
    const tree = fullTree()
    assert.equal(await humidityFor(tree, { humidity: 'environment.inside.humidity' }), undefined)
  })
})
