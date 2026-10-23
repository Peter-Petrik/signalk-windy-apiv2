'use strict'

/*
 * How the plugin reacts when Windy refuses a request or cannot be reached:
 * what the dashboard shows, what is logged, and when the next attempt is made.
 */

const { describe, it, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  WARM_UP_MS, FIVE_MINUTES_MS,
  config, createEnv, httpError, networkError, advance, setUp, tearDown
} = require('../test-support/harness')

describe('rate limit (HTTP 429)', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('retries at the time Windy names in retry_after, without showing an error', async () => {
    const env = createEnv()
    let attempts = 0
    env.get = async () => {
      attempts++
      if (attempts === 1) throw httpError(429, { retry_after: new Date(Date.now() + 90000).toISOString() })
      return { status: 200, data: {} }
    }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    // Two seconds after the moment Windy named, so that a clock slightly
    // ahead of Windy's does not retry too early.
    await advance(91999)
    assert.equal(env.gets().length, 1)
    await advance(1)
    assert.equal(env.gets().length, 2)
    assert.equal(env.gets()[1].at - env.gets()[0].at, 92000)
    assert.deepEqual(env.errors, [])
    env.plugin.stop()
  })

  it('returns to the normal interval after the retry', async () => {
    const env = createEnv()
    let attempts = 0
    env.get = async () => {
      attempts++
      if (attempts === 1) throw httpError(429, { retry_after: new Date(Date.now() + 90000).toISOString() })
      return { status: 200, data: {} }
    }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(92000)
    await advance(FIVE_MINUTES_MS - 1)
    assert.equal(env.gets().length, 2)
    await advance(1)
    assert.equal(env.gets().length, 3)
    env.plugin.stop()
  })

  it('waits the normal interval when retry_after is missing', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(429, {}) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS - 1)
    assert.equal(env.gets().length, 1)
    await advance(1)
    assert.equal(env.gets().length, 2)
    assert.deepEqual(env.errors, [])
    env.plugin.stop()
  })

  it('waits the normal interval when retry_after is in the past or more than ten minutes ahead', async () => {
    for (const offset of [-5000, 11 * 60 * 1000]) {
      const env = createEnv()
      env.get = async () => { throw httpError(429, { retry_after: new Date(Date.now() + offset).toISOString() }) }
      env.plugin.start(config())
      await advance(WARM_UP_MS)
      await advance(FIVE_MINUTES_MS - 1)
      assert.equal(env.gets().length, 1)
      await advance(1)
      assert.equal(env.gets().length, 2)
      env.plugin.stop()
    }
  })
})

describe('duplicate observation (HTTP 409)', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('shows no error and logs none, because Windy already holds the observation', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(409, { statusCode: 409 }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, [])
    assert.deepEqual(env.errorLines, [])
    assert.ok(env.debugLines.some((line) => line.includes('(409)')))
    env.plugin.stop()
  })

  it('reports again at the normal interval', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(409, {}) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS - 1)
    assert.equal(env.gets().length, 1)
    await advance(1)
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })
})

describe('observation rejected', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('names the Station Password when Windy answers 400 with a password message', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: 'Provided password is invalid', error: 'Bad Request', statusCode: 400 }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, ['Station Password rejected by Windy — verify the Station Password in the plugin configuration'])
    env.plugin.stop()
  })

  it('names both the Station ID and the Station Password when Windy says they do not match', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: 'Provided password does not match with station id', error: 'Bad Request', statusCode: 400 }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, ['Station ID and Station Password do not belong together — verify both in the plugin configuration'])
    env.plugin.stop()
  })

  it('shows the status and the answer for any other rejection', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: ['rh must not be greater than 100'], error: 'Bad Request', statusCode: 400 }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.equal(env.errors.length, 1)
    assert.match(env.errors[0], /^Observation failed: Status 400: /)
    assert.match(env.errors[0], /rh must not be greater than 100/)
    env.plugin.stop()
  })

  it('shows a server error and tries again on the next cycle', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(500, { message: 'Internal server error' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.match(env.errors[0], /^Observation failed: Status 500: /)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })

  it('does not put the station password into any log line or status', async () => {
    const env = createEnv()
    env.get = async () => { throw httpError(400, { message: 'Provided password is invalid' }) }
    env.put = async () => { throw httpError(403, { message: 'Forbidden resource' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    const everything = JSON.stringify([env.statuses, env.errors, env.debugLines, env.errorLines])
    assert.ok(!everything.includes('station-password'))
    assert.ok(!everything.includes('api-key'))
    env.plugin.stop()
  })
})

describe('station update rejected', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  // The three answers below are the ones the live API gave on 2026-10-10.

  it('names the Global API Key when Windy answers 403', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(403, { message: 'Forbidden resource', error: 'Forbidden', statusCode: 403 }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, ['Windy rejected the Global API Key (403) — verify the Global API Key in the plugin configuration'])
    env.plugin.stop()
  })

  it('names the Station ID when Windy answers 404', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(404, { message: 'PWS not found', error: 'Not Found', statusCode: 404 }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, ['Windy does not know this Station ID (404) — verify the Station ID in the plugin configuration'])
    env.plugin.stop()
  })

  it('shows the status for any other rejection', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(400, { message: ['elev_m must be an integer number'], error: 'Bad Request', statusCode: 400 }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, ['Metadata update failed (400): elev_m must be an integer number'])
    env.plugin.stop()
  })

  it('still sends the observation in the same cycle', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(403, { message: 'Forbidden resource' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET'])
    env.plugin.stop()
  })

  it('tries the station update again on the next cycle', async () => {
    const env = createEnv()
    env.put = async () => { throw httpError(403, { message: 'Forbidden resource' }) }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.deepEqual(env.requests.map((r) => r.method), ['PUT', 'GET', 'PUT', 'GET'])
    env.plugin.stop()
  })
})

describe('network errors', () => {
  beforeEach(setUp)
  afterEach(tearDown)

  it('logs a failed observation without turning the dashboard red', async () => {
    const env = createEnv()
    env.get = async () => { throw networkError('EAI_AGAIN') }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, [])
    assert.ok(env.errorLines.some((line) => /^Windy Observation Error \(network\): .*EAI_AGAIN/.test(line)))
    env.plugin.stop()
  })

  it('logs a failed station update without turning the dashboard red', async () => {
    const env = createEnv()
    env.put = async () => { throw networkError('ENOTFOUND') }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    assert.deepEqual(env.errors, [])
    assert.ok(env.errorLines.some((line) => /^Windy Metadata Error \(network\): .*ENOTFOUND/.test(line)))
    env.plugin.stop()
  })

  it('tries again on the next cycle', async () => {
    const env = createEnv()
    env.get = async () => { throw networkError('ETIMEDOUT') }
    env.plugin.start(config())
    await advance(WARM_UP_MS)
    await advance(FIVE_MINUTES_MS)
    assert.equal(env.gets().length, 2)
    env.plugin.stop()
  })
})
