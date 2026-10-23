/*
 * Settings: the configuration form and the reading of a saved configuration.
 *
 * The form is described twice on purpose. `schema` and `uiSchema` tell the
 * Signal K admin UI what to draw. `resolveOptions()` turns whatever was saved
 * into the values the plugin works with, and applies the same defaults again
 * in code: a configuration written by hand, by an older version, or by a
 * test harness can lack any field, and the form's defaults exist only in the
 * browser.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

'use strict'

// The two values Windy accepts for a station's share option. Windy's
// specification lists exactly these, and the live API answered 400 to
// `private` when tested on 2026-10-10.
const SHARE_OPTIONS = ['public', 'only_windy']

const DEFAULTS = {
  stationName: 'Signal K Vessel',
  station_type: 'Boat (Signal K)',
  agl_temp: 2,
  agl_wind: 10,
  interval: 5,
  minMove: 300,
  maxAge: 15,
  pathMap: {
    windSpeed: 'environment.wind.speedOverGround',
    windGust: 'environment.wind.gust',
    windDir: 'environment.wind.directionTrue',
    temp: 'environment.outside.temperature',
    pressure: 'environment.outside.pressure',
    humidity: 'environment.outside.humidity'
  }
}

// Windy accepts one observation per station every 5 minutes.
const MIN_INTERVAL_MINUTES = 5

// One day. A longer wait is beyond what a timer can hold: Node.js runs a
// timer of more than about 24.8 days after 1 millisecond instead.
const MAX_INTERVAL_MINUTES = 1440

const schema = {
  type: 'object',
  required: ['credentials'],
  properties: {
    credentials: {
      title: 'Windy API Credentials',
      type: 'object',
      description: 'Authentication requirements for the Windy.com Stations dashboard.',
      required: ['stationId', 'stationPassword', 'apiKey'],
      properties: {
        stationId: {
          type: 'string',
          title: 'Station ID',
          description: 'The unique identifier assigned during station registration (e.g., f0123456).'
        },
        stationPassword: {
          type: 'string',
          title: 'Station Password',
          description: 'The secret password assigned to the station.'
        },
        apiKey: {
          type: 'string',
          title: 'Global API Key',
          description: 'The API key created on the API Keys page at stations.windy.com. The plugin uses it to update the position of the station.'
        }
      }
    },
    identity: {
      title: 'Vessel Identity & Sensors',
      type: 'object',
      properties: {
        stationName: {
          type: 'string',
          title: 'Display Name',
          default: DEFAULTS.stationName,
          description: 'The name visible on the Windy map.'
        },
        station_type: {
          type: 'string',
          title: 'Station Type',
          default: DEFAULTS.station_type,
          description: 'Free text shown as "Station type" on the Windy station page.'
        },
        operator_url: {
          type: 'string',
          title: 'Operator Website URL',
          description: 'A public link shown on the Windy station page, including https://. May be left empty.'
        },
        shareOption: {
          type: 'string',
          title: 'Share Option',
          default: 'public',
          enum: [...SHARE_OPTIONS],
          enumNames: ['Public', 'Windy only']
        },
        agl_temp: {
          type: 'integer', // Windy rejects a sensor height that is not a whole number
          title: 'Temperature Sensor Height (m)',
          default: DEFAULTS.agl_temp,
          minimum: 0,
          description: 'Height of the thermometer above the water line, as a whole number. This is not the station elevation.'
        },
        agl_wind: {
          type: 'integer', // Windy rejects a sensor height that is not a whole number
          title: 'Wind Sensor Height (m)',
          default: DEFAULTS.agl_wind,
          minimum: 0,
          description: 'Height of the anemometer above the water line, as a whole number. This is not the station elevation.'
        },
        elevation: {
          type: 'integer', // Windy rejects an elevation that is not a whole number
          title: 'Station Elevation (m)',
          description: 'Elevation above sea level, shown by Windy as AMSL. Left empty, the GNSS antenna altitude from Signal K is sent, or 0 when there is none.'
        }
      }
    },
    logic: {
      title: 'Transmission & Movement Guard',
      type: 'object',
      properties: {
        interval: {
          // A whole number in the form. resolveOptions() still honours a
          // fraction, so that an interval saved by an earlier version keeps
          // its schedule until the configuration is next saved.
          type: 'integer',
          title: 'Reporting Interval (Minutes)',
          default: DEFAULTS.interval,
          minimum: MIN_INTERVAL_MINUTES,
          maximum: MAX_INTERVAL_MINUTES,
          description: 'A whole number of minutes, 5 or more. Windy enforces a rate limit of one observation per 5 minutes per station.'
        },
        minMove: {
          type: 'number',
          title: 'Min Movement Threshold (Meters)',
          default: DEFAULTS.minMove,
          minimum: 0,
          description: 'How far the vessel has to move from the position last sent before the position on the Windy map is updated. Below this distance the map position stays where it is. With 0 the position is updated at every report.'
        },
        maxAge: {
          type: 'number',
          title: 'Maximum Reading Age (Minutes)',
          default: DEFAULTS.maxAge,
          minimum: 0,
          description: 'A sensor reading that has not been updated for this long is left out of the report, so that a sensor that has stopped is not reported as current. The dashboard shows such a reading with a dash. With 0 the age is not checked.'
        },
        forceUpdate: {
          type: 'boolean',
          title: 'Force GPS Updates',
          default: false
        }
      }
    },
    pathMap: {
      title: 'Sensor Path Overrides (Advanced)',
      type: 'object',
      properties: {
        windSpeed: { type: 'string', title: 'Wind Speed', default: DEFAULTS.pathMap.windSpeed },
        windGust: { type: 'string', title: 'Wind Gust', default: DEFAULTS.pathMap.windGust },
        windDir: { type: 'string', title: 'Wind Direction', default: DEFAULTS.pathMap.windDir },
        temp: { type: 'string', title: 'Outside Temp', default: DEFAULTS.pathMap.temp },
        pressure: { type: 'string', title: 'Barometric Pressure', default: DEFAULTS.pathMap.pressure },
        humidity: { type: 'string', title: 'Relative Humidity', default: DEFAULTS.pathMap.humidity }
      }
    }
  }
}

const uiSchema = {
  credentials: {
    stationPassword: { 'ui:widget': 'password' },
    apiKey: { 'ui:widget': 'password' }
  },
  identity: {
    shareOption: {
      'ui:help': 'Public: aggregate data under the Aggregator Open Data License; Windy only: observations used only by Windy.com'
    }
  },
  logic: {
    forceUpdate: {
      'ui:help': 'Bypasses the Movement Guard to send GPS coordinates at every interval. While it is on, the dashboard shows "Forced" in place of the distance.'
    }
  },
  pathMap: { 'ui:options': { collapsible: true, collapsed: true } }
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/** A saved string with surrounding white space removed, or '' for anything else. */
const text = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * Turns a saved configuration into the options the plugin runs with.
 *
 * Nothing here throws: every field is read defensively and falls back to the
 * default the form shows. Two results are not settings but findings about the
 * configuration:
 *
 *   missingCredentials  the labels of the credentials that are absent. With
 *                       any of them missing the plugin sends nothing.
 *   shareProblem        null, or the reason no station update can be sent.
 */
