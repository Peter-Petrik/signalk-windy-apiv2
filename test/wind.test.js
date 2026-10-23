'use strict'

/*
 * The wind of a report is the wind of its whole interval: the speed is the
 * mean, weighted by how long each value stood; the gust is the highest
 * value; the direction is the vector mean, weighted by the wind speed.
 * Also the wind paths that cannot give the wind Windy expects.
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test')
const assert = require('node:assert/strict')
const {
  START_TIME, WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, advance, setUp, tearDown
} = require('../test-support/harness')

const SPEED = 'environment.wind.speedOverGround'
const GUST = 'environment.wind.gust'
const DIRECTION = 'environment.wind.directionTrue'
const OTHERS = ['environment.outside.temperature', 'environment.outside.pressure', 'environment.outside.humidity']

const radians = (degrees) => (degrees * Math.PI) / 180
const lastParams = (env) => env.gets()[env.gets().length - 1].params

/**
 * Starts the plugin without simulated sensors and waits for the first
 * report. The next report comes one interval later, so its window starts
 * now.
 */
async function startedEnv (tree = fullTree(), overrides) {
  const env = createEnv({ tree, live: false })
  env.plugin.start(config(overrides))
  await advance(WARM_UP_MS)
  return env
}

/** Repeats the temperature, pressure and humidity, so that they stay current. */
function refreshOthers (env) {
  for (const skPath of OTHERS) {
    const node = skPath.split('.').reduce((n, key) => n[key], env.tree)
    env.emit(skPath, node.value)
  }
}

