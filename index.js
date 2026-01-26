/**
 * Signal K Windy API v2 Reporter
 * v1.0.6 - Peak Gust Tracking (Gap Closer)
 * Reports data to Windy using separate observation (GET) and metadata (PUT) endpoints.
 * Includes Movement Guard and Independent State Persistence.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports = function (app) {
  let timer = null;
  let lastSentPos = { lat: 0, lon: 0 };
  let currentDistance = 0;
  let nextRunTime = 0;
  let kx = 1; // Latitude scaling factor for Equirectangular projection (Cheap Ruler)

  // Peak Gust Tracking Variables
  let peakGust = 0;

  const plugin = {};
  plugin.id = 'signalk-windy-apiv2';
  plugin.name = 'Windy API v2 Reporter';
  plugin.description = 'Reports weather and position data to Windy.com API v2';

  // Helper to safely get the state file path only when the app object is ready
  const getStateFilePath = () => {
    const dataDir = app.getDataDirPath();
    return path.join(dataDir, 'state.json');
  };

  plugin.schema = {
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
            description: 'The global API key found in Windy account settings.' 
          }
        }
      },
      identity: {
        title: 'Vessel Identity & Privacy',
        type: 'object',
        properties: {
          stationName: { 
            type: 'string', 
            title: 'Display Name', 
            default: 'Signal K Vessel',
            description: 'The name visible on the Windy map.'
          },
          stationType: { 
            type: 'string', 
            title: 'Station Type', 
            default: 'Boat (Signal K)',
            description: 'The category assigned to the reporting station.'
          },
          operator_url: { 
            type: 'string', 
            title: 'Operator Website URL',
            description: 'A public link displayed on the Windy station page.'
          },
          shareOption: {
            type: 'string',
            title: 'Share Option',
            default: 'public',
            enum: ['public', 'private'],
            enumNames: [
              'Public (Open Data)', 
              'Private (Only Windy)'
            ],
            description: 'Public: aggregate data under the Aggregator Open Data License; Private: Windy.com use only.'
          }
        }
      },
      logic: {
        title: 'Transmission & Movement Guard',
        type: 'object',
        properties: {
          interval: { 
            type: 'number', 
            title: 'Reporting Interval (Minutes)', 
            default: 5,
            description: 'Frequency of data transmissions.'
          },
          minMove: { 
            type: 'number', 
            title: 'Min Movement Threshold (Meters)', 
            default: 300,
            description: 'The distance required for a GPS position update on the Windy map.'
          },
          forceUpdate: { 
            type: 'boolean', 
            title: 'Force GPS Updates', 
            default: false,
            description: 'Bypasses the Movement Guard to send GPS coordinates at every interval.'
          }
        }
      },
      pathMap: {
        title: 'Sensor Path Overrides (Advanced)',
        type: 'object',
        properties: {
          windSpeed: { type: 'string', title: 'Wind Speed', default: 'environment.wind.speedOverGround' },
          windGust: { type: 'string', title: 'Wind Gust', default: 'environment.wind.gust' },
          windDir: { type: 'string', title: 'Wind Direction', default: 'environment.wind.directionTrue' },
          temp: { type: 'string', title: 'Outside Temp', default: 'environment.outside.temperature' },
          pressure: { type: 'string', title: 'Barometric Pressure', default: 'environment.outside.pressure' },
          humidity: { type: 'string', title: 'Relative Humidity', default: 'environment.outside.relativeHumidity' }
        }
      }
    }
  };

  plugin.uiSchema = {
    credentials: { 
      stationPassword: { "ui:widget": "password" }, 
      apiKey: { "ui:widget": "password" } 
    },
    pathMap: { "ui:options": { collapsible: true, collapsed: true } }
  };

  // --- LIFECYCLE ---

  plugin.start = function (settings) {
    const options = { 
      ...(settings.credentials || {}), 
      ...(settings.identity || {}), 
      ...(settings.logic || {}), 
      pathMap: settings.pathMap || {} 
    };

    // Load internal movement state from private file
    // app.getDataDirPath() is safe to call inside start()
    try {
      const stateFile = getStateFilePath();
      if (fs.existsSync(stateFile)) {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        lastSentPos = state.lastSentPos || { lat: 0, lon: 0 };
        currentDistance = state.currentDistance || 0;
        nextRunTime = state.nextRunTime || 0;
        if (lastSentPos.lat) kx = Math.cos(lastSentPos.lat * Math.PI / 180);
      }
    } catch (e) { app.debug('Starting with fresh internal state.'); }

    // --- PEAK GUST TRACKING (GAP CLOSER) ---
    // Subscribe to navigation.position to track vessel movement for the Movement Guard
    // Also subscribe to wind speed at 1Hz to track the highest wind speed observed between intervals
    const windPath = options.pathMap.windSpeed || 'environment.wind.speedOverGround';

    app.subscriptionmanager.subscribe({
      context: 'vessels.self',
      subscribe: [
        { path: 'navigation.position', period: 1000 },
        { path: windPath, period: 1000 }
      ]
    }, [], (err) => app.error(err), (delta) => {
      delta.updates.forEach(u => u.values.forEach(v => {
        if (v.path === 'navigation.position' && v.value) handlePositionUpdate(v.value);

        // Track Peak Gust
        if (v.path === windPath && v.value !== null) {
          if (v.value > peakGust) peakGust = v.value;
        }
      }));
    });

    // Determine if the plugin should report immediately or wait based on persisted nextRunTime
    const remainingTime = nextRunTime - Date.now();
    if (remainingTime <= 0) {
      // Warm-up delay: Give Signal K 15 seconds to receive sensor data before first report
      app.setPluginStatus('Warming up (15s)...');
      timer = setTimeout(() => {
        reportToWindy(options, !!options.forceUpdate);
        scheduleNext(options);
      }, 15000);
    } else {
      app.setPluginStatus(`Resuming: ${Math.round(remainingTime / 60000)}m remaining`);
      timer = setTimeout(() => { reportToWindy(options); scheduleNext(options); }, remainingTime);
    }
  };

  plugin.stop = function () {
    if (timer) clearTimeout(timer);
    
    // Save movement state to private file (Does not touch config/settings.json)
    try {
      const dataDir = app.getDataDirPath();
      const stateFile = getStateFilePath();
      const state = { lastSentPos, currentDistance, nextRunTime };
      
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(stateFile, JSON.stringify(state));
    } catch (e) { app.error('Failed to save state file:', e.message); }

    app.setPluginStatus('Stopped');
  };

  // --- ENGINE ---

  /**
   * Tracks distance traveled since the last successful map update using Cheap Ruler math.
   */
  function handlePositionUpdate(pos) {
    if (!lastSentPos.lat) {
      lastSentPos = { lat: pos.latitude, lon: pos.longitude };
      kx = Math.cos(pos.latitude * Math.PI / 180);
      return;
    }
    const dx = (pos.longitude - lastSentPos.lon) * kx;
    const dy = (pos.latitude - lastSentPos.lat);
    currentDistance += Math.sqrt(dx * dx + dy * dy) * 111319; // Result in meters
    lastSentPos = { lat: pos.latitude, lon: pos.longitude };
    kx = Math.cos(pos.latitude * Math.PI / 180);
  }

  /**
   * Reports data using separate endpoints as required by API v2.
   * Observations use GET while Metadata (Location/Identity) use PUT.
   */
  function reportToWindy(options, force = false) {
    const weather = getStationData(options);
    const pos = app.getSelfPath('navigation.position');
    const shouldUpdateGPS = force || currentDistance >= (options.minMove || 300);

    // GAP CLOSER: If no native gust is available, or if tracked peak is higher, use peakGust
    if (peakGust > (weather.gust || 0)) {
      weather.gust = peakGust.toFixed(1);
    }

    // Check if we have any weather data to send
    if (Object.keys(weather).length > 0) {
      // 1. OBSERVATIONS: GET /api/v2/observation/update
      // Auth uses Station Password as a query parameter (PASSWORD)
      const weatherParams = new URLSearchParams({
        id: options.stationId,
        PASSWORD: options.stationPassword,
        time: 'now',
        ...weather
      }).toString();

      // Log variables and values submitted via GET
      app.debug(`Windy Submission (GET): ${JSON.stringify(weather)}`);

      axios.get(`https://stations.windy.com/api/v2/observation/update?${weatherParams}`)
        .then(() => {
          const time = new Date().toLocaleTimeString([], { hour12: false });
          
          // Define fixed flag order: Wind, Gust, Direction, Temp, Pressure, Humidity
          const flagMap = { wind: 'W', gust: 'G', winddir: 'D', temp: 'T', baro: 'P', rh: 'H' };
          const sensorFlags = Object.keys(flagMap)
            .filter(key => weather.hasOwnProperty(key))
            .map(key => `${flagMap[key]}:${weather[key]}`)
            .join('|');

          app.setPluginStatus(`[${sensorFlags}] at ${time} | Delta: ${Math.round(currentDistance)}m`);

          // RESET PEAK after successful report
          peakGust = 0;
        })
        .catch(err => app.error('Windy Observation Error:', err.message));
    } else {
      app.setPluginStatus(`Waiting for sensor data | Delta: ${Math.round(currentDistance)}m`);
    }

    // 2. METADATA: PUT /api/v2/pws/{id}
    // Auth uses Global API Key in headers (windy-api-key)
    if (pos && pos.value && shouldUpdateGPS) {
      const metadataPayload = {
        lat: pos.value.latitude,
        lon: pos.value.longitude,
        name: options.stationName,
        type: options.stationType,
        share: options.shareOption === 'public' ? 'Open' : 'Private',
        operator_url: options.operator_url || ''
      };

      // Log movement tracking status for PUT submission
      app.debug(`Movement Guard: ${Math.round(currentDistance)} meters traveled`);

      axios.put(`https://stations.windy.com/api/v2/pws/${options.stationId}`, metadataPayload, {
        headers: { 'windy-api-key': options.apiKey }
      })
      .then(() => {
        currentDistance = 0; // Reset movement guard after successful map update
        app.debug('Station metadata updated successfully');
      })
      .catch(err => app.error('Windy Metadata Error:', err.message));
    }
  }

  /**
   * Fetches weather data from Signal K and converts values to Windy-standard units.
   * Pa -> hPa, K -> °C, Ratio -> %
   */
  function getStationData(options) {
    const pm = options.pathMap || {};
    const d = {};
    const get = (p) => app.getSelfPath(p);

    const w = get(pm.windSpeed || 'environment.wind.speedOverGround');
    if (w && w.value !== null) d.wind = w.value.toFixed(1);

    const g = get(pm.windGust || 'environment.wind.gust');
    if (g && g.value !== null) d.gust = g.value.toFixed(1);

    const dr = get(pm.windDir || 'environment.wind.directionTrue');
    if (dr && dr.value !== null) d.winddir = Math.round((dr.value * 180) / Math.PI);

    const t = get(pm.temp || 'environment.outside.temperature');
    if (t && t.value !== null) d.temp = (t.value - 273.15).toFixed(1);

    const p = get(pm.pressure || 'environment.outside.pressure');
    if (p && p.value !== null) d.baro = Math.round(p.value / 100);

    const h = get(pm.humidity || 'environment.outside.relativeHumidity');
    if (h && h.value !== null) d.rh = Math.round(h.value * 100);

    return d;
  }

  /**
   * Schedules the next reporting interval and updates the persistent nextRunTime timestamp.
   */
  function scheduleNext(options) {
    const interval = (options.interval || 5) * 60000;
    nextRunTime = Date.now() + interval;
    timer = setTimeout(() => { reportToWindy(options); scheduleNext(options); }, interval);
  }

  return plugin;
};