function resolveOptions (settings) {
  const saved = settings && typeof settings === 'object' ? settings : {}
  const credentials = saved.credentials || {}
  const identity = saved.identity || {}
  const logic = saved.logic || {}
  const savedPaths = saved.pathMap || {}

  // Credentials are trimmed: a space or line break picked up while copying a
  // key from the Windy site would otherwise be sent as part of it.
  const stationId = text(credentials.stationId)
  const stationPassword = text(credentials.stationPassword)
  const apiKey = text(credentials.apiKey)

  const missingCredentials = []
  if (!stationId) missingCredentials.push('Station ID')
  if (!stationPassword) missingCredentials.push('Station Password')
  if (!apiKey) missingCredentials.push('Global API Key')

  // The share option decides who may use the station's data, so no value is
  // ever chosen on the owner's behalf. A value Windy does not accept, or no
  // value at all, stops station updates until the owner picks one. That is
  // the same outcome as before 1.5.2, when Windy rejected such an update with
  // a 400; the difference is that the dashboard now says why.
  const shareOption = text(identity.shareOption).toLowerCase()
  let shareProblem = null
  if (shareOption === 'private') {
    shareProblem = 'Share Option "Private" is not accepted by Windy. Choose Public or Windy only in the plugin configuration.'
  } else if (!SHARE_OPTIONS.includes(shareOption)) {
    shareProblem = 'Share Option is not set. Choose Public or Windy only in the plugin configuration.'
  }

  // A sensor height of 0 is a valid height and Windy accepts it. Only a
  // missing or non-numeric value falls back to the default.
  const height = (value, fallback) => (isNumber(value) ? Math.max(0, Math.round(value)) : fallback)

  const pathMap = {}
  for (const key of Object.keys(DEFAULTS.pathMap)) {
    pathMap[key] = text(savedPaths[key]) || DEFAULTS.pathMap[key]
  }

  return {
    stationId,
    stationPassword,
    apiKey,
    missingCredentials,
    stationName: text(identity.stationName) || DEFAULTS.stationName,
    station_type: text(identity.station_type) || DEFAULTS.station_type,
    operator_url: text(identity.operator_url),
    shareOption,
    shareProblem,
    agl_temp: height(identity.agl_temp, DEFAULTS.agl_temp),
    agl_wind: height(identity.agl_wind, DEFAULTS.agl_wind),
    // null means "not set": the GNSS antenna altitude is sent. A negative
    // elevation is valid and Windy accepts it.
    elevation: isNumber(identity.elevation) ? Math.round(identity.elevation) : null,
    // Windy answers 429 to anything faster than one observation per 5 minutes.
    interval: isNumber(logic.interval) ? Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, logic.interval)) : DEFAULTS.interval,
    // 0 is honoured and means "update the position at every report".
    minMove: isNumber(logic.minMove) ? Math.max(0, logic.minMove) : DEFAULTS.minMove,
    // Minutes. A configuration saved before 1.6.0 has no value and gets the
    // default, so the age check is on after an update. 0 switches it off.
    maxAge: isNumber(logic.maxAge) ? Math.max(0, logic.maxAge) : DEFAULTS.maxAge,
    forceUpdate: logic.forceUpdate === true,
    pathMap
  }
}

module.exports = { schema, uiSchema, resolveOptions, DEFAULTS, SHARE_OPTIONS, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES }
