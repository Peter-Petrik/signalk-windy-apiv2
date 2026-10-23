'use strict'

/*
 * The configuration form: the schema the Signal K admin UI renders, and the
 * identity the server uses to find the plugin.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createEnv, tearDown } = require('../test-support/harness')

const { plugin } = createEnv()
tearDown()

describe('plugin identity', () => {
  it('has the id, name and lifecycle functions the server requires', () => {
    assert.equal(plugin.id, 'signalk-windy-apiv2')
    assert.equal(plugin.name, 'Windy API v2 Reporter')
    assert.equal(typeof plugin.description, 'string')
    assert.equal(typeof plugin.start, 'function')
    assert.equal(typeof plugin.stop, 'function')
  })
})

describe('configuration schema', () => {
  const schema = plugin.schema
  const sections = schema.properties

  it('has the four sections in the order shown in the form', () => {
    assert.equal(schema.type, 'object')
    assert.deepEqual(Object.keys(sections), ['credentials', 'identity', 'logic', 'pathMap'])
  })

  it('requires the three credentials', () => {
    assert.deepEqual(schema.required, ['credentials'])
    assert.deepEqual(sections.credentials.required, ['stationId', 'stationPassword', 'apiKey'])
  })

  it('says where the API key is created, as Windy\'s API reference does', () => {
    const description = sections.credentials.properties.apiKey.description
    assert.match(description, /API Keys page/)
    assert.match(description, /stations\.windy\.com/)
    assert.doesNotMatch(description, /account settings/)
  })

  it('does not allow a reporting interval below Windy\'s five-minute limit', () => {
    assert.equal(sections.logic.properties.interval.minimum, 5)
    assert.equal(sections.logic.properties.interval.default, 5)
  })

  it('does not allow a reporting interval longer than one day', () => {
    assert.equal(sections.logic.properties.interval.maximum, 1440)
  })

  it('asks for the reporting interval as a whole number of minutes', () => {
    assert.equal(sections.logic.properties.interval.type, 'integer')
  })

  it('defaults to a 300 m movement threshold with Force GPS Updates off', () => {
    assert.equal(sections.logic.properties.minMove.default, 300)
    assert.equal(sections.logic.properties.forceUpdate.default, false)
  })

  it('offers exactly the two share options Windy accepts and defaults to public', () => {
    const share = sections.identity.properties.shareOption
    // Windy answers 400 to any other value, `private` included.
    assert.deepEqual(share.enum, ['public', 'only_windy'])
    assert.deepEqual(share.enumNames, ['Public', 'Windy only'])
    assert.equal(share.default, 'public')
  })

  it('accepts zero for the sensor heights and for the movement threshold', () => {
    assert.equal(sections.identity.properties.agl_wind.minimum, 0)
    assert.equal(sections.identity.properties.agl_temp.minimum, 0)
    assert.equal(sections.logic.properties.minMove.minimum, 0)
  })

  it('checks the age of readings by default, with 0 to switch the check off', () => {
    const maxAge = sections.logic.properties.maxAge
    assert.equal(maxAge.type, 'number')
    assert.equal(maxAge.default, 15)
    assert.equal(maxAge.minimum, 0)
  })

  it('leaves the station elevation empty by default, so that existing stations keep their GNSS altitude', () => {
    const elevation = sections.identity.properties.elevation
    assert.equal(elevation.type, 'integer')
    assert.ok(!('default' in elevation))
    assert.ok(!('minimum' in elevation), 'a station below sea level is valid')
  })

  it('takes sensor heights as whole numbers, as Windy requires', () => {
    assert.equal(sections.identity.properties.agl_wind.type, 'integer')
    assert.equal(sections.identity.properties.agl_temp.type, 'integer')
  })

  it('says that the wind is taken over the reporting interval, and names its limits', () => {
    const description = sections.logic.properties.interval.description
    assert.match(description, /from 5 to 1440/)
    assert.match(description, /wind speed and direction sent are averaged over this interval, and the gust is its highest wind speed/)
  })

  it('offers three position precisions, with the exact position as the default', () => {
    const precision = sections.identity.properties.positionPrecision
    assert.equal(precision.type, 'string')
    assert.deepEqual(precision.enum, ['exact', '100m', '1km'])
    assert.deepEqual(precision.enumNames, ['Exact', 'About 100 m', 'About 1 km'])
    assert.equal(precision.default, 'exact')
    assert.match(precision.description, /Windy shows the position of a public station to anyone/)
  })

  it('asks for the dew point path under the sensor path overrides', () => {
    assert.equal(sections.pathMap.properties.dewPoint.title, 'Dew Point')
  })

  it('has a default Signal K path for each of the seven sensors', () => {
    const defaults = Object.fromEntries(Object.entries(sections.pathMap.properties).map(([key, def]) => [key, def.default]))
    assert.deepEqual(defaults, {
      windSpeed: 'environment.wind.speedOverGround',
      windGust: 'environment.wind.gust',
      windDir: 'environment.wind.directionTrue',
      temp: 'environment.outside.temperature',
      pressure: 'environment.outside.pressure',
      humidity: 'environment.outside.humidity',
      dewPoint: 'environment.outside.dewPointTemperature'
    })
  })

  it('gives every field a title', () => {
    for (const [sectionName, section] of Object.entries(sections)) {
      assert.equal(typeof section.title, 'string', `${sectionName} has no title`)
      for (const [fieldName, field] of Object.entries(section.properties)) {
        assert.equal(typeof field.title, 'string', `${sectionName}.${fieldName} has no title`)
      }
    }
  })

  it('survives a round trip through JSON and shares no object between two places', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(schema)), schema)
    // The Signal K plugin CI reports an object that appears twice in a schema
    // as a circular reference.
    const seen = new Set()
    const walk = (node, where) => {
      if (node === null || typeof node !== 'object') return
      assert.ok(!seen.has(node), `the object at ${where} is used in more than one place`)
      seen.add(node)
      for (const [key, value] of Object.entries(node)) walk(value, `${where}.${key}`)
    }
    walk(schema, 'schema')
    walk(plugin.uiSchema, 'uiSchema')
  })
})

describe('form presentation', () => {
  it('masks the two secrets', () => {
    assert.equal(plugin.uiSchema.credentials.stationPassword['ui:widget'], 'password')
    assert.equal(plugin.uiSchema.credentials.apiKey['ui:widget'], 'password')
  })

  it('refers only to fields that exist in the schema', () => {
    for (const [sectionName, section] of Object.entries(plugin.uiSchema)) {
      assert.ok(plugin.schema.properties[sectionName], `uiSchema section ${sectionName} is not in the schema`)
      for (const fieldName of Object.keys(section)) {
        if (fieldName.startsWith('ui:')) continue
        assert.ok(plugin.schema.properties[sectionName].properties[fieldName], `uiSchema field ${sectionName}.${fieldName} is not in the schema`)
      }
    }
  })
})
