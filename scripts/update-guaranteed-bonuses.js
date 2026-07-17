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
const LIVE_DETAIL_URL = 'https://newsky.app/api/airline-api/flight/';
const DEFAULT_TOKEN = 'UKR_uSTNynarbU8B8A61nvDLqmSl7Ji8xK';

const args = new Set(process.argv.slice(2));
const argValue = name => {
  const prefix = `${name}=`;
  const items = process.argv.slice(2);
  const found = items.find(item => item.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const index = items.indexOf(name);
  return index >= 0 && items[index + 1] && !String(items[index + 1]).startsWith('--') ? items[index + 1] : '';
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function routeRunsToday(route, now = new Date()) {
  const days = new Set(array(route?.days).map(day => String(day).trim().toLowerCase()));
  if (!days.size) return true;
  return days.has(dayKey(now));
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
  const byId = new Map();
  const addFlight = flight => {
    if (!flight?.id) return;
    byId.set(String(flight.id), flight);
  };
  const archive = readJson(path.join(FLIGHTS_DIR, 'archive.json'), {flights: []});
  array(archive.flights).forEach(addFlight);

  const manifest = readJson(path.join(FLIGHTS_DIR, 'manifest.json'), {});
  const year = Number(manifest.year) || new Date().getUTCFullYear();
  const nowWeek = currentIsoWeek();
  const liveWeek = nowWeek.year === year ? nowWeek.week : Number(manifest.liveWeek || manifest.archiveThroughWeek + 1);
  const firstWeek = Number(manifest.archiveThroughWeek || archive.throughWeek || 0) + 1;
  for (let week = firstWeek; week <= liveWeek; week += 1) {
    const weekFile = path.join(FLIGHTS_DIR, `${year}-W${String(week).padStart(2, '0')}.json`);
    if (!fs.existsSync(weekFile)) continue;
    const raw = readJson(weekFile, []);
    const pilots = Array.isArray(raw) ? raw : array(raw.results || raw.pilots);
    pilots.forEach(pilot => {
      array(pilot.flights || pilot.reports).forEach(item => {
        const normalized = normalizeCompletedRawFlight(item, pilot, week);
        addFlight(normalized);
      });
    });
  }
  return [...byId.values()];
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
  const ad = readJson(path.join(OUTPUT_ROOT, 'ADcoordinates.json'), {});
  Object.entries(ad || {}).forEach(([icao, item]) => {
    const code = upper(icao);
    const lat = Number(item?.lat);
    const lon = Number(item?.lon);
    if (code && Number.isFinite(lat) && Number.isFinite(lon) && !map.has(code)) {
      map.set(code, {icao: code, lat, lon, name: item.name || code, city: item.city || ''});
    }
  });
  return map;
}

function currentIsoWeek(date = new Date()) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const year = value.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return {year, week};
}

function completedFlightTimestamp(flight) {
  return new Date(
    flight?.times?.closed
    || flight?.times?.actualArrival
    || flight?.times?.takeoff
    || flight?.times?.actualDeparture
    || flight?.times?.scheduledDeparture
    || 0
  ).getTime() || 0;
}

function applyLatestCompletedLocations(flights, aircraftMaps) {
  const latest = new Map();
  flights.forEach(flight => {
    if (flight?.status && flight.status !== 'completed') return;
    const aircraftId = cleanId(flight?.aircraft?.id || flight?.aircraft?._id || flight?.aircraftId);
    const arrival = upper(flight?.actualArrival?.icao || flight?.arrival?.icao);
    if (!aircraftId || !arrival) return;
    const timestamp = completedFlightTimestamp(flight);
    const previous = latest.get(aircraftId);
    if (!previous || timestamp >= previous.timestamp) latest.set(aircraftId, {arrival, timestamp});
  });
  latest.forEach((item, aircraftId) => {
    const aircraft = aircraftMaps.byId.get(aircraftId);
    if (!aircraft) return;
    aircraft.lastflightlocationICAO = item.arrival;
    aircraft.lastFlightLocationIcao = item.arrival;
  });
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

function scheduleRotationStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function scheduleRotationHash(value) {
  let hash = 0;
  String(value || '').split('').forEach(char => {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  });
  return hash;
}

function completedFlightMatchesAircraft(flight, aircraft = {}) {
  const aircraftId = cleanId(aircraft.id || aircraft._id);
  const registration = upper(aircraft.registration);
  const flightAircraftId = cleanId(flight?.aircraft?.id || flight?.aircraft?._id || flight?.aircraftId);
  if (aircraftId && flightAircraftId === aircraftId) return true;
  if (!registration) return false;
  const text = upper(`${flight?.aircraft?.name || ''} ${flight?.aircraft?.customName || ''}`);
  return text.includes(registration);
}

function completedFlightEndTime(flight) {
  const value = flight?.times?.closed || flight?.times?.actualArrival || flight?.times?.scheduledArrival || flight?.updatedAt || flight?.createdAt;
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function scheduleRouteUsage(route, aircraft, completedFlights, since) {
  const number = String(route?.number || '').trim();
  if (!number) return 0;
  return array(completedFlights).filter(flight => {
    if (String(flight?.flightNumber || '').trim() !== number) return false;
    if (since && completedFlightEndTime(flight) < since) return false;
    return completedFlightMatchesAircraft(flight, aircraft);
  }).length;
}

function pickScheduleRoute(routes, aircraft, completedFlights, now = new Date()) {
  const pool = array(routes)
    .filter(Boolean)
    .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0) || String(a.number || '').localeCompare(String(b.number || '')));
  if (pool.length <= 1) return pool[0] || null;
  const since = scheduleRotationStart(now);
  const scored = pool.map(route => ({route, usage: scheduleRouteUsage(route, aircraft, completedFlights, since)}));
  const minUsage = Math.min(...scored.map(item => item.usage));
  const tied = scored.filter(item => item.usage === minUsage).map(item => item.route);
  if (tied.length <= 1) return tied[0] || null;
  const seed = now.getUTCDate() + scheduleRotationHash(aircraft.registration || aircraft.id || aircraft._id || '');
  return tied[seed % tied.length] || tied[0] || null;
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

function proposedRouteForAircraft({db, aircraft, airports, demand, now, completedFlights = []}) {
  if (!aircraft?.id) return null;
  const current = upper(aircraft.lastflightlocationICAO || aircraft.lastFlightLocationIcao || aircraft.locationIcao);
  const scheduleIcao = upper(aircraft.locationIcao);
  const mode = isCargoAircraft(aircraft, aircraft) ? 'cargo' : 'pax';
  const activeRoutes = scheduleRoutesForAircraft(db, aircraft).filter(route => route?.active !== false);
  const todayRoutes = activeRoutes.filter(route => routeRunsToday(route, now));
  const routeFromCurrent = pickScheduleRoute(todayRoutes.filter(route => route.dep === current), aircraft, completedFlights, now);
  if (todayRoutes.length && current === scheduleIcao && routeFromCurrent) {
    return {kind: 'schedule', reason: 'schedule', number: routeFromCurrent.number, dep: routeFromCurrent.dep, arr: routeFromCurrent.arr};
  }
  const routeFromScheduleToday = pickScheduleRoute(todayRoutes.filter(route => route.dep === scheduleIcao), aircraft, completedFlights, now);
  if (activeRoutes.length && scheduleIcao && current !== scheduleIcao) {
    return freeProposalWithRange(
      demand,
      airports,
      current,
      scheduleIcao,
      aircraft,
      mode,
      routeFromScheduleToday ? 'schedule-positioning' : 'maintenance-positioning'
    );
  }
  if (activeRoutes.length && current === scheduleIcao) {
    const demandRoute = demandProposalFromOrigin(demand, current, aircraft, mode, airports);
    if (demandRoute) return demandRoute;
    return null;
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
  const scheduleRaw = raw.schedule ?? raw.isSchedule ?? raw.operation?.schedule ?? raw.operations?.scheduled;
  const freeRaw = raw.free ?? raw.isFree ?? raw.operation?.free;
  const charterRaw = raw.charter ?? raw.isCharter ?? raw.operation?.charter ?? raw.operations?.charter;
  const typeText = String(raw.type || raw.flightType || raw.operation?.type || raw.category || '').trim().toLowerCase();
  const isSchedule = scheduleRaw === true || typeText === 'schedule' || typeText === 'scheduled';
  const isCharter = charterRaw === true || typeText === 'charter';
  const isFree = freeRaw === true || typeText === 'free' || (!isSchedule && !isCharter);
  return {
    id: cleanId(raw._id || raw.id),
    pilotId: cleanId(pick(raw, ['pilot.id', 'pilot._id', 'pilotId', 'pilotID'])),
    flightNumber: String(raw.flightNumber || raw.number || raw.callsign || '').trim(),
    depIcao: dep,
    arrIcao: arr,
    aircraftIds: liveAircraftIds(raw),
    airlineIcao: upper(pick(raw, ['airline.icao', 'airlineIcao'])) || 'UKL',
    schedule: isSchedule,
    free: isFree,
    charter: isCharter,
    airborne: Boolean(raw.depTimeAct || raw.takeoffTimeAct || raw.takeoff || raw.status === 'enroute' || raw.status === 'ENROUTE')
  };
}

function liveMatchesProposalOperation(live, proposal) {
  const kind = String(proposal?.kind || '').toLowerCase();
  if (kind === 'schedule') {
    const proposalNumber = String(proposal?.number || proposal?.label || '').trim();
    const liveNumber = String(live.flightNumber || '').trim();
    return live.schedule === true && (!proposalNumber || proposalNumber === liveNumber);
  }
  if (kind === 'free') return live.free === true;
  return true;
}

function mergeLiveFlightDetail(raw, detail) {
  const source = detail?.flight || detail || {};
  if (!source || typeof source !== 'object') return raw;
  const sourceAircraft = source.aircraft;
  if (!sourceAircraft || typeof sourceAircraft !== 'object') return raw;
  return {
    ...raw,
    aircraft: {
      ...(raw?.aircraft && typeof raw.aircraft === 'object' ? raw.aircraft : {}),
      ...sourceAircraft,
      airframe: {
        ...(raw?.aircraft?.airframe || {}),
        ...(sourceAircraft.airframe || {})
      }
    },
    aircraftId: sourceAircraft._id || sourceAircraft.id || source.aircraftId || raw?.aircraftId || ''
  };
}

async function loadLiveFlightDetail(raw, token) {
  const id = cleanId(raw?._id || raw?.id);
  if (!id) return raw;
  const response = await fetch(`${LIVE_DETAIL_URL}${encodeURIComponent(id)}`, {headers: {Authorization: `Bearer ${token}`}});
  if (!response.ok) {
    console.warn(`Live flight detail skipped ${id}: ${response.status} ${response.statusText}`);
    return raw;
  }
  return mergeLiveFlightDetail(raw, await response.json());
}

async function loadLiveFlightDetailsLimited(list, token) {
  const result = [];
  const batchSize = 5;
  for (let index = 0; index < list.length; index += batchSize) {
    const batch = list.slice(index, index + batchSize);
    result.push(...await Promise.all(batch.map(item => loadLiveFlightDetail(item, token))));
    if (index + batchSize < list.length) await sleep(10500);
  }
  return result;
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
  const filtered = list.filter(item => {
    const live = normalizeLiveFlight(item);
    return live.id && live.airborne && live.airlineIcao === 'UKL';
  });
  const detailed = await loadLiveFlightDetailsLimited(filtered, token);
  return detailed.map(normalizeLiveFlight)
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
  applyLatestCompletedLocations(completedFlights, aircraftMaps);
  const coefficient = loadAircraftCoefficient();
  const demand = parseDemandFile(path.join(OUTPUT_ROOT, 'newsky-charter-results.txt'));

  const probeAircraftId = cleanId(argValue('--probe-aircraft'));
  if (probeAircraftId) {
    const aircraft = aircraftMaps.byId.get(probeAircraftId);
    const proposal = aircraft ? proposedRouteForAircraft({db, aircraft, airports, demand, now, completedFlights}) : null;
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
      const proposal = proposedRouteForAircraft({db, aircraft, airports, demand, now, completedFlights});
      if (args.has('--debug-live')) {
        console.error(JSON.stringify({liveId: live.id, aircraftId, depIcao: live.depIcao, arrIcao: live.arrIcao, proposal}, null, 2));
      }
      if (!proposal) continue;
      if (proposal.dep !== live.depIcao || proposal.arr !== live.arrIcao) continue;
      if (!liveMatchesProposalOperation(live, proposal)) continue;
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