describe('the wind speed', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is the mean of the interval, weighted by how long each value stood', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 4.0)
    await advance(60000)
    env.emit(SPEED, 10.0)
    await advance(FIVE_MINUTES_MS - 60000)
    // 4 m/s for 60 s and 10 m/s for 240 s.
    assert.equal(lastParams(env).wind, '8.8')
    env.plugin.stop()
  })

  it('is not pulled up by a burst of samples at the end of the interval', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 4.0)
    await advance(FIVE_MINUTES_MS - 10000)
    for (let i = 0; i < 20; i++) env.emit(SPEED, 10.0)
    await advance(10000)
    // 4 m/s for 290 s and 10 m/s for 10 s; a mean of the samples would be
    // about 9.7.
    assert.equal(lastParams(env).wind, '4.2')
    env.plugin.stop()
  })

  it('leaves out a gap in which the sensor had no value', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 4.0)
    await advance(100000)
    env.emit(SPEED, null)
    await advance(100000)
    env.emit(SPEED, 10.0)
    await advance(100000)
    assert.equal(lastParams(env).wind, '7.0')
    env.plugin.stop()
  })

  it('leaves out a value outside the range Windy accepts, and lets the value before it stand', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 4.0)
    await advance(150000)
    env.emit(SPEED, 250)
    await advance(100000)
    env.emit(SPEED, 6.0)
    await advance(50000)
    // 4 m/s for 250 s and 6 m/s for 50 s.
    assert.equal(lastParams(env).wind, '4.3')
    assert.equal(lastParams(env).gust, '6.0')
    env.plugin.stop()
  })

  it('leaves out the time in which the server declared the sensor timed out', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 4.0)
    await advance(100000)
    env.timeOut(SPEED)
    await advance(100000)
    env.emit(SPEED, 10.0)
    await advance(100000)
    assert.equal(lastParams(env).wind, '7.0')
    env.plugin.stop()
  })

  it('is not interrupted by another source of the path that has no value or has timed out', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 4.0)
    await advance(50000)
    env.emit(SPEED, null, 'other')
    await advance(50000)
    env.timeOut(SPEED, 'other')
    await advance(100000)
    env.emit(SPEED, 10.0)
    await advance(100000)
    // 4 m/s for 200 s and 10 m/s for 100 s.
    assert.equal(lastParams(env).wind, '6.0')
    env.plugin.stop()
  })

  it('is left out when the latest value lies outside the range Windy accepts', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 8.0)
    // A calm read with a slight calibration offset, every minute.
    for (let i = 0; i < 5; i++) {
      await advance(60000)
      env.emit(SPEED, -0.1)
    }
    assert.ok(!('wind' in lastParams(env)))
    assert.match(env.lastStatus(), / W:- /)
    env.plugin.stop()
  })

  it('does not count a value from before the sensor stopped for longer than the age limit', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 15.0)
    env.emit(DIRECTION, radians(270))
    // Two hours without the instruments, as at anchor overnight.
    for (let i = 0; i < 24; i++) {
      await advance(FIVE_MINUTES_MS)
      refreshOthers(env)
    }
    await advance(FIVE_MINUTES_MS - 60000)
    env.emit(SPEED, 3.0)
    env.emit(DIRECTION, radians(90))
    refreshOthers(env)
    await advance(60000)
    assert.equal(lastParams(env).wind, '3.0')
    assert.equal(lastParams(env).gust, '3.0')
    assert.equal(lastParams(env).winddir, '90')
    env.plugin.stop()
  })

  it('keeps counting a value that a working sensor repeats, however long it stays the same', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = await startedEnv(tree)
    for (let i = 0; i < 30; i++) {
      env.emit(SPEED, 6.0)
      refreshOthers(env)
      await advance(60000)
    }
    assert.equal(lastParams(env).wind, '6.0')
    assert.equal(lastParams(env).gust, '6.0')
    env.plugin.stop()
  })

  it('in a calm gives a gust of 0', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = await startedEnv(tree)
    env.emit(SPEED, 0)
    await advance(FIVE_MINUTES_MS)
    assert.equal(lastParams(env).wind, '0.0')
    assert.equal(lastParams(env).gust, '0.0')
    env.plugin.stop()
  })

  it('does not stretch a repeated value over the time it had expired', async () => {
    const env = await startedEnv(fullTree(), { logic: { interval: 5, minMove: 300, forceUpdate: false, maxAge: 2 } })
    env.emit(SPEED, 10.0)
    await advance(60000)
    env.emit(SPEED, 4.0)
    refreshOthers(env)
    await advance(120000)
    refreshOthers(env)
    await advance(110000)
    env.emit(SPEED, 4.0)
    refreshOthers(env)
    await advance(10000)
    // 10 m/s for 60 s, 4 m/s for 120 s until it expires, nothing for 110 s,
    // then 4 m/s again for 10 s.
    assert.equal(lastParams(env).wind, '5.9')
    env.plugin.stop()
  })

  it('takes the range of the wind speed when one path is set for both the wind speed and the gust', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = await startedEnv(tree, { pathMap: { windGust: SPEED } })
    env.emit(SPEED, 4.0)
    await advance(100000)
    env.emit(SPEED, 250)
    await advance(100000)
    env.emit(SPEED, 4.0)
    await advance(100000)
    assert.equal(lastParams(env).wind, '4.0')
    assert.equal(lastParams(env).gust, '4.0')
    env.plugin.stop()
  })

  it('is the one value of a sensor that has sent only once', async () => {
    const tree = fullTree()
    tree.environment.wind.speedOverGround.value = 6.66
    const env = createEnv({ tree, live: false })
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).wind, '6.7')
    env.plugin.stop()
  })

  it('is left out, with the gust it gives, when the latest sample is older than the age limit', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = await startedEnv(tree, { logic: { interval: 5, minMove: 300, forceUpdate: false, maxAge: 2 } })
    env.emit(SPEED, 8.0)
    await advance(FIVE_MINUTES_MS - 10000)
    refreshOthers(env)
    await advance(10000)
    assert.equal(env.gets().length, 2)
    assert.ok(!('wind' in lastParams(env)))
    assert.ok(!('gust' in lastParams(env)))
    assert.equal(lastParams(env).temp, '20.0')
    env.plugin.stop()
  })

  it('is left out, with the gust it gives, when the server declares it timed out', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = await startedEnv(tree)
    env.emit(SPEED, 8.0)
    await advance(100000)
    env.timeOut(SPEED)
    await advance(FIVE_MINUTES_MS - 100000)
    assert.ok(!('wind' in lastParams(env)))
    assert.ok(!('gust' in lastParams(env)))
    env.plugin.stop()
  })
})

