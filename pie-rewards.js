(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UCAAPieRewards = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RULE_VERSION = 1;
  const REWARDS = Object.freeze({1: 3, 2: 2, 3: 1});
  const text = value => String(value || '').trim();
  const upper = value => text(value).toUpperCase();
  const time = value => value ? new Date(value).getTime() : NaN;
  const flightNumber = value => upper(value).replace(/^UKL\s*/, '').replace(/\s+/g, '').replace(/^0+(?=\d)/, '');

  function rewardForRank(rank) {
    const value = Number(rank);
    return Number.isInteger(value) ? (REWARDS[value] || 0) : 0;
  }

  function snapshotMatchesFlight(record, flight) {
    const claim = record?.pieClaim || record;
    const started = time(flight?.times?.actualDeparture || flight?.times?.takeoff);
    const completed = time(flight?.times?.closed || flight?.times?.actualArrival);
    const generated = time(record?.piePoolGeneratedAt);
    const activeUntil = time(record?.piePoolActiveUntil);
    const claimableUntil = time(record?.piePoolClaimableUntil);
    if (![started, completed, generated, activeUntil, claimableUntil].every(Number.isFinite)) return false;
    if (started < generated || started > activeUntil || completed < started || completed > claimableUntil) return false;
    if (!text(record.piePoolKey)) return false;
    if (!text(record.pilotId) || text(record.pilotId) !== text(flight?.pilot?.id)) return false;
    if (!text(claim.aircraftId) || text(claim.aircraftId) !== text(flight?.aircraft?.id)) return false;
    if (!upper(claim.depIcao) || upper(claim.depIcao) !== upper(flight?.departure?.icao)) return false;
    if (!upper(claim.arrIcao) || upper(claim.arrIcao) !== upper(flight?.actualArrival?.icao || flight?.arrival?.icao)) return false;
    const operation = text(claim.proposalType).toLowerCase();
    if (operation === 'free') return flight?.operations?.free === true;
    if (operation === 'schedule') {
      return flight?.operations?.scheduled === true
        && Boolean(flightNumber(claim.flightNumber))
        && flightNumber(claim.flightNumber) === flightNumber(flight.flightNumber);
    }
    if (operation === 'charter') return flight?.operations?.charter === true;
    return false;
  }

  function syncLedger(ledger, bonusRecords, completedFlights, now = new Date()) {
    if (ledger?.version !== 1 || ledger?.ruleVersion !== RULE_VERSION || !ledger.entries || Array.isArray(ledger.entries) || typeof ledger.entries !== 'object') {
      throw new Error('Unsupported or invalid pies ledger');
    }
    const nowMs = time(now);
    if (!Number.isFinite(nowMs)) throw new Error('Invalid pies ledger update time');
    const activatedAt = ledger.activatedAt || new Date(nowMs).toISOString();
    const activation = time(activatedAt);
    if (!Number.isFinite(activation)) throw new Error('Invalid pies ledger activation time');
    const entries = {...ledger.entries};
    const creditedFlights = new Set(Object.values(entries).filter(entry => entry?.kind === 'earn').map(entry => text(entry.flightId)));
    const flights = new Map((completedFlights || []).map(flight => [text(flight.id), flight]));
    let changed = !ledger.activatedAt;
    for (const [id, record] of Object.entries(bonusRecords || {})) {
      const flightId = text(id);
      const entryId = `hot:${flightId}`;
      if (!flightId || Object.prototype.hasOwnProperty.call(entries, entryId) || creditedFlights.has(flightId)) continue;
      const flight = flights.get(flightId);
      if (!flight || flight.status !== 'completed' || record?.state !== 'DONE' || record?.status !== 'earned') continue;
      if (record.pie !== true || record.pieType !== 'hot') continue;
      const amount = rewardForRank(record.pieRank);
      if (!amount || !snapshotMatchesFlight(record, flight)) continue;
      const started = time(flight.times?.actualDeparture || flight.times?.takeoff);
      const completed = time(flight.times?.closed || flight.times?.actualArrival);
      if (started < activation || completed > nowMs) continue;
      entries[entryId] = {
        id: entryId,
        kind: 'earn',
        ruleVersion: RULE_VERSION,
        pilotId: text(record.pilotId),
        flightId,
        category: 'hot',
        rank: Number(record.pieRank),
        delta: amount,
        poolId: record.piePoolId || null,
        poolKey: record.piePoolKey,
        poolGeneratedAt: record.piePoolGeneratedAt,
        startedAt: new Date(started).toISOString(),
        completedAt: new Date(completed).toISOString(),
        awardedAt: new Date(nowMs).toISOString()
      };
      creditedFlights.add(flightId);
      changed = true;
    }
    return changed ? {...ledger, activatedAt, updatedAt: new Date(nowMs).toISOString(), entries} : ledger;
  }

  function balanceForPilot(ledger, pilotId) {
    const id = text(pilotId);
    if (!id || !ledger?.entries) return 0;
    const seen = new Set();
    let balance = 0;
    for (const entry of Object.values(ledger.entries)) {
      if (!entry || text(entry.pilotId) !== id || !text(entry.id) || seen.has(entry.id)) continue;
      const delta = Number(entry.delta);
      if (!Number.isSafeInteger(delta)) continue;
      seen.add(entry.id);
      balance += delta;
    }
    return balance;
  }

  return Object.freeze({RULE_VERSION, REWARDS, rewardForRank, snapshotMatchesFlight, syncLedger, balanceForPilot});
});
