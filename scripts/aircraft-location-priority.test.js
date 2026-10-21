'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const cabinetSource = fs.readFileSync(path.join(root, 'pilot-cabinet.js'), 'utf8');
const engines = ['scripts/update-top-pool.js', 'scripts/update-guaranteed-bonuses.js'];

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' must exist');
  const next = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

function cabinet(matchingPosition = 'LTAI') {
  const aircraft = {id: 'AZR', registration: 'UR-AZR'};
  const latest = {id: 'last-free', status: 'completed', aircraft: {id: 'AZR'},
    actualArrival: {icao: 'KLAX', name: 'Los Angeles'}};
  const route = {number: '771', dep: 'LTAI', arr: 'UKBB', active: true};
  const context = {
    app: {companyLiveryMatching: {liveries: [
      {_id: 'AZR', registration: 'UR-AZR',
        lastflightlocationICAO: matchingPosition, locationIcao: 'LTAI'}
    ]}},
    liveryAirportObjectByIcao: icao => ({icao, name: icao}),
    companyLiveryAircraftForCard: () => aircraft,
    liveryCardFallbackAirport: () => ({icao: 'KLAX'}),
    liveryScheduleRoutesForAircraft: () => [route],
    liveryLatestScheduleAirportIcao: () => 'LTAI',
    liveryScheduleCandidateRoutes: routes => routes,
    liveryChooseScheduleRoute: (routes, origin) => routes.find(item => item.dep === origin) || null,
    liveryRouteProposalData: (kind, number, origin, destination) =>
      ({kind, number, origin, destination}),
    liveryScheduleRouteFrom: () => route,
    liveryScheduleTimingLabel: () => 'сьогодні',
    liveryAppendNearestScheduleTooltip: value => value,
    liveryRangeSafeFreeProposal: (origin, destination) =>
      ({kind: 'free', origin, destination})
  };
  vm.createContext(context);
  for (const name of ['companyLiveryMatchingRecord', 'companyLiveryMatchingIcao',
    'liveryEffectiveCurrentIcao', 'liveryEffectiveCurrentAirport', 'liverySuggestedRouteData']) {
    vm.runInContext(functionSource(cabinetSource, name), context);
  }
  return {context, aircraft, latest};
}

test('saved position overrides the latest completed FREE flight in card and proposal', () => {
  const {context, aircraft, latest} = cabinet();
  assert.equal(context.liveryEffectiveCurrentIcao(aircraft, latest, {icao:'KLAX'}), 'LTAI');
  assert.equal(context.liveryEffectiveCurrentAirport(aircraft, latest, {icao:'KLAX'}).icao, 'LTAI');
  const offer = context.liverySuggestedRouteData({}, 'UR-AZR', [latest], latest, {id: 'AZR'});
  assert.equal(offer.kind, 'schedule');
  assert.equal(offer.origin, 'LTAI');
});

test('a saved position outside the schedule base still proposes an appropriate FREE', () => {
  const {context, latest} = cabinet('KLAX');
  const offer = context.liverySuggestedRouteData({}, 'UR-AZR', [latest], latest, {id: 'AZR'});
  assert.equal(offer.kind, 'free');
  assert.equal(offer.origin, 'KLAX');
  assert.equal(offer.destination, 'LTAI');
});

test('missing saved position uses completed arrival before the static card or schedule base', () => {
  const {context, aircraft, latest} = cabinet('');
  assert.equal(context.liveryEffectiveCurrentIcao(aircraft, latest, {icao:'UKKK'}), 'KLAX');
  assert.equal(context.liveryEffectiveCurrentIcao(aircraft, null, {icao:'UKKK'}), 'UKKK');
  assert.equal(context.liveryEffectiveCurrentIcao(aircraft, null, null), 'LTAI');
});

for (const file of engines) {
  test(file + ' retains a saved position, using flight arrivals only as fallback', () => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const context = {
      cleanId: value => String(value || '').trim(),
      upper: value => String(value || '').trim().toUpperCase()
    };
    vm.createContext(context);
    for (const name of ['completedFlightTimestamp', 'applyLatestCompletedLocations']) {
      vm.runInContext(functionSource(source, name), context);
    }
    const flight = {status:'completed', aircraft:{id:'AZR'},
      actualArrival:{icao:'KLAX'}, times:{closed:'2026-10-20T14:58:00Z'}};
    const stored = {id:'AZR', lastflightlocationICAO:'LTAI'};
    context.applyLatestCompletedLocations([flight], {byId:new Map([['AZR',stored]])});
    assert.equal(stored.lastflightlocationICAO, 'LTAI');
    const missing = {id:'AZR', lastflightlocationICAO:''};
    context.applyLatestCompletedLocations([flight], {byId:new Map([['AZR',missing]])});
    assert.equal(missing.lastflightlocationICAO, 'KLAX');
  });
}