describe('the gust', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is the highest value of the gust path in the interval, not only its latest one', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 5.0)
    await advance(10000)
    env.emit(GUST, 12.0)
    await advance(10000)
    env.emit(GUST, 7.0)
    await advance(FIVE_MINUTES_MS - 20000)
    assert.equal(lastParams(env).wind, '5.0')
    assert.equal(lastParams(env).gust, '12.0')
    env.plugin.stop()
  })

  it('is the highest wind speed of the interval when that is higher than the gust path', async () => {
    const env = await startedEnv()
    env.emit(GUST, 6.0)
    env.emit(SPEED, 5.0)
    await advance(10000)
    env.emit(SPEED, 13.0)
    await advance(1000)
    env.emit(SPEED, 5.0)
    await advance(FIVE_MINUTES_MS - 11000)
    assert.equal(lastParams(env).gust, '13.0')
    env.plugin.stop()
  })

  it('counts a value that stood at the start of the interval', async () => {
    const tree = fullTree()
    delete tree.environment.wind.gust
    const env = await startedEnv(tree)
    await advance(10000)
    env.emit(SPEED, 9.0)
    await advance(FIVE_MINUTES_MS - 10000)
    // From a sensor that sends only when its value changes: 9 m/s arrived in
    // the previous interval and stood through this one until the last 10 s.
    await advance(FIVE_MINUTES_MS - 10000)
    env.emit(SPEED, 3.0)
    await advance(10000)
    assert.equal(env.gets().length, 3)
    assert.equal(lastParams(env).wind, '8.8')
    assert.equal(lastParams(env).gust, '9.0')
    env.plugin.stop()
  })
})

describe('the wind direction', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is the vector mean, so that 350° and 10° give 0°', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 5.0)
    env.emit(DIRECTION, radians(350))
    await advance(FIVE_MINUTES_MS / 2)
    env.emit(DIRECTION, radians(10))
    await advance(FIVE_MINUTES_MS / 2)
    assert.equal(lastParams(env).winddir, '0')
    env.plugin.stop()
  })

  it('is weighted by the wind speed, so that the direction of a near calm counts little', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 0.5)
    env.emit(DIRECTION, radians(90))
    await advance(FIVE_MINUTES_MS / 2)
    env.emit(SPEED, 10.0)
    env.emit(DIRECTION, radians(180))
    await advance(FIVE_MINUTES_MS / 2)
    // 0.5 m/s from 90° and 10 m/s from 180°, each for 150 s. Without the
    // weight the mean would be 135°.
    assert.equal(lastParams(env).winddir, '177')
    env.plugin.stop()
  })

  it('takes the wind speed that stood at each moment, also when the two change at different times', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 2.0)
    env.emit(DIRECTION, radians(0))
    await advance(100000)
    env.emit(SPEED, 8.0)
    await advance(100000)
    env.emit(DIRECTION, radians(90))
    await advance(100000)
    // 0° at 2 m/s for 100 s and at 8 m/s for 100 s; 90° at 8 m/s for
    // 100 s: atan2(800, 1000).
    assert.equal(lastParams(env).winddir, '39')
    env.plugin.stop()
  })

  it('counts every moment the same in a calm', async () => {
    const env = await startedEnv()
    env.emit(SPEED, 0)
    env.emit(DIRECTION, radians(80))
    await advance(FIVE_MINUTES_MS / 2)
    env.emit(DIRECTION, radians(100))
    await advance(FIVE_MINUTES_MS / 2)
    assert.equal(lastParams(env).winddir, '90')
    env.plugin.stop()
  })

  it('counts every moment the same when no wind speed is known', async () => {
    const tree = fullTree()
    delete tree.environment.wind.speedOverGround
    const env = await startedEnv(tree)
    env.emit(DIRECTION, radians(80))
    await advance(FIVE_MINUTES_MS / 2)
    env.emit(DIRECTION, radians(100))
    await advance(FIVE_MINUTES_MS / 2)
    assert.ok(!('wind' in lastParams(env)))
    assert.equal(lastParams(env).winddir, '90')
    env.plugin.stop()
  })
})

