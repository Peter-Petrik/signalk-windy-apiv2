'use strict'

/*
 * Stale readings: a sensor that has stopped is not reported as current.
 * Also what follows from taking every reading from the subscription: wind
 * and gust from the same samples, and nothing read from the data tree.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, httpError, networkError, deferred, advance, settle, setUp, tearDown
} = require('../test-support/harness')

const SENSOR_PATHS = [
  'environment.wind.speedOverGround',
  'environment.wind.gust',
  'environment.wind.directionTrue',
  'environment.outside.temperature',
  'environment.outside.pressure',
  'environment.outside.humidity'
]

const logic = (overrides) => ({ logic: { interval: 5, minMove: 300, forceUpdate: false, ...overrides } })

/** Repeats the current value of the given paths, as working sensors do. */
function refresh (env, paths) {
  for (const skPath of paths) {
    const node = skPath.split('.').reduce((n, key) => n[key], env.tree)
    env.emit(skPath, node.value)
  }
}

/**
 * Runs `cycles` further reporting cycles with every sensor working except
 * the ones named in `stopped`.
 */
async function runCycles (env, cycles, stopped = []) {
  const working = SENSOR_PATHS.filter((skPath) => !stopped.includes(skPath))
  for (let i = 0; i < cycles; i++) {
    await advance(FIVE_MINUTES_MS - 1000)
    refresh(env, working)
    await advance(1000)
  }
}

const lastParams = (env) => env.gets()[env.gets().length - 1].params

describe('a sensor that has stopped', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is reported while its last reading is younger than the limit', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    // Two more cycles: the humidity reading is now 10 minutes and 15 seconds old.
    await runCycles(env, 2, ['environment.outside.humidity'])
    assert.equal(lastParams(env).rh, '65')
    env.plugin.stop()
  })

  it('is left out once its last reading is older than the default of 15 minutes', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await runCycles(env, 3, ['environment.outside.humidity'])
    // 15 minutes and 15 seconds after the last humidity reading.
    assert.ok(!('rh' in lastParams(env)))
    assert.equal(lastParams(env).temp, '20.0')
    assert.ok(env.debugLines.includes('Reading ignored: environment.outside.humidity was last updated 15 minutes ago'))
    env.plugin.stop()
  })

  it('is shown with a dash on the dashboard, so that the gap is visible', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await runCycles(env, 3, ['environment.outside.humidity', 'environment.outside.temperature'])
    assert.match(env.lastStatus(), /^Next: 0m00s \| Δ0m \| W:9\.9 G:14\.0 D:180 T:- P:101\.3 H:- \| \d{2}:\d{2}$/)
    env.plugin.stop()
  })

  it('is reported again as soon as it sends a reading', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await runCycles(env, 3, ['environment.outside.humidity'])
    assert.ok(!('rh' in lastParams(env)))
    env.emit('environment.outside.humidity', 0.7)
    await runCycles(env, 1, ['environment.outside.humidity'])
    assert.equal(lastParams(env).rh, '70')
    assert.match(env.lastStatus(), / H:70 \| /)
    env.plugin.stop()
  })

  it('honours a shorter limit from the settings', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config(logic({ maxAge: 5 })))
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).rh, '65')
    // One cycle later the reading is 5 minutes and 15 seconds old.
    await runCycles(env, 1, ['environment.outside.humidity'])
    assert.ok(!('rh' in lastParams(env)))
    env.plugin.stop()
  })

  it('is reported for as long as it takes when the limit is 0', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config(logic({ maxAge: 0 })))
    await advance(WARM_UP_MS)
    await runCycles(env, 12, SENSOR_PATHS)
    // An hour without a single reading from any sensor.
    assert.equal(env.gets().length, 13)
    assert.equal(lastParams(env).rh, '65')
    assert.equal(lastParams(env).wind, '5.1')
    env.plugin.stop()
  })

  it('applies the default limit to a configuration saved before the setting existed', async () => {
    const env = createEnv({ live: false })
    const saved = config()
    assert.equal(saved.logic.maxAge, undefined)
    env.plugin.start(saved)
    await advance(WARM_UP_MS)
    await runCycles(env, 3, SENSOR_PATHS)
    assert.equal(env.gets().length, 3, 'nothing is sent once every reading is stale')
    env.plugin.stop()
  })

  it('keeps reporting sensors that work, however long the vessel runs', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(12 * FIVE_MINUTES_MS)
    assert.equal(env.gets().length, 13)
    assert.deepEqual(Object.keys(lastParams(env)).sort(), ['gust', 'id', 'pressure', 'rh', 'softwaretype', 'temp', 'ts', 'wind', 'winddir'])
    assert.ok(!env.debugLines.some((line) => line.startsWith('Reading ignored')))
    env.plugin.stop()
  })
})

