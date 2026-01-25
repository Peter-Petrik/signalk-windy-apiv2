const axios = require('axios');

module.exports = function (app) {
  let timer = null;
  let lastSentPos = { lat: 0, lon: 0 };
  let currentDistance = 0;
  let nextRunTime = 0;
  let kx = 1; // Latitude scaling factor

  const plugin = {};
  // ID corrected to match package.json exactly
  plugin.id = 'signalk-windy-apiv2';
  plugin.name = 'Windy API v2 Reporter';
  plugin.description = 'Reports weather and position data to Windy.com Stations API using optimized movement tracking.';

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
            title: 'API Key',
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
          shareOption: {
            type: 'string',
            title: 'Data Sharing License',
            default: 'public',
            enum: ['public', 'private'],
            enumNames: [
              'Public (Visible on Map / Open Data)', 
              'Private (Personal Use / Hidden from Map)'
            ],
            description: 'Public mode aggregate data under the Aggregator Open Data Licence.'
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
        title: 'Sensor Path Mapping',
        type: 'object',
        description: 'Mapping of internal Signal K paths to Windy variables.',
        properties: {
          windSpeed: { type: 'string', title: 'Wind Speed', default: 'environment.wind.speedOverGround' },
          windGust: { type: 'string', title: 'Wind Gust', default: 'environment.wind.gust' },
          windDir: { type: 'string', title: 'Wind Direction', default: 'environment.wind.directionTrue' },
          temp: { type: 'string', title: 'Outside Temp', default: 'environment.outside.temperature' },
          pressure: { type: 'string', title: 'Barometer', default: 'environment.outside.pressure' },
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

    const savedOptions = app.readPluginOptions();
    if (savedOptions && savedOptions.state) {
      lastSentPos = savedOptions.state.lastSentPos || { lat: 0, lon: 0 };
      currentDistance = savedOptions.state.currentDistance || 0;
      nextRunTime = savedOptions.state.nextRunTime || 0;
      if (lastSentPos.lat) kx = Math.cos(lastSentPos.lat * Math.PI / 180);
    }

    const remainingTime = nextRunTime - Date.now();
    if (remainingTime <= 0) {
      reportToWindy(options, !!options.forceUpdate);
      scheduleNext(options);
    } else {
      app.setPluginStatus(`Resuming: ${Math.round(remainingTime / 60000)}m remaining`);
      timer = setTimeout(() => { reportToWindy(options); scheduleNext(options); }, remainingTime);
    }

    app.subscriptionmanager.subscribe({
      context: 'vessels.self',
      subscribe: [{ path: 'navigation.position', period: 1000 }]
    }, [], (err) => app.error(err), (delta) => {
      delta.updates.forEach(u => u.values.forEach(v => {
        if (v.path === 'navigation.position' && v.value) handlePositionUpdate(v.value);
      }));
    });
  };

  plugin.stop = function () {
    if (timer) clearTimeout(timer);
    app.savePluginOptions({
      ...app.readPluginOptions(),
      state: { lastSentPos, currentDistance, nextRunTime }
    });
    app.setPluginStatus('Stopped');
  };

  // --- ENGINE ---

  function handlePositionUpdate(pos) {
    if (!lastSentPos.lat) {
      lastSentPos = { lat: pos.latitude, lon: pos.longitude };
      kx = Math.cos(pos.latitude * Math.PI / 180);
      return;
    }
    const dx = (pos.longitude - lastSentPos.lon) * kx;
    const dy = (pos.latitude - lastSentPos.lat);
    currentDistance += Math.sqrt(dx * dx + dy * dy) * 111319;
    lastSentPos = { lat: pos.latitude, lon: pos.longitude };
    kx = Math.cos(pos.latitude * Math.PI / 180);
  }

  function reportToWindy(options, force = false) {
    const weather = getStationData(options);
    const pos = app.getSelfPath('navigation.position');
    const shouldUpdateGPS = force || currentDistance >= (options.minMove || 300);

    const payload = {
      stations: [{
        station: options.stationId,
        name: options.stationName,
        type: options.stationType,
        share: options.shareOption === 'public',
        ...weather
      }]
    };

    if (pos && pos.value && shouldUpdateGPS) {
      payload.stations[0].lat = pos.value.latitude;
      payload.stations[0].lon = pos.value.longitude;
      currentDistance = 0;
    }

    axios.post(`https://stations.windy.com/pws/update/${options.apiKey}`, payload)
      .then(() => app.setPluginStatus(`Sent: ${new Date().toLocaleTimeString()}`))
      .catch(err => app.error('Windy API Error:', err.message));
  }

  function getStationData(options) {
    const pm = options.pathMap || {};
    const d = {};
    const get = (p) => app.getSelfPath(p);

    const w = get(pm.windSpeed || 'environment.wind.speedOverGround');
    if (w) d.wind = w.value.toFixed(1);

    const g = get(pm.windGust || 'environment.wind.gust');
    if (g) d.gust = g.value.toFixed(1);

    const dr = get(pm.windDir || 'environment.wind.directionTrue');
    if (dr) d.winddir = Math.round((dr.value * 180) / Math.PI);

    const t = get(pm.temp || 'environment.outside.temperature');
    if (t) d.temp = (t.value - 273.15).toFixed(1);

    const p = get(pm.pressure || 'environment.outside.pressure');
    if (p) d.baro = Math.round(p.value / 100);

    const h = get(pm.humidity || 'environment.outside.relativeHumidity');
    if (h) d.rh = Math.round(h.value * 100);

    return d;
  }

  function scheduleNext(options) {
    const interval = (options.interval || 5) * 60000;
    nextRunTime = Date.now() + interval;
    timer = setTimeout(() => { reportToWindy(options); scheduleNext(options); }, interval);
  }

  return plugin;
};