describe('a value that stops standing within the interval', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('leaves the rest of its stretch out of the mean direction', async () => {
    const tree = fullTree()
    delete tree.environment.wind.directionTrue
    const env = await startedEnv(tree, { logic: { interval: 5, minMove: 300, forceUpdate: false, maxAge: 2 } })
    await advance(10000)
    for (let i = 0; i < 10; i++) {
      env.emit(SPEED, 5.0 + (i % 2))
      refreshOthers(env)
      if (i === 6) env.emit(DIRECTION, radians(90))
      if (i === 0) {
        await advance(15000)
        env.emit(DIRECTION, radians(0))
        await advance(15000)
      } else {
        await advance(30000)
      }
    }
    assert.equal(env.gets().length, 2)
    // The speed changes every 30 s from 10 s into the interval. 0° arrives
    // at 25 s and stands for 2 minutes; 90° stands from 190 s to the report:
    // atan2(600, 660).
    assert.equal(lastParams(env).winddir, '42')
    env.plugin.stop()
  })
})

describe('values the server held when the plugin started', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('count only with the newest of them when several sources held one', async () => {
    const tree = fullTree()
    tree.environment.wind.speedOverGround = { value: 8.0, timestamp: new Date(Date.now() - 1000).toISOString() }
    const held = [{ path: SPEED, value: 1.0, timestamp: new Date(Date.now() - 600000).toISOString(), source: 'old' }]
    const env = createEnv({ tree, held, live: false })
    env.plugin.start(config())
    for (let i = 0; i < 15; i++) {
      env.emit(SPEED, 8.0)
      await advance(1000)
    }
    assert.equal(lastParams(env).wind, '8.0')
    env.plugin.stop()
  })

  it('count only with the newest of them, also when the older one comes last', async () => {
    const tree = fullTree()
    tree.environment.wind.speedOverGround = { value: 1.0, timestamp: new Date(Date.now() - 600000).toISOString() }
    const held = [{ path: SPEED, value: 8.0, timestamp: new Date(Date.now() - 1000).toISOString(), source: 'new' }]
    const env = createEnv({ tree, held, live: false })
    env.plugin.start(config())
    for (let i = 0; i < 15; i++) {
      env.emit(SPEED, 8.0)
      await advance(1000)
    }
    assert.equal(lastParams(env).wind, '8.0')
    env.plugin.stop()
  })

  it('do not give the gust when the gust path was held from before the interval', async () => {
    const tree = fullTree()
    tree.environment.wind.gust = { value: 25.0, timestamp: new Date(Date.now() - 14 * 60000).toISOString() }
    const env = createEnv({ tree, live: false })
    env.plugin.start(config())
    env.emit(SPEED, 3.0)
    await advance(WARM_UP_MS)
    assert.equal(lastParams(env).gust, '3.0')
    env.plugin.stop()
  })
})

describe('a system clock that is set back', () => {
  beforeEach(() => {
    // Timers are mocked, the clock is not: Date.now() is set by the test, so
    // that the clock can be moved without the timers noticing.
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  })
  afterEach(tearDown)

  it('starts the wind of the next report from the values that follow it', async () => {
    let now = START_TIME
    mock.method(Date, 'now', () => now)
    try {
      const step = async (ms) => {
        for (let i = 0; i < ms / 1000; i++) {
          now += 1000
          await advance(1000)
        }
      }
      const tree = fullTree()
      delete tree.environment.wind.gust
      const env = createEnv({ tree, live: false })
      env.plugin.start(config())
      await step(WARM_UP_MS + 20000)
      // Repeated every second for 41 s, from 20 s into the interval.
      for (let i = 0; i <= 40; i++) {
        env.emit(SPEED, 9.0)
        env.emit(DIRECTION, radians(200))
        await step(1000)
      }
      // The clock was 30 s ahead; set-system-time puts it right.
      now -= 30000
      env.emit(SPEED, 6.0)
      env.emit(DIRECTION, radians(100))
      await step(FIVE_MINUTES_MS - 61000)
      assert.equal(env.gets().length, 2)
      assert.equal(lastParams(env).wind, '6.0')
      assert.equal(lastParams(env).gust, '6.0')
      assert.equal(lastParams(env).winddir, '100')
      env.plugin.stop()
    } finally {
      mock.restoreAll()
    }
  })
})

