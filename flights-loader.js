(function () {
  const START_WEEK = 2;
  const MAX_WEEK = 53;
  const YEAR = 2026;

  const padWeek = week => String(week).padStart(2, '0');
  const fileUrl = week => `FLIGHTS/${YEAR}-W${padWeek(week)}.json`;

  function routeType(dep, arr) {
    const depUA = String(dep || '').startsWith('UK');
    const arrUA = String(arr || '').startsWith('UK');
    if (depUA && arrUA) return 'UA-UA';
    if (depUA !== arrUA) return 'UA-INT';
    return 'INT-INT';
  }

  function touchdownWeather(flight) {
    const violations = Array.isArray(flight.result?.violations) ? flight.result.violations : [];
    const hasWeather = violation => {
      const value = violation?.entry?.payload?.weather;
      return value && Number.isFinite(Number(value.windDir)) && Number.isFinite(Number(value.windSpd));
    };
    const landingViolation = violations.find(violation => hasWeather(violation) && (
      violation?.entry?.payload?.touchDown || /touchdown|landing/i.test(String(violation?.title || ''))
    ));
    const weather = (landingViolation || violations.find(hasWeather))?.entry?.payload?.weather;
    if (!weather) return null;
    return {
      windDir: Number(weather.windDir),
      windSpd: Number(weather.windSpd),
      crosswind: Number.isFinite(Number(weather.windX)) ? Math.abs(Number(weather.windX)) : null
    };
  }

  function normalizeFlight(flight, pilot, week) {
    const totals = flight.result?.totals || {};
    const durationMinutes = Number(flight.durationAct) || 0;
    const completed = durationMinutes > 0 && Boolean(flight.arrTimeAct || flight.close);
    const dep = flight.dep || {};
    const arr = flight.arr || {};
    return {
      id: String(flight._id || `${week}-${pilot.pilot_id}-${flight.flightNumber}-${flight.depTime}`),
      sourceWeek: week,
      status: completed ? 'completed' : 'failed',
      pilot: {
        id: String(pilot.pilot_id),
        name: String(pilot.fullname || 'Pilot'),
        avatar: pilot.avatar || null
      },
      flightNumber: String(flight.flightNumber || ''),
      flightType: String(flight.type || ''),
      aircraft: {
        id: flight.aircraft?._id || null,
        icao: String(flight.aircraft?.icao || ''),
        name: String(flight.aircraft?.name || flight.aircraft?.icao || 'Unknown aircraft'),
        fleetName: String(flight.aircraft?.name || '')
      },
      departure: {
        icao: String(dep.icao || ''),
        name: String(dep.name || ''),
        city: String(dep.city || '')
      },
      arrival: {
        icao: String(arr.icao || ''),
        name: String(arr.name || ''),
        city: String(arr.city || '')
      },
      actualArrival: flight.actArr ? {
        icao: String(flight.actArr.icao || ''),
        name: String(flight.actArr.name || ''),
        city: String(flight.actArr.city || '')
      } : null,
      routeType: routeType(dep.icao, arr.icao),
      times: {
        scheduledDeparture: flight.depTime || null,
        scheduledArrival: flight.arrTime || null,
        actualDeparture: flight.depTimeAct || null,
        takeoff: flight.takeoffTimeAct || null,
        actualArrival: flight.arrTimeAct || null,
        closed: flight.close || null,
        durationMinutes
      },
      rating: flight.rating == null ? null : Number(flight.rating),
      finance: {
        revenue: Number(totals.revenue) || 0,
        expenses: Number(totals.expenses) || 0,
        penalties: Number(totals.penalties) || 0,
        balance: Number(totals.balance) || 0,
        details: {
          tickets: Number(flight.result?.revenue?.tickets) || 0,
          cargo: Number(flight.result?.revenue?.cargo) || 0,
          fuel: Number(flight.result?.expenses?.fuel) || 0,
          aircraft: Number(flight.result?.expenses?.aircraft) || 0,
          handling: Number(flight.result?.expenses?.handling) || 0,
          landing: Number(flight.result?.expenses?.landing) || 0
        },
        pilotPay: null,
        payRuleVersion: null
      },
      operations: {
        distance: Number(totals.distance) || 0,
        fuel: Number(totals.fuel) || 0,
        passengers: Number(flight.payload?.pax) || 0,
        passengersByClass: flight.result?.totals?.payload?.paxByClass || null,
        cargo: Number(flight.payload?.cargo) || 0,
        cargoWeightKg: Number(flight.payload?.weights?.cargo) || 0,
        ticketPrice: Number(flight.result?.totals?.prices?.ticketPrice) || 0,
        cargoUnitPrice: Number(flight.result?.totals?.prices?.cargoUnitPrice) || 0,
        simulator: String(flight.simulator || ''),
        network: String(flight.network?.name || ''),
        emergency: Boolean(flight.emergency),
        free: Boolean(flight.free),
        scheduled: Boolean(flight.schedule),
        charter: Boolean(flight.charter),
        touchdownWeather: touchdownWeather(flight),
        violations: Array.isArray(flight.result?.violations) ? flight.result.violations : []
      }
    };
  }

  function normalizeWeek(data, week) {
    const flights = [];
    (Array.isArray(data) ? data : []).forEach(pilot => {
      (Array.isArray(pilot.flights) ? pilot.flights : []).forEach(flight => {
        flights.push(normalizeFlight(flight, pilot, week));
      });
    });
    return flights;
  }

  let loadPromise = null;
  let refreshTimer = null;

  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  async function fetchOptionalJson(url, options) {
    const response = await fetch(url, options);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
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

  async function loadBundle(onProgress) {
    onProgress?.('Завантаження переліку польотів…');
    const manifest = await fetchJson(`FLIGHTS/manifest.json?v=${Date.now()}`, {cache: 'no-store'});
    onProgress?.(`Завантаження архіву до W${manifest.archiveThroughWeek}…`);
    const archiveData = await fetchJson(`FLIGHTS/${manifest.archiveFile}?v=${encodeURIComponent(manifest.generatedAt)}`, {cache: 'default'});
    const year = Number(manifest.year) || YEAR;
    const nowWeek = currentIsoWeek();
    const liveWeek = nowWeek.year === year ? nowWeek.week : Number(manifest.liveWeek || manifest.archiveThroughWeek + 1);
    const baseArchiveFlights = Array.isArray(archiveData.flights) ? archiveData.flights : [];
    const knownArchiveWeeks = new Set(baseArchiveFlights.map(flight => Number(flight.sourceWeek)).filter(Number.isFinite));
    const supplementalArchiveFlights = [];

    for (let week = START_WEEK; week < liveWeek; week += 1) {
      if (knownArchiveWeeks.has(week)) continue;
      onProgress?.(`Перевірка відсутнього архівного W${padWeek(week)}…`);
      const weekData = await fetchOptionalJson(`FLIGHTS/${year}-W${padWeek(week)}.json?v=${Date.now()}`, {cache:'no-store'});
      if (!weekData) continue;
      supplementalArchiveFlights.push(...normalizeWeek(weekData, week));
      knownArchiveWeeks.add(week);
    }

    onProgress?.(`Перевірка live W${padWeek(liveWeek)}…`);
    const liveData = await fetchOptionalJson(`FLIGHTS/${year}-W${padWeek(liveWeek)}.json?v=${Date.now()}`, {cache:'no-store'});
    const archiveUnique = new Map();
    baseArchiveFlights.forEach(flight => archiveUnique.set(flight.id, flight));
    supplementalArchiveFlights.forEach(flight => archiveUnique.set(flight.id, flight));
    const archiveFlights = [...archiveUnique.values()];
    const currentFlights = normalizeWeek(liveData || [], liveWeek);
    const unique = new Map();
    archiveFlights.forEach(flight => unique.set(flight.id, flight));
    currentFlights.forEach(flight => unique.set(flight.id, flight));
    const flights = [...unique.values()];
    const latestPilotIdentity = new Map();
    flights.forEach(flight => {
      const pilotId = String(flight.pilot?.id || '');
      if (!pilotId) return;
      const timestamp = new Date(
        flight.times?.closed
        || flight.times?.actualArrival
        || flight.times?.takeoff
        || flight.times?.actualDeparture
        || flight.times?.scheduledDeparture
        || 0
      ).getTime();
      const known = latestPilotIdentity.get(pilotId);
      if (!known || timestamp > known.timestamp) {
        latestPilotIdentity.set(pilotId,{
          timestamp,
          name:flight.pilot?.name || known?.name || 'Pilot',
          avatar:flight.pilot?.avatar || known?.avatar || null
        });
      }
    });
    flights.forEach(flight => {
      const identity = latestPilotIdentity.get(String(flight.pilot?.id || ''));
      if (!identity) return;
      flight.pilot.name = identity.name;
      if (identity.avatar) flight.pilot.avatar = identity.avatar;
    });
    const latest = [...currentFlights].sort((a, b) => new Date(b.times.actualArrival || b.times.closed) - new Date(a.times.actualArrival || a.times.closed))[0] || null;

    return {
      archive: {flights: archiveFlights},
      current: {flights: currentFlights},
      flights,
      weeks: [...new Set([...archiveFlights.map(flight => Number(flight.sourceWeek)), liveWeek])].filter(Number.isFinite).sort((a,b) => a-b),
      currentWeek: liveWeek,
      latest
    };
  }

  function loadWeeklyFlights(onProgress) {
    if (!loadPromise) {
      loadPromise = loadBundle(onProgress).then(bundle => {
        if (!refreshTimer) {
          refreshTimer = setInterval(async () => {
            try {
              const updated = await loadBundle();
              loadPromise = Promise.resolve(updated);
              window.dispatchEvent(new CustomEvent('ucaa-flights-updated', {detail: updated}));
            } catch (error) {
              console.error('Не вдалося оновити live-файл', error);
            }
          }, 180000);
        }
        return bundle;
      });
    }
    return loadPromise;
  }

  window.UCAAFlightData = {loadWeeklyFlights};
})();
