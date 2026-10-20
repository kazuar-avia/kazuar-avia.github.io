'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {applyAircraftReroutes} = require('./aircraft-reroute.js');

const id = '695ebf3c3dc76275ba3e31f1';
const otherId = '6a864196ef75cc3330403216';
const since = '2026-10-20T19:00:00.000Z';
function fixture(currentTime='2026-10-20T18:00:00.000Z') {
  const aircraft = {lastflightlocationICAO:'KLAX', lastFlightLocationIcao:'KLAX'};
  const other = {lastflightlocationICAO:'LUKK'};
  const byId = new Map([[id,aircraft],[otherId,other]]);
  const latest = new Map([[id,{arrival:'KLAX',timestamp:Date.parse(currentTime)}]]);
  return {aircraft,other,byId,latest};
}
function override(icao='LTAI', updatedAt=since) {
  return {version:1,aircraft:{[id]:{flightId:'6ad775f4f7e01a7089e0b6f9',icao,updatedAt}}};
}

test('admin reroute wins over previously completed unrelated FREE flights', () => {
  const f=fixture();
  applyAircraftReroutes(f.latest,{byId:f.byId},override());
  assert.equal(f.aircraft.lastflightlocationICAO,'LTAI');
  assert.equal(f.aircraft.lastFlightLocationIcao,'LTAI');
  assert.equal(f.other.lastflightlocationICAO,'LUKK');
});

test('a newer completed flight overrides the manual reroute', () => {
  const f=fixture('2026-10-20T19:30:00.000Z');
  applyAircraftReroutes(f.latest,{byId:f.byId},override());
  assert.equal(f.aircraft.lastflightlocationICAO,'KLAX');
});

test('malformed or stale instructions cannot change the fleet', () => {
  const invalid=[
    override('XXX'),override('KLAX','invalid'),
    {aircraft:{invalid:{icao:'LTAI',updatedAt:since}}},
    {aircraft:{[id]:{icao:'LTAI'}}},null,
  ];
  for (const data of invalid) {
    const f=fixture();
    applyAircraftReroutes(f.latest,{byId:f.byId},data);
    assert.equal(f.aircraft.lastflightlocationICAO,'KLAX');
  }
});