describe('a wind path that cannot give the wind Windy expects', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  /** The first report with the given wind paths, and what the dashboard shows. */
  async function reportWith (pathMap, values) {
    const tree = fullTree()
    for (const [skPath, value] of Object.entries(values)) {
      const keys = skPath.split('.')
      let node = tree
      for (const key of keys.slice(0, -1)) node = node[key] = node[key] || {}
      node[keys[keys.length - 1]] = { value }
    }
    const env = createEnv({ tree })
    env.plugin.start(config({ pathMap }))
    await advance(WARM_UP_MS)
    const result = { params: env.gets()[0].params, dashboard: env.dashboard(), errorLines: env.errorLines }
    env.plugin.stop()
    return result
  }

  it('is named on the dashboard when it is apparent wind, and the wind is still sent', async () => {
    const { params, dashboard, errorLines } = await reportWith({ windSpeed: 'environment.wind.speedApparent' }, { 'environment.wind.speedApparent': 6.0 })
    assert.equal(params.wind, '6.0')
    const text = "Wind Speed path environment.wind.speedApparent is apparent wind, which includes the boat's own speed. Choose environment.wind.speedOverGround in the plugin configuration."
    assert.deepEqual(dashboard, { type: 'error', message: text, lastError: null })
    assert.ok(errorLines.includes(text))
  })

  for (const skPath of ['environment.wind.angleApparent', 'environment.wind.angleTrueWater', 'environment.wind.angleTrueGround']) {
    it(`leaves the direction out and says why when it is ${skPath}, an angle from the bow`, async () => {
      const { params, dashboard } = await reportWith({ windDir: skPath }, { [skPath]: 0.5 })
      assert.ok(!('winddir' in params))
      assert.equal(params.wind, '5.1')
      assert.equal(dashboard.type, 'error')
      assert.equal(dashboard.message, `Wind Direction path ${skPath} is an angle from the bow, so no wind direction is sent. Choose environment.wind.directionTrue in the plugin configuration.`)
    })
  }

  it('is named on the dashboard when it is the magnetic direction, and the direction is still sent', async () => {
    const { params, dashboard } = await reportWith({ windDir: 'environment.wind.directionMagnetic' }, { 'environment.wind.directionMagnetic': Math.PI / 2 })
    assert.equal(params.winddir, '90')
    assert.equal(dashboard.message, 'Wind Direction path environment.wind.directionMagnetic is magnetic, while Windy expects degrees from true north. Choose environment.wind.directionTrue in the plugin configuration.')
  })

  it('names both problems when both paths have one', async () => {
    const { dashboard } = await reportWith(
      { windSpeed: 'environment.wind.speedApparent', windDir: 'environment.wind.angleApparent' },
      { 'environment.wind.speedApparent': 6.0, 'environment.wind.angleApparent': 0.5 }
    )
    assert.match(dashboard.message, /^Wind Speed path .* \| Wind Direction path environment\.wind\.angleApparent /)
  })

  it('does not apply to the default paths or to a path of the owner\'s own', async () => {
    for (const pathMap of [{}, { windSpeed: 'custom.ws', windDir: 'custom.wd' }]) {
      const { dashboard } = await reportWith(pathMap, { 'custom.ws': 4.0, 'custom.wd': 1.0 })
      assert.equal(dashboard.type, 'status')
    }
  })
})

describe('a long reporting interval', () => {
  it('takes a day of samples, one a second, in one pass', () => {
    const { createSamples } = require('../lib/samples')
    const samples = createSamples()
    const t0 = START_TIME
    for (let i = 0; i < 86400; i++) {
      samples.add('speed', 5 + (i % 7), t0 + i * 1000)
      samples.add('direction', radians(i % 360), t0 + i * 1000)
    }
    const started = process.hrtime.bigint()
    const to = t0 + 86400 * 1000
    assert.ok(samples.mean('speed', t0, to) > 5)
    assert.equal(samples.max('speed', t0, to), 11)
    assert.notEqual(samples.directionMean('direction', 'speed', t0, to), null)
    // A pass that looked the value up again for each moment took 43 s.
    assert.ok(Number(process.hrtime.bigint() - started) / 1e9 < 5)
  })
})