describe('values the server holds when the plugin starts', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('are not reported when their own timestamp is older than the limit', async () => {
    // After a restart of the plugin the server still holds the last value of
    // a sensor that was switched off an hour ago.
    const env = createEnv({ live: false })
    env.hold('environment.outside.temperature', 293.15, 60 * 60000)
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.ok(!('temp' in lastParams(env)))
    assert.equal(lastParams(env).wind, '5.1')
    assert.match(env.lastStatus(), / T:- /)
    env.plugin.stop()
  })

  it('are reported when their own timestamp is recent', async () => {
    const env = createEnv({ live: false })
    env.hold('environment.outside.temperature', 293.15, 5 * 60000)
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).temp, '20.0')
    env.plugin.stop()
  })

  it('are taken as current when their timestamp lies in the future or cannot be read', async () => {
    const env = createEnv({ live: false })
    env.hold('environment.outside.temperature', 293.15, -3600000)
    env.tree.environment.outside.pressure = { value: 101325, timestamp: 'not a time' }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).temp, '20.0')
    assert.equal(lastParams(env).pressure, '101325')
    env.plugin.stop()
  })

  it('do not stay current for longer because their timestamp lies in the future', async () => {
    const env = createEnv({ live: false })
    env.hold('environment.outside.temperature', 293.15, -3600000)
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await runCycles(env, 3, ['environment.outside.temperature'])
    assert.ok(!('temp' in lastParams(env)))
    env.plugin.stop()
  })

  it('do not count towards the gust peak', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree, live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    // The wind speed is known from the server's store, but no sample has
    // arrived since the start, so there is no peak to report as a gust.
    assert.equal(lastParams(env).wind, '5.1')
    assert.ok(!('gust' in lastParams(env)))
    env.plugin.stop()
  })
})

describe('a live reading', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('counts as current by its arrival, even when its source stamps it with an old time', async () => {
    // A source whose clock is wrong must not make a working sensor look dead.
    const env = createEnv({ live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    for (let i = 0; i < 4; i++) {
      await advance(FIVE_MINUTES_MS - 1000)
      refresh(env, SENSOR_PATHS.filter((p) => p !== 'environment.outside.temperature'))
      env.subscriptions[0].callback({
        context: 'vessels.self',
        updates: [{ $source: 'wrong-clock', timestamp: '2020-01-01T00:00:00.000Z', values: [{ path: 'environment.outside.temperature', value: 288.15 }] }]
      })
      await advance(1000)
    }
    assert.equal(lastParams(env).temp, '15.0')
    env.plugin.stop()
  })

  it('is replaced by "no value" when the server publishes null for the path', async () => {
    const env = createEnv()
    env.plugin.start(config())
    env.emit('environment.outside.temperature', null)
    await advance(WARM_UP_MS)
    assert.ok(!('temp' in lastParams(env)))
    // The path has no reading at all, so there is nothing to mark.
    assert.ok(!env.lastStatus().includes('T:'))
    env.plugin.stop()
  })
})

describe('the position', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is not sent to Windy once it is older than the limit', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config(logic({ forceUpdate: true })))
    await advance(WARM_UP_MS)
    assert.equal(env.puts().length, 1)
    await runCycles(env, 2, [])
    assert.equal(env.puts().length, 3)
    // The GNSS receiver has now been silent for 15 minutes and 15 seconds.
    await runCycles(env, 1, [])
    assert.equal(env.puts().length, 3)
    assert.ok(env.debugLines.includes('Station update not sent: the position was last updated 15 minutes ago'))
    // Observations go on.
    assert.equal(env.gets().length, 4)
    env.plugin.stop()
  })

  it('is sent again once the receiver reports', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config(logic({ forceUpdate: true })))
    await advance(WARM_UP_MS)
    await runCycles(env, 3, [])
    assert.equal(env.puts().length, 3)
    env.emit('navigation.position', { latitude: 37.6, longitude: 23.5 })
    await runCycles(env, 1, [])
    assert.equal(env.puts().length, 4)
    assert.equal(env.puts()[3].body.lat, 37.6)
    env.plugin.stop()
  })
})

