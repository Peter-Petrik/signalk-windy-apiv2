/**
 * Signal K Windy API v2 Reporter
 * v1.0.1 - State Persistence Update
 * * Reports environmental data to Windy.com using the v2 API.
 * Includes a Movement Guard to optimize map updates and 
 * State Persistence to resume countdowns after server restarts.
 */

const axios = require('axios');

module.exports = function (app) {
  let timer = null;
  let lastSentPos = { lat: 0, lon: 0 };
  let currentDistance = 0;
  let nextRunTime = 0; // Persistent timestamp for the next API call

  const plugin = {
    id: 'signalk-windy-apiv2',
    name: 'Windy API v2 Reporter',
    description: 'Persistent reporting of weather data to Windy.com API v2'
  };

  plugin.start = function (settings) {
    // Consolidate settings from configuration groups
    const options = { 
      ...settings.credentials, 
      ...settings.identity, 
      ...settings.logic, 
      pathMap: settings.pathMap 
    };

    // 1. LOAD PERSISTED STATE
    // Check for existing state (last position, distance, and next run timer)
    // to maintain continuity across server restarts.
    const savedOptions = app.readPluginOptions();
    if (savedOptions && savedOptions.state) {
      lastSentPos = savedOptions.state.lastSentPos || { lat: 0, lon: 0 };
      currentDistance = savedOptions.state.currentDistance || 0;
      nextRunTime = savedOptions.state.nextRunTime || 0;
    }

    const now = Date.now();
    
    // 2. RESUME LOGIC
    // If nextRunTime is in the past (or 0), trigger reporting immediately.
    // If in the future, set a timer for the remaining duration.
    const remainingTime = nextRunTime - now;

    if (remainingTime <= 0) {
      app.debug('Interval expired or new start. Reporting now.');
      reportToWindy(options, !!options.forceUpdate);
      scheduleNext(options);
    } else {
      const minutesRemaining = Math.round(remainingTime / 60000);
      updateDisplay(`Resuming countdown: ${minutesRemaining}m remaining`);
      
      timer = setTimeout(() => {
        reportToWindy(options);
        scheduleNext(options);
      }, remainingTime);
    }

    // Subscribe to position updates for the Movement Guard tracking
    app.subscriptionmanager.subscribe({
      context: 'vessels.self',
      subscribe: [{ path: 'navigation.position', period: 1000 }]
    }, [], (err) => app.error(err), (delta) => {
      delta.updates.forEach(update => {
        update.values.forEach(val => {
          if (val.path === 'navigation.position' && val.value) {
            handlePositionUpdate(val.value);
          }
        });
      });
    });
  };

  // 3. PERSISTENT STOP
  // Captures current progress and next scheduled run before shutdown.
  plugin.stop = function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    // Capture state and merge with existing plugin configuration
    const currentOptions = app.readPluginOptions();
    app.savePluginOptions({
      ...currentOptions,
      state: {
        lastSentPos,
        currentDistance,
        nextRunTime
      }
    }, (err) => {
      if (err) app.error('Failed to save persistence state:', err);
    });

    updateDisplay('Stopped & State Persisted');
  };

  /**
   * Recursive timer to handle the reporting interval.
   * Calculates the exact timestamp for the next run for persistence.
   */
  function scheduleNext(options) {
    const intervalMs = (options.interval || 5) * 60000;
    nextRunTime = Date.now() + intervalMs;

    timer = setTimeout(() => {
      reportToWindy(options);
      scheduleNext(options);
    }, intervalMs);
  }

  /**
   * Tracks distance traveled since the last successful map update.
   */
  function handlePositionUpdate(pos) {
    if (lastSentPos.lat === 0 && lastSentPos.lon === 0) {
      lastSentPos = pos;
      return;
    }
    const dist = calculateDistance(lastSentPos.lat, lastSentPos.lon, pos.lat, pos.lon);
    currentDistance += dist;
    // lastSentPos is updated only on successful Windy API sync (reportToWindy)
  }

  /**
   * Main transmission logic.
   * Windy API v2 requires a GET for data and a PUT for metadata/location.
   */
  async function reportToWindy(options, forceMove = false) {
    const position = app.getSelfPath('navigation.position');
    if (!position || !position.value) {
      updateDisplay('Skipped: Waiting for GPS fix...');
      return;
    }

    const { lat, lon } = position.value;
    const dataPoints = getStationData(options);
    const sensorFlags = Object.keys(dataPoints).map(k => k[0].toUpperCase()).join('|');

    try {
      // Station Data (GET) - Pass through native Signal K m/s values
      await axios.get('https://stations.windy.com/pws/update/' + options.stationPassword, {
        params: { ...dataPoints, station: 0, lat, lon }
      });

      // Location Sync (PUT) - Only updates map pin if Minimum Movement threshold is met
      let moveStatus = 'Static';
      if (currentDistance >= (options.minMove || 300) || forceMove) {
        await axios.put('https://stations.windy.com/pws/station/v2/' + options.apiKey, {
          stationId: options.stationId,
          lat, lon,
          name: options.stationName,
          shareOption: options.shareOption,
          type: options.stationType
        }, { params: { station: 0 } });

        lastSentPos = { lat, lon };
        currentDistance = 0;
        moveStatus = 'Moved';
      }

      const time = new Date().toLocaleTimeString([], { hour12: false });
      updateDisplay(`[${sensorFlags}] at ${time} (${moveStatus}) | Delta: ${Math.round(currentDistance)}m`);
      
    } catch (err) {
      app.error('Windy API Error:', err.message);
      updateDisplay('Error: Check Logs');
    }
  }

  /**
   * Formats Signal K values for Windy.
   * Wind speeds (wind/gust) are passed in native m/s (no conversion).
   * Temperature is converted from Kelvin to Celsius.
   */
  function getStationData(options) {
    const pm = options.pathMap || {};
    const data = {};
    
    const wind = app.getSelfPath(pm.windSpeed || 'environment.wind.speedOverGround');
    if (wind) data.wind = wind.value.toFixed(1);

    const gust = app.getSelfPath(pm.windGust || 'environment.wind.gust');
    if (gust) data.gust = gust.value.toFixed(1);

    const dir = app.getSelfPath(pm.windDir || 'environment.wind.directionTrue');
    if (dir) data.winddir = Math.round((dir.value * 180) / Math.PI);

    const temp = app.getSelfPath(pm.temp || 'environment.outside.temperature');
    if (temp) data.temp = (temp.value - 273.15).toFixed(1);

    const pres = app.getSelfPath(pm.pressure || 'environment.outside.pressure');
    if (pres) data.baro = Math.round(pres.value);

    const hum = app.getSelfPath(pm.humidity || 'environment.outside.relativeHumidity');
    if (hum) data.rh = Math.round(hum.value * 100);

    return data;
  }

  function updateDisplay(msg) {
    app.setPluginStatus(msg);
  }

  /**
   * MOVEMENT GUARD LOGIC
   * Calculates planar distance in meters using Earth's radius (6,371,000m).
   */
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  plugin.schema = {
    type: 'object',
    properties: {
      credentials: {
        title: 'Windy API Credentials',
        type: 'object',
        required: ['stationId', 'stationPassword', 'apiKey'],
        properties: {
          stationId: { type: 'string', title: 'Station ID' },
          stationPassword: { type: 'string', title: 'Station Password' },
          apiKey: { type: 'string', title: 'Global API Key' }
        }
      },
      identity: {
        title: 'Vessel Identity & Privacy',
        type: 'object',
        properties: {
          stationName: { type: 'string', title: 'Station Name', default: 'Signal K Vessel' },
          stationType: { type: 'string', title: 'Station Type', default: 'Boat (Signal K)' },
          shareOption: {
            type: 'string',
            title: 'Share Option',
            default: 'public',
            enum: ['public', 'private'],
            enumNames: [
              'Public (Open Data - Visible on Map)', 
              'Private (Only Windy - Visualized Only)'
            ]
          }
        }
      },
      logic: {
        title: 'Transmission & GPS Logic',
        type: 'object',
        properties: {
          interval: { type: 'number', title: 'Reporting Interval (Minutes)', default: 5 },
          minMove: { type: 'number', title: 'Minimum Movement (Meters)', default: 300 },
          forceUpdate: { type: 'boolean', title: 'Force Immediate Update', default: false }
        }
      },
      pathMap: {
        title: 'Sensor Path Overrides (Advanced)',
        type: 'object',
        properties: {
          windSpeed: { type: 'string', title: 'Wind Speed Path' },
          windGust: { type: 'string', title: 'Wind Gust Path' },
          windDir: { type: 'string', title: 'Wind Direction Path' },
          temp: { type: 'string', title: 'Temperature Path' },
          pressure: { type: 'string', title: 'Pressure Path' },
          humidity: { type: 'string', title: 'Humidity Path' }
        }
      }
    }
  };

  plugin.uiSchema = {
    credentials: { stationPassword: { "ui:widget": "password" }, apiKey: { "ui:widget": "password" } },
    pathMap: { "ui:options": { collapsible: true, collapsed: true } }
  };

  return plugin;
};