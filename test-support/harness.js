/*
 * Test harness for signalk-windy-apiv2.
 *
 * The plugin is driven from the outside, exactly as the Signal K server drives
 * it: through the `app` object it is given, through start() and stop(), and
 * through the passage of time. Nothing in the plugin is replaced except the two
 * axios calls that would otherwise reach Windy, so no test sends a request to
 * the network.
 *
 * Time is controlled with the Node.js test runner's mock timers. A reporting
 * cycle that takes five minutes in production takes no time here, and every
 * run sees the same clock.
 *
 * This file lives outside test/ on purpose: the test runner treats every file
 * under a test directory as a test file.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

const { mock } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const axios = require('axios')

const createPlugin = require('../index.js')

// 2026-10-14T17:46:40.000Z. Any fixed moment after 2026-10-01 works: the
// clock check ignores a GNSS time before then. A fixed one keeps the `ts`
// parameter and the saved schedule the same on every run.
const START_TIME = 1792000000000

const WARM_UP_MS = 15000
const FIVE_MINUTES_MS = 5 * 60 * 1000

const originalPut = axios.put
const originalGet = axios.get
const tempDirs = []
const sensorTimers = []

// How often the simulated sensors repeat their values.
const SENSOR_PERIOD_MS = 60000

/** A complete, valid configuration as the admin UI would save it. */
function config (overrides = {}) {
  return {
    credentials: { stationId: 'f0TEST01', stationPassword: 'station-password', apiKey: 'api-key' },
    identity: {
      stationName: 'Test Vessel',
      station_type: 'Boat (Signal K)',
      operator_url: 'https://example.com',
      shareOption: 'public',
      agl_temp: 2,
      agl_wind: 10
    },
    logic: { interval: 5, minMove: 300, forceUpdate: false },
    pathMap: {},
    ...overrides
  }
}

/** The values of a vessel with every default path present, in Signal K base units. */
function fullTree () {
  return {
    navigation: { position: { value: { latitude: 37.5, longitude: 23.4 } } },
    environment: {
      wind: {
        speedOverGround: { value: 5.14 },
        gust: { value: 7.2 },
        directionTrue: { value: Math.PI }
      },
      outside: {
        temperature: { value: 293.15 },
        pressure: { value: 101325 },
        humidity: { value: 0.65 }
      }
    }
  }
}

/** Builds an error shaped like the one axios throws for an HTTP error answer. */
function httpError (status, data) {
  const err = new Error(`Request failed with status code ${status}`)
  err.response = { status, data }
  return err
}

/** Builds an error shaped like the one axios throws when no answer arrives. */
function networkError (code) {
  const err = new Error(`getaddrinfo ${code} stations.windy.com`)
  err.code = code
  return err
}

/** The node at a dotted path of a tree, or undefined. */
function nodeAt (tree, skPath) {
  return skPath.split('.').reduce((node, key) => (node == null ? undefined : node[key]), tree)
}

/** Every path of a tree that holds a value. */
function valuePaths (node, prefix = '') {
  if (node === null || typeof node !== 'object') return []
  if ('value' in node) return [prefix]
  return Object.keys(node).flatMap((key) => valuePaths(node[key], prefix ? `${prefix}.${key}` : key))
}

/**
 * Creates one plugin instance with a mock Signal K `app` and intercepted HTTP.
 *
 * The mock behaves like the server in the three ways the plugin depends on:
 * a subscription receives only the paths it asked for; at the moment of
 * subscribing it is handed the value the server holds for each of them, with
 * that value's own timestamp; and after that it receives a value only when
 * the path is updated.
 *
 * Options:
 *   tree  the values the server holds when the plugin starts
 *   held  further values the server holds, from other sources:
 *         [{ path, value, timestamp, source }], handed over after the tree's
 *         values
 *   live  true (the default) to have every value in the tree repeated once
 *         a minute, as a working sensor does; false for sensors that have
 *         stopped, which is what the tests of stale readings need
 *   put   replacement for the station update request
 *   get   replacement for the observation request
 */
