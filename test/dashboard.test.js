'use strict'

/*
 * The dashboard line as the Signal K admin UI shows it: the current status
 * or error, and the "Last Error" the server keeps. The harness keeps both the
 * way the server does (env.dashboard()).
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test')
const assert = require('node:assert/strict')
const {
  START_TIME, WARM_UP_MS, FIVE_MINUTES_MS,
  config, fullTree, createEnv, httpError, networkError, advance, setUp, tearDown
} = require('../test-support/harness')

const API_KEY_ERROR = 'Windy rejected the Global API Key (403) — verify the Global API Key in the plugin configuration'
const PASSWORD_ERROR = 'Station Password rejected by Windy — verify the Station Password in the plugin configuration'

describe('a request Windy refuses', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('stays on the dashboard as an error when the observation of the same cycle succeeds', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(403, { message: 'Forbidden resource' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.gets().length, 1, 'the observation was sent and accepted')
    await advance(60000)
    assert.deepEqual(env.dashboard(), { type: 'error', message: API_KEY_ERROR, lastError: null })
    env.plugin.stop()
  })

  it('is set once and not repeated every second', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: 'Provided password is invalid' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS * 2)
    assert.deepEqual(env.errors, [PASSWORD_ERROR])
    assert.equal(env.dashboard().message, PASSWORD_ERROR)
    env.plugin.stop()
  })

  it('gives way to the countdown once the station update succeeds, and remains as Last Error', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(403, { message: 'Forbidden resource' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.put = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS + 1000)
    const board = env.dashboard()
    assert.equal(board.type, 'status')
    assert.match(board.message, /^Next: 4m59s \| Δ0m \| W:/)
    assert.equal(board.lastError, API_KEY_ERROR)
    env.plugin.stop()
  })

  it('gives way to the countdown once an observation is accepted, and remains as Last Error', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: 'Provided password is invalid' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.get = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS + 1000)
    assert.equal(env.dashboard().type, 'status')
    assert.equal(env.dashboard().lastError, PASSWORD_ERROR)
    env.plugin.stop()
  })

  it('is cleared by a rate limit or a duplicate, which show that the observation was not refused', async () => {
    for (const answer of [httpError(429, {}), httpError(409, {})]) {
      const env = createEnv()
      env.get = async () => { throw httpError(400, { message: 'Provided password is invalid' }) }
      env.plugin.start(config())
      await advance(WARM_UP_MS)
      env.get = async () => { throw answer }
      await advance(FIVE_MINUTES_MS + 1000)
      assert.equal(env.dashboard().type, 'status', `after ${answer.response.status}`)
      env.plugin.stop()
    }
  })

  it('is shown together with a second refusal, so that neither hides the other', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(403, { message: 'Forbidden resource' }) }
    env.get = async () => { throw httpError(400, { message: 'Provided password is invalid' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS + 60000)
    assert.deepEqual(env.dashboard(), { type: 'error', message: `${PASSWORD_ERROR} | ${API_KEY_ERROR}`, lastError: null })
    env.plugin.stop()
  })

  it('is shown together with a share option Windy does not accept', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: 'Provided password is invalid' }) }
    env.plugin.start(config({ identity: { ...config().identity, shareOption: 'private' } }))
    await advance(WARM_UP_MS + 60000)
    const board = env.dashboard()
    assert.equal(board.type, 'error')
    assert.ok(board.message.startsWith(`${PASSWORD_ERROR} | Station position not updated: Share Option "Private"`))
    // The share option error that was shown before the observation failed
    // has become the Last Error, as the server does with any replaced error.
    assert.match(board.lastError, /^Station position not updated: /)
    env.plugin.stop()
  })

  it('shows Windy\'s explanation of a refused station update', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(400, { message: ['operator_url must be a URL address'], error: 'Bad Request', statusCode: 400 }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().message, 'Metadata update failed (400): operator_url must be a URL address')
    env.plugin.stop()
  })

  it('shows at most 200 characters of an answer and logs at most 500', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: 'x'.repeat(5000) }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    const shown = env.dashboard().message
    assert.ok(shown.startsWith('Observation failed: Status 400: xxx'))
    assert.ok(shown.endsWith('…'))
    assert.equal(shown.length, 'Observation failed: Status 400: '.length + 200)
    const logged = env.errorLines.find((line) => line.startsWith('Windy Observation Error'))
    assert.ok(logged.length <= 'Windy Observation Error: Status 400: '.length + 500)
    env.plugin.stop()
  })

  it('stays while Windy cannot be reached afterwards', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: 'Provided password is invalid' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.get = async () => { throw networkError('EAI_AGAIN') }
    await advance(FIVE_MINUTES_MS + 1000)
    assert.deepEqual(env.dashboard(), { type: 'error', message: PASSWORD_ERROR, lastError: null })
    env.plugin.stop()
  })

  it('of a station update is dropped once no update is due any more', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    // 556 m north: an update is due and Windy refuses it.
    env.put = async () => { throw httpError(500, { message: 'Internal server error' }) }
    env.tree.navigation.position.value = { latitude: 37.505, longitude: 23.4 }
    env.emit('navigation.position', { latitude: 37.505, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS + 1000)
    assert.equal(env.dashboard().type, 'error')
    // Back at the position Windy holds: no update is due, and none is sent.
    env.tree.navigation.position.value = { latitude: 37.5, longitude: 23.4 }
    env.emit('navigation.position', { latitude: 37.5, longitude: 23.4 })
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.puts().length, 2)
    assert.equal(env.dashboard().type, 'status')
    assert.equal(env.dashboard().lastError, 'Metadata update failed (500): Internal server error')
    env.plugin.stop()
  })

  it('leaves out the colon when the answer has no body', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(302, '') }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.dashboard().message, 'Metadata update failed (302)')
    env.plugin.stop()
  })

  it('shows a server error (500) as an error, since the request may have caused it', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(500, { message: 'Internal server error' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS + 1000)
    assert.deepEqual(env.dashboard(), { type: 'error', message: 'Observation failed: Status 500: Internal server error', lastError: null })
    env.plugin.stop()
  })
})

describe('Windy out of reach', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is a plain status, with the time of the first failure in place of the readings', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.get = async () => { throw networkError('EAI_AGAIN') }
    await advance(FIVE_MINUTES_MS)
    const since = env.lastStatus().match(/No connection to Windy since (\d{2}:\d{2})$/)
    assert.ok(since, env.lastStatus())
    await advance(FIVE_MINUTES_MS * 3 + 1000)
    const board = env.dashboard()
    assert.equal(board.type, 'status')
    assert.equal(board.message, `Next: 4m59s | Δ0m | No connection to Windy since ${since[1]}`)
    assert.deepEqual(env.errors, [])
    env.plugin.stop()
  })

  it('names a gateway answer such as 503 as Windy not being available, without an error', async () => {
    const env = createEnv()
    const page = `<!DOCTYPE html><html><head><title>503</title></head><body>${'Service Unavailable '.repeat(200)}</body></html>`
    env.get = async () => { throw httpError(503, page) }
    env.plugin.start(config())
    await advance(WARM_UP_MS + 1000)
    assert.equal(env.dashboard().type, 'status')
    assert.match(env.dashboard().message, /^Next: 4m59s \| Δ0m \| Windy not available \(503\) since \d{2}:\d{2}$/)
    assert.deepEqual(env.errors, [])
    assert.ok(env.errorLines.includes('Windy Observation Error: Status 503: (HTML page)'))
    env.plugin.stop()
  })

  it('treats a request timeout (408) and a station update without an answer the same way', async () => {
    const env = createEnv()
    env.put = async () => { throw networkError('ECONNRESET') }
    env.get = async () => { throw httpError(408, '') }
    env.plugin.start(config())
    await advance(WARM_UP_MS + 1000)
    assert.equal(env.dashboard().type, 'status')
    assert.match(env.dashboard().message, /Windy not available \(408\) since \d{2}:\d{2}$/)
    env.plugin.stop()
  })

  it('treats a gateway answer to a station update like one to an observation', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(502, '<html><body>Bad Gateway</body></html>') }
    env.plugin.start(config())
    await advance(WARM_UP_MS + 1000)
    assert.deepEqual(env.errors, [])
    assert.ok(env.errorLines.includes('Windy Metadata Error (502): (HTML page)'))
    env.plugin.stop()
  })

  it('ends with a station update Windy refuses, which is an answer as well', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    const move = (latitude) => {
      env.tree.navigation.position.value = { latitude, longitude: 23.4 }
      env.emit('navigation.position', { latitude, longitude: 23.4 })
    }
    // 556 m north, and Windy out of reach.
    move(37.505)
    env.put = async () => { throw networkError('EAI_AGAIN') }
    env.get = async () => { throw networkError('EAI_AGAIN') }
    await advance(FIVE_MINUTES_MS)
    const first = env.lastStatus().match(/since (\d{2}:\d{2})$/)[1]
    // Windy refuses the station update; the observation gets no answer, so
    // the failure starts again from this cycle.
    env.put = async () => { throw httpError(403, { message: 'Forbidden resource' }) }
    await advance(FIVE_MINUTES_MS)
    // Back where Windy has the station: the refusal no longer applies.
    move(37.5)
    await advance(FIVE_MINUTES_MS)
    const since = env.lastStatus().match(/No connection to Windy since (\d{2}:\d{2})$/)
    assert.ok(since, env.lastStatus())
    assert.notEqual(since[1], first)
    env.plugin.stop()
  })

  it('ends with a station update Windy accepts', async () => {
    const env = createEnv({ tree: { navigation: fullTree().navigation }, live: false })
    env.put = async () => { throw networkError('EAI_AGAIN') }
    env.plugin.start(config())
    await advance(WARM_UP_MS + 1000)
    assert.match(env.lastStatus(), /No connection to Windy since/)
    env.put = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS)
    assert.doesNotMatch(env.lastStatus(), /No connection/)
    env.plugin.stop()
  })

  it('takes the place of the "No data" line', async () => {
    const env = createEnv({ tree: { navigation: fullTree().navigation }, live: false })
    env.put = async () => { throw networkError('EAI_AGAIN') }
    env.plugin.start(config())
    await advance(WARM_UP_MS + 1000)
    assert.match(env.lastStatus(), /^Next: 4m59s \| Δ0m \| No connection to Windy since \d{2}:\d{2}$/)
    env.plugin.stop()
  })

  it('is still shown after a restart while Windy cannot be reached', async () => {
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.get = async () => { throw networkError('EAI_AGAIN') }
    await advance(FIVE_MINUTES_MS)
    env.plugin.stop()
    env.plugin.start(config())
    await advance(2000)
    assert.match(env.lastStatus(), /^Resume: .* \| No connection to Windy since \d{2}:\d{2}$/)
    env.plugin.stop()
  })

  it('names a request that ran out of time, and an answer too large to read', async () => {
    for (const [err, reason, logged] of [
      [Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' }), 'No answer from Windy', 'no answer within 30 seconds'],
      [Object.assign(new Error('maxContentLength size of 65536 exceeded'), { code: 'ERR_BAD_RESPONSE' }), 'Answer from Windy too large', 'answer larger than 64 KB']
    ]) {
      const env = createEnv()
      env.get = async () => { throw err }
      env.plugin.start(config())
      await advance(WARM_UP_MS + 1000)
      assert.match(env.lastStatus(), new RegExp(`\\| ${reason} since \\d{2}:\\d{2}$`))
      assert.ok(env.errorLines.includes(`Windy Observation Error (network): ${logged}`), env.errorLines.join('\n'))
      env.plugin.stop()
    }
  })

  it('ends with any answer from Windy, a refusal or a rate limit as well', async () => {
    for (const answer of [httpError(429, {}), httpError(409, {}), httpError(400, { message: 'Provided password is invalid' })]) {
      const env = createEnv()
      env.get = async () => { throw networkError('EAI_AGAIN') }
      env.plugin.start(config())
      await advance(WARM_UP_MS)
      env.get = async () => { throw answer }
      await advance(FIVE_MINUTES_MS + 1000)
      assert.doesNotMatch(env.dashboard().message, /No connection/, `after ${answer.response.status}`)
      env.plugin.stop()
    }
  })

  it('ends with the next answer from Windy', async () => {
    const env = createEnv()
    env.get = async () => { throw networkError('EAI_AGAIN') }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    env.get = async () => ({ status: 200, data: {} })
    await advance(FIVE_MINUTES_MS + 1000)
    assert.match(env.lastStatus(), /^Next: 4m59s \| Δ0m \| W:9\.9 G:14\.0 D:180 T:20\.0 P:101\.3 H:65 \| \d{2}:\d{2}$/)
    env.plugin.stop()
  })
})

describe('a cycle that fails in an unforeseen way', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('stays on the dashboard until a cycle completes', async () => {
    const env = createEnv()
    const original = env.app.debug
    let failing = true
    env.app.debug = (line) => {
      if (failing && String(line).startsWith('Windy Submission')) throw new Error('log unavailable')
      original(line)
    }
    env.plugin.start(config())
    await advance(WARM_UP_MS + 60000)
    assert.deepEqual(env.dashboard(), { type: 'error', message: 'Reporting cycle failed: log unavailable', lastError: null })
    failing = false
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.dashboard().type, 'status')
    assert.equal(env.dashboard().lastError, 'Reporting cycle failed: log unavailable')
    env.plugin.stop()
  })
})

describe('the time of the last report', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('is shown as 00:05 five minutes after midnight, never as 24:05', async () => {
    // Five minutes after midnight, local time, 15 seconds before the
    // warm-up ends.
    const midnight = new Date(START_TIME)
    midnight.setHours(0, 5, 0, 0)
    mock.timers.setTime(midnight.getTime() - WARM_UP_MS)
    const env = createEnv()
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.match(env.lastStatus(), / \| 00:05$/)
    env.plugin.stop()
  })
})

describe('the countdown', () => {
  beforeEach(() => {
    // Timers are mocked, the clock is not: Date.now() is set by the test, so
    // that the clock can be moved without the timers noticing, as when a
    // computer's clock is set after it has started.
    mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  })
  afterEach(tearDown)

  it('goes on when the clock is set forward while it runs', async () => {
    let now = START_TIME
    mock.method(Date, 'now', () => now)
    const step = async (ms) => {
      for (let i = 0; i < ms / 1000; i++) {
        now += 1000
        await advance(1000)
      }
    }
    const env = createEnv({ live: false })
    env.plugin.start(config())
    await step(2000)
    assert.match(env.lastStatus(), /^Warm: 0m13s/)
    now += 3 * 3600000
    await step(1000)
    assert.match(env.lastStatus(), /^Warm: 0m12s/)
    env.plugin.stop()
    mock.restoreAll()
  })
})
