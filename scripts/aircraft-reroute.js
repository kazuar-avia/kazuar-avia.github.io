'use strict';

// The bot pins one completed flight as the aircraft's effective last flight.
// A newer completed flight restores automatic location tracking.
function applyAircraftReroutes(latest, aircraftMaps, data) {
  const entries = data?.aircraft;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return;
  for (const [aircraftId, entry] of Object.entries(entries)) {
    if (!/^[a-f0-9]{24}$/i.test(aircraftId)) continue;
    const airport = String(entry?.icao || '').trim().toUpperCase();
    const updatedAt = Date.parse(entry?.updatedAt || '');
    if (!/^[A-Z0-9]{4}$/.test(airport) || !Number.isFinite(updatedAt)) continue;
    const recorded = latest.get(aircraftId);
    if (recorded && Number.isFinite(recorded.timestamp) && recorded.timestamp > updatedAt) continue;
    const aircraft = aircraftMaps?.byId?.get(aircraftId);
    if (!aircraft) continue;
    aircraft.lastflightlocationICAO = airport;
    aircraft.lastFlightLocationIcao = airport;
  }
}

module.exports = {applyAircraftReroutes};
