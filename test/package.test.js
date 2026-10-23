'use strict'

/*
 * The published package: what the Signal K App Store reads from package.json,
 * and what the publish workflow reads from CHANGELOG.md. A mistake in either
 * is invisible until after a release, so both are checked here.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const source = fs.readFileSync(path.join(root, 'index.js'), 'utf8')

/** True when a package-relative path is covered by the `files` list. */
function isPublished (relative) {
  const clean = relative.replace(/^\.\//, '')
  return pkg.files.some((entry) => {
    if (entry === clean) return true
    if (entry.endsWith('/')) return clean.startsWith(entry)
    if (entry.includes('*')) {
      const pattern = new RegExp('^' + entry.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$')
      return pattern.test(clean)
    }
    return false
  })
}

describe('package.json', () => {
  it('is found by the Signal K App Store', () => {
    assert.ok(pkg.keywords.includes('signalk-node-server-plugin'))
    assert.ok(pkg.keywords.includes('signalk-category-weather'))
    assert.equal(pkg.signalk.pluginId, pkg.name)
    assert.equal(typeof pkg.signalk.displayName, 'string')
  })

  it('declares the minimum Node.js version', () => {
    assert.equal(typeof pkg.engines.node, 'string')
  })

  it('has an author name, which the store shows in place of the publishing account', () => {
    assert.equal(typeof pkg.author.name, 'string')
  })

  it('has no install-time scripts, which the store would not run', () => {
    for (const name of ['preinstall', 'install', 'postinstall']) {
      assert.ok(!(pkg.scripts && pkg.scripts[name]), `${name} script present`)
    }
  })

  it('points the app icon at a file that exists and is published', () => {
    const icon = pkg.signalk.appIcon
    assert.equal(typeof icon, 'string')
    assert.ok(fs.existsSync(path.join(root, icon)), `${icon} does not exist`)
    assert.ok(isPublished(icon), `${icon} is not in the files list`)
    // The older key is not read by the server.
    assert.equal(pkg.signalk.icon, undefined)
  })

  it('lists screenshots that exist, are published and are PNG or JPEG', () => {
    const shots = pkg.signalk.screenshots
    assert.ok(Array.isArray(shots) && shots.length >= 1)
    assert.ok(shots.length <= 6, 'the store shows the first six only')
    for (const shot of shots) {
      assert.match(shot, /\.(png|jpe?g)$/i)
      assert.ok(fs.existsSync(path.join(root, shot)), `${shot} does not exist`)
      assert.ok(isPublished(shot), `${shot} is not in the files list`)
    }
  })

  it('publishes the entry point and the documents', () => {
    assert.ok(fs.existsSync(path.join(root, pkg.main)))
    for (const file of [pkg.main, 'README.md', 'CHANGELOG.md', 'LICENSE']) {
      assert.ok(isPublished(file), `${file} is not in the files list`)
    }
  })

  it('publishes every file of lib/, which index.js cannot load without', () => {
    const modules = fs.readdirSync(path.join(root, 'lib')).filter((name) => name.endsWith('.js'))
    assert.ok(modules.length > 0)
    for (const name of modules) {
      assert.ok(isPublished(`lib/${name}`), `lib/${name} is not in the files list`)
    }
    // Every module index.js asks for exists.
    for (const [, required] of source.matchAll(/require\('(\.\/lib\/[^']+)'\)/g)) {
      assert.ok(fs.existsSync(path.join(root, `${required}.js`)), `${required}.js does not exist`)
    }
  })

  it('keeps the integration check out of the published package and out of npm test', () => {
    assert.equal(pkg.scripts['test:integration'], 'node integration/server-check.js')
    assert.ok(fs.existsSync(path.join(root, 'integration', 'server-check.js')))
    assert.ok(!isPublished('integration/server-check.js'))
  })

  it('carries the same version as the header of index.js', () => {
    const header = source.match(/^ \* v(\d+\.\d+\.\d+) - /m)
    assert.ok(header, 'index.js has no version line in its header')
    assert.equal(header[1], pkg.version)
  })
})

describe('published documents', () => {
  it('hold no placeholder left from editing', () => {
    for (const file of ['README.md', 'CHANGELOG.md', 'MIGRATION.md', 'CONTRIBUTING.md']) {
      const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
      assert.doesNotMatch(text, /@@|TODO|TBD|<unknown/, file)
    }
  })
})

describe('CHANGELOG.md', () => {
  const headings = changelog.split('\n').filter((line) => line.startsWith('## '))

  it('starts every release section with "## [x.y.z] - YYYY-MM-DD"', () => {
    assert.ok(headings.length > 0)
    for (const heading of headings) {
      assert.match(heading, /^## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}/, `unexpected heading: ${heading}`)
    }
  })

  it('has no Unreleased section, which would publish an empty release', () => {
    assert.ok(!/^## \[Unreleased\]/im.test(changelog))
  })

  it('has the package version as its newest entry', () => {
    assert.ok(headings[0].startsWith(`## [${pkg.version}] - `), `newest entry is "${headings[0]}", package.json is ${pkg.version}`)
  })

  it('has text under the newest entry, which becomes the GitHub Release', () => {
    // The same extraction the publish workflow performs.
    const lines = changelog.split('\n')
    const start = lines.findIndex((line) => line.startsWith(`## [${pkg.version}]`))
    let end = lines.findIndex((line, index) => index > start && line.startsWith('## ['))
    if (end === -1) end = lines.length
    const body = lines.slice(start + 1, end).filter((line) => !/^\[.*\]: https:\/\//.test(line)).join('\n').trim()
    assert.ok(body.length > 0)
  })

  it('has a comparison link for every version after the first', () => {
    // The oldest entry has no earlier version to compare with.
    for (const heading of headings.slice(0, -1)) {
      const version = heading.match(/^## \[(\d+\.\d+\.\d+)\]/)[1]
      assert.ok(changelog.includes(`\n[${version}]: https://github.com/Peter-Petrik/signalk-windy-apiv2/`), `no comparison link for ${version}`)
    }
  })
})
