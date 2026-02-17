/**
 * Signal K Windy API v2 Reporter
 * v1.2.0 - Fix station offline when underway (Issue #4)
 * Reports data to Windy using separate observation (GET) and metadata (PUT) endpoints.
 * Includes Movement Guard and Independent State Persistence.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports = function (app) {
  let timer = null;
  let statusTimer = null; // Variable for the live countdown heartbeat
  let lastSentPos = { lat: 0, lon: 0 };
  let currentDistance = 0;
  let nextRunTime = 0;
  let kx = 1; // Latitude scaling factor for Equirectangular projection (Cheap Ruler)
  let lastReportString = ''; // Persistent storage for the last submitted data string

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

  /**
   * Heartbeat: Updates the Signal K Dashboard status with a live countdown.
   * Refined to show Last Report data, distance from baseline (Delta), and Countdown.
   */
  const updateHeartbeatStatus = (msgPrefix = 'Next report in') => {
    const remainingMs = nextRunTime - Date.now();
    if (remainingMs > 0) {
      const min = Math.floor(remainingMs / 60000);
      const sec = Math.floor((remainingMs % 60000) / 1000);
      
      // Build the components of the status string
      const heartbeat = `${msgPrefix}: ${min}m ${sec}s`;
      const movement = `Delta: ${Math.round(currentDistance)}m`;
      
      // Combine last submitted data with the countdown and movement delta
      const status = lastReportString 
        ? `${lastReportString} | ${movement} | ${heartbeat}`
        : `${heartbeat} | ${movement}`;
        
      app.setPluginStatus(status);
    }
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
        title: 'Vessel Identity & Sensors',
        type: 'object',
        properties: {
          stationName: { 
            type: 'string', 
            title: 'Display Name', 
            default: 'Signal K Vessel',
            description: 'The name visible on the Windy map.'
          },
          station_type: { 
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
            enum: ['public', 'only_windy', 'private'],
            enumNames: [
              'Public', 
              'Windy',
              'Private'
            ]
          },
          agl_temp: {
            type: 'integer', // Changed from 'number' to 'integer'
            title: 'Temperature Sensor Height (m)',
            default: 2,
            description: 'Height of the thermometer above the water line (AGL). Must be a whole number.'
          },
          agl_wind: {
            type: 'integer', // Changed from 'number' to 'integer'
            title: 'Wind Sensor Height (m)',
            default: 10,
            description: 'Height of the anemometer above the water line (AGL). Must be a whole number.'
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
            minimum: 5,
            description: 'Minimum 5 minutes. Windy enforces a rate limit of one observation per 5 minutes per station.'
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
            default: false
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
    identity: {
      shareOption: {
       "ui:help": "Public: aggregate data under the Aggregator Open Data License; Windy: Observations used only by Windy.com; Private: Private non-public use"
      }
    },
    logic: {
      forceUpdate: {
        "ui:help": "Bypasses the Movement Guard to send GPS coordinates at every interval."
      }
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
      nextRunTime = Date.now() + 15000;
      statusTimer = setInterval(() => updateHeartbeatStatus('Warming up'), 1000);
      
      timer = setTimeout(() => {
        clearInterval(statusTimer); // Stop warm-up countdown
        reportToWindy(options, !!options.forceUpdate);
        scheduleNext(options);
      }, 15000);
    } else {
      // Resuming logic with Heartbeat integration
      statusTimer = setInterval(() => updateHeartbeatStatus('Resuming'), 1000);
      
      timer = setTimeout(() => { 
        clearInterval(statusTimer);
        reportToWindy(options); 
        scheduleNext(options); 
      }, remainingTime);
    }
  };

  plugin.stop = function () {
    if (timer) clearTimeout(timer);
    if (statusTimer) clearInterval(statusTimer); // Clear heartbeat on stop
    
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
   * Tracks distance from the last reported (baseline) position using Cheap Ruler math.
   * This is a radius calculation, not cumulative odometer distance.
   */
  function handlePositionUpdate(pos) {
    if (!lastSentPos.lat) {
      lastSentPos = { lat: pos.latitude, lon: pos.longitude };
      kx = Math.cos(pos.latitude * Math.PI / 180);
      return;
    }
    const dx = (pos.longitude - lastSentPos.lon) * kx;
    const dy = (pos.latitude - lastSentPos.lat);
    currentDistance = Math.sqrt(dx * dx + dy * dy) * 111319; // Current radius in meters
  }

  /**
   * Reports data using separate endpoints as required by API v2.
   * When the distance threshold is exceeded (vessel underway), the station location
   * is updated via PUT first, then the observation is sent via GET immediately after.
   * This ensures Windy receives observation data at the newly registered position,
   * preventing the station from being marked offline after a location update.
   * PUTs do not count against Windy's observation rate limit (confirmed via testing).
   */
  async function reportToWindy(options, force = false) {
    const weather = getStationData(options);
    const pos = app.getSelfPath('navigation.position');
    const shouldUpdateGPS = force || currentDistance >= (options.minMove || 300);

    // GAP CLOSER: If no native gust is available, or if tracked peak is higher, use peakGust
    if (peakGust > (weather.gust || 0)) {
      weather.gust = peakGust.toFixed(1);
    }

    // --- STEP 1: METADATA PUT (if distance threshold exceeded) ---
    // Must complete before the observation GET so Windy has the correct station
    // position when the observation arrives. Auth uses Global API Key in headers.
    if (pos && pos.value && shouldUpdateGPS) {
      // API v2 Requirement: elev_m must be an integer
      // Attempt to find altitude in common Signal K paths; default to 0
      const altitude = app.getSelfPath('navigation.gnss.antennaAltitude') || 
                       app.getSelfPath('navigation.altitude') || { value: 0 };

      // Convert selection to lowercase as required by API v2.
      // No default is applied here; if empty, Windy will return a 400 Bad Request error.
      const rawShare = (options.shareOption || '').toLowerCase();

      const metadataPayload = {
        name: options.stationName,
        share_option: rawShare,
        lat: Number(pos.value.latitude.toFixed(5)),
        lon: Number(pos.value.longitude.toFixed(5)),
        elev_m: Math.round(altitude.value), // Round to nearest integer per API error
        agl_wind: options.agl_wind || 10,    // Height from settings (AGL requirement)
        agl_temp: options.agl_temp || 2,     // Height from settings (AGL requirement)
        station_type: options.station_type,
        operator_text: options.stationName,
        operator_url: options.operator_url || ''
      };

      app.debug(`Movement Guard: ${Math.round(currentDistance)}m from baseline position`);
      app.debug(`Windy Metadata Submission (PUT): ${JSON.stringify(metadataPayload)}`);

      try {
        await axios.put(`https://stations.windy.com/api/v2/pws/${options.stationId}`, metadataPayload, {
          headers: { 
            'windy-api-key': options.apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });
        // Reset movement guard baseline only after a successful map update
        lastSentPos = { lat: pos.value.latitude, lon: pos.value.longitude };
        kx = Math.cos(pos.value.latitude * Math.PI / 180);
        currentDistance = 0;
        app.debug('Station metadata updated successfully');
      } catch (err) {
        const detail = err.response ? JSON.stringify(err.response.data) : err.message;
        const status = err.response ? err.response.status : 'N/A';
        app.error(`Windy Metadata Error (${status}): ${detail}`);
        app.setPluginError(`Metadata update failed (${status})`);
        // Continue to observation — weather data is still valuable even if location update failed
      }
    }

    // --- STEP 2: OBSERVATION GET ---
    // Sent after the PUT so the observation lands at the station's current registered position.
    // Auth uses Station Password as a query parameter. Rate-limited to 1 per 5 minutes by Windy.
    if (Object.keys(weather).length > 0) {
      const weatherParams = new URLSearchParams({
        id: options.stationId,
        PASSWORD: options.stationPassword,
        ts: Math.floor(Date.now() / 1000),
        ...weather
      }).toString();

      app.debug(`Windy Submission (GET): ${JSON.stringify(weather)}`);

      try {
        await axios.get(`https://stations.windy.com/api/v2/observation/update?${weatherParams}`, {
          timeout: 30000
        });
        const time = new Date().toLocaleTimeString([], { hour12: false });
        
        // User-friendly status: converts m/s -> kn and Pa -> kPa for dashboard readability
        const displayMap = [];
        if (weather.wind) displayMap.push(`W:${(weather.wind * 1.94384).toFixed(1)}kn`);
        if (weather.gust) displayMap.push(`G:${(weather.gust * 1.94384).toFixed(1)}kn`);
        if (weather.winddir) displayMap.push(`D:${weather.winddir}°`);
        if (weather.temp) displayMap.push(`T:${weather.temp}C`);
        if (weather.pressure) displayMap.push(`P:${(weather.pressure / 1000).toFixed(2)}kPa`);
        if (weather.rh) displayMap.push(`H:${weather.rh}%`);

        const sensorFlags = displayMap.join('|');
        lastReportString = `[${sensorFlags}] at ${time}`;
        app.setPluginStatus(`${lastReportString} | Delta: ${Math.round(currentDistance)}m`);

        // Reset peak gust tracker after successful report
        peakGust = 0;
      } catch (err) {
        const msg = err.response ? `Status ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
        app.error('Windy Observation Error:', msg);
        app.setPluginError(`Observation failed: ${msg}`);
      }
    } else {
      app.setPluginStatus(`Waiting for sensor data | Delta: ${Math.round(currentDistance)}m`);
    }
  }

  /**
   * Fetches weather data from Signal K and converts values to Windy-standard units.
   * K -> Â°C, Ratio -> %
   * Signal K provides Pa. Windy API v2 expects Pa. (v1.0.8 Update)
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
    if (p && p.value !== null) d.pressure = Math.round(p.value);

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

    // Start countdown heartbeat for the new interval
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = setInterval(() => updateHeartbeatStatus(), 1000);

    timer = setTimeout(() => { 
      clearInterval(statusTimer); // Stop countdown before reporting
      reportToWindy(options); 
      scheduleNext(options); 
    }, interval);
  }

  return plugin;
};