describe('nothing to report', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('names the first missing path for the whole countdown, not for one second', async () => {
    const env = createEnv({ tree: { navigation: fullTree().navigation } })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(60000)
    assert.equal(env.lastStatus(), 'Next: 4m00s | Δ0m | No data: environment.wind.speedOverGround +4')
    assert.deepEqual(env.errors, [], 'instruments switched off are not an error')
    env.plugin.stop()
  })

  it('names the only missing path without a count', async () => {
    const tree = { navigation: fullTree().navigation, environment: { wind: { gust: { value: 999 } } } }
    const env = createEnv({ tree })
    env.plugin.start(config({ pathMap: { windSpeed: 'a.b', windDir: 'a.b', temp: 'a.b', pressure: 'a.b', humidity: 'a.b' } }))
    await advance(WARM_UP_MS)
    assert.ok(env.statuses.includes('Next: 0m00s | Δ0m | No data: a.b +4'))
    env.plugin.stop()
  })

  it('replaces the readings of the last report once every sensor has stopped', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.match(env.lastStatus(), /W:9\.9/)
    await runCycles(env, 3, SENSOR_PATHS)
    await advance(60000)
    assert.equal(env.lastStatus(), 'Next: 4m00s | Δ0m | No data: environment.wind.speedOverGround +4')
    env.plugin.stop()
  })

  it('returns to the normal line when readings come back', async () => {
    const env = createEnv({ tree: { navigation: fullTree().navigation } })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.emit('environment.outside.temperature', 293.15)
    await advance(FIVE_MINUTES_MS)
    assert.match(env.lastStatus(), /^Next: 0m00s \| Δ0m \| T:20\.0 \| \d{2}:\d{2}$/)
    await advance(60000)
    assert.match(env.lastStatus(), /^Next: 4m00s \| Δ0m \| T:20\.0 \| \d{2}:\d{2}$/)
    env.plugin.stop()
  })

  it('shows that Windy cannot be reached in place of the readings, and the readings again after the next report', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.get = async () => { throw networkError('EAI_AGAIN') }
    await advance(FIVE_MINUTES_MS + 60000)
    assert.match(env.lastStatus(), /^Next: 4m00s \| Δ0m \| No connection to Windy since \d{2}:\d{2}$/)
    env.get = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS)
    assert.match(env.lastStatus(), /^Next: 4m00s \| Δ0m \| W:9\.9 /)
    env.plugin.stop()
  })
})