function createEnv (options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signalk-windy-test-'))
  tempDirs.push(dataDir)

  const env = {
    dataDir,
    stateFile: path.join(dataDir, 'state.json'),
    tree: options.tree || fullTree(),
    requests: [],
    statuses: [],
    errors: [],
    debugLines: [],
    errorLines: [],
    // Subscriptions that are still live; a released one is removed.
    subscriptions: [],
    subscribeCalls: 0,
    // The plugin is not meant to read the data tree; this counts if it does.
    treeReads: 0,
    put: options.put || (async () => ({ status: 200, data: {} })),
    get: options.get || (async () => ({ status: 200, data: {} })),
    // The plugin's entry on the dashboard, kept as the server keeps it (see
    // setStatus below).
    board: { type: null, message: null, lastError: null }
  }

  // As doSetProviderStatus in the server's src/index.ts: an error that is
  // replaced by a different message, of either kind, becomes the "Last
  // Error". The same error set again changes nothing.
  const setStatus = (type, message) => {
    if (env.board.type === 'error' && env.board.message !== message) env.board.lastError = env.board.message
    env.board.type = type
    env.board.message = message
  }

  axios.put = async (url, body, requestConfig = {}) => {
    env.requests.push({ method: 'PUT', url, body, headers: requestConfig.headers || {}, timeout: requestConfig.timeout, config: requestConfig, at: Date.now() })
    return env.put(url, body, requestConfig)
  }
  axios.get = async (url, requestConfig = {}) => {
    const parsed = new URL(url)
    env.requests.push({
      method: 'GET',
      url,
      path: parsed.origin + parsed.pathname,
      params: Object.fromEntries(parsed.searchParams),
      headers: requestConfig.headers || {},
      timeout: requestConfig.timeout,
      config: requestConfig,
      at: Date.now()
    })
    return env.get(url, requestConfig)
  }

  env.app = {
    getDataDirPath: () => dataDir,
    getSelfPath: (skPath) => {
      env.treeReads++
      return nodeAt(env.tree, skPath)
    },
    setPluginStatus: (message) => { env.statuses.push(message); setStatus('status', message) },
    setPluginError: (message) => { env.errors.push(message); setStatus('error', message) },
    debug: (message) => env.debugLines.push(String(message)),
    error: (...parts) => env.errorLines.push(parts.join(' ')),
    subscriptionmanager: {
      // As on the server: the caller's array receives one function per
      // subscription, and calling it ends that subscription.
      subscribe: (command, unsubscribes, errorCallback, callback) => {
        const subscription = { command, callback, paths: command.subscribe.map((row) => row.path) }
        env.subscriptions.push(subscription)
        env.subscribeCalls++
        unsubscribes.push(() => {
          const index = env.subscriptions.indexOf(subscription)
          if (index !== -1) env.subscriptions.splice(index, 1)
        })
        // The values the server holds, handed over before subscribe() returns.
        for (const skPath of subscription.paths) {
          const node = nodeAt(env.tree, skPath)
          if (node && typeof node === 'object' && 'value' in node) {
            callback(delta(skPath, node.value, node.timestamp || new Date().toISOString()))
          }
        }
        for (const held of options.held || []) {
          if (subscription.paths.includes(held.path)) callback(delta(held.path, held.value, held.timestamp, held.source))
        }
      }
    }
  }

  env.plugin = createPlugin(env.app)

  /**
   * Updates one path, as a sensor does: the server keeps the value, and
   * every subscription that asked for the path receives it, from the given
   * source.
   */
  env.emit = (skPath, value, source = 'test') => {
    const timestamp = new Date().toISOString()
    const keys = skPath.split('.')
    let node = env.tree
    for (const key of keys.slice(0, -1)) node = node[key] = node[key] || {}
    node[keys[keys.length - 1]] = { value, timestamp }
    for (const subscription of [...env.subscriptions]) {
      if (subscription.paths.includes(skPath)) subscription.callback(delta(skPath, value, timestamp, source))
    }
  }

  /**
   * Declares a path timed out, as a server with "enforce data timeouts"
   * switched on does: null, marked as timed out, delivered to every
   * subscription that asked for the path.
   */
  env.timeOut = (skPath, source = 'test') => {
    const timestamp = new Date().toISOString()
    for (const subscription of [...env.subscriptions]) {
      if (subscription.paths.includes(skPath)) {
        subscription.callback({
          context: 'vessels.self',
          updates: [{ $source: source, timestamp, values: [{ path: skPath, value: null, state: { timedOut: true } }] }]
        })
      }
    }
  }

  /** Puts a value into the server's store with a given age, without delivering it. */
  env.hold = (skPath, value, ageMs) => {
    const keys = skPath.split('.')
    let node = env.tree
    for (const key of keys.slice(0, -1)) node = node[key] = node[key] || {}
    node[keys[keys.length - 1]] = { value, timestamp: new Date(Date.now() - ageMs).toISOString() }
  }

  if (options.live !== false) {
    sensorTimers.push(setInterval(() => {
      for (const skPath of valuePaths(env.tree)) env.emit(skPath, nodeAt(env.tree, skPath).value)
    }, SENSOR_PERIOD_MS))
  }

  env.puts = () => env.requests.filter((r) => r.method === 'PUT')
  env.gets = () => env.requests.filter((r) => r.method === 'GET')
  env.lastStatus = () => env.statuses[env.statuses.length - 1]
  /** What the dashboard shows now: { type, message, lastError }. */
  env.dashboard = () => ({ ...env.board })

  return env
}

/** One value as the server delivers it to a subscription. */
function delta (skPath, value, timestamp, source = 'test') {
  return { context: 'vessels.self', updates: [{ $source: source, timestamp, values: [{ path: skPath, value }] }] }
}

/**
 * A request that stays unanswered until the test answers it. Used to stop the
 * plugin while a request is on its way to Windy.
 */
function deferred () {
  const handle = {}
  handle.promise = new Promise((resolve, reject) => {
    handle.resolve = () => resolve({ status: 200, data: {} })
    handle.reject = reject
  })
  return handle
}

/** Lets every pending promise callback run. */
async function settle () {
  for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve))
}

/**
 * Moves the clock forward and lets the plugin react.
 *
 * The clock moves one second at a time. A single large step would run every
 * timer that falls inside it with the clock already at the end of the step,
 * so a countdown would read zero where the running plugin shows the true
 * remaining time. After each second the pending promise callbacks run, which
 * is what lets a finished request schedule the next cycle at the right moment.
 */
async function advance (ms) {
  let remaining = ms
  while (remaining > 0) {
    const step = Math.min(remaining, 1000)
    mock.timers.tick(step)
    remaining -= step
    await new Promise((resolve) => setImmediate(resolve))
  }
  await settle()
}

/** Call from beforeEach: fixed clock, mocked timers. */
function setUp () {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: START_TIME })
}

/** Call from afterEach: real timers, real axios, temporary directories removed. */
function tearDown () {
  while (sensorTimers.length) clearInterval(sensorTimers.pop())
  mock.timers.reset()
  axios.put = originalPut
  axios.get = originalGet
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true })
  }
}

module.exports = {
  START_TIME,
  WARM_UP_MS,
  FIVE_MINUTES_MS,
  config,
  fullTree,
  httpError,
  networkError,
  createEnv,
  deferred,
  advance,
  settle,
  setUp,
  tearDown
}
