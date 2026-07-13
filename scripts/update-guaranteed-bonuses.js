#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const OUTPUT_ROOT = path.resolve(__dirname, '..');
const COMPANY_DIR = path.join(OUTPUT_ROOT, 'COMPANY');
const FLIGHTS_DIR = path.join(OUTPUT_ROOT, 'FLIGHTS');
const BONUS_FILE = path.join(COMPANY_DIR, 'guaranteed-bonuses.json');
const LIVE_URL = 'https://newsky.app/api/airline-api/flights/ongoing';
const DEFAULT_TOKEN = 'UKR_uSTNynarbU8B8A61nvDLqmSl7Ji8xK';

const args = new Set(process.argv.slice(2));
const argValue = name => {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(item => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameFlights(a, b) {
  return stableJson(a || {}) === stableJson(b || {});
}

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanId(value) {
  return String(value || '').trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function parseDate(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dayKey(date = new Date()) {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return keys[date.getUTCDay()];
}

function routeRunsTodayOrTomorrow(route, now = new Date()) {
  const days = new Set(array(route?.days).map(day => String(day).trim().toLowerCase()));
  if (!days.size) return true;
  const tomorrow = new Date(now.getTime() + 86400000);
  return days.has(dayKey(now)) || days.has(dayKey(tomorrow));
}

function pick(obj, paths) {
  for (const pathText of paths) {
    const parts = pathText.split('.');
    let current = obj;
    for (const part of parts) current = current?.[part];
    if (current !== undefined && current !== null && String(current).trim() !== '') return current;
  }
  return '';
}

function airportFromRaw(value) {
  if (!value) return {};
  if (typeof value === 'string') return {icao: upper(value)};
  return {
    icao: upper(value.icao || value.ident || value.code),
    name: String(value.name || value.fullname || ''),
    city: String(value.city || ''),
    location: value.location || value.loc || (value.lat && value.lon ? {lat: value.lat, lon: value.lon} : null)
  };
}

function normalizeCompletedRawFlight(raw, pilot = {}, week = null) {
  const dep = airportFromRaw(raw.dep || raw.departure);
  const arr = airportFromRaw(raw.arr || raw.arrival);
  const actualArr = airportFromRaw(raw.actArr || raw.actualArrival || raw.arrival || raw.arr);
  const closed = raw.close || raw.closed || raw.arrTimeAct || raw.actualArrivalTime;
  const hasClosed = Boolean(closed || raw.durationAct || raw.rating);
  if (!hasClosed) return null;
  return {
    id: cleanId(raw._id || raw.id),
    sourceWeek: week,
    status: 'completed',
    pilot: {
      id: cleanId(pilot.pilot_id || pilot.id || raw.pilotId || raw.pilot?.id),
      name: String(pilot.fullname || pilot.name || raw.pilot?.name || '')
    },
    flightNumber: String(raw.flightNumber || raw.number || '').trim(),
    flightType: String(raw.type || raw.flightType || (raw.payload?.cargo ? 'cargo' : 'pax')).trim(),
    aircraft: {
      id: cleanId(raw.aircraft?._id || raw.aircraft?.id || raw.aircraftId),
      icao: upper(raw.aircraft?.icao || raw.aircraft?.ident || raw.aircraft?.airframe?.icao),
      name: String(raw.aircraft?.name || raw.aircraft?.customName || raw.aircraft?.icao || '')
    },
    departure: dep,
    arrival: arr,
    actualArrival: actualArr.icao ? actualArr : arr,
    times: {
      scheduledDeparture: raw.depTime || raw.scheduledDeparture,
      scheduledArrival: raw.arrTime || raw.scheduledArrival,
      actualDeparture: raw.depTimeAct || raw.actualDeparture,
      takeoff: raw.takeoffTimeAct || raw.takeoff,
      actualArrival: raw.arrTimeAct || raw.actualArrival,
      closed,
      durationMinutes: Number(raw.durationAct || raw.duration || 0) || 0
    },
    operations: {
      scheduled: Boolean(raw.schedule || raw.scheduled),
      free: Boolean(raw.free),
      charter: Boolean(raw.charter),
      distance: Number(raw.result?.totals?.distance || raw.operations?.distance || 0) || 0
    }
  };
}

function loadCompletedFlights() {
  const flights = [];
  const archive = readJson(path.join(FLIGHTS_DIR, 'archive.json'), {flights: []});
  array(archive.flights).forEach(flight => flights.push(flight));

  const manifest = readJson(path.join(FLIGHTS_DIR, 'manifest.json'), {});
  const liveFile = manifest.liveFile ? path.join(FLIGHTS_DIR, manifest.liveFile) : '';
  if (liveFile && fs.existsSync(liveFile)) {
    const week = Number(manifest.liveWeek) || null;
    const raw = readJson(liveFile, []);
    const pilots = Array.isArray(raw) ? raw : array(raw.results || raw.pilots);
    pilots.forEach(pilot => {
      array(pilot.flights || pilot.reports).forEach(item => {
        const normalized = normalizeCompletedRawFlight(item, pilot, week);
        if (normalized?.id) flights.push(normalized);
      });
    });
  }
  return flights;
}

function loadAirportLocations(flights) {
  const map = new Map();
  const add = airport => {
    const icao = upper(airport?.icao);
    const lat = Number(airport?.location?.lat ?? airport?.lat);
    const lon = Number(airport?.location?.lon ?? airport?.lon);
    if (!icao || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!map.has(icao)) map.set(icao, {icao, lat, lon, name: airport.name || '', city: airport.city || ''});
  };
  flights.forEach(flight => {
    add(flight.departure);
    add(flight.arrival);
    add(flight.actualArrival);
  });
  return map;
}

function distanceNm(airports, from, to) {
  const a = airports.get(upper(from));
  const b = airports.get(upper(to));
  if (!a || !b) return 0;
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function loadAircraftCoefficient() {
  const sandbox = {window: {}};
  vm.runInNewContext(fs.readFileSync(path.join(OUTPUT_ROOT, 'aircraft-difficulty-coefficients.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(OUTPUT_ROOT, 'pilot-pay-policy.js'), 'utf8'), sandbox);
  return (icao, flightType) => {
    const fn = sandbox.window?.UCAAPilotPay?.aircraftCoefficient;
    return Number(fn ? fn(icao, flightType) : 1) || 1;
  };
}

function isCargoAircraft(aircraft = {}, matching = {}) {
  const text = `${aircraft.purpose || ''} ${aircraft.name || ''} ${matching.name || ''} ${aircraft.airframeIdent || ''}`.toLowerCase();
  return /cargo|freighter|bcf|\bf\b/.test(text);
}

function aircraftKeyData(fleetData, matchingData) {
  const byId = new Map();
  const byReg = new Map();
  array(fleetData.aircraft).forEach(aircraft => {
    const id = cleanId(aircraft.id || aircraft._id);
    const reg = upper(aircraft.registration);
    if (id) byId.set(id, aircraft);
    if (reg) byReg.set(reg, aircraft);
  });
  array(matchingData.liveries || matchingData).forEach(match => {
    const id = cleanId(match._id || match.aircraftId || match.id);
    const reg = upper(match.registration);
    const fleet = (id && byId.get(id)) || (reg && byReg.get(reg)) || {};
    const merged = {...fleet, ...match, id: id || cleanId(fleet.id), registration: reg || upper(fleet.registration)};
    if (merged.id) byId.set(merged.id, merged);
    if (merged.registration) byReg.set(merged.registration, merged);
  });
  return {byId, byReg};
}

function baseIcaosForAircraft(aircraft = {}) {
  const bases = new Set(array(aircraft.basesFromName).map(upper).filter(Boolean));
  const match = String(aircraft.name || '').match(/based in\s+([A-Z0-9 ]+)/i);
  if (match) match[1].split(/\s+/).map(upper).filter(code => /^[A-Z0-9]{4}$/.test(code)).forEach(code => bases.add(code));
  const loc = upper(aircraft.locationIcao);
  if (!bases.size && loc) bases.add(loc);
  return [...bases];
}

function scheduleRoutesForAircraft(db, aircraft = {}) {
  const id = cleanId(aircraft.id || aircraft._id);
  const reg = upper(aircraft.registration);
  const code = upper(aircraft.airframeIdent || aircraft.airframeType || aircraft.icao);
  return array(db.scheduleAssignments)
    .filter(route => route?.active !== false)
    .filter(route => {
      const ids = new Set(array(route.assignedAircraftIds).map(cleanId).filter(Boolean));
      const regs = new Set(array(route.assignedRegistrations).map(upper).filter(Boolean));
      const airframes = new Set(array(route.airframes).map(upper).filter(Boolean));
      return (id && ids.has(id)) || (reg && regs.has(reg)) || (!ids.size && !regs.size && code && airframes.has(code));
    })
    .map(route => ({...route, dep: upper(route.dep), arr: upper(route.arr), number: String(route.number || '').trim()}))
    .filter(route => route.dep && route.arr);
}

function parseDemandFile(file) {
  const byOrigin = new Map();
  const byInbound = new Map();
  if (!fs.existsSync(file)) return {byOrigin, byInbound};
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^(out|in)\s+(pax|cargo)\s+([A-Z0-9]{4}|NONE)-([A-Z0-9]{4}|NONE)\b.*?\((\d+)nm\)/i);
    if (!match) continue;
    const [, dir, mode, fromRaw, toRaw, distRaw] = match;
    const from = upper(fromRaw);
    const to = upper(toRaw);
    if (from === 'NONE' || to === 'NONE') continue;
    const item = {mode: mode.toLowerCase(), from, to, distanceNm: Number(distRaw) || 0, raw: line.trim()};
    if (dir.toLowerCase() === 'out') {
      if (!byOrigin.has(from)) byOrigin.set(from, []);
      byOrigin.get(from).push(item);
    } else {
      if (!byInbound.has(to)) byInbound.set(to, []);
      byInbound.get(to).push(item);
    }
  }
  return {byOrigin, byInbound};
}

function routeFits(airports, aircraft, from, to) {
  const maxRange = Number(aircraft.maxRange || aircraft.maxRangeNm || 0) || 0;
  if (!maxRange) return true;
  const dist = distanceNm(airports, from, to);
  return dist > 0 && dist <= maxRange;
}

function demandProposalFromOrigin(demand, current, aircraft, mode, airports) {
  const candidates = array(demand.byOrigin.get(upper(current)))
    .filter(item => item.mode === mode)
    .filter(item => routeFits(airports, aircraft, item.from, item.to));
  return candidates[0] ? {kind: 'free', reason: 'charter-demand', dep: candidates[0].from, arr: candidates[0].to} : null;
}

function inboundDemandProposal(demand, target, aircraft, mode, airports) {
  const candidates = array(demand.byInbound.get(upper(target)))
    .filter(item => item.mode === mode)
    .filter(item => routeFits(airports, aircraft, item.from, item.to));
  return candidates[0] ? {kind: 'free', reason: 'inbound-demand', dep: candidates[0].from, arr: candidates[0].to} : null;
}

function freeProposalWithRange(demand, airports, current, target, aircraft, mode, reason) {
  if (!current || !target || current === target) return null;
  if (routeFits(airports, aircraft, current, target)) return {kind: 'free', reason, dep: current, arr: target};
  return inboundDemandProposal(demand, target, aircraft, mode, airports);
}

function proposedRouteForAircraft({db, aircraft, airports, demand, now}) {
  if (!aircraft?.id) return null;
  const current = upper(aircraft.lastflightlocationICAO || aircraft.lastFlightLocationIcao || aircraft.locationIcao);
  const scheduleIcao = upper(aircraft.locationIcao);
  const mode = isCargoAircraft(aircraft, aircraft) ? 'cargo' : 'pax';
  const routes = scheduleRoutesForAircraft(db, aircraft).filter(route => routeRunsTodayOrTomorrow(route, now));
  const routeFromCurrent = routes.find(route => route.dep === current);
  if (routes.length && current === scheduleIcao && routeFromCurrent) {
    return {kind: 'schedule', reason: 'schedule', number: routeFromCurrent.number, dep: routeFromCurrent.dep, arr: routeFromCurrent.arr};
  }
  const routeFromSchedule = routes.find(route => route.dep === scheduleIcao);
  if (routes.length && routeFromSchedule && current !== scheduleIcao) {
    return freeProposalWithRange(demand, airports, current, scheduleIcao, aircraft, mode, 'schedule-positioning');
  }
  const bases = baseIcaosForAircraft(aircraft);
  if (bases.includes(current)) {
    const demandRoute = demandProposalFromOrigin(demand, current, aircraft, mode, airports);
    if (demandRoute) return demandRoute;
  }
  const targetBase = bases.find(base => base !== current) || bases[0] || scheduleIcao;
  return freeProposalWithRange(demand, airports, current, targetBase, aircraft, mode, 'base-return');
}

function premiumAmount(airports, coefficient, aircraft, dep, arr) {
  const dist = distanceNm(airports, dep, arr);
  const code = upper(aircraft.airframeIdent || aircraft.airframeType || aircraft.icao);
  const flightType = isCargoAircraft(aircraft, aircraft) ? 'cargo' : 'pax';
  return Math.round((100 + dist) * coefficient(code, flightType));
}

function liveAircraftIds(flight) {
  const ids = new Set();
  const scan = (value, depth = 0) => {
    if (!value || depth > 5) return;
    if (typeof value === 'string') {
      if (/^[0-9a-f]{20,}$/i.test(value.trim())) ids.add(value.trim());
      return;
    }
    if (Array.isArray(value)) return value.forEach(item => scan(item, depth + 1));
    if (typeof value !== 'object') return;
    ['id', '_id', 'aircraftId', 'aircraftID'].forEach(key => {
      if (value[key]) scan(value[key], depth + 1);
    });
    Object.entries(value).forEach(([key, child]) => {
      if (/aircraft|livery|fleet/i.test(key)) scan(child, depth + 1);
    });
  };
  scan(flight.aircraft);
  scan(flight.aircraftId);
  scan(flight.aircraftID);
  return [...ids];
}

function normalizeLiveFlight(raw) {
  const dep = upper(pick(raw, ['dep.icao', 'departure.icao', 'dep', 'departure']));
  const arr = upper(pick(raw, ['arr.icao', 'arrival.icao', 'arr', 'arrival']));
  return {
    id: cleanId(raw._id || raw.id),
    pilotId: cleanId(pick(raw, ['pilot.id', 'pilot._id', 'pilotId', 'pilotID'])),
    flightNumber: String(raw.flightNumber || raw.number || raw.callsign || '').trim(),
    depIcao: dep,
    arrIcao: arr,
    aircraftIds: liveAircraftIds(raw),
    airlineIcao: upper(pick(raw, ['airline.icao', 'airlineIcao'])) || 'UKL',
    airborne: Boolean(raw.depTimeAct || raw.takeoffTimeAct || raw.takeoff || raw.status === 'enroute' || raw.status === 'ENROUTE')
  };
}

async function loadLiveFlights() {
  const liveFile = argValue('--live-json');
  if (liveFile) {
    const raw = readJson(path.resolve(liveFile), []);
    const list = Array.isArray(raw) ? raw : array(raw.results || raw.flights);
    return list.map(normalizeLiveFlight).filter(item => item.id);
  }
  if (args.has('--skip-live')) return [];
  const token = process.env.NEWSKY_AIRLINE_TOKEN || DEFAULT_TOKEN;
  const response = await fetch(LIVE_URL, {headers: {Authorization: `Bearer ${token}`}});
  if (!response.ok) throw new Error(`Live API failed: ${response.status} ${response.statusText}`);
  const raw = await response.json();
  const list = Array.isArray(raw) ? raw : array(raw.results || raw.flights);
  return list.map(normalizeLiveFlight)
    .filter(item => item.id && item.airborne && item.airlineIcao === 'UKL');
}

function completedMap(flights) {
  const map = new Map();
  flights.forEach(flight => {
    const id = cleanId(flight.id || flight._id);
    if (id) map.set(id, flight);
  });
  return map;
}

function recordFromLive(live, aircraft, proposal, amount) {
  return {
    amount,
    pilotId: live.pilotId,
    aircraftId: cleanId(aircraft.id || aircraft._id),
    depIcao: live.depIcao,
    arrIcao: live.arrIcao,
    flightNumber: live.flightNumber,
    route: `${live.depIcao}-${live.arrIcao}`,
    state: 'LIVE',
    status: 'matched',
    proposalType: proposal.kind,
    proposalReason: proposal.reason,
    updatedAt: new Date().toISOString()
  };
}

async function main() {
  const now = new Date();
  const matching = readJson(path.join(COMPANY_DIR, 'livery-matching.json'), {liveries: []});
  const db = readJson(path.join(COMPANY_DIR, 'ucaa-livery-database.json'), {aircraft: [], scheduleAssignments: []});
  const bonuses = readJson(BONUS_FILE, {version: 1, flights: {}});
  const completedFlights = loadCompletedFlights();
  const completedById = completedMap(completedFlights);
  if (args.has('--debug-completed')) {
    console.error(JSON.stringify({
      completedFlights: completedFlights.length,
      hasTestUrfkr: completedById.has('test-live-match-urfkr'),
      testUrfkr: completedById.get('test-live-match-urfkr') || null
    }, null, 2));
  }
  const airports = loadAirportLocations(completedFlights);
  const aircraftMaps = aircraftKeyData(db, matching);
  const coefficient = loadAircraftCoefficient();
  const demand = parseDemandFile(path.join(OUTPUT_ROOT, 'newsky-charter-results.txt'));

  const probeAircraftId = cleanId(argValue('--probe-aircraft'));
  if (probeAircraftId) {
    const aircraft = aircraftMaps.byId.get(probeAircraftId);
    const proposal = aircraft ? proposedRouteForAircraft({db, aircraft, airports, demand, now}) : null;
    const amount = proposal ? premiumAmount(airports, coefficient, aircraft, proposal.dep, proposal.arr) : 0;
    console.log(JSON.stringify({
      aircraftId: probeAircraftId,
      registration: aircraft?.registration || '',
      name: aircraft?.name || '',
      currentIcao: upper(aircraft?.lastflightlocationICAO || aircraft?.lastFlightLocationIcao || aircraft?.locationIcao),
      scheduleIcao: upper(aircraft?.locationIcao),
      proposal,
      amount
    }, null, 2));
    return;
  }

  const liveFlights = await loadLiveFlights();
  const liveById = new Map(liveFlights.map(flight => [flight.id, flight]));
  if (args.has('--debug-live')) {
    console.error(JSON.stringify({liveFlights}, null, 2));
  }

  const next = {version: Number(bonuses.version) || 1, updatedAt: bonuses.updatedAt || '', flights: {}};

  Object.entries(bonuses.flights || {}).forEach(([id, record]) => {
    const state = String(record?.state || '').toUpperCase();
    if (state === 'DONE') {
      next.flights[id] = record;
      return;
    }
    if (completedById.has(id)) {
      if (Number(record?.amount) > 0) next.flights[id] = {...record, state: 'DONE', status: 'earned', updatedAt: now.toISOString()};
      return;
    }
    if (state === 'LIVE' && Number(record?.amount) > 0 && !liveById.has(id)) {
      next.flights[id] = {...record, state: 'LIVE', status: 'pending-completion-check', updatedAt: now.toISOString()};
    }
  });

  for (const live of liveFlights) {
    for (const aircraftId of live.aircraftIds) {
      const aircraft = aircraftMaps.byId.get(aircraftId);
      if (!aircraft) continue;
      const proposal = proposedRouteForAircraft({db, aircraft, airports, demand, now});
      if (args.has('--debug-live')) {
        console.error(JSON.stringify({liveId: live.id, aircraftId, depIcao: live.depIcao, arrIcao: live.arrIcao, proposal}, null, 2));
      }
      if (!proposal) continue;
      if (proposal.dep !== live.depIcao || proposal.arr !== live.arrIcao) continue;
      const amount = premiumAmount(airports, coefficient, aircraft, proposal.dep, proposal.arr);
      if (amount <= 0) continue;
      next.flights[live.id] = recordFromLive(live, aircraft, proposal, amount);
      break;
    }
  }

  if (args.has('--dry-run')) {
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  if (sameFlights(bonuses.flights || {}, next.flights)) {
    console.log(`no changes for ${path.relative(process.cwd(), BONUS_FILE)}: ${Object.keys(next.flights).length} records`);
    return;
  }
  next.updatedAt = now.toISOString();
  writeJson(BONUS_FILE, next);
  console.log(`updated ${path.relative(process.cwd(), BONUS_FILE)}: ${Object.keys(next.flights).length} records`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
