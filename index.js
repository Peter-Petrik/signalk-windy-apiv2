/**
 * Signal K Windy API v2 Reporter
 * Reports weather data (Wind, Temp, Pressure, Humidity, Gusts) to Windy.com.
 * Final Merged Version: Corrected to m/s for Windy API compliance.
 */

const axios = require('axios');

module.exports = function (app) {
  let plugin = {};
  let timer;
  let lastStatus = 'Initialized';
  let lastError = 'None';
  let lastSentPos = { lat: 0, lon: 0 };
  let currentDistance = 0;

  plugin.id = 'signalk-windy-apiv2';
  plugin.name = 'Windy API v2 Reporter';
  
  /**
   * Updates the Signal K Dashboard status string with telemetry feedback.
   * Format: ✅ Status: [Flags] at [Time] [Movement Status] | Delta: [Distance]m
   */
  const updateDisplay = (msg, isError = false) => {
    lastStatus = msg;
    const distText = lastSentPos.lat !== 0 ? ` | Delta: ${Math.round(currentDistance)}m` : '';
    const statusPrefix = isError ? '❌ Error' : '✅ Status';
    app.setPluginStatus(`${statusPrefix}: ${lastStatus}${distText} | Last Error: ${lastError}`);
  };

  /**
   * Main reporting loop. Handles Metadata synchronization (PUT) 
   * and Weather Observation updates (GET).
   */
  const reportToWindy = async (options, force = false) => {
    // Helper to extract values from Signal K paths safely
    const getVal = (path) => {
      const val = app.getSelfPath(path);
      return (val === undefined || val === null) ? null : val.value;
    };

    // Ensure GPS lock exists before proceeding
    const currentPos = getVal('navigation.position');
    if (!currentPos || !currentPos.latitude || !currentPos.longitude) {
      updateDisplay('Waiting for GPS fix...', true);
      return;
    }

    try {
      /**
       * MOVEMENT GUARD LOGIC
       * Calculates planar distance (meters) between current and last reported position.
       * Map pin only updates if vessel moves beyond the defined threshold (default 300m).
       */
      const R = 6371000; // Earth radius in meters
      const dLat = (currentPos.latitude - lastSentPos.lat) * Math.PI / 180;
      const dLon = (currentPos.longitude - lastSentPos.lon) * Math.PI / 180;
      const x = dLon * Math.cos((currentPos.latitude + lastSentPos.lat) * Math.PI / 360);
      currentDistance = Math.sqrt(x * x + dLat * dLat) * R;

      const shouldUpdatePos = force || lastSentPos.lat === 0 || currentDistance > (options.minMove || 300);

      /**
       * METADATA UPDATE (PUT) - Location & Identity 
       * Syncs vessel identity and current coordinates to Windy.
       * Uses the Global API Key in the headers for security.
       */
      if (shouldUpdatePos) {
        await axios.put(`https://stations.windy.com/api/v2/pws/${options.stationId}`, {
          lat: currentPos.latitude,
          lon: currentPos.longitude,
          name: options.stationName || '',
          url: options.stationWebsite || '',
          share_option: options.shareOption || 'public',
          type: options.stationType || 'Boat (Signal K)'
        }, {
          headers: { 'windy-api-key': options.apiKey }
        });
        lastSentPos = { lat: currentPos.latitude, lon: currentPos.longitude };
        currentDistance = 0;
        app.debug(`Windy: Position updated (Share: ${options.shareOption})`);
      }

      /**
       * OBSERVATION UPDATE (GET)
       * Gathers weather data and performs unit conversions:
       * - Temp: Kelvin -> Celsius
       * - Wind & Gusts: Kept as m/s (Standard for Windy API)
       * - Wind Direction: Radians -> Degrees
       */
      const paths = {
        temp: options.pathMap?.temp || 'environment.outside.temperature',
        windSpeed: options.pathMap?.windSpeed || 'environment.wind.speedOverGround',
        windGust: options.pathMap?.windGust || 'environment.wind.gust',
        windDir: options.pathMap?.windDir || 'environment.wind.directionTrue',
        pressure: options.pathMap?.pressure || 'environment.outside.pressure',
        humidity: options.pathMap?.humidity || 'environment.outside.humidity'
      };

      const params = {
        id: options.stationId,
        PASSWORD: options.stationPassword,
        temp: getVal(paths.temp) ? (getVal(paths.temp) - 273.15).toFixed(1) : null,
        wind: getVal(paths.windSpeed) ? getVal(paths.windSpeed).toFixed(1) : null,
        gust: getVal(paths.windGust) ? getVal(paths.windGust).toFixed(1) : null,
        winddir: getVal(paths.windDir) ? Math.round((getVal(paths.windDir) * 180) / Math.PI) % 360 : null,
        pressure: getVal(paths.pressure) ? Math.round(getVal(paths.pressure)) : null,
        rh: getVal(paths.humidity) ? Math.round(getVal(paths.humidity) * 100) : null,
        time: 'now'
      };

      /**
       * HIGH-RESOLUTION TELEMETRY
       * Detects and flags successfully sent data points [T|W|G|D|P|H] for dashboard monitoring.
       */
      const sensorFlags = [];
      if (params.temp) sensorFlags.push('T');
      if (params.wind) sensorFlags.push('W');
      if (params.gust) sensorFlags.push('G');
      if (params.winddir) sensorFlags.push('D');
      if (params.pressure) sensorFlags.push('P');
      if (params.rh) sensorFlags.push('H');

      // Filter nulls and send the GET request
      const query = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([_, v]) => v != null)));
      const cleanUrl = `https://stations.windy.com/api/v2/observation/update?${query.toString()}`;
      
      app.debug(`Windy sending observation: ${cleanUrl}`);
      await axios.get(cleanUrl);
      
      lastError = 'None';
      const dataLabel = sensorFlags.length > 0 ? ` [${sensorFlags.join('|')}]` : ' [No Data]';
      updateDisplay(`Sent${dataLabel} at ${new Date().toLocaleTimeString()}${!shouldUpdatePos ? ' (Static)' : ' (Moved)'}`);
    } catch (err) {
      lastError = `${err.response?.status || 'Error'}: ${err.message}`;
      updateDisplay('Transmission Failed', true);
    }
  };

  /**
   * PLUGIN CONFIGURATION SCHEMA
   * Includes descriptions for user guidance.
   */
  plugin.schema = {
    type: 'object',
    required: ['credentials'],
    properties: {
      credentials: {
        title: 'Windy API Credentials',
        description: 'Obtain keys from stations.windy.com.',
        type: 'object',
        required: ['apiKey', 'stationId', 'stationPassword'],
        properties: {
          stationId: { type: 'string', title: 'Station ID' },
          stationPassword: { type: 'string', title: 'Station Password' },
          apiKey: { type: 'string', title: 'Global API Key' }
        }
      },
      identity: {
        title: 'Vessel Identity & Privacy',
        description: 'Define appearance and data sharing preferences.',
        type: 'object',
        properties: {
          stationName: { type: 'string', title: 'Station Name' },
          stationType: { type: 'string', title: 'Station Description/Type', default: 'Boat (Signal K)' },
          stationWebsite: { type: 'string', title: 'Station Website (URL)' },
          shareOption: {
            type: 'string',
            title: 'Share Option',
            default: 'public',
            enum: ['public', 'private'],
            enumNames: [
              'Public (Open Data - Aggregated & Shared)', 
              'Private (Only Windy - Visualized on Windy Only)'
            ]
          }
        }
      },
      logic: {
        title: 'Transmission & GPS Logic',
        description: 'Configure frequency and movement sensitivity.',
        type: 'object',
        properties: {
          interval: { type: 'number', title: 'Interval (min)', default: 5 },
          minMove: { type: 'number', title: 'Minimum Movement (meters)', default: 300 },
          forceUpdate: { type: 'boolean', title: 'Force Immediate Update', default: false }
        }
      },
      pathMap: {
        title: 'Sensor Path Overrides',
        description: 'Advanced: Override default Signal K paths. Leave blank to use defaults.',
        type: 'object',
        properties: {
          temp: { type: 'string', title: 'Temp Path' },
          windSpeed: { type: 'string', title: 'Wind Speed Path' },
          windGust: { type: 'string', title: 'Wind Gust Path' },
          windDir: { type: 'string', title: 'Wind Direction Path' },
          pressure: { type: 'string', title: 'Pressure Path' },
          humidity: { type: 'string', title: 'Humidity Path' }
        }
      }
    }
  };

  /**
   * UI SCHEMA
   * Controls visual presentation and placeholders.
   */
  plugin.uiSchema = {
    credentials: {
      stationId: { "ui:placeholder": "f1a2b3c4" },
      stationPassword: { "ui:widget": "password", "ui:placeholder": "Station-Secret-Key" },
      apiKey: { "ui:widget": "password", "ui:placeholder": "12345-abcde-..." }
    },
    identity: {
      stationName: { "ui:placeholder": "SV VesselName" },
      stationType: { "ui:placeholder": "Boat (Signal K)" },
      stationWebsite: { "ui:placeholder": "https://vessel-link.com" }
    },
    logic: {
      interval: { "ui:placeholder": "5" },
      minMove: { "ui:placeholder": "300" }
    },
    pathMap: {
      "ui:options": { "collapse": true },
      temp: { "ui:placeholder": "environment.outside.temperature" },
      windSpeed: { "ui:placeholder": "environment.wind.speedOverGround" },
      windGust: { "ui:placeholder": "environment.wind.gust" },
      windDir: { "ui:placeholder": "environment.wind.directionTrue" },
      pressure: { "ui:placeholder": "environment.outside.pressure" },
      humidity: { "ui:placeholder": "environment.outside.humidity" }
    }
  };

  /**
   * PLUGIN LIFECYCLE: START
   * Initializes reporting based on the configured interval.
   */
  plugin.start = function (settings) {
    app.debug('Windy Plugin starting...');

    const options = {
      ...settings.credentials,
      ...settings.identity,
      ...settings.logic,
      pathMap: settings.pathMap
    };

    reportToWindy(options, !!options.forceUpdate);
    timer = setInterval(() => reportToWindy(options), (options.interval || 5) * 60000);
  };

  /**
   * PLUGIN LIFECYCLE: STOP
   * Clears timers and updates status.
   */
  plugin.stop = function () {
    app.debug('Windy Plugin stopping...');

    if (timer) clearInterval(timer);
    updateDisplay('Stopped');
  };

  return plugin;
};