describe('wind and gust', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('come from the same samples: the latest one is the wind, the highest one the gust', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree })
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 6.0)
    env.emit('environment.wind.speedOverGround', 9.0)
    env.emit('environment.wind.speedOverGround', 4.0)
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).wind, '4.0')
    assert.equal(lastParams(env).gust, '9.0')
    env.plugin.stop()
  })

  it('never report a gust below the wind speed sent with it', async () => {
    const tree = fullTree()
    tree.environment.wind.speedOverGround.value = 8.0
    tree.environment.wind.gust.value = 3.0
    const env = createEnv({ tree, live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).wind, '8.0')
    assert.equal(lastParams(env).gust, '8.0')
    env.plugin.stop()
  })

  it('do not report a peak from before a long failure as the gust of now', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree, live: false })
    env.get = async () => { throw new Error('socket hang up') }
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 12.0)
    await advance(WARM_UP_MS)
    // Twenty minutes without connectivity and without a wind sample.
    const others = SENSOR_PATHS.filter((p) => !p.startsWith('environment.wind.'))
    await runCycles(env, 3, SENSOR_PATHS.filter((p) => p.startsWith('environment.wind.')))
    env.get = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS - 1000)
    refresh(env, others)
    await advance(1000)
    assert.ok(!('gust' in lastParams(env)))
    assert.ok(!('wind' in lastParams(env)))
    assert.equal(lastParams(env).temp, '20.0')
    env.plugin.stop()
  })

  it('report the peak of the whole interval when the age limit is shorter than the interval', async () => {
    // Found on a real server: with a limit of 1 minute and reports every 5,
    // a peak from early in the interval was discarded as too old.
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree })
    env.plugin.start(config(logic({ maxAge: 1 })))
    await advance(WARM_UP_MS)
    env.emit('environment.wind.speedOverGround', 11.0)
    await advance(30000)
    env.emit('environment.wind.speedOverGround', 5.0)
    await advance(FIVE_MINUTES_MS - 30000)
    assert.equal(lastParams(env).wind, '5.0')
    assert.equal(lastParams(env).gust, '11.0')
    env.plugin.stop()
  })

  it('mark a gust path that was left out only when no gust could be reported', async () => {
    const tree = fullTree()
    tree.environment.wind.gust.value = 999
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    // No sample has arrived yet, so there is no peak to take its place.
    assert.match(env.lastStatus(), / G:- /)
    await advance(FIVE_MINUTES_MS)
    // The wind samples of the interval now provide the gust.
    assert.match(env.lastStatus(), / G:9\.9 /)
    env.plugin.stop()
  })
})

describe('a reading outside the range Windy accepts', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is shown with a dash as well', async () => {
    const tree = fullTree()
    tree.environment.outside.humidity.value = 65
    const env = createEnv({ tree })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.match(env.lastStatus(), / P:101\.3 H:- \| /)
    env.plugin.stop()
  })
})

describe('a reading that is not a number', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is shown with a dash, for every field', async () => {
    const tree = fullTree()
    for (const skPath of SENSOR_PATHS.filter((p) => p !== 'environment.outside.pressure')) {
      skPath.split('.').reduce((n, key) => n[key], tree).value = 'n/a'
    }
    const env = createEnv({ tree, live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.match(env.lastStatus(), /^Next: 0m00s \| Δ0m \| W:- G:- D:- T:- P:101\.3 H:- \| \d{2}:\d{2}$/)
    env.plugin.stop()
  })
})

describe('the data tree', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is not read: every reading comes from the subscription', async () => {
    const tree = fullTree()
    tree.navigation.gnss = { antennaAltitude: { value: 3.4 } }
    const env = createEnv({ tree })
    env.plugin.start(config(logic({ forceUpdate: true })))
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 2)
    assert.equal(env.puts()[1].body.elev_m, 3)
    assert.equal(env.treeReads, 0)
    env.plugin.stop()
  })
})

