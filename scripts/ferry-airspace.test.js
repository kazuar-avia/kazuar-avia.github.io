const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAirspace() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'ferry-airspace.js'), 'utf8');
  const context = {window: {}};
  vm.runInNewContext(code, context, {filename: 'ferry-airspace.js'});
  return context.window.UCAAFerryAirspace;
}

const airports = {
  UKFF: {lat: 45.052, lon: 33.975},
  UKFB: {lat: 44.691, lon: 33.575},
  Kerch: {lat: 45.357, lon: 36.47},
  UGTB: {lat: 41.6692, lon: 44.9547},
  UKKK: {lat: 50.402, lon: 30.451},
  Moscow: {lat: 55.7558, lon: 37.6173},
  Sochi: {lat: 43.6028, lon: 39.7342},
  Minsk: {lat: 53.9006, lon: 27.559}
};

test('Crimean airfields can be used for ferry routes', () => {
  const airspace = loadAirspace();
  for (const [from, to] of [
    ['UKFF', 'UGTB'], ['UKFB', 'UKKK'], ['Kerch', 'UGTB'], ['UGTB', 'UKFF']
  ]) {
    const route = airspace.route(airports[from], airports[to]);
    assert.ok(route && !route.unavailable, `${from} → ${to} should be routable`);
    assert.ok(route.distanceNm > 0, `${from} → ${to} needs a route distance`);
  }
});

test('mainland Russia and Belarus are still blocked', () => {
  const airspace = loadAirspace();
  for (const origin of ['Moscow', 'Sochi', 'Minsk']) {
    assert.equal(airspace.route(airports[origin], airports.UKKK).unavailable, true, origin);
  }
});

test('invalid coordinates remain rejected', () => {
  const airspace = loadAirspace();
  assert.equal(airspace.route(null, airports.UKKK), null);
  assert.equal(airspace.route({lat: NaN, lon: 33}, airports.UKKK), null);
});
