'use strict'

/*
 * Check against a running Signal K server.
 *
 * Run by `npm run test:integration` with SIGNALK_URL pointing at a server
 * that has this plugin installed and enabled with an empty configuration.
 * The Signal K plugin CI workflow provides exactly that, with sample NMEA
 * data playing, for every server version it tests.
 *
 * The check confirms that the server has loaded the plugin, that the plugin
 * describes its settings, and that without credentials it reports itself as
 * not configured. It deliberately saves no configuration: with credentials
 * the plugin would send requests to Windy, and a CI run must never do that.
 *
 * This file lives outside test/ on purpose: the Node.js test runner picks up
 * every file under a test directory, and this one needs a server.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require('node:assert/strict')

const BASE = (process.env.SIGNALK_URL || 'http://localhost:3000').replace(/\/$/, '')
const PLUGIN = 'signalk-windy-apiv2'
const WAIT_MS = 45000

async function plugins () {
  const response = await fetch(`${BASE}/skServer/plugins`)
  assert.equal(response.status, 200, `GET /skServer/plugins answered ${response.status}`)
  return response.json()
}

/**
 * The plugin's status as the dashboard shows it, read from the stream of
 * server events the admin UI itself listens to. The plugin list at
 * /skServer/plugins also carries a status, but servers before 2.33.0 look it
 * up under the wrong key there and always answer with an empty one.
 */
function statusFromServerEvents () {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${BASE.replace(/^http/, 'ws')}/signalk/v1/stream?serverevents=all&subscribe=none`)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('the server sent no plugin status within the waiting time'))
    }, WAIT_MS)
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('the stream refused the connection'))
    })
    socket.addEventListener('message', (event) => {
      let parsed
      try { parsed = JSON.parse(event.data) } catch (err) { return }
      if (parsed.type !== 'PROVIDERSTATUS' || !Array.isArray(parsed.data)) return
      const own = parsed.data.find((status) => status.id === PLUGIN)
      // The status is set as the plugin starts. An event that arrives before
      // that carries none, and the next one is waited for.
      if (!own || !own.message) return
      clearTimeout(timer)
      socket.close()
      resolve(String(own.message))
    })
  })
}

async function statusMessage () {
  const listed = (await plugins()).find((p) => p.id === PLUGIN)
  if (listed && listed.statusMessage) return String(listed.statusMessage)
  return statusFromServerEvents()
}

async function main () {
  console.log(`Checking ${PLUGIN} on ${BASE}`)

  const plugin = (await plugins()).find((p) => p.id === PLUGIN)
  assert.ok(plugin, 'the plugin is not loaded')
  console.log(`  loaded, version ${plugin.version}`)

  assert.deepEqual(Object.keys(plugin.schema.properties), ['credentials', 'identity', 'logic', 'pathMap'])
  console.log('  settings form described in four sections')

  const message = await statusMessage()
  assert.equal(message, 'Not configured: enter Station ID, Station Password, Global API Key in the plugin configuration')
  console.log(`  plugin status: ${message}`)

  console.log('All checks passed')
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`)
  process.exit(1)
})