describe('the peak', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('takes in the samples that arrive while a report is on its way to Windy', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree, live: false })
    const answer = deferred()
    env.get = () => answer.promise
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 6.0)
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).gust, '6.0')
    // A squall while Windy has not answered yet.
    env.emit('environment.wind.speedOverGround', 14.0)
    env.emit('environment.wind.speedOverGround', 4.0)
    answer.resolve()
    await settle()
    env.get = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).wind, '4.0')
    assert.equal(lastParams(env).gust, '14.0')
    env.plugin.stop()
  })

  it('keeps the higher of the two when a failed report gives its peak back', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree, live: false })
    const answer = deferred()
    env.get = () => answer.promise
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 12.0)
    await advance(WARM_UP_MS)
    env.emit('environment.wind.speedOverGround', 15.0)
    env.emit('environment.wind.speedOverGround', 5.0)
    answer.reject(networkError('ETIMEDOUT'))
    await settle()
    env.get = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).gust, '15.0')
    env.plugin.stop()
  })

  it('is given back when the report is rate limited', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree, live: false })
    env.get = async () => { throw httpError(429, {}) }
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 12.0)
    env.emit('environment.wind.speedOverGround', 5.0)
    await advance(WARM_UP_MS)
    env.get = async () => ({ status: 200, data: {} })
    env.emit('environment.wind.speedOverGround', 5.0)
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).gust, '12.0')
    env.plugin.stop()
  })

  it('starts again from the samples after a long failure, instead of being lost', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree, live: false })
    env.get = async () => { throw networkError('EAI_AGAIN') }
    env.plugin.start(config())
    env.emit('environment.wind.speedOverGround', 20.0)
    await advance(WARM_UP_MS)
    // Fifteen minutes without connectivity: the peak of 20 m/s is now too
    // old to be reported. The samples that follow make the peak of now,
    // although they are lower.
    await advance(3 * FIVE_MINUTES_MS - 10000)
    env.emit('environment.wind.speedOverGround', 9.0)
    env.emit('environment.wind.speedOverGround', 6.0)
    refresh(env, SENSOR_PATHS.filter((p) => p !== 'environment.wind.gust' && p !== 'environment.wind.speedOverGround'))
    env.get = async () => ({ status: 200, data: {} })
    await advance(10000)
    assert.equal(lastParams(env).wind, '6.0')
    assert.equal(lastParams(env).gust, '9.0')
    env.plugin.stop()
  })

  it('never expires when the age check is switched off', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = createEnv({ tree, live: false })
    env.get = async () => { throw networkError('EAI_AGAIN') }
    env.plugin.start(config(logic({ maxAge: 0 })))
    env.emit('environment.wind.speedOverGround', 20.0)
    await advance(WARM_UP_MS)
    // An hour without connectivity; the wind drops.
    await advance(12 * FIVE_MINUTES_MS - 10000)
    env.emit('environment.wind.speedOverGround', 6.0)
    env.get = async () => ({ status: 200, data: {} })
    await advance(10000)
    assert.equal(lastParams(env).wind, '6.0')
    assert.equal(lastParams(env).gust, '20.0')
    env.plugin.stop()
  })
})

describe('readings that come back while the report does not reach Windy', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('end the "No data" line, although the report does not reach Windy', async () => {
    const env = createEnv({ tree: { navigation: fullTree().navigation }, live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.match(env.lastStatus(), /No data: /)
    // A rate limit: the observation does not reach Windy, and nothing else
    // takes the place of the readings on the line.
    env.get = async () => { throw httpError(429, {}) }
    env.emit('environment.outside.temperature', 293.15)
    await advance(FIVE_MINUTES_MS + 1000)
    assert.doesNotMatch(env.lastStatus(), /No data/)
    env.plugin.stop()
  })
})

describe('a path the Signal K server declares timed out', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is left out and shown with a dash, like any reading of a sensor that has stopped', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.timeOut('environment.outside.humidity')
    await advance(WARM_UP_MS)
    assert.ok(!('rh' in lastParams(env)))
    assert.match(env.lastStatus(), / H:- \|/)
    assert.ok(env.debugLines.some((line) => line.includes('reports that environment.outside.humidity has timed out')))
    env.plugin.stop()
  })

  it('is reported again with the next value', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.timeOut('environment.outside.humidity')
    await advance(WARM_UP_MS)
    env.emit('environment.outside.humidity', 0.7)
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).rh, '70')
    env.plugin.stop()
  })

  it('holds back the station update when it is the position', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.timeOut('navigation.position')
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['GET'])
    assert.ok(env.debugLines.includes('Station update not sent: the Signal K server reports that navigation.position has timed out'))
    env.plugin.stop()
  })

  it('is ignored when the latest value came from another source of the path', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    env.timeOut('environment.outside.humidity', 'second-sensor')
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).rh, '65')
    env.plugin.stop()
  })

  it('does not take away the value of another source when it is a plain null', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config())
    for (const subscription of env.subscriptions) {
      subscription.callback({ context: 'vessels.self', updates: [{ $source: 'second-sensor', timestamp: new Date().toISOString(), values: [{ path: 'environment.outside.humidity', value: null }] }] })
    }
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).rh, '65')
    env.plugin.stop()
  })

  it('counts as stale even when the age check is switched off', async () => {
    const env = createEnv({ live: false })
    env.plugin.start(config(logic({ maxAge: 0 })))
    env.timeOut('environment.outside.temperature')
    await advance(WARM_UP_MS)
    assert.ok(!('temp' in lastParams(env)))
    assert.match(env.lastStatus(), / T:- /)
    env.plugin.stop()
  })
})
