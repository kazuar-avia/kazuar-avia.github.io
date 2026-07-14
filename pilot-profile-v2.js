(function () {
  const PERIODS = [
    ['today', 'За сьогодні (з 00:00 UTC)'],
    ['weekToDate', 'З початку тижня'],
    ['previousWeek', 'Минулий тиждень'],
    ['monthToDate', 'З початку місяця'],
    ['previousMonth', 'Минулий місяць'],
    ['sinceRestructure', 'з 01.05'],
    ['all', 'Весь період']
  ];
  const AIRCRAFT_COLORS = ['#4f7fd4','#54a85b','#f39a0a','#9a75c9','#37afb3','#d55353','#9a9a9a','#d5a52b'];
  const TYPE_META = {
    charter:{label:'Charter', color:'#f39a0a'},
    free:{label:'Free', color:'#8b8b8b'},
    schedule:{label:'Schedule', color:'#55ad55'}
  };
  const MONTH_AWARD_COLORS = [
    '#c8e6f5','#b9d8f0','#d2e9c7','#c5e2b3','#eadc94','#f2c987',
    '#f2b778','#eda36f','#e2c06f','#d8a862','#ccd9ea','#bfd8ee'
  ];
  const MONTH_AWARD_MONTHS = ['СІЧ','ЛЮТ','БЕР','КВІ','ТРА','ЧЕР','ЛИП','СЕР','ВЕР','ЖОВ','ЛИС','ГРУ'];
  let specialProfileAwards = [];
  let specialProfileAwardsPromise = null;
  function monthlyAwardPeriods() {
    const dates = availableFlights.map(dateOf).filter(date => date instanceof Date && !Number.isNaN(date.getTime()));
    if (!dates.length) return [];
    const first = new Date(Math.min(...dates.map(date => date.getTime())));
    const now = new Date();
    const lastCompletedMonth = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
    const cursor = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),1));
    const periods = [];
    while (cursor < lastCompletedMonth) {
      periods.push({year:cursor.getUTCFullYear(),month:cursor.getUTCMonth()});
      cursor.setUTCMonth(cursor.getUTCMonth()+1);
    }
    return periods;
  }
  // Редагований довідник сімейств для нагород: ICAO рейсу → ICAO, що пишеться на відзнаці.
  const AIRCRAFT_AWARD_FAMILIES = {
    A318:'A320',A319:'A320',A320:'A320',A321:'A320',
    A20N:'A20N',A21N:'A20N',
    B735:'B738',B736:'B738',B737:'B738',B738:'B738',B739:'B738',B738F:'B738',
    B38M:'B38M',
    E170:'ERJ',E175:'ERJ',E190:'ERJ',E195:'ERJ',
    CRJ5:'CRJ',CRJ7:'CRJ',CRJ9:'CRJ',CRJX:'CRJ',
    B752:'B757',B753:'B757',B752F:'B757',B753F:'B757',
    B762:'B767',B763:'B767',B764:'B767',B762F:'B767',B763F:'B767',B764F:'B767',
    B772:'B777',B773:'B777',B77W:'B777',B77L:'B777',B772F:'B777',B77LF:'B777',
    B788:'B787',B789:'B787',B78X:'B787',
    B742:'B747',B744:'B747',B748:'B747',B744F:'B747',B748F:'B747',
    A306:'A300',A310:'A300',A306F:'A300',A310F:'A300',
    A332:'A330',A333:'A330',A337:'A330',A338:'A330',A339:'A330',
    A342:'A340',A343:'A340',A345:'A340',A346:'A340',
    A359:'A350',A35K:'A350',A388:'A380',
    AT42:'ATR',AT43:'ATR',AT45:'ATR',AT46:'ATR',AT72:'ATR',AT75:'ATR',AT76:'ATR',
    DH8A:'DH8D',DH8B:'DH8D',DH8C:'DH8D',DH8D:'DH8D',
    F28:'F100',F70:'F100',F100:'F100',
    B461:'BAE',B462:'BAE',B463:'BAE',RJ1H:'BAE',B463F:'BAE',
    MD80:'MD80',MD82:'MD80',MD83:'MD80',MD88:'MD80',
    B722:'B727',B727:'B727',
    MD11:'MD11',MD11F:'MD11',
    L101:'L1011',
    A225:'A225'
  };
  const AIRCRAFT_AWARD_LEVELS = {
    1:'Допуск',
    2:'Бронза',
    3:'Срібло',
    4:'Золото'
  };
  const AIRCRAFT_AWARD_FAMILY_VARIANTS = {
    A320:['A318','A319','A320','A321'],
    A20N:['A20N','A21N'],
    B738:['B736','B737','B738','B739'],
    B38M:['B38M'],
    ERJ:['E170','E175','E190','E195'],
    CRJ:['CRJ5','CRJ7','CRJ9','CRJX'],
    B757:['B752','B753','B752F','B753F'],
    B767:['B762','B763','B764','B762F','B763F','B764F'],
    B777:['B772','B773','B77W','B77L','B772F','B77LF'],
    B787:['B788','B789','B78X'],
    B747:['B742','B744','B748','B744F','B748F'],
    A300:['A306','A310','A306F','A310F'],
    A330:['A332','A333','A337','A338','A339'],
    A380:['A388'],
    ATR:['AT42','AT43','AT45','AT46','AT72','AT75','AT76'],
    BAE:['B461','B462','B463','RJ1H','B463F'],
    MD80:['MD80','MD82','MD83','MD88'],
    L1011:['L101'],
    A225:['A225']
  };

  let availableFlights = [];
  let insuranceCoverage = new Map();
  let aircraftAwardStatsCache = null;
  let newskyAwardRequirements = null;
  let newskyAwardStatsCache = null;
  let newskyAwardRequirementsPromise = null;
  let companyFleetTypes = new Set();
  let companyFleetPromise = null;
  let profileFlightsSignature = '';
  let profileSummaryCache = new Map();
  let profileOverallCache = null;
  let monthlyAwardsCache = null;
  let referenceNow = new Date();
  let current = null;
  let profileCalendarOpen = false;
  let profileCalendarMode = 'date';
  let profileCalendarRangePickingEnd = false;
  let profileCalendarPickerValue = '';
  const isMobileProfileView = () => document.body.classList.contains('mobile-cabinet') || Boolean(window.matchMedia?.('(max-width: 940px)').matches || window.innerWidth <= 940);

  const esc = value => String(value ?? '').replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
  const sum = (items, fn) => items.reduce((total, item) => total + (Number(fn(item)) || 0), 0);
  const dateOf = flight => new Date(flight.times?.actualArrival || flight.times?.closed || flight.times?.takeoff || flight.times?.scheduledDeparture);
  const flightStartDateForDisplay = flight => new Date(flight.times?.actualDeparture || flight.times?.takeoff || flight.times?.scheduledDeparture || flight.times?.open || flight.times?.actualArrival || flight.times?.closed);
  const flightEndDateForDisplay = flight => new Date(flight.times?.closed || flight.times?.actualArrival || flight.times?.scheduledArrival || flight.times?.takeoff || flight.times?.scheduledDeparture);
  const utcDateParts = date => ({
    day: String(date.getUTCDate()).padStart(2, '0'),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    year: String(date.getUTCFullYear())
  });
  function formatFlightDateLabel(flight) {
    const start = flightStartDateForDisplay(flight);
    const end = flightEndDateForDisplay(flight);
    if (!Number.isFinite(end.getTime())) return dateOf(flight).toLocaleDateString('uk-UA',{timeZone:'UTC'});
    if (!Number.isFinite(start.getTime())) return end.toLocaleDateString('uk-UA',{timeZone:'UTC'});
    const s = utcDateParts(start);
    const e = utcDateParts(end);
    if (s.day === e.day && s.month === e.month && s.year === e.year) return `${e.day}.${e.month}.${e.year}`;
    if (s.month === e.month && s.year === e.year) return `${s.day}-${e.day}.${e.month}.${e.year}`;
    if (s.year === e.year) return `${s.day}.${s.month}-${e.day}.${e.month}.${e.year}`;
    return `${s.day}.${s.month}.${s.year}-${e.day}.${e.month}.${e.year}`;
  }
  function formatFlightCloseTime(flight) {
    const end = flightEndDateForDisplay(flight);
    const date = Number.isFinite(end.getTime()) ? end : dateOf(flight);
    return date.toLocaleTimeString('uk-UA',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});
  }
  const utcDayKey = date => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  function flightStreakForPilot(pilotId, flights = availableFlights, now = referenceNow || new Date()) {
    if (!pilotId || !Array.isArray(flights) || !flights.length) return 0;
    const pilotDays = new Set();
    flights.forEach(flight => {
      if (flight.status !== 'completed' || flight.pilot?.id !== pilotId) return;
      [flightStartDateForDisplay(flight), dateOf(flight)].forEach(date => {
        if (!Number.isFinite(date.getTime())) return;
        pilotDays.add(utcDayKey(date));
      });
    });
    const today = utcDayKey(now);
    const dayMs = 86400000;
    let streak = 0;
    for (let offset = 1; offset <= 9; offset += 1) {
      if (!pilotDays.has(today - offset * dayMs)) break;
      streak += 1;
    }
    if (!streak) return 0;
    if (pilotDays.has(today)) streak += 1;
    return Math.min(9, streak);
  }
  function liveRegularityStreakForPilot(pilotId, flights = availableFlights, now = referenceNow || new Date()) {
    const streak = flightStreakForPilot(pilotId, flights, now);
    if (streak) return streak;
    if (!pilotId || !Array.isArray(flights) || !flights.length) return 0;
    const today = utcDayKey(now);
    const flewToday = flights.some(flight => {
      if (flight.status !== 'completed' || flight.pilot?.id !== pilotId) return false;
      return [flightStartDateForDisplay(flight), dateOf(flight)]
        .some(date => Number.isFinite(date.getTime()) && utcDayKey(date) === today);
    });
    return flewToday ? 1 : 0;
  }
  function flightStreakBadge(pilotId, flights = availableFlights, now = referenceNow || new Date()) {
    const streak = flightStreakForPilot(pilotId, flights, now);
    if (!streak) return '';
    const maxed = streak >= 5;
    const hot = streak >= 3 && streak < 5;
    const label = maxed ? 'Літає 5+ днів підряд' : `Літає ${streak} ${streak === 1 ? 'день' : 'дні/днів'} підряд`;
    return `<span class="flight-streak-badge ${maxed ? 'flight-streak-max' : hot ? 'flight-streak-hot' : ''}" title="${esc(label)}">🔥${streak > 1 && !maxed ? `<span class="flight-streak-count">${streak}</span>` : ''}</span>`;
  }
  const pilotNameWithStreak = pilot => {
    const name = String(pilot?.name || 'Пілот').trim();
    const badge = flightStreakBadge(pilot?.id);
    if (!badge) return esc(name);
    const parts = name.split(/\s+/);
    const last = parts.pop() || name;
    const head = parts.join(' ');
    return `${head ? `${esc(head)} ` : ''}<span class="pilot-name-tail">${esc(last)}${badge}</span>`;
  };
  const pilotAvatarUrl = value => {
    const hash = String(value || 'default').trim();
    return `https://newsky.app/api/pilot/avatar/${encodeURIComponent(hash && hash !== 'null' ? hash : 'default')}`;
  };
  const money = (value, signed = false) => {
    const amount = Math.round(Number(value) || 0);
    return `${amount < 0 ? '−' : signed && amount > 0 ? '+' : ''}$${Math.abs(amount).toLocaleString('uk-UA')}`;
  };
  const compactMoney = value => {
    const amount = Math.abs(Number(value) || 0);
    if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
    if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
    return `$${Math.round(amount).toLocaleString('uk-UA')}`;
  };
  const formatMinutes = value => {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    if (minutes < 60) return `${minutes} хв`;
    return `${Math.floor(minutes / 60)} год ${String(minutes % 60).padStart(2, '0')} хв`;
  };
  const compactTime = value => {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  };
  const formatDateShort = isoDate => {
    if (!isoDate) return '';
    const date = new Date(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('uk-UA',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'2-digit'});
  };
  const flightWord = count => {
    const n = Math.abs(count) % 100;
    const last = n % 10;
    return n > 10 && n < 20 ? 'рейсів' : last === 1 ? 'рейс' : last >= 2 && last <= 4 ? 'рейси' : 'рейсів';
  };
  const dayWord = count => {
    const n = Math.abs(count) % 100;
    const last = n % 10;
    return n > 10 && n < 20 ? 'днів' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дні' : 'днів';
  };
  const profileMembershipDays = firstFlight => {
    if (!firstFlight) return null;
    const start = dateOf(firstFlight);
    if (!Number.isFinite(start.getTime())) return null;
    const today = new Date();
    const startDay = Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),start.getUTCDate());
    const todayDay = Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate());
    return Math.max(1,Math.floor((todayDay - startDay) / 86400000) + 1);
  };
  const aircraftRegistrationFromName = value => String(value || '').match(/\bUR-[A-Z0-9]+\b/i)?.[0]?.toUpperCase() || '';
  const profileLiveryMatchingRecordByAircraftId = aircraftId => {
    const key = String(aircraftId || '').trim();
    if (!key) return null;
    const records = Array.isArray(window.UCAACompanyLiveryMatching?.liveries) ? window.UCAACompanyLiveryMatching.liveries : [];
    return records.find(item => String(item?._id || item?.aircraftId || '').trim() === key) || null;
  };
  const profileAircraftLiveryName = flight => {
    const matching = profileLiveryMatchingRecordByAircraftId(flight?.aircraft?.id);
    return String(matching?.name || matching?.newskyName || flight?.aircraft?.fleetName || flight?.aircraft?.name || 'Літак').trim();
  };
  const profileAircraftRegistration = flight => aircraftRegistrationFromName(profileAircraftLiveryName(flight)) || aircraftRegistrationFromName(flight?.aircraft?.name);
  const profileEpaulet = stripes => `<span class="profile-epaulet profile-epaulet-${stripes}" aria-hidden="true">${Array.from({length:stripes},() => '<i></i>').join('')}</span>`;
  function profileFleetRole(currentPilotId) {
    const aircraftMap = new Map();
    availableFlights
      .filter(flight => flight.status === 'completed' && flight.aircraft?.id && flight.pilot?.id)
      .forEach(flight => {
        const aircraftId = String(flight.aircraft.id);
        let item = aircraftMap.get(aircraftId);
        if (!item) {
          item = {
            aircraftId,
            icao:String(flight.aircraft?.icao || '').trim().toUpperCase(),
            livery:profileAircraftLiveryName(flight),
            registration:profileAircraftRegistration(flight),
            pilots:new Map()
          };
          aircraftMap.set(aircraftId,item);
        }
        const pilotId = String(flight.pilot.id);
        const pilot = item.pilots.get(pilotId) || {id:pilotId,name:flight.pilot.name || 'Пілот',flights:0,minutes:0};
        pilot.flights += 1;
        pilot.minutes += Number(flight.times?.durationMinutes) || 0;
        item.pilots.set(pilotId,pilot);
      });
    const rows = [...aircraftMap.values()]
      .map(item => {
        const pilots = [...item.pilots.values()].sort((a,b) => b.minutes - a.minutes || b.flights - a.flights || a.name.localeCompare(b.name));
        const own = item.pilots.get(String(currentPilotId));
        if (!own) return null;
        return {...item,own,leader:pilots[0],cruiseTarget:pilots[1] || pilots[0],rank:pilots.findIndex(pilot => pilot.id === String(currentPilotId)) + 1};
      })
      .filter(Boolean);
    const CAPTAIN_MINUTES = 40 * 60;
    const FIRST_OFFICER_MINUTES = 10 * 60;
    const topRows = rows.filter(row => row.rank > 0 && row.rank <= 2);
    const captains = topRows.filter(row => row.rank === 1 && row.own.minutes >= CAPTAIN_MINUTES).sort((a,b) => b.own.minutes - a.own.minutes || b.own.flights - a.own.flights);
    const officers = topRows.filter(row => row.own.minutes >= FIRST_OFFICER_MINUTES && !(row.rank === 1 && row.own.minutes >= CAPTAIN_MINUTES)).sort((a,b) => b.own.minutes - a.own.minutes || b.own.flights - a.own.flights);
    const cruise = topRows.filter(row => row.own.minutes < FIRST_OFFICER_MINUTES).sort((a,b) => b.own.minutes - a.own.minutes || b.own.flights - a.own.flights);
    const cadets = rows.filter(row => row.rank > 2).sort((a,b) => {
      const aNeed = Math.max(0,(a.cruiseTarget?.minutes || 0) - a.own.minutes + 1);
      const bNeed = Math.max(0,(b.cruiseTarget?.minutes || 0) - b.own.minutes + 1);
      return aNeed - bNeed || b.own.minutes - a.own.minutes || b.own.flights - a.own.flights;
    });
    const mode = captains.length ? 'captain' : officers.length ? 'fo' : cruise.length ? 'cruise' : cadets.length ? 'cadet' : '';
    const selected = mode === 'captain' ? captains[0] : mode === 'fo' ? officers[0] : mode === 'cruise' ? cruise[0] : mode === 'cadet' ? cadets[0] : null;
    const source = mode === 'captain' ? [...captains, ...officers] : mode === 'fo' ? officers : mode === 'cruise' ? cruise : cadets.slice(0,5);
    const tooltip = source.map(row => {
      const rowMode = row.rank === 1 && row.own.minutes >= CAPTAIN_MINUTES ? 'captain'
        : row.own.minutes >= FIRST_OFFICER_MINUTES && row.rank <= 2 ? 'fo'
        : row.rank <= 2 ? 'cruise'
        : 'cadet';
      const role = rowMode === 'captain' ? 'CAPTAIN' : rowMode === 'fo' ? 'First Officer' : rowMode === 'cruise' ? 'Cruise Pilot' : 'CADET';
      const captainNeed = Math.max(0,CAPTAIN_MINUTES - row.own.minutes,row.rank === 1 ? 0 : (row.leader?.minutes || 0) - row.own.minutes);
      const firstOfficerNeed = Math.max(0,FIRST_OFFICER_MINUTES - row.own.minutes);
      const cruiseNeed = Math.max(0,(row.cruiseTarget?.minutes || 0) - row.own.minutes + 1);
      const need = rowMode === 'fo' ? ` · до CAPTAIN ${compactTime(captainNeed)}` : rowMode === 'cruise' ? ` · до First Officer ${compactTime(firstOfficerNeed)}` : rowMode === 'cadet' ? ` · до Cruise Pilot ${compactTime(cruiseNeed)}` : '';
      return `${role} ${row.livery}\n${row.own.flights} ${flightWord(row.own.flights)} · ${compactTime(row.own.minutes)}${need}`;
    }).join('\n@@LINE@@\n');
    return {mode,selected,tooltip,counts:{captains:captains.length,officers:officers.length,cruise:cruise.length}};
  }
  function profileFleetRoleHtml(pilotId) {
    const role = profileFleetRole(pilotId);
    if (!role.selected) return '<small class="profile-career-line">CADET</small>';
    const captain = role.mode === 'captain';
    const firstOfficer = role.mode === 'fo';
    const stripes = captain ? 4 : firstOfficer ? 3 : 1;
    const row = role.selected;
    if (role.mode === 'cruise') {
      return `<small class="profile-career-line profile-tip" data-tooltip="${esc(role.tooltip)}">${profileEpaulet(stripes)} <span class="profile-fleet-role-label">Cruise Pilot на ${esc(role.counts.cruise)} ПС</span></small>`;
    }
    if (role.mode === 'cadet') {
      return `<small class="profile-career-line profile-tip" data-tooltip="${esc(role.tooltip)}"><span class="profile-fleet-role-label">CADET</span></small>`;
    }
    const captainExtra = role.mode === 'captain' && role.counts.captains > 1 ? ` <span>(+${role.counts.captains - 1})</span>` : '';
    const aircraft = [row.icao ? `<span class="profile-fleet-role-label">${esc(row.icao)}</span>` : '', row.registration ? `<span>${esc(row.registration)}</span>${captainExtra}` : captainExtra.trim()].filter(Boolean).join(' ');
    return `<small class="profile-career-line profile-tip" data-tooltip="${esc(role.tooltip)}">${profileEpaulet(stripes)} ${aircraft || esc(row.livery)}</small>`;
  }
  const periodName = period => {
    if (period === 'customRange' && current?.customDate && current?.customEndDate) {
      return `${formatDateShort(current.customDate)}-${formatDateShort(current.customEndDate)}`;
    }
    if (period === 'customDate' && current?.customDate) {
      return new Date(`${current.customDate}T00:00:00Z`).toLocaleDateString('uk-UA',{timeZone:'UTC'});
    }
    return PERIODS.find(([key]) => key === period)?.[1] || 'Весь період';
  };
  const periodCaption = () => {
    if (current?.period === 'customRange' && current.customDate && current.customEndDate) {
      return `за ${formatDateShort(current.customDate)}-${formatDateShort(current.customEndDate)}`;
    }
    if (current?.period === 'customDate' && current.customDate) {
      return `за ${new Date(`${current.customDate}T00:00:00Z`).toLocaleDateString('uk-UA',{timeZone:'UTC'})}`;
    }
    const labels = {
      today:'за сьогодні',
      weekToDate:'з початку тижня',
      previousWeek:'за минулий тиждень',
      monthToDate:'з початку місяця',
      previousMonth:'за минулий місяць',
      sinceRestructure:'з 01.05.2026',
      all:'за весь період'
    };
    return labels[current?.period] || 'за вибраний період';
  };

  function directFlightFinance(flight) {
    return window.UCAADashboardFlightUI.directFlightFinance(flight);
  }

  function periodBounds(period) {
    const now = referenceNow;
    if (period === 'all') return null;
    if (period === 'customRange' && current?.customDate && current?.customEndDate) {
      const first = new Date(`${current.customDate}T00:00:00Z`);
      const second = new Date(`${current.customEndDate}T00:00:00Z`);
      const start = first <= second ? first : second;
      const endBase = first <= second ? second : first;
      return {start, end:new Date(endBase.getTime() + 86400000)};
    }
    if (period === 'customDate' && current?.customDate) {
      const start = new Date(`${current.customDate}T00:00:00Z`);
      return {start, end:new Date(start.getTime() + 86400000)};
    }
    let start;
    let end = now;
    if (period === 'today') start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (period === 'weekToDate' || period === 'previousWeek') {
      const weekday = (now.getUTCDay() + 6) % 7;
      const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - weekday));
      if (period === 'weekToDate') start = monday;
      else {
        start = new Date(monday.getTime() - 7 * 86400000);
        end = monday;
      }
    }
    if (period === 'monthToDate') start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (period === 'previousMonth') {
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    }
    if (period === 'sinceRestructure') start = new Date(Date.UTC(2026, 4, 1));
    return {start, end};
  }

  function filterPeriod(flights, period) {
    const bounds = periodBounds(period);
    if (!bounds) return flights;
    return flights.filter(flight => {
      const date = dateOf(flight);
      return date >= bounds.start && date < bounds.end;
    });
  }

  function defaultPeriod(flights) {
    const completed = period => filterPeriod(flights, period).some(flight => flight.status === 'completed');
    if (completed('today')) return 'today';
    if (completed('weekToDate')) return 'weekToDate';
    if (completed('previousWeek')) return 'previousWeek';
    if (completed('monthToDate')) return 'monthToDate';
    return 'all';
  }

  function favorite(items, keyFn) {
    const counts = new Map();
    items.forEach(item => {
      const key = keyFn(item);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts].map(([key,count]) => ({key,count}))
      .sort((a,b) => b.count - a.count || a.key.localeCompare(b.key))[0] || null;
  }

  function profileCacheSignature(flights = availableFlights) {
    const list = Array.isArray(flights) ? flights : [];
    let latest = 0;
    for (const flight of list) latest = Math.max(latest,dateOf(flight).getTime() || 0);
    return `${list.length}:${latest}`;
  }

  function resetProfileCaches(signature = profileCacheSignature()) {
    profileFlightsSignature = signature;
    profileSummaryCache = new Map();
    profileOverallCache = null;
    monthlyAwardsCache = null;
    aircraftAwardStatsCache = null;
    newskyAwardStatsCache = null;
  }

  function cachedSummaryKey(id, flights, scope = '') {
    const list = Array.isArray(flights) ? flights : [];
    if (scope) return `${profileFlightsSignature}|${scope}|${id}`;
    if (list === availableFlights) return `${profileFlightsSignature}|all|${id}`;
    return '';
  }

  function summarizeRaw(id, flights) {
    const list = flights.filter(flight => flight.pilot.id === id);
    const latestIdentity = [...list].sort((a,b) => dateOf(b) - dateOf(a))[0]?.pilot || null;
    const completed = list.filter(flight => flight.status === 'completed');
    const rows = completed.map(flight => ({flight, direct:directFlightFinance(flight)}));
    const ratings = completed.map(flight => Number(flight.rating)).filter(value => value > 0);
    const airports = [];
    completed.forEach(flight => airports.push(flight.departure?.icao, flight.arrival?.icao));
    const aircraft = favorite(completed, flight => `${flight.aircraft?.icao || '—'}|${flight.aircraft?.name || flight.aircraft?.icao || '—'}`);
    const avatar = [...list].sort((a,b) => dateOf(b) - dateOf(a)).find(flight => flight.pilot?.avatar)?.pilot?.avatar || 'default';
    return {
      id,
      name:latestIdentity?.name || 'Пілот',
      avatar,
      list,
      completed,
      rows,
      minutes:sum(completed, flight => flight.times?.durationMinutes),
      rating:ratings.length ? sum(ratings, value => value) / ratings.length : 0,
      salary:sum(rows, row => row.direct.pilotSalary),
      companyProfit:sum(rows, row => row.direct.companyProfit),
      revenue:sum(completed, flight => flight.finance?.revenue),
      pilotDeductions:sum(rows, row => row.direct.pilotPay?.totalDeductions),
      newSkyPenalties:sum(completed, flight => flight.finance?.penalties),
      aircraft,
      airport:favorite(airports, value => value)
    };
  }

  function summarize(id, flights, scope = '') {
    const key = cachedSummaryKey(id,flights,scope);
    if (!key) return summarizeRaw(id,flights);
    if (!profileSummaryCache.has(key)) profileSummaryCache.set(key,summarizeRaw(id,flights));
    return profileSummaryCache.get(key);
  }

  function allPilotIds() {
    return [...new Set(availableFlights.map(flight => flight.pilot?.id).filter(Boolean))];
  }

  function overallSummaries() {
    const key = profileFlightsSignature || profileCacheSignature();
    if (profileOverallCache?.key === key) return profileOverallCache.items;
    const items = allPilotIds().map(id => summarize(id,availableFlights,'all'));
    profileOverallCache = {key,items};
    return items;
  }

  function avatarUrl(value) {
    const hash = String(value || 'default').trim();
    return `https://newsky.app/api/pilot/avatar/${encodeURIComponent(hash && hash !== 'null' ? hash : 'default')}`;
  }

  function simulatorLabel(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'msfs2024' || raw === 'msfs24') return 'MSFS 2024';
    if (raw === 'msfs2020' || raw === 'msfs20' || raw === 'msfs') return 'MSFS 2020';
    if (raw === 'xp12' || raw === 'xplane12' || raw === 'x-plane 12') return 'X-PLANE 12';
    if (raw === 'xp11' || raw === 'xplane11' || raw === 'x-plane 11') return 'X-PLANE 11';
    if (raw === 'xp' || raw === 'xplane' || raw === 'x-plane') return 'X-PLANE';
    return raw.toUpperCase();
  }

  function simulatorSummary(flights) {
    const completed = (flights || []).filter(flight => flight.status === 'completed');
    const counts = new Map();
    completed.forEach(flight => {
      const label = simulatorLabel(flight.operations?.simulator);
      if (label) counts.set(label,(counts.get(label) || 0) + 1);
    });
    const total = [...counts.values()].reduce((acc,value) => acc + value,0);
    const entries = [...counts].map(([label,count]) => ({
      label,
      count,
      percent:total ? count / total * 100 : 0
    })).sort((a,b) => b.count-a.count || a.label.localeCompare(b.label,'uk'));
    const leader = entries[0] || null;
    const tooltip = entries.length > 1
      ? entries.map(entry => `${entry.label}: ${entry.count} ${flightWord(entry.count)} (${entry.percent.toFixed(0)}%)`).join('\n')
      : leader ? `${leader.label}: ${leader.count} ${flightWord(leader.count)} (${leader.percent.toFixed(0)}%)` : '';
    return {leader,entries,total,tooltip};
  }

  function aircraftAwardFamily(flight) {
    const raw = String(flight?.aircraft?.icao || '').trim().toUpperCase();
    return AIRCRAFT_AWARD_FAMILIES[raw] || raw || '—';
  }

  function aircraftAwardFamilyLabel(family) {
    return family === 'B738' ? 'B737' : family;
  }

  function aircraftAwardIncident(flight) {
    const direct = directFlightFinance(flight);
    const pay = direct.pilotPay || {};
    const insurance = Number(pay.insuranceCase) > 0
      || Number(direct.insurancePayout) > 0
      || Number(flight.finance?.penalties) >= 150000;
    const incident = insurance
      || Number(pay.seriousIncidentPenalty) > 0
      || Number(pay.incidentLiability) > 0
      || Boolean(flight.operations?.emergency);
    return {insurance,incident};
  }

  function buildAircraftAwardStatsCache() {
    if (aircraftAwardStatsCache) return aircraftAwardStatsCache;
    const completed = availableFlights.filter(flight => flight.status === 'completed');
    const familyLeaders = new Map();
    const pilotGroups = new Map();
    completed.forEach(flight => {
      const pilotId = flight.pilot?.id;
      if (!pilotId) return;
      const family = aircraftAwardFamily(flight);
      const groups = pilotGroups.get(pilotId) || new Map();
      const group = groups.get(family) || {
        family,
        pilotId,
        pilotName:flight.pilot?.name || 'Пілот',
        flights:[],
        safe5:0,
        rating75:0,
        rating85:0,
        rating95:0,
        perfect:0,
        hasIncident:false,
        hasInsurance:false
      };
      const rating = Number(flight.rating) || 0;
      const event = aircraftAwardIncident(flight);
      group.flights.push(flight);
      if (rating >= 5 && !event.insurance) group.safe5 += 1;
      if (rating >= 7.5) group.rating75 += 1;
      if (rating >= 8.5) group.rating85 += 1;
      if (rating >= 9.5) group.rating95 += 1;
      if (rating >= 9.995) group.perfect += 1;
      group.hasIncident ||= event.incident;
      group.hasInsurance ||= event.insurance;
      groups.set(family,group);
      pilotGroups.set(pilotId,groups);
    });
    pilotGroups.forEach(groups => groups.forEach(group => {
      familyLeaders.set(group.family,Math.max(familyLeaders.get(group.family) || 0,group.flights.length));
    }));
    const byPilot = new Map();
    const byFamily = new Map();
    const allByFamily = new Map();
    pilotGroups.forEach((groups,pilotId) => {
      const evaluated = [...groups.values()].map(group => {
        let level = group.safe5 >= 1 ? 1 : 0;
        if (group.rating75 >= 5 && group.perfect >= 1) level = 2;
        if (group.rating85 >= 15 && group.perfect >= 4) level = 3;
        if (group.rating95 >= 30 && group.perfect >= 10) level = 4;
        return {...group,level,leader:group.flights.length === (familyLeaders.get(group.family) || 0)};
      });
      evaluated.forEach(group => {
        const familyPilots = allByFamily.get(group.family) || [];
        familyPilots.push(group);
        allByFamily.set(group.family,familyPilots);
      });
      const awards = evaluated.filter(group => group.level > 0)
        .sort((a,b) => b.level-a.level || b.flights.length-a.flights.length || a.family.localeCompare(b.family));
      byPilot.set(pilotId,awards);
      awards.forEach(award => {
        const familyAwards = byFamily.get(award.family) || [];
        familyAwards.push(award);
        byFamily.set(award.family,familyAwards);
      });
    });
    byFamily.forEach(awards => awards.sort((a,b) =>
      b.level-a.level || b.flights.length-a.flights.length || b.rating95-a.rating95 || a.pilotName.localeCompare(b.pilotName,'uk')
    ));
    allByFamily.forEach(pilots => pilots.sort((a,b) =>
      b.flights.length-a.flights.length || b.perfect-a.perfect || a.pilotName.localeCompare(b.pilotName,'uk')
    ));
    aircraftAwardStatsCache = {byPilot,byFamily,allByFamily};
    return aircraftAwardStatsCache;
  }

  function aircraftAwardStats(pilotId) {
    return buildAircraftAwardStatsCache().byPilot.get(pilotId) || [];
  }

  function loadNewskyAwardRequirements() {
    if (newskyAwardRequirements) return Promise.resolve(newskyAwardRequirements);
    if (newskyAwardRequirementsPromise) return newskyAwardRequirementsPromise;
    newskyAwardRequirementsPromise = fetch('ukl_awards_requirements_v1_1.json')
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        newskyAwardRequirements = data;
        newskyAwardStatsCache = null;
        if (availableFlights.length) buildNewskyAwardStatsCache();
        dispatchEvent(new CustomEvent('ucaa-profile-awards-updated'));
        if (current) render();
        return data;
      })
      .catch(error => {
        console.warn('Не вдалося завантажити умови нагород NewSky:', error);
        return null;
      });
    return newskyAwardRequirementsPromise;
  }

  function loadSpecialProfileAwards() {
    if (specialProfileAwardsPromise) return specialProfileAwardsPromise;
    specialProfileAwardsPromise = fetch('COMPANY/special-profile-awards.json', {cache:'default'})
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        const awards = Array.isArray(data) ? data : (Array.isArray(data?.awards) ? data.awards : []);
        specialProfileAwards = awards.filter(award => award && award.pilotId);
        if (current) render();
        dispatchEvent(new CustomEvent('ucaa-profile-awards-updated'));
        return specialProfileAwards;
      })
      .catch(error => {
        console.warn('Special profile awards load failed:', error);
        specialProfileAwards = [];
        return specialProfileAwards;
      });
    return specialProfileAwardsPromise;
  }

  function loadCompanyFleetTypes() {
    if (companyFleetPromise) return companyFleetPromise;
    companyFleetPromise = fetch('COMPANY/company-data.json', {cache:'default'})
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        const types = new Set();
        (data?.fleet?.aircraft || []).forEach(aircraft => {
          [aircraft?.icao,aircraft?.variant].forEach(value => {
            const code = String(value || '').trim().toUpperCase();
            if (code) types.add(code);
          });
        });
        companyFleetTypes = types;
        if (current) render();
        return types;
      })
      .catch(error => {
        console.warn('Не вдалося завантажити перелік флоту для підказки складності:',error);
        return companyFleetTypes;
      });
    return companyFleetPromise;
  }

  function newskyAwardFlightTime(flight) {
    return new Date(
      flight?.times?.actualArrival
      || flight?.times?.closed
      || flight?.times?.takeoff
      || flight?.times?.actualDeparture
      || flight?.times?.scheduledDeparture
    );
  }

  function newskyAwardAirframes(award) {
    const requested = (award?.require?.airframes || [])
      .map(token => String(token || '').trim())
      .filter(Boolean);
    if (!requested.length) return null;
    const groups = newskyAwardRequirements?.aircraftGroups || {};
    const categoryPattern = /^(?:all|pax|passenger|cargo)(?:_(?:xs|s|m|l|xl|bizjet))?$/i;
    const exact = requested.filter(token => !groups[token] && !categoryPattern.test(token));
    // Exact ICAO requirements have priority over broad NewSky categories.
    if (exact.length) return new Set(exact.map(token => token.toUpperCase()));
    const accepted = new Set();
    requested.forEach(token => {
      const group = groups[token];
      if (Array.isArray(group)) group.forEach(icao => accepted.add(String(icao).toUpperCase()));
    });
    // NewSky зараховує A350-900 до XL-турів; у допоміжному списку v1.1 він помилково лишився тільки в pax_l.
    if (requested.includes('pax_xl')) {
      accepted.add('A359');
      accepted.add('A359U');
    }
    // NewSky зараховує Avro RJ100 до малого пасажирського класу в Short Haul Kings.
    if (requested.includes('pax_s')) accepted.add('RJ1H');
    return accepted;
  }

  function isNewskyAwardEligibleFlight(flight, award, acceptedAirframes) {
    if (flight?.status !== 'completed') return false;
    const time = newskyAwardFlightTime(flight);
    if (!Number.isFinite(time.getTime())) return false;
    const from = award.activeFrom ? new Date(award.activeFrom) : null;
    const to = award.activeTo ? new Date(award.activeTo) : null;
    if (from && time < from) return false;
    if (to && time > to) return false;
    const minimumRating = Number(award?.require?.minRating) || 0;
    if (minimumRating > 0 && Number(flight.rating) < minimumRating) return false;
    const icao = String(flight?.aircraft?.icao || '').toUpperCase();
    const requested = (award?.require?.airframes || [])
      .map(token => String(token || '').trim())
      .filter(Boolean);
    if (!requested.length || requested.some(token => token.toLowerCase() === 'all')) return true;
    const groups = newskyAwardRequirements?.aircraftGroups || {};
    const categoryPattern = /^(?:all|pax|passenger|cargo)(?:_(?:xs|s|m|l|xl|bizjet))?$/i;
    const exact = requested.filter(token => !groups[token] && !categoryPattern.test(token));
    if (exact.length) return acceptedAirframes?.has(icao) || false;
    if (acceptedAirframes?.has(icao)) return true;
    const flightType = String(flight?.flightType || flight?.type || '').toLowerCase();
    const wantsCargo = requested.some(token => /^cargo(?:_|$)/i.test(token));
    const wantsPax = requested.some(token => /^(?:pax|passenger)(?:_|$)/i.test(token));
    const hasExpandedSizeCategory = requested.some(token =>
      /_(?:xs|s|m|l|xl|bizjet)$/i.test(token) && Array.isArray(groups[token])
    );
    if (hasExpandedSizeCategory) return false;
    // If a size expansion is unavailable, fall back to the requested purpose.
    if (wantsCargo && flightType === 'cargo') return true;
    if (wantsPax && flightType !== 'cargo') return true;
    return false;
  }

  function evaluateNewskyAward(pilotFlights, award) {
    const legs = Array.isArray(award?.legs) ? award.legs : [];
    if (!legs.length || award?.deleted || !award?.started) return null;
    const acceptedAirframes = newskyAwardAirframes(award);
    const eligible = pilotFlights
      .filter(flight => isNewskyAwardEligibleFlight(flight, award, acceptedAirframes))
      .sort((a,b) => newskyAwardFlightTime(a) - newskyAwardFlightTime(b));
    const routeKey = (dep, arr) => `${String(dep || '').toUpperCase()}-${String(arr || '').toUpperCase()}`;
    const matchedFlights = [];
    const ordered = award?.require?.ordered;
    if (ordered === 'sequence') {
      for (let startIndex = 0; startIndex < legs.length && matchedFlights.length !== legs.length; startIndex += 1) {
        const candidate = [];
        let legOffset = 0;
        for (const flight of eligible) {
          const leg = legs[(startIndex + legOffset) % legs.length];
          if (routeKey(flight.departure?.icao, flight.arrival?.icao) === routeKey(leg.dep, leg.arr)) {
            candidate.push(flight);
            legOffset += 1;
            if (legOffset === legs.length) break;
          }
        }
        if (candidate.length === legs.length) matchedFlights.push(...candidate);
      }
    } else if (ordered === 'sequence_start') {
      let legIndex = 0;
      for (const flight of eligible) {
        const leg = legs[legIndex];
        if (!leg) break;
        if (routeKey(flight.departure?.icao, flight.arrival?.icao) === routeKey(leg.dep, leg.arr)) {
          matchedFlights.push(flight);
          legIndex += 1;
        }
      }
    } else {
      const remaining = new Map();
      legs.forEach(leg => {
        const key = routeKey(leg.dep, leg.arr);
        remaining.set(key, (remaining.get(key) || 0) + 1);
      });
      for (const flight of eligible) {
        const key = routeKey(flight.departure?.icao, flight.arrival?.icao);
        const count = remaining.get(key) || 0;
        if (!count) continue;
        matchedFlights.push(flight);
        if (count === 1) remaining.delete(key);
        else remaining.set(key, count - 1);
      }
    }
    if (matchedFlights.length !== legs.length) return null;
    return {award, matchedFlights};
  }

  function buildNewskyAwardStatsCache() {
    if (newskyAwardStatsCache) return newskyAwardStatsCache;
    const byPilot = new Map();
    const byAward = new Map();
    const completed = availableFlights.filter(flight => flight.status === 'completed' && flight.pilot?.id);
    const pilotIds = [...new Set(completed.map(flight => flight.pilot.id))];
    if (!newskyAwardRequirements?.awards) {
      newskyAwardStatsCache = {byPilot, byAward, totalPilots:pilotIds.length};
      return newskyAwardStatsCache;
    }
    pilotIds.forEach(pilotId => {
      const pilotFlights = completed.filter(flight => flight.pilot.id === pilotId);
      const earned = newskyAwardRequirements.awards
        .map(award => evaluateNewskyAward(pilotFlights, award))
        .filter(Boolean);
      byPilot.set(pilotId, earned);
      earned.forEach(result => {
        const holders = byAward.get(result.award.id) || [];
        holders.push({
          pilotId,
          pilotName:pilotFlights[0]?.pilot?.name || 'Пілот',
          result
        });
        byAward.set(result.award.id, holders);
      });
    });
    newskyAwardStatsCache = {byPilot, byAward, totalPilots:pilotIds.length};
    return newskyAwardStatsCache;
  }

  function newskyAwardLargeImage(award) {
    return String(award?.imageXs || '').replace(/_xs(?=$|[?#])/i, '');
  }

  function newskyAwardAirframeLabel(award) {
    const requested = award?.require?.airframes || [];
    if (!requested.length) return 'Без обмеження за типом літака';
    const groupNames = {
      pax_s:'пасажирські S',
      pax_m:'пасажирські M',
      pax_l:'пасажирські L',
      pax_xl:'пасажирські XL',
      cargo:'вантажні'
    };
    return requested.map(token => {
      const group = newskyAwardRequirements?.aircraftGroups?.[token];
      return Array.isArray(group)
        ? `категорія ${groupNames[token] || token}`
        : String(token);
    }).join('<br>');
  }

  function newskyAwardTooltipHtml(result, pilotId) {
    const award = result.award;
    const stats = buildNewskyAwardStatsCache();
    const holders = stats.byAward.get(award.id) || [];
    const otherHolders = holders.filter(holder => holder.pilotId !== pilotId).length;
    const percent = stats.totalPilots ? Math.round(otherHolders / stats.totalPilots * 100) : 0;
    const minimumRating = Number(award?.require?.minRating) || 0;
    const periodFrom = award.activeFrom
      ? new Date(award.activeFrom).toLocaleDateString('uk-UA',{timeZone:'UTC'})
      : 'без обмеження';
    const periodTo = award.activeTo
      ? new Date(award.activeTo).toLocaleDateString('uk-UA',{timeZone:'UTC'})
      : 'безстроково';
    const holdersCaption = otherHolders === 0
      ? 'Більше ніхто не отримав цю нагороду (поки що!)'
      : `Нагороду також мають ${otherHolders} ${otherHolders === 1 ? 'людина' : 'людей'} в авіакомпанії (${percent}%).`;
    return [
      `<div class="newsky-award-tooltip-head"><strong>${esc(award.title)}</strong><img src="${esc(newskyAwardLargeImage(award))}" alt=""></div>`,
      `<div><strong>Потрібно виконати:</strong> ${award.legs.length} ${flightWord(award.legs.length)}${minimumRating ? `<br><strong>Мінімальний рейтинг:</strong> ${minimumRating.toFixed(minimumRating % 1 ? 1 : 0)}` : ''}<br><strong>Період:</strong> ${periodFrom} — ${periodTo}</div>`,
      `<div><strong>Літаки:</strong><br>${newskyAwardAirframeLabel(award)}</div>`,
      `<div>${holdersCaption}</div>`
    ].join('');
  }

  function newskyAwardsHtml(pilotId) {
    if (!newskyAwardRequirements) return '';
    const results = buildNewskyAwardStatsCache().byPilot.get(pilotId) || [];
    return results.map(result => {
      const award = result.award;
      return `<a class="newsky-achievement-award" href="${esc(award.url)}" target="_blank" rel="noopener noreferrer" data-award-tooltip="${esc(newskyAwardTooltipHtml(result,pilotId))}" aria-label="${esc(award.title)}"><img src="${esc(newskyAwardLargeImage(award))}" alt="${esc(award.title)}"></a>`;
    }).join('');
  }

  function aircraftAwardManufacturer(family) {
    if (family === 'A225') return 'eastern';
    if (family === 'ERJ') return 'embraer';
    if (family === 'MD80') return 'mcdonnell';
    if (family === 'ATR') return 'regional';
    if (family === 'CRJ') return 'bombardier';
    if (family === 'BAE') return 'bae';
    if (/^C208/.test(family)) return 'cessna';
    if (/^(?:F27|F50|F70|F100|F28)$/.test(family)) return 'fokker';
    if (family === 'L1011') return 'lockheed';
    if (family === 'SF50') return 'cirrus';
    if (/^(?:DH|DHC)/.test(family)) return 'dehavilland';
    if (/^(?:SF34|SB20)/.test(family)) return 'saab';
    if (/^A(?:2|3)/.test(family)) return 'airbus';
    if (/^B(?:3|7)/.test(family)) return 'boeing';
    if (/^(?:E1|E2|E17|E19)/.test(family)) return 'embraer';
    if (/^(?:MD|DC)/.test(family)) return 'mcdonnell';
    if (/^AT/.test(family)) return 'regional';
    if (/^(?:AN|IL|T1|YK)/.test(family)) return 'eastern';
    return 'other';
  }

  function aircraftAwardManufacturerName(family) {
    return {
      airbus:'Airbus',
      boeing:'Boeing',
      embraer:'Embraer',
      mcdonnell:'McDonnell Douglas',
      regional:'регіональних літаків',
      bombardier:'Bombardier',
      bae:'British Aerospace',
      cessna:'Cessna',
      fokker:'Fokker',
      lockheed:'Lockheed',
      cirrus:'Cirrus',
      dehavilland:'De Havilland',
      saab:'Saab',
      eastern:'літаків східного виробництва',
      other:'літаків'
    }[aircraftAwardManufacturer(family)];
  }

  function aircraftAwardFamilyVariants(family) {
    if (AIRCRAFT_AWARD_FAMILY_VARIANTS[family]) return AIRCRAFT_AWARD_FAMILY_VARIANTS[family];
    const variants = Object.entries(AIRCRAFT_AWARD_FAMILIES)
      .filter(([,awardFamily]) => awardFamily === family)
      .map(([icao]) => icao.replace(/F$/,''))
      .filter((icao,index,list) => list.indexOf(icao) === index);
    return variants.length ? variants : [family];
  }

  function aircraftAwardFamilyDescription(family) {
    if (family === 'A225') return 'Antonov An-225 (ICAO A225)';
    return `${aircraftAwardManufacturerName(family)} ${aircraftAwardFamilyVariants(family).join('/')}`;
  }

  function aircraftAwardShortLevel(level) {
    return level >= 4 ? 'Золото' : AIRCRAFT_AWARD_LEVELS[level];
  }

  function aircraftAwardTierLine(label,awards) {
    if (!awards.length) return `${label}: —`;
    const sorted = [...awards].sort((a,b) =>
      b.flights.length-a.flights.length || b.perfect-a.perfect || a.pilotName.localeCompare(b.pilotName,'uk')
    );
    const first = sorted[0];
    const others = sorted.length - 1;
    return `${label}: ${first.pilotName}${others ? ` і ще у ${others} ${others===1?'пілота':'пілотів'}` : ''}`;
  }

  function aircraftAwardRequirement(level) {
    return {
      1:{label:'Допуск',rating:5,count:1,perfect:0,field:'safe5'},
      2:{label:'Бронзи',rating:7.5,count:5,perfect:1,field:'rating75'},
      3:{label:'Срібло',rating:8.5,count:15,perfect:4,field:'rating85'},
      4:{label:'Золото',rating:9.5,count:30,perfect:10,field:'rating95'}
    }[level];
  }

  function aircraftAwardTooltipHtml(award,familyAwards) {
    const currentRule = aircraftAwardRequirement(award.level);
    const currentCount = award[currentRule.field];
    const allPilots = buildAircraftAwardStatsCache().allByFamily.get(award.family) || [];
    const leader = allPilots[0];
    const follower = allPilots.find(item => item.pilotId !== award.pilotId);
    const goldAwards = familyAwards.filter(item => item.level === 4);
    const silverAwards = familyAwards.filter(item => item.level === 3);
    const bronzeAwards = familyAwards.filter(item => item.level === 2);
    const blocks = [
      `<div>${esc(AIRCRAFT_AWARD_LEVELS[award.level])} за польоти на літаках сімейства<br>${esc(aircraftAwardFamilyDescription(award.family))}<br>${currentCount} ${flightWord(currentCount)} на ${String(currentRule.rating).replace('.',',')}+${currentRule.perfect ? `, з них ${award.perfect} ${flightWord(award.perfect)} на 10,00` : ''}</div>`,
      `<div><strong>Умова виконана на ${esc(currentRule.label)}:</strong><br>${currentRule.count} ${flightWord(currentRule.count)} на ${String(currentRule.rating).replace('.',',')}+${currentRule.perfect ? `, з них ${currentRule.perfect} ${flightWord(currentRule.perfect)} на 10,00` : ''}</div>`
    ];
    const nextRule = aircraftAwardRequirement(award.level + 1);
    if (nextRule) {
      const remainingFlights = Math.max(0,nextRule.count-award[nextRule.field]);
      const remainingPerfect = Math.max(0,nextRule.perfect-award.perfect);
      const remainingParts = [];
      if (remainingFlights) remainingParts.push(`${remainingFlights} рейсів на ${String(nextRule.rating).replace('.',',')}+`);
      if (remainingPerfect) remainingParts.push(`${remainingPerfect} на 10,00`);
      if (remainingParts.length) blocks.push(`<div><strong>До ${esc(nextRule.label)} залишилось:</strong><br>${remainingParts.join(', з них ')}</div>`);
    }
    if (leader && leader.pilotId !== award.pilotId) {
      blocks.push(`<div>До лідера «${esc(leader.pilotName)}» за кількістю рейсів на типі<br>залишилось виконати ${Math.max(0,leader.flights.length-award.flights.length)} ${flightWord(Math.max(0,leader.flights.length-award.flights.length))}.</div>`);
    } else if (follower) {
      blocks.push(`<div>Найближчий переслідувач за <strong>рекордом</strong><br>по кількості рейсів на типі:<br>${esc(follower.pilotName)} — залишилось ${Math.max(0,award.flights.length-follower.flights.length)} ${flightWord(Math.max(0,award.flights.length-follower.flights.length))}.</div>`);
    } else {
      blocks.push('<div>Найближчих переслідувачів поки немає.</div>');
    }
    blocks.push(`<div><strong>ТОП-3:</strong><br>${esc(aircraftAwardTierLine('Золото',goldAwards))}<br>${esc(aircraftAwardTierLine('Срібло',silverAwards))}<br>${esc(aircraftAwardTierLine('Бронза',bronzeAwards))}<br>Допуск: ${familyAwards.length} ${familyAwards.length===1?'пілот':'пілотів'}.</div>`);
    return blocks.join('');
  }

  function aircraftAwardDecor(level,uid) {
    if (level === 1) return `<svg class="aircraft-award-bg-stand" viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(0, -1.5)"><path class="aircraft-award-meme-stand" d="M 48.2,31 L 51.8,31 L 51.5,82 L 48.5,82 Z"/><path class="aircraft-award-meme-stand" d="M 49,70 C 36,70 24,71 21,59 C 19,55 20,53 22,53 C 24,53 25,55 24,58 C 26,62 36,61 49,63 Z"/><path class="aircraft-award-meme-stand" d="M 49,63 L 34,84 L 28,84 L 44,63 Z"/><path class="aircraft-award-meme-stand" d="M 51,70 C 64,70 76,71 79,59 C 81,55 80,53 78,53 C 76,53 75,55 76,58 C 74,62 64,61 51,63 Z"/><path class="aircraft-award-meme-stand" d="M 51,63 L 66,84 L 72,84 L 56,63 Z"/><circle class="aircraft-award-meme-stand" cx="50" cy="71" r="2.5"/></g></svg>`;
    const gradient = level === 2
      ? '<stop offset="0%" stop-color="#4e2207"/><stop offset="45%" stop-color="#b56f45"/><stop offset="75%" stop-color="#e0a37b"/><stop offset="100%" stop-color="#faddc7"/>'
      : level === 3
        ? '<stop offset="0%" stop-color="#383e42"/><stop offset="40%" stop-color="#838c94"/><stop offset="75%" stop-color="#d3dae0"/><stop offset="100%" stop-color="#ffffff"/>'
        : '<stop offset="0%" stop-color="#543f03"/><stop offset="35%" stop-color="#c49e1a"/><stop offset="70%" stop-color="#f2da6e"/><stop offset="100%" stop-color="#fff9e3"/>';
    const leaf = '<path class="aircraft-award-wreath-part" d="M 0,0 Q 8,-3 5,-15 Q -7,-6 0,0 Z" transform="translate(0, -2)"/><path class="aircraft-award-wreath-part" d="M -2,4 Q -10,1 -6,-11 Q 5,-5 -2,4 Z" transform="translate(0, 2)"/>';
    const left = [[32.5,71.5,-55,.88],[27.5,66.5,-38,.83],[23.8,60,-21,.78],[21.7,53,-4,.73],[21.5,45.5,13,.68],[22.9,38.2,30,.63],[25.5,31.2,47,.58]]
      .map(([x,y,r,s]) => `<g transform="translate(${x}, ${y}) rotate(${r}) scale(${s})">${leaf}</g>`).join('');
    const right = [[67.5,71.5,55,.88],[72.5,66.5,38,.83],[76.2,60,21,.78],[78.3,53,4,.73],[78.5,45.5,-13,.68],[77.1,38.2,-30,.63],[74.5,31.2,-47,.58]]
      .map(([x,y,r,s]) => `<g transform="translate(${x}, ${y}) rotate(${r}) scale(-${s}, ${s})">${leaf}</g>`).join('');
    return `<svg class="aircraft-award-decor" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="aircraft-award-${uid}" x1="0%" y1="100%" x2="100%" y2="0%">${gradient}</linearGradient></defs><g transform="translate(0, -1.5)" fill="url(#aircraft-award-${uid})">${left}${right}<polygon class="aircraft-award-wreath-part" points="45,71.5 55,71.5 57,80 43,80"/><rect class="aircraft-award-wreath-part" x="36" y="80" width="28" height="4" rx="1"/></g></svg>`;
  }

  function monthlyAwardQuality(rows) {
    const eligible = rows.filter(row => Number(row.flight.rating) > 0 && !row.flight.operations?.emergency);
    const clean = eligible.filter(row => {
      const pay = row.direct.pilotPay || {};
      return Math.max(0,Number(row.flight.finance?.penalties)||0) === 0
        && Math.max(0,Number(pay.delayDeduction)||0) === 0
        && Math.max(0,Number(pay.fdrPenalty)||0) === 0
        && Math.max(0,Number(pay.incidentLiability)||0) === 0
        && Math.max(0,Number(pay.insuranceLiability)||0) === 0
        && !pay.seriousIncident
        && Math.max(0,Number(pay.insuranceCase)||0) === 0;
    });
    return {
      eligible:eligible.length,
      clean:clean.length,
      percent:eligible.length ? clean.length/eligible.length*100 : 0
    };
  }

  function buildMonthlyAwardsCache() {
    const key = profileFlightsSignature || profileCacheSignature();
    if (monthlyAwardsCache?.key === key) return monthlyAwardsCache.byPilot;
    const pilotIds = allPilotIds();
    const byPilot = new Map(pilotIds.map(id => [id,[]]));
    monthlyAwardPeriods().forEach(({year,month}) => {
      const start = new Date(Date.UTC(year,month,1));
      const end = new Date(Date.UTC(year,month+1,1));
      const monthFlights = availableFlights.filter(flight => {
        const date = dateOf(flight);
        return date >= start && date < end;
      });
      const candidates = pilotIds.map(id => {
        const summary = summarize(id,monthFlights,`month:${year}-${month}`);
        const ratedFlights = summary.completed.filter(flight => Number(flight.rating) > 0 && !flight.operations?.emergency);
        const scheduledFlights = summary.completed.filter(flight => Boolean(flight.operations?.scheduled));
        const charterFlights = summary.completed.filter(flight => Boolean(flight.operations?.charter));
        const difficulty = summary.completed.length
          ? sum(summary.completed,flight => window.UCAAPilotPay.aircraftCoefficient(flight.aircraft?.icao,flight.flightType))/summary.completed.length
          : 0;
        return {
          id,
          name:summary.name,
          flights:summary.completed.length,
          ratedFlights:ratedFlights.length,
          minutes:summary.minutes,
          rating:ratedFlights.length ? sum(ratedFlights,flight => flight.rating)/ratedFlights.length : 0,
          companyProfit:summary.companyProfit,
          salary:summary.salary,
          difficulty,
          scheduledFlights:scheduledFlights.length,
          charterFlights:charterFlights.length,
          quality:monthlyAwardQuality(summary.rows)
        };
      }).filter(item => item.flights > 0);
      const definitions = [
        {key:'hours',emoji:'⏱️',label:'Найбільший наліт',value:item=>item.minutes,format:value=>formatMinutes(value)},
        {key:'flights',emoji:'🛫',label:'Найбільша кількість рейсів',value:item=>item.flights,format:value=>`${value} ${flightWord(value)}`},
        {key:'rating',emoji:'✅',label:'Найвищий середній рейтинг',value:item=>item.rating,format:value=>value.toFixed(2),eligible:item=>item.ratedFlights>=10},
        {key:'profit',emoji:'💵',label:'Найбільший прибуток для авіакомпанії',value:item=>item.companyProfit,format:value=>money(value,true)},
        {key:'salary',emoji:'👷',label:'Найбільша зарплата пілота',value:item=>item.salary,format:value=>money(value,true)},
        {key:'difficulty',emoji:'⚙️',label:'Найвища середня складність літака',value:item=>item.difficulty,format:value=>value.toFixed(2),eligible:item=>item.difficulty>0},
        {key:'clean',emoji:'🧑‍✈️',label:'Найбільший відсоток польотів без штрафів',value:item=>item.quality.percent,format:(value,item)=>`${value.toFixed(0)}% (${item.quality.clean}/${item.quality.eligible})`,eligible:item=>item.quality.eligible>=10},
        {key:'scheduleFlights',emoji:'📅',label:'Найбільше schedule-рейсів',shortLabel:'SCHED',variant:'schedule',value:item=>item.scheduledFlights,format:value=>`${value} ${flightWord(value)}`,eligible:item=>item.scheduledFlights>=5},
        {key:'charterFlights',emoji:'📅',label:'Найбільше charter-рейсів',shortLabel:'CHART',variant:'charter',value:item=>item.charterFlights,format:value=>`${value} ${flightWord(value)}`,eligible:item=>item.charterFlights>=5}
      ];
      definitions.forEach(definition => {
        const ranked = candidates.filter(item => definition.eligible ? definition.eligible(item) : true)
          .sort((a,b) => definition.value(b)-definition.value(a) || b.flights-a.flights || a.name.localeCompare(b.name,'uk'));
        const winner = ranked[0];
        if (!winner) return;
        const monthName = new Date(Date.UTC(year,month,1)).toLocaleDateString('uk-UA',{month:'long',year:'numeric',timeZone:'UTC'});
        if (!byPilot.has(winner.id)) byPilot.set(winner.id,[]);
        byPilot.get(winner.id).push({
          ...definition,
          year,
          month,
          monthName,
          value:definition.value(winner),
          formatted:definition.format(definition.value(winner),winner),
          flights:winner.flights
        });
      });
    });
    byPilot.forEach(awards => awards.sort((a,b) => b.year-a.year || b.month-a.month));
    monthlyAwardsCache = {key,byPilot};
    return byPilot;
  }

  function monthlyAwardsForPilot(pilotId) {
    return buildMonthlyAwardsCache().get(pilotId) || [];
  }

  function monthlyAwardsHtml(pilotId) {
    return monthlyAwardsForPilot(pilotId).map(award => {
      const label = `${award.label} · ${award.monthName}`;
      const tooltip = `<div><strong>${esc(award.label)}</strong><br>${esc(award.monthName)}<br>${esc(award.formatted)} за місяць</div>`;
      const variantClass = award.variant ? ` monthly-award-${award.variant}` : '';
      const text = award.shortLabel || `${MONTH_AWARD_MONTHS[award.month]} ${String(award.year).slice(-2)}`;
      return `<span class="monthly-achievement-award${variantClass}" style="--month-award-color:${MONTH_AWARD_COLORS[award.month]}" data-award-tooltip="${esc(tooltip)}" aria-label="${esc(label)}"><span class="monthly-award-diamond"><span class="monthly-award-emoji">${award.emoji}</span><span class="monthly-award-date">${esc(text)}</span><span class="monthly-award-medal">🥇</span></span></span>`;
    }).join('');
  }

  function specialProfileAwardsHtml(pilotId) {
    return specialProfileAwards
      .filter(award => String(award.pilotId) === String(pilotId))
      .map(award => {
        const colors = Array.isArray(award.stripeColors) ? award.stripeColors : [];
        const colorA = colors[0] || award.stripeColorA || '#f2a51f';
        const colorB = colors[1] || award.stripeColorB || '#111';
        const label = award.label || 'SPECIAL';
        const tooltipTitle = award.tooltipTitle || label;
        const tooltipText = award.tooltipText || award.tooltip || award.text || '';
        const tooltip = `<div><strong>${esc(tooltipTitle)}</strong><br>${esc(tooltipText)}</div>`;
        const style = `--special-stripe-a:${esc(colorA)};--special-stripe-b:${esc(colorB)};--special-text-box-width:${esc(award.textBoxWidth || '37px')};--special-text-box-color:${esc(award.textBoxColor || '#111')};--special-text-color:${esc(award.textColor || '#fff')}`;
        const topIcon = award.topIcon || award.emoji || '';
        const bottomIcon = award.bottomIcon || award.medal || '';
        const text = award.text || 'SPECIAL';
        return `<span class="monthly-achievement-award monthly-award-special" style="${style}" data-award-tooltip="${esc(tooltip)}" aria-label="${esc(label)}"><span class="monthly-award-diamond"><span class="monthly-award-emoji">${topIcon}</span><span class="monthly-award-date">${esc(text)}</span><span class="monthly-award-medal">${bottomIcon}</span></span></span>`;
      }).join('');
  }

  function aircraftAwardsHtml(summary) {
    const awards = aircraftAwardStats(summary.id);
    const specialAwards = specialProfileAwardsHtml(summary.id);
    const monthlyAwards = monthlyAwardsHtml(summary.id);
    const newskyAwards = newskyAwardsHtml(summary.id);
    if (!awards.length && !specialAwards && !monthlyAwards && !newskyAwards) return '<div class="profile-aircraft-awards empty">Нагороди ще не отримані</div>';
    return `<div class="profile-aircraft-awards" aria-label="Нагороди пілота">${awards.map((award,index) => {
      const familyAwards = buildAircraftAwardStatsCache().byFamily.get(award.family) || [];
      const tooltip = aircraftAwardTooltipHtml(award,familyAwards);
      return `<span class="aircraft-award level-${award.level} manufacturer-${aircraftAwardManufacturer(award.family)} ${award.leader?'aircraft-award-leader':''}" data-award-tooltip="${esc(tooltip)}">${aircraftAwardDecor(award.level,`${summary.id}-${award.family}-${index}`)}<span class="aircraft-award-circle"><span>${esc(aircraftAwardFamilyLabel(award.family))}</span></span></span>`;
    }).join('')}${specialAwards}${monthlyAwards}${newskyAwards}</div>`;
  }

  function wireAircraftAwardTooltips(root) {
    document.querySelector('#profileAircraftAwardTooltip')?.remove();
    const tooltip = document.createElement('div');
    tooltip.id = 'profileAircraftAwardTooltip';
    tooltip.className = 'profile-aircraft-award-tooltip';
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    const show = element => {
      tooltip.innerHTML = element.dataset.awardTooltip || '';
      tooltip.hidden = false;
      const rect = element.getBoundingClientRect();
      const width = tooltip.offsetWidth;
      const height = tooltip.offsetHeight;
      const left = Math.max(6,Math.min(window.innerWidth-width-6,rect.left+(rect.width-width)/2));
      const below = rect.bottom + 5;
      const top = below + height <= window.innerHeight-6 ? below : Math.max(6,rect.top-height-5);
      tooltip.style.left = `${Math.round(left)}px`;
      tooltip.style.top = `${Math.round(top)}px`;
    };
    const hide = () => { tooltip.hidden = true; };
    root.querySelectorAll('[data-award-tooltip]').forEach(element => {
      element.addEventListener('mouseenter',() => show(element));
      element.addEventListener('mouseleave',hide);
    });
    const awardsZone = root.querySelector('.profile-aircraft-awards:not(.empty)');
    if (awardsZone) {
      const updateAwardsScroll = () => {
        const rowTops = [];
        [...awardsZone.children].forEach(element => {
          const top = element.offsetTop - (parseFloat(getComputedStyle(element).marginTop) || 0);
          if (!rowTops.some(existing => Math.abs(existing - top) <= 8)) rowTops.push(top);
        });
        awardsZone.classList.toggle('scrollable', rowTops.length >= 3);
      };
      awardsZone.classList.remove('scrollable');
      awardsZone.scrollTop = 0;
      requestAnimationFrame(() => requestAnimationFrame(updateAwardsScroll));
      awardsZone.querySelectorAll('img').forEach(image => {
        if (!image.complete) image.addEventListener('load',updateAwardsScroll,{once:true});
      });
      if (window.ResizeObserver) {
        const observer = new ResizeObserver(updateAwardsScroll);
        observer.observe(awardsZone);
        setTimeout(() => observer.disconnect(),1500);
      }
    }
  }

  function ensureProfilePage() {
    const content = document.querySelector('#profilePageContent');
    const pickerButton = document.querySelector('#profileTabLink');
    const pickerList = document.querySelector('#pilotPickerList');
    if (!document.querySelector('#ucaa-profile-v2-style')) {
      const style = document.createElement('style');
      style.id = 'ucaa-profile-v2-style';
      style.textContent = `
        .profile-v2{padding:0}.profile-v2 .profile-identity{display:grid;grid-template-columns:112px 164px minmax(0,1fr);column-gap:6px;align-items:start;min-height:108px;margin:-4px 0 -2px}
        .profile-v2 .profile-avatar-wrap{position:relative;box-sizing:border-box;width:108px;height:108px;margin-top:4px}
        .profile-v2 .profile-avatar{box-sizing:border-box;width:108px;height:108px;border:1px solid #555;background:#eef8fa;object-fit:cover}
        .profile-v2 .profile-sim-badge{position:absolute;left:1px;bottom:21px;box-sizing:border-box;max-width:100px;padding:1px 4px;border:1px solid #333;border-radius:4px;background:rgba(245,245,245,.9);color:#111;font:700 10px/12px Arial,sans-serif;text-align:center;white-space:nowrap;cursor:help}
        .profile-empty-picker{padding:12px;background:#fafafa}.profile-empty-title{font-weight:bold;margin-bottom:8px;color:#111}.profile-inline-picker{position:static!important;left:auto!important;top:auto!important;transform:none!important;z-index:1!important;width:min(909px,100%)!important;margin:0 auto!important;text-align:left}.profile-inline-picker button,.profile-inline-picker a{grid-template-columns:24px 18px minmax(0,1fr) auto!important;gap:8px!important;align-items:center!important;min-height:31px!important;padding-top:4px!important;padding-bottom:4px!important;padding-left:5px!important;padding-right:10px!important;overflow:visible!important}.profile-inline-picker button strong,.profile-inline-picker a strong{display:block;min-height:22px;line-height:22px;padding-right:10px;overflow:hidden;text-overflow:ellipsis}.profile-inline-picker .picker-rank,.profile-inline-picker .picker-avatar,.profile-inline-picker .picker-hours{align-self:center}.profile-inline-picker .picker-avatar{display:block}.profile-inline-picker .flight-streak-badge{top:0;transform:translateY(-1px)}.profile-inline-picker .picker-hours{padding-left:10px}
        .profile-v2 .profile-person{min-width:0;padding-top:0}.profile-v2 .profile-identity h3{display:grid;align-items:center;max-width:100%;white-space:normal;min-height:52px;margin:0 0 4px;font-size:24px;line-height:26px}.profile-v2 .profile-title-name{display:block;max-width:100%;white-space:normal}.profile-v2 .profile-title-name .pilot-name-tail{display:inline-flex;align-items:center;white-space:nowrap}.profile-v2 .profile-title-name .flight-streak-badge{font-size:.92em;transform:translateY(-5%)}.profile-v2 .profile-newsky-row{display:flex;align-items:center;gap:2px;margin:0 0 2px;font-size:13px;white-space:nowrap}.profile-v2 .profile-badge{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;border:1px solid #777;background:#ddd;padding:1px 3px;color:#111;font-size:13px;line-height:17px;text-decoration:none;white-space:nowrap;cursor:pointer}.profile-v2 .profile-badge:hover,.profile-v2 .profile-badge:focus{background:#c8ddeb;color:#111;text-decoration:none}.profile-v2 .profile-badge.profile-tip:hover{background:#c8ddeb}.profile-v2 .profile-person small{font-size:13px;line-height:18px}.profile-v2 .profile-career-line{display:block;white-space:nowrap}.profile-v2 .profile-epaulet{display:inline-flex;box-sizing:border-box;width:28px;height:13px;align-items:stretch;justify-content:center;gap:2px;margin-right:3px;padding:1px 4px;border:1px solid #000;background:#111;vertical-align:-2px}.profile-v2 .profile-epaulet i{display:block;width:3px;background:#f0c22f;box-shadow:inset 0 0 0 1px #d69f15}.profile-v2 .profile-fleet-role-label{font-weight:bold}
        .profile-v2 .profile-aircraft-awards{box-sizing:border-box;min-width:0;width:calc(100% - 5px);height:117px;display:flex;flex-wrap:wrap;align-content:flex-start;gap:0;overflow:hidden;margin:-1px 0 0 5px;padding:0 5px 0 0}
        .profile-v2 .profile-aircraft-awards.scrollable{overflow-x:hidden;overflow-y:auto;scrollbar-width:thin}
        .profile-v2 .profile-aircraft-awards.scrollable::-webkit-scrollbar-track{margin-top:10px}
        .profile-v2 .profile-aircraft-awards.empty{display:flex;align-items:center;color:#777;font-size:11px}
        .profile-v2 .aircraft-award{position:relative;display:inline-flex;flex:0 0 67px;width:67px;height:67px;margin:0 -15px -15px 0;align-items:center;justify-content:center;isolation:isolate;overflow:hidden;cursor:help}
        .profile-v2 .aircraft-award-bg-stand{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none}
        .profile-v2 .aircraft-award-circle{position:relative;display:flex;width:37px;height:37px;align-items:center;justify-content:center;z-index:3;overflow:hidden;border-radius:50%}
        .profile-v2 .level-1 .aircraft-award-circle{border:1px solid rgba(255,255,255,.15);box-shadow:inset 0 1px 3px rgba(255,255,255,.1),0 4px 10px rgba(0,0,0,.25)}
        .profile-v2 .level-2 .aircraft-award-circle,.profile-v2 .level-3 .aircraft-award-circle,.profile-v2 .level-4 .aircraft-award-circle{border:1px solid rgba(255,255,255,.25);box-shadow:inset 0 2px 5px rgba(255,255,255,.2),0 4px 10px rgba(0,0,0,.35)}
        .profile-v2 .aircraft-award::before{content:"";position:absolute;top:15px;left:15px;width:37px;height:19px;background:linear-gradient(to bottom,rgba(255,255,255,.12),rgba(255,255,255,0));pointer-events:none;z-index:4;border-radius:19px 19px 0 0}
        .profile-v2 .aircraft-award-circle span{position:relative;z-index:6;width:100%;margin:0;padding:0;color:#fff;font:700 9px/1 Arial,sans-serif;letter-spacing:.1px;text-align:center;text-transform:uppercase;text-shadow:0 2px 4px rgba(0,0,0,.8)}
        .profile-v2 .manufacturer-airbus .aircraft-award-circle{background:radial-gradient(circle,#165c3f 0%,#0a3020 100%)}
        .profile-v2 .manufacturer-boeing .aircraft-award-circle{background:radial-gradient(circle,#18447e 0%,#0a213f 100%)}
        .profile-v2 .manufacturer-embraer .aircraft-award-circle{background:radial-gradient(circle,#087f82 0%,#063b45 100%)}
        .profile-v2 .manufacturer-mcdonnell .aircraft-award-circle{background:radial-gradient(circle,#8a3b48 0%,#40151f 100%)}
        .profile-v2 .manufacturer-regional .aircraft-award-circle{background:radial-gradient(circle,#a46a20 0%,#55320d 100%)}
        .profile-v2 .manufacturer-bombardier .aircraft-award-circle{background:radial-gradient(circle,#7054a5 0%,#30204f 100%)}
        .profile-v2 .manufacturer-bae .aircraft-award-circle{background:radial-gradient(circle,#356c7d 0%,#173944 100%)}
        .profile-v2 .manufacturer-cessna .aircraft-award-circle{background:radial-gradient(circle,#3f8eaa 0%,#17475c 100%)}
        .profile-v2 .manufacturer-fokker .aircraft-award-circle{background:radial-gradient(circle,#be6f2b 0%,#62320f 100%)}
        .profile-v2 .manufacturer-lockheed .aircraft-award-circle{background:radial-gradient(circle,#76518e 0%,#352043 100%)}
        .profile-v2 .manufacturer-cirrus .aircraft-award-circle{background:radial-gradient(circle,#b18b24 0%,#59430d 100%)}
        .profile-v2 .manufacturer-dehavilland .aircraft-award-circle{background:radial-gradient(circle,#34866d 0%,#164538 100%)}
        .profile-v2 .manufacturer-saab .aircraft-award-circle{background:radial-gradient(circle,#58749b 0%,#26384f 100%)}
        .profile-v2 .manufacturer-eastern .aircraft-award-circle{background:radial-gradient(circle,#8b3430 0%,#451616 100%)}
        .profile-v2 .manufacturer-other .aircraft-award-circle{background:radial-gradient(circle,#5e6670 0%,#252b31 100%)}
        .profile-v2 .aircraft-award-decor{position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none}
        .profile-v2 .aircraft-award-wreath-part{stroke:rgba(0,0,0,.25);stroke-width:.4px}
        .profile-v2 .aircraft-award-meme-stand{fill:#1a1a1a;stroke:#0a0a0a;stroke-width:.5px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
        .profile-v2 .level-2 .aircraft-award-decor,.profile-v2 .level-3 .aircraft-award-decor,.profile-v2 .level-4 .aircraft-award-decor{filter:drop-shadow(0 2px 4px rgba(0,0,0,.35))}
        .profile-v2 .aircraft-award-leader::after{content:"";position:absolute;z-index:7;top:-17px;left:-36px;width:16px;height:103px;background:linear-gradient(90deg,transparent,#ffffffb8,transparent);transform:rotate(23deg);animation:aircraft-award-shine 5.4s ease-in-out infinite;pointer-events:none}
        @keyframes aircraft-award-shine{0%,60%{left:-36px;opacity:0}64%{opacity:.85}87%{left:85px;opacity:.7}91%,100%{left:85px;opacity:0}}
        .profile-v2 .monthly-achievement-award{position:relative;display:inline-flex;flex:0 0 43px;width:43px;height:43px;margin:13px 3px 0 2px;align-items:center;justify-content:center;cursor:help}
        .profile-v2 .aircraft-award + .monthly-achievement-award{margin-left:14px}
        .profile-v2 .monthly-award-diamond{position:relative;display:block;width:30px;height:30px;transform:rotate(45deg);border:1px solid #9a7b18;border-radius:4px;background:var(--month-award-color);box-shadow:0 0 0 1px rgba(230,188,58,.75),0 2px 5px #0004,inset 0 0 0 1px rgba(255,255,255,.55),inset 0 0 8px rgba(255,255,255,.28)}
        .profile-v2 .monthly-award-schedule .monthly-award-diamond{border-color:#2f8d3e;box-shadow:0 0 0 1px rgba(65,166,78,.85),0 2px 5px #0004,inset 0 0 0 1px rgba(255,255,255,.55),inset 0 0 8px rgba(255,255,255,.25)}
        .profile-v2 .monthly-award-charter .monthly-award-diamond{border-color:#d17909;box-shadow:0 0 0 1px rgba(243,154,10,.9),0 2px 5px #0004,inset 0 0 0 1px rgba(255,255,255,.55),inset 0 0 8px rgba(255,255,255,.25)}
        .profile-v2 .monthly-award-special .monthly-award-diamond{border-color:#171717;background:repeating-linear-gradient(135deg,var(--special-stripe-a,#f2a51f) 0 8px,var(--special-stripe-b,#111) 8px 11px);box-shadow:0 0 0 1px rgba(255,176,35,.85),0 2px 5px #0005,inset 0 0 0 1px rgba(255,255,255,.42),inset 0 0 8px rgba(255,255,255,.18)}
        .profile-v2 .monthly-award-special .monthly-award-emoji,.profile-v2 .monthly-award-special .monthly-award-medal{filter:drop-shadow(0 1px 1px #fff) drop-shadow(0 1px 1px #0008)}
        .profile-v2 .monthly-award-date{position:absolute;left:50%;top:50%;width:38px;transform:translate(-50%,-50%) rotate(-45deg);color:#3b3216;font:700 8px/1 Arial,sans-serif;text-align:center;white-space:nowrap;text-shadow:0 1px #fff}
        .profile-v2 .monthly-award-emoji{position:absolute;left:-5px;top:-4px;z-index:2;width:18px;transform:rotate(-45deg);font:15px/18px Arial,sans-serif;text-align:center;filter:drop-shadow(0 1px 1px #fff)}
        .profile-v2 .monthly-award-medal{position:absolute;right:-3px;bottom:-5px;z-index:2;width:18px;transform:rotate(-45deg);font:15px/18px Arial,sans-serif;text-align:center;filter:drop-shadow(0 1px 1px #fff)}
        .profile-v2 .monthly-award-special .monthly-award-date{box-sizing:border-box;width:auto;min-width:var(--special-text-box-width,37px);padding:1px 3px;border-radius:2px;background:var(--special-text-box-color,#111);color:var(--special-text-color,#fff);font-size:7.5px;text-shadow:0 1px 1px #000,0 0 3px #000}
        .profile-v2 .monthly-award-special .monthly-award-emoji,.profile-v2 .monthly-award-special .monthly-award-medal{filter:drop-shadow(0 1px 1px #fff) drop-shadow(0 1px 1px #0008)}
        .profile-v2 .monthly-achievement-award + .newsky-achievement-award{margin-left:9px}
        .profile-v2 .newsky-achievement-award{box-sizing:border-box;display:inline-flex;flex:0 0 auto;width:auto;height:35px;margin:17px 6px 0 1px;align-items:center;justify-content:center;padding:0;background:transparent;cursor:pointer;text-decoration:none}
        .profile-v2 .aircraft-award + .newsky-achievement-award{margin-left:16px}
        .profile-v2 .newsky-achievement-award img{box-sizing:border-box;display:block;width:auto;height:35px;max-width:none;border:1px solid #708999;border-radius:5px;box-shadow:0 1px 3px #0002;object-fit:contain}
        .profile-aircraft-award-tooltip{position:fixed;z-index:1000;box-sizing:border-box;width:max-content;max-width:350px;padding:8px 10px;border:1px solid #666;background:#fff;color:#222;font:12px/1.35 Arial,sans-serif;text-align:left;box-shadow:0 5px 16px #0004;pointer-events:none}
        .profile-aircraft-award-tooltip>div+div{margin-top:7px;padding-top:7px;border-top:1px dotted #bbb}.profile-aircraft-award-tooltip strong{font-weight:bold}
        .profile-aircraft-award-tooltip .newsky-award-tooltip-head{display:flex;flex-direction:column;align-items:center;gap:3px;padding:0;font-size:14px;text-align:center}.profile-aircraft-award-tooltip .newsky-award-tooltip-head strong{display:block;margin:0}.profile-aircraft-award-tooltip .newsky-award-tooltip-head img{display:block;flex:0 0 auto;width:280px;max-width:100%;height:auto;margin:0;object-fit:contain}
        .profile-v2 table{border-collapse:collapse;width:100%}.profile-v2 th,.profile-v2 td{border:1px solid #888;padding:5px;text-align:left}
        .profile-v2 th{background:#eee}.profile-v2 .num{text-align:right}.profile-v2 .positive{color:#08783f;font-weight:bold}.profile-v2 .negative{color:#a40000;font-weight:bold}
        .profile-v2 .profile-section-title{font-weight:bold;text-align:center;background:#c7eef2;border:1px solid #777;padding:5px;margin-top:8px}
        .profile-v2 .profile-overall{table-layout:fixed;font-size:12px}.profile-v2 .profile-overall th{font-size:11px;line-height:1.15;vertical-align:middle;padding-left:3px;padding-right:3px;white-space:nowrap}.profile-v2 .profile-overall td{font-family:Consolas,monospace;font-size:13px;font-weight:bold;vertical-align:middle;white-space:nowrap}
        .profile-v2 .profile-overall th[title],.profile-v2 .profile-overall td[title]{cursor:help}.profile-v2 .profile-overall th[title]:hover,.profile-v2 .profile-overall td[title]:hover{background:#fffbe3}
        .profile-v2 .profile-tip{position:relative;cursor:help}.profile-v2 .profile-tip:hover{background:#fffbe3}
        .profile-v2 .profile-tooltip-box{position:absolute;left:50%;top:calc(100% + 5px);transform:translateX(-50%);z-index:100;width:max-content;max-width:350px;padding:7px 9px;border:1px solid #666;background:#fff;color:#222;font-family:Arial,sans-serif;font-size:11px;font-weight:normal;line-height:1.35;text-align:left;white-space:pre-line;box-shadow:0 4px 12px #0003;opacity:0;visibility:hidden;pointer-events:none}
        .profile-v2 .profile-tip:hover .profile-tooltip-box{opacity:1;visibility:visible}
        .profile-v2 .profile-tooltip-section{display:block;white-space:pre-line}.profile-v2 .profile-tooltip-rule{height:0;margin:5px 0;border:0;border-top:1px solid #ccc}
        .profile-v2 .profile-career-line{line-height:16px}.profile-v2 .profile-career-line .profile-epaulet{width:27px;height:12px;vertical-align:1px}.profile-v2 .profile-career-line .profile-tooltip-box{min-width:360px;max-width:460px}
        .profile-v2 .profile-tooltip-excluded{display:block;margin-top:6px;color:#888;font-style:italic;white-space:pre-line}
        .profile-v2 .profile-rank-medal{display:inline-block;font-size:18px;line-height:1;vertical-align:-2px;margin-left:3px;transform:translateY(-2px)}
        .profile-v2 .profile-rank-medal.anti{display:inline-block}
        .profile-v2 .profile-divider{color:#888;padding:0 5px}
        .profile-v2 .profile-rank-place{color:#777;font-weight:normal}
        .profile-v2 .profile-period-bar{display:flex;align-items:center;gap:6px;border:1px solid #555;background:#f7e7f8;padding:5px 5px 5px 6px;margin-top:7px}
        .profile-v2 .profile-period-icon{white-space:nowrap;font-size:16px;line-height:1}.profile-v2 .profile-period-buttons{display:flex;gap:3px;align-items:center;flex-wrap:nowrap;min-width:0;flex:1}
        .profile-v2 .profile-period-buttons button{border:1px solid #777;background:#fff;padding:4px 6px;cursor:pointer;white-space:nowrap;font-size:13px;font-weight:normal}
        .profile-v2 .profile-period-buttons button.active{background:#d8f5e6;border-color:#17804c;box-shadow:inset 0 0 0 1px #17804c}.profile-v2 .profile-period-buttons button:hover{background:#fff7c7}
        .profile-v2 .profile-calendar{position:relative;display:inline-flex;flex:0 0 auto;align-self:stretch;overflow:visible}.profile-v2 .profile-calendar>button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:48px;width:auto;height:28px;padding:3px 8px;border:1px solid #777;background:#fff;cursor:pointer}
        .profile-v2 .profile-calendar>button.active{background:#d8f5e6;border-color:#17804c}.profile-v2 .profile-calendar-label{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.05;gap:0;font-size:12px;font-weight:normal;white-space:nowrap}.profile-v2 .profile-calendar-label span{font-size:10px;line-height:1}
        .profile-v2 .profile-calendar-panel{position:absolute;right:0;top:calc(100% + 4px);z-index:35;width:245px;border:1px solid #777;background:#fff;box-shadow:0 3px 10px #0003;padding:6px}.profile-v2 .profile-calendar-panel[hidden]{display:none}
        .profile-v2 .profile-calendar-modes{display:flex;gap:5px;margin-bottom:6px}.profile-v2 .profile-calendar-modes button{flex:1;padding:4px 6px!important}.profile-v2 .profile-calendar-modes button.active{background:#d8f5e6;border-color:#17804c;font-weight:bold}
        .profile-v2 .profile-calendar-fields{display:grid;grid-template-columns:1fr;gap:5px}.profile-v2 .profile-calendar-fields.range{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
        .profile-v2 .profile-calendar-fields input{box-sizing:border-box;width:100%;border:1px solid #888;padding:4px;font:12px Arial,sans-serif;cursor:pointer}.profile-v2 .profile-calendar-fields.range input{font-size:11px;padding:3px 2px}.profile-v2 .profile-calendar-fields input[readonly]{background:#fff}.profile-v2 .profile-calendar-fields input[type="date"]::-webkit-calendar-picker-indicator{opacity:0}
        .profile-v2 .profile-dashboard{display:block;margin:7px 0}
        .profile-v2 .profile-finance-grid{display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:7px;min-width:0}
        .profile-v2 .profile-finance-stack{display:grid;grid-template-rows:190px 114px;gap:6px;min-width:0}.profile-v2 .profile-finance{border:1px solid #555;min-width:0;overflow:hidden}.profile-v2 .profile-finance-title{font-weight:bold;text-align:center;background:#c7eef2;border-bottom:1px solid #777;padding:4px}
        .profile-v2 .profile-finance:nth-child(2) .profile-finance-title{background:#fffbe3}
        .profile-v2 .profile-finance-body{display:grid;grid-template-columns:155px minmax(230px,1fr);gap:10px;align-items:center;align-content:center;justify-content:center;height:164px;padding:0 16px}
        .profile-v2 .profile-finance-pie{width:132px;height:132px;border:1px solid #777;border-radius:50%;margin:0 auto;position:relative;overflow:hidden;background:#f6f6f6}
        .profile-v2 .profile-airline-benefit .profile-finance-body{grid-template-columns:155px minmax(230px,1fr);height:88px}
        .profile-v2 .profile-airline-benefit .profile-finance-pie{width:82px;height:82px}
        .profile-v2 .profile-finance-legend{font-size:13px}.profile-v2 .profile-finance-row{display:grid;grid-template-columns:82px 12px minmax(0,1fr);gap:5px;align-items:center;padding:2px 0}
        .profile-v2 .profile-finance-row strong{text-align:right;white-space:nowrap}.profile-v2 .profile-finance-dot{width:10px;height:10px;border:1px solid #777}
        .profile-v2 .profile-finance-note{color:#777;font-size:11px;white-space:nowrap}
        .profile-v2 .profile-finance-total{border-top:1px solid #999;margin-top:5px;padding-top:5px;font-weight:bold}
        .profile-v2 .profile-mini-pies{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:152px 152px;gap:6px}.profile-v2 .profile-mini-pie-block{border:1px solid #555;display:flex;flex-direction:column;min-width:0;height:152px;text-align:center;overflow:hidden}
        .profile-v2 .profile-mini-title{font-weight:bold;font-size:11px;border-bottom:1px solid #888;padding:2px 3px;background:#edf8ef}
        .profile-v2 .profile-mini-pie-block:nth-child(2) .profile-mini-title{background:#fffbe3}.profile-v2 .profile-mini-pie-block:nth-child(3) .profile-mini-title{background:#f0f4ff}.profile-v2 .profile-mini-pie-block:nth-child(4) .profile-mini-title{background:#f7edf8}
        .profile-v2 .profile-mini-pie{width:82px;height:82px;flex:0 0 82px;border:1px solid #777;border-radius:50%;margin:3px auto 2px;position:relative;overflow:hidden;background:#f6f6f6}
        .profile-v2 .profile-mini-labels{display:flex;justify-content:center;align-content:center;align-items:center;gap:3px;flex-wrap:wrap;height:57px;min-height:57px;padding:0 4px 4px;overflow:visible}
        .profile-v2 .profile-mini-labels.aircraft{display:grid;grid-template-columns:repeat(4,auto);grid-auto-rows:auto;align-content:center;align-items:center;justify-content:center;gap:2px 3px;height:57px;min-height:57px}
        .profile-v2 .profile-mini-labels.countries{display:grid;grid-template-columns:repeat(4,auto);grid-auto-rows:auto;align-content:center;align-items:center;justify-content:center;gap:2px 3px;height:57px;min-height:57px}
        .profile-v2 .profile-type-badge{display:inline-block;padding:2px 5px;border-radius:5px;color:#fff;font-size:10px;font-weight:bold;line-height:1.1;box-shadow:inset 0 0 0 1px #0002;white-space:nowrap}
        .profile-v2 .profile-aircraft-badge{min-width:34px}
        .profile-v2 .profile-country-flag{display:inline-block;box-sizing:border-box;width:24px;height:15px;object-fit:cover;border:1px solid #888;border-radius:3px;vertical-align:middle}
        .profile-v2 .profile-airport-badge{display:inline-block;min-width:36px;padding:2px 5px;border-radius:5px;color:#fff;font-size:10px;font-weight:bold;line-height:1.1;box-shadow:inset 0 0 0 1px #0002;white-space:nowrap}
        .profile-v2 .profile-cards{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:7px}.profile-v2 .profile-card{border:1px solid #777;min-height:56px;padding:3px 8px;display:flex;flex-direction:column;justify-content:center;gap:1px}
        .profile-v2 .profile-card:nth-child(1){background:#eef9fa}.profile-v2 .profile-card:nth-child(2){background:#fffbe3}.profile-v2 .profile-card:nth-child(3){background:#f0f4ff}.profile-v2 .profile-card:nth-child(4){background:#f7edf8}.profile-v2 .profile-card:nth-child(5){background:#edf8ef}
        .profile-v2 .profile-card small,.profile-v2 .profile-card span{color:#666;font-size:11px;line-height:11px}.profile-v2 .profile-card strong{font-size:18px;line-height:18px;margin:2px 0 0}
        .profile-v2 .profile-flights-panel{border:1px solid #777;margin-top:7px}.profile-v2 .profile-flights-title{font-weight:bold;text-align:center;background:#c7eef2;border-bottom:1px solid #777;padding:5px}
        .profile-v2 .profile-flight-window{overflow-x:auto;overflow-y:visible}.profile-v2 .profile-flight-table{table-layout:fixed;min-width:850px;font-size:12.5px}
        .profile-v2 .profile-flight-table th{position:sticky;top:0;z-index:2;text-align:center;font-size:12px;padding:6px}.profile-v2 .profile-flight-table td{padding:6px;vertical-align:middle}
        .profile-v2 .profile-flight-table td:not(:first-child){text-align:center}.profile-v2 .profile-flight-table td.finance-click-cell{font-size:14px;cursor:pointer;font-weight:bold}
        .profile-v2 .profile-flight-table td.finance-click-cell:hover,.profile-v2 .profile-flight-table td.finance-click-cell:focus{background:#fff7c7;outline:0}
        .profile-v2 .profile-sort-button,.profile-v2 .profile-aircraft-filter-button{border:0;background:transparent;width:100%;min-height:34px;padding:0;cursor:pointer;font:inherit;font-weight:bold;display:flex;align-items:center;justify-content:center;gap:5px}
        .profile-v2 .profile-sort-icon{display:inline-flex;flex-direction:column;font-size:8px;line-height:7px;color:#bbb}.profile-v2 .profile-sort-button[data-direction="asc"] .up,.profile-v2 .profile-sort-button[data-direction="desc"] .down{color:#17804c}
        .profile-v2 .profile-aircraft-filter-head{position:relative}.profile-v2 .profile-aircraft-filter-button.active{color:#08783f}.profile-v2 .profile-filter-hint{font-size:9px;color:#08783f;font-weight:normal}
        .profile-v2 .profile-aircraft-list{position:fixed;z-index:80;width:245px;max-height:320px;overflow:auto;border:1px solid #555;background:#fff;padding:4px;box-shadow:0 5px 18px #0004}
        .profile-v2 .profile-aircraft-list button{display:flex;justify-content:space-between;gap:6px;width:100%;border:1px solid #bbb;background:#fff;padding:5px;text-align:left;cursor:pointer}.profile-v2 .profile-aircraft-list button+button{margin-top:2px}.profile-v2 .profile-aircraft-list button:hover,.profile-v2 .profile-aircraft-list button.active{background:#fff7c7}
        .profile-v2 .profile-note{font-size:11px;color:#666;margin:6px 0}.profile-v2 .pie-hit-map{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;pointer-events:none}.profile-v2 .pie-hit-map path{pointer-events:auto;cursor:help}
        @media(max-width:720px){.profile-v2 .profile-identity{grid-template-columns:112px minmax(0,1fr)}.profile-v2 .profile-aircraft-awards{grid-column:1/-1}.profile-v2 .profile-period-bar{align-items:flex-start;flex-direction:column}.profile-v2 .profile-period-buttons{flex-wrap:wrap}.profile-v2 .profile-finance-grid,.profile-v2 .profile-finance-body{grid-template-columns:1fr}.profile-v2 .profile-cards{grid-template-columns:1fr 1fr}}
        body.mobile-cabinet .profile-v2 .profile-overall{display:block;table-layout:auto;width:100%}
        body.mobile-cabinet .profile-v2 .profile-overall colgroup{display:none}
        body.mobile-cabinet .profile-v2 .profile-overall tbody{display:grid;grid-template-columns:max-content minmax(0,1fr)}
        body.mobile-cabinet .profile-v2 .profile-overall tr{display:contents}
        body.mobile-cabinet .profile-v2 .profile-overall th,body.mobile-cabinet .profile-v2 .profile-overall td{display:block;min-width:0;padding:5px 6px;font-size:11px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:clip}
        body.mobile-cabinet .profile-v2 .profile-overall th{width:auto;max-width:none;justify-self:stretch;box-sizing:border-box}
        body.mobile-cabinet .profile-v2 .profile-overall td{text-align:left;font-family:Arial,sans-serif!important;font-size:10px!important;font-weight:400!important;letter-spacing:0!important}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(1) th:nth-of-type(1){order:1}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(1) td:nth-of-type(1){order:2}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(2) th:nth-of-type(1){order:3}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(2) td:nth-of-type(1){order:4}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(3) th:nth-of-type(1){order:5}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(3) td:nth-of-type(1){order:6}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(4) th:nth-of-type(1){order:7}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(4) td:nth-of-type(1){order:8}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(1) th:nth-of-type(2){order:9}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(1) td:nth-of-type(2){order:10}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(2) th:nth-of-type(2){order:11}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(2) td:nth-of-type(2){order:12}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(3) th:nth-of-type(2){order:13}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(3) td:nth-of-type(2){order:14}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(4) th:nth-of-type(2){order:15}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(4) td:nth-of-type(2){order:16}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(1) th:nth-of-type(3){order:17}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(1) td:nth-of-type(3){order:18}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(2) th:nth-of-type(3){order:19}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(2) td:nth-of-type(3){order:20}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(3) th:nth-of-type(3){order:21}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(3) td:nth-of-type(3){order:22}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(4) th:nth-of-type(3){order:23}
        body.mobile-cabinet .profile-v2 .profile-overall tbody tr:nth-child(4) td:nth-of-type(3){order:24}
        body.mobile-cabinet .profile-v2 .profile-overall th,body.mobile-cabinet .profile-v2 .profile-overall td{cursor:pointer}
        .mobile-profile-info-tooltip{position:fixed;left:8px;right:8px;bottom:10px;z-index:2000;box-sizing:border-box;max-height:55vh;overflow:auto;padding:9px 11px;border:1px solid #555;background:#fff;color:#222;font:12px/1.35 Arial,sans-serif;text-align:left;box-shadow:0 5px 18px #0005;white-space:pre-line}
        .mobile-profile-info-tooltip[hidden]{display:none}.mobile-profile-info-tooltip .profile-tooltip-rule{height:0;margin:6px 0;border:0;border-top:1px solid #ccc}.mobile-profile-info-tooltip .profile-tooltip-excluded{display:block;margin-top:6px;color:#888;font-style:italic}
        body.mobile-cabinet .profile-v2 .profile-finance:not(.profile-airline-benefit) .profile-finance-pie{display:none}
        body.mobile-cabinet .profile-v2 .profile-finance:not(.profile-airline-benefit) .profile-finance-body{display:block;height:auto;padding:8px;text-align:center}
        body.mobile-cabinet .profile-v2 .profile-finance:not(.profile-airline-benefit) .profile-finance-legend{display:inline-block;text-align:left}
        body.mobile-cabinet .profile-v2 .profile-airline-benefit .profile-finance-body{display:block;height:auto;padding:8px;text-align:center}
        body.mobile-cabinet .profile-v2 .profile-airline-benefit .profile-finance-pie{display:none}
        body.mobile-cabinet .profile-v2 .profile-airline-benefit .profile-finance-legend{display:inline-block;text-align:left}
      `;
      document.head.appendChild(style);
    }
    return {content,pickerButton,pickerList};
  }

  function piePoint(cx, cy, radius, percent) {
    const radians = (percent * 3.6 - 90) * Math.PI / 180;
    return {x:cx + radius * Math.cos(radians), y:cy + radius * Math.sin(radians)};
  }

  function piePath(startPercent, endPercent) {
    const start = piePoint(50,50,50,startPercent);
    const end = piePoint(50,50,50,endPercent);
    return `M 50 50 L ${start.x} ${start.y} A 50 50 0 ${endPercent-startPercent>50?1:0} 1 ${end.x} ${end.y} Z`;
  }

  function renderPie(element, segments, titleFn) {
    if (!element) return;
    const visible = segments.filter(segment => Number(segment.value) > 0);
    const total = sum(visible, segment => segment.value);
    if (!total) {
      element.style.background = '#f6f6f6';
      element.innerHTML = '';
      element.title = 'Немає даних за вибраний період';
      return;
    }
    let cursor = 0;
    const stops = [];
    const paths = [];
    visible.forEach(segment => {
      const start = cursor;
      cursor += Number(segment.value) / total * 100;
      const share = Number(segment.value) / total * 100;
      stops.push(`${segment.color} ${start}% ${cursor}%`);
      paths.push(`<path d="${piePath(start,cursor)}" fill="rgba(255,255,255,.001)"><title>${esc(titleFn(segment,share))}</title></path>`);
    });
    element.style.background = `conic-gradient(${stops.join(',')})`;
    element.innerHTML = `<svg class="pie-hit-map" viewBox="0 0 100 100" aria-hidden="true">${paths.join('')}</svg>`;
    element.removeAttribute('title');
  }

  function renderPicker() {
    const page = ensureProfilePage();
    const pilots = pickerPilots();
    page.pickerList.style.gridTemplateRows = `repeat(${Math.ceil(pilots.length / 3)}, auto)`;
    page.pickerList.innerHTML = pickerButtonsHtml(pilots);
    bindPickerButtons(page.pickerList);
    page.pickerButton.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      current = null;
      renderEmptyProfilePicker();
      page.pickerList.hidden = true;
      page.pickerButton.setAttribute('aria-expanded', 'false');
      if (!String(location.hash || '').startsWith('#profile')) location.hash = 'profile';
    };
    if (!current) renderEmptyProfilePicker();
  }

  function pickerPilots() {
    return [...new Set(availableFlights.map(flight => flight.pilot.id))]
      .map(id => summarize(id, availableFlights))
      .sort((a,b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  }

  function pickerButtonsHtml(pilots) {
    return pilots.map((pilot,index) =>
      `<a href="pilot-cabinet.html#profile/${encodeURIComponent(pilot.id)}" data-picker-pilot="${esc(pilot.id)}"><span class="picker-rank">#${index+1}</span><img class="picker-avatar" src="${esc(pilotAvatarUrl(pilot.avatar))}" alt="${esc(pilot.name)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='https://newsky.app/api/pilot/avatar/default'}"><strong>${pilotNameWithStreak(pilot)}</strong><span class="picker-hours">${compactTime(pilot.minutes)}</span></a>`
    ).join('');
  }

  function bindPickerButtons(root) {
    root.querySelectorAll('[data-picker-pilot]').forEach(link => link.onclick = event => {
      event.preventDefault();
      const id = link.dataset.pickerPilot;
      open(id, availableFlights);
      const url = new URL(window.location.href);
      url.searchParams.delete('pilot');
      url.hash = `profile/${encodeURIComponent(id)}`;
      history.replaceState(null, '', url);
    });
  }

  function renderEmptyProfilePicker() {
    const page = ensureProfilePage();
    const pilots = pickerPilots();
    page.content.innerHTML = `<div class="profile-empty profile-empty-picker"><div class="profile-empty-title">Виберіть пілота <span class="muted">(нумерація за загальним нальотом за АК)</span></div><div class="pilot-picker-list profile-inline-picker">${pickerButtonsHtml(pilots)}</div></div>`;
    const inlineList = page.content.querySelector('.profile-inline-picker');
    if (inlineList) {
      inlineList.style.gridTemplateRows = `repeat(${Math.ceil(pilots.length / 3)}, auto)`;
      bindPickerButtons(inlineList);
    }
  }

  function profileFinanceData(summary) {
    const flightCount = summary.rows.length;
    const occurrenceNote = count => count && flightCount ? ` (${count}/${flightCount} рейсів, ${Math.round(count / flightCount * 100)}%)` : '';
    const salary = sum(summary.rows, row => Math.max(0, Number(row.direct.pilotPay?.salaryBeforeDeductions) || 0));
    const premium = sum(summary.rows, row => Math.max(0, Number(row.direct.pilotPay?.managementBonus) || 0));
    const delays = sum(summary.rows, row => Math.max(0, Number(row.direct.pilotPay?.delayDeduction) || 0));
    const fdr = sum(summary.rows, row => Math.max(0, Number(row.direct.pilotPay?.fdrPenalty) || 0));
    const incidents = sum(summary.rows, row => Math.max(0, Number(row.direct.pilotPay?.incidentLiability) || 0));
    const insurance = sum(summary.rows, row => Math.max(0, Number(row.direct.pilotPay?.insuranceLiability) || 0));
    const fdrCount = summary.rows.filter(row => Number(row.direct.pilotPay?.fdrPenalty) > 0).length;
    const incidentCount = summary.rows.filter(row => Number(row.direct.pilotPay?.incidentLiability) > 0).length;
    const insuranceCount = summary.rows.filter(row => Number(row.direct.pilotPay?.insuranceLiability) > 0).length;
    return {
      categories:[
        {label:'Зарплата', value:salary, color:'#83c987', expense:false},
        {label:'Премія від керівництва', value:premium, color:'#65bfe3', expense:false},
        {label:'Затримки рейсів', value:delays, color:'#e4bb45', expense:true},
        {label:'Аналіз FDR', note:fdr ? occurrenceNote(fdrCount) : '', value:fdr, color:'#d98745', expense:true},
        {label:'Інциденти', note:incidents ? occurrenceNote(incidentCount) : '', value:incidents, color:'#d65f55', expense:true},
        {label:'Страхові випадки', note:insurance ? occurrenceNote(insuranceCount) : '', value:insurance, color:'#b51f2e', expense:true}
      ],
      total:summary.salary
    };
  }

  function renderFinanceAndPies(summary) {
    const ui = window.UCAADashboardFlightUI;
    const finance = profileFinanceData(summary);
    renderPie(document.querySelector('#profileFinancePie'), finance.categories, (segment,share) => `${segment.label}: ${money(segment.value)} (${share.toFixed(1)}%)`);
    document.querySelector('#profileFinanceLegend').innerHTML = finance.categories.map(segment =>
      `<div class="profile-finance-row"><strong>${segment.expense && segment.value ? '−' : ''}${compactMoney(segment.value)}</strong><i class="profile-finance-dot" style="background:${segment.color}"></i><span>${esc(segment.label)}${segment.note ? `<small class="profile-finance-note">${esc(segment.note)}</small>` : ''}</span></div>`
    ).join('') + `<div class="profile-finance-row profile-finance-total"><strong class="${finance.total<0?'negative':'positive'}">${money(finance.total,true)}</strong><i></i><span></span></div>`;

    const profitableFlights = sum(summary.rows,row => Math.max(0,Number(row.direct.companyProfit)||0));
    const lossFlights = sum(summary.rows,row => Math.max(0,-(Number(row.direct.companyProfit)||0)));
    const airlineSegments = [
      {label:'Зароблено для АК',value:profitableFlights,color:'#83c987'},
      {label:'Збитки для АК',value:lossFlights,color:'#d65f55'}
    ];
    renderPie(document.querySelector('#profileAirlineBenefitPie'),airlineSegments,(segment,share) => `${segment.label}: ${money(segment.value)} (${share.toFixed(1)}%)`);
    document.querySelector('#profileAirlineBenefitLegend').innerHTML = airlineSegments.map(segment =>
      `<div class="profile-finance-row"><strong>${segment.label === 'Збитки для АК' && segment.value ? '−' : ''}${compactMoney(segment.value)}</strong><i class="profile-finance-dot" style="background:${segment.color}"></i><span>${esc(segment.label)}</span></div>`
    ).join('') + `<div class="profile-finance-row profile-finance-total"><strong class="${summary.companyProfit<0?'negative':'positive'}">${money(summary.companyProfit,true)}</strong><i></i><span></span></div>`;

    const typeCounts = {charter:0,free:0,schedule:0};
    summary.completed.forEach(flight => {
      const key = ui.flightOperation(flight).key;
      typeCounts[key] = (typeCounts[key] || 0) + 1;
    });
    const typeSegments = Object.keys(TYPE_META).map(key => ({...TYPE_META[key], key, value:typeCounts[key] || 0}));
    renderPie(document.querySelector('#profileFlightTypePie'), typeSegments, (segment,share) => `${segment.label}: ${segment.value} ${flightWord(segment.value)} (${share.toFixed(1)}%)`);
    document.querySelector('#profileFlightTypeLegend').innerHTML = typeSegments.filter(segment => segment.value > 0).map(segment =>
      `<span class="profile-type-badge" style="background:${segment.color}" title="${esc(`${segment.label}: ${segment.value} ${flightWord(segment.value)}`)}">${esc(segment.label)}</span>`
    ).join('');

    const aircraftMap = new Map();
    summary.completed.forEach(flight => {
      const icao = String(flight.aircraft?.icao || '—').toUpperCase();
      const item = aircraftMap.get(icao) || {icao,name:flight.aircraft?.name || icao,value:0};
      item.value += 1;
      aircraftMap.set(icao,item);
    });
    const aircraftSegments = [...aircraftMap.values()].sort((a,b) => b.value-a.value || a.icao.localeCompare(b.icao)).slice(0,8)
      .map((item,index) => ({...item,label:item.icao,color:AIRCRAFT_COLORS[index]}));
    renderPie(document.querySelector('#profileAircraftTypePie'), aircraftSegments, (segment,share) => `${segment.icao} · ${segment.name}: ${segment.value} ${flightWord(segment.value)} (${share.toFixed(1)}%)`);
    document.querySelector('#profileAircraftTypeLegend').innerHTML = aircraftSegments.map(segment =>
      `<span class="profile-type-badge profile-aircraft-badge" style="background:${segment.color}" title="${esc(`${segment.icao} · ${segment.name}: ${segment.value} ${flightWord(segment.value)}`)}">${esc(segment.icao)}</span>`
    ).join('');

    const countryMap = new Map();
    const airportMap = new Map();
    summary.completed.forEach(flight => {
      [flight.departure,flight.arrival].forEach(airport => {
        const icao = String(airport?.icao || '').toUpperCase();
        if (icao) {
          const airportItem = airportMap.get(icao) || {icao,name:airport?.name || airport?.city || icao,value:0};
          airportItem.value += 1;
          airportMap.set(icao,airportItem);
        }
        const country = ui.countryForAirport?.(icao);
        if (country) {
          const countryItem = countryMap.get(country.cc) || {cc:country.cc,name:country.name,value:0};
          countryItem.value += 1;
          countryMap.set(country.cc,countryItem);
        }
      });
    });
    const countrySegments = [...countryMap.values()].sort((a,b) => b.value-a.value || a.name.localeCompare(b.name)).slice(0,8)
      .map((item,index) => ({...item,label:item.name,color:AIRCRAFT_COLORS[index]}));
    renderPie(document.querySelector('#profileCountryPie'),countrySegments,(segment,share) => `${segment.name}: ${segment.value} відвідувань (${share.toFixed(1)}%)`);
    document.querySelector('#profileCountryLegend').innerHTML = countrySegments.map(segment =>
      `<img class="profile-country-flag" src="https://flagcdn.com/w40/${esc(segment.cc)}.png" alt="${esc(segment.name)}" title="${esc(`${segment.name}: ${segment.value} відвідувань`)}">`
    ).join('');

    const airportSegments = [...airportMap.values()].sort((a,b) => b.value-a.value || a.icao.localeCompare(b.icao)).slice(0,8)
      .map((item,index) => ({...item,label:item.icao,color:AIRCRAFT_COLORS[index]}));
    renderPie(document.querySelector('#profileAirportPie'),airportSegments,(segment,share) => `${segment.icao} · ${segment.name}: ${segment.value} відвідувань (${share.toFixed(1)}%)`);
    document.querySelector('#profileAirportLegend').innerHTML = airportSegments.map(segment =>
      `<span class="profile-airport-badge" style="background:${segment.color}" title="${esc(`${segment.icao} · ${segment.name}: ${segment.value} відвідувань`)}">${esc(segment.icao)}</span>`
    ).join('');
  }

  function aircraftKey(flight) {
    return `${String(flight.aircraft?.icao || '').toUpperCase()}|${flight.aircraft?.name || ''}`;
  }

  function payloadSortValue(flight) {
    const cargo = Number(flight.operations?.cargoWeightKg || 0);
    const passengers = Number(flight.operations?.passengers || 0);
    return cargo > 0 && passengers <= 0 ? cargo : passengers * 100;
  }

  function sortedRows(flights) {
    const ui = window.UCAADashboardFlightUI;
    const filtered = current.aircraft ? flights.filter(flight => aircraftKey(flight) === current.aircraft) : flights;
    const rows = filtered.map(flight => ({flight,direct:ui.directFlightFinance(flight)}));
    const direction = current.sortDirection === 'asc' ? 1 : -1;
    const value = row => {
      if (current.sortField === 'date') return dateOf(row.flight).getTime();
      if (current.sortField === 'duration') return Number(row.flight.times?.durationMinutes || 0);
      if (current.sortField === 'payload') return payloadSortValue(row.flight);
      if (current.sortField === 'rating') return Number(row.flight.rating || 0);
      if (current.sortField === 'profit') return Number(row.direct.companyProfit || 0);
      if (current.sortField === 'salary') return Number(row.direct.pilotSalary || 0);
      return 0;
    };
    return rows.sort((a,b) => (value(a)-value(b))*direction || dateOf(b.flight)-dateOf(a.flight));
  }

  function sortButton(field, label) {
    const active = current.sortField === field;
    return `<button type="button" class="profile-sort-button" data-profile-sort="${field}" data-direction="${active?current.sortDirection:''}"><span>${label}</span><span class="profile-sort-icon" aria-hidden="true"><span class="up">▲</span><span class="down">▼</span></span></button>`;
  }

  function flightRow(row) {
    const ui = window.UCAADashboardFlightUI;
    const flight = row.flight;
    const date = dateOf(flight);
    const operation = ui.flightOperation(flight);
    const payload = ui.flightPayloadKind(flight);
    const rating = ui.flightRatingPresentation(flight);
    const profitVisual = ui.companyProfitVisual(flight,row.direct);
    const salaryVisual = ui.pilotSalaryVisual(flight,row.direct);
    return `<tr>
      <td>${formatFlightDateLabel(flight)}<span class="date-flight-meta"><span class="date-flight-time">${formatFlightCloseTime(flight)}</span><a class="flight-number-link flight-number-${operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${esc(operation.label)}">${esc(flight.flightNumber || '—')}</a></span></td>
      <td class="route"><span class="route-airports">${ui.airportWithFlag(flight.departure)} → ${ui.airportWithFlag(flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times?.durationMinutes)}</span></td>
      <td>${esc(flight.aircraft?.name || '—')}<span class="flight-note">${esc(ui.aircraftTableNote ? ui.aircraftTableNote(flight) : (flight.aircraft?.icao || ''))}</span></td>
      <td><span class="payload-value" title="${esc(payload.label)}">${esc(ui.flightLoad(flight))}<span class="load-kind-icon" aria-hidden="true">${payload.icon}</span></span></td>
      <td class="rating-cell profile-rating-detail" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="rating-badge ${rating.className}">${rating.label}</span><span class="landing-line">${ui.landingStats(flight)}</span></td>
      <td class="finance-click-cell profile-company-profit-detail ${profitVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(row.direct.companyProfit,true)}${profitVisual.notes.map(note => `<span class="profit-incident-note ${note.className}">${esc(note.text)}</span>`).join('')}</td>
      <td class="finance-click-cell profile-pilot-salary-detail ${salaryVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="salary-amount-inline">${money(row.direct.pilotSalary,true)}${ui.guaranteedBonusIconHtmlForRow ? ui.guaranteedBonusIconHtmlForRow(flight,row.direct.guaranteedBonus) : ''}</span>${salaryVisual.note?`<span class="profit-incident-note ${salaryVisual.noteClass || ''}">${esc(salaryVisual.note)}</span>`:''}</td>
    </tr>`;
  }

  function profileCalendarLabelHtml() {
    if (current?.period === 'customRange' && current.customDate && current.customEndDate) {
      return `<span>${esc(formatDateShort(current.customDate))}</span><span>${esc(formatDateShort(current.customEndDate))}</span>`;
    }
    if (current?.period === 'customDate' && current.customDate) return esc(formatDateShort(current.customDate));
    return '';
  }

  function render() {
    if (!current || !window.UCAADashboardFlightUI) return;
    const page = ensureProfilePage();
    const lifetime = summarize(current.id,availableFlights,'all');
    const selectedFlights = filterPeriod(lifetime.list,current.period);
    const selected = summarize(current.id,selectedFlights,`selected:${current.period}:${current.customDate || ''}:${current.customEndDate || ''}`);
    const monthSummary = summarize(current.id,filterPeriod(lifetime.list,'monthToDate'),'monthToDate');
    const weekSummary = summarize(current.id,filterPeriod(lifetime.list,'weekToDate'),'weekToDate');
    const completed = selected.completed;
    const rows = sortedRows(completed);
    const first = [...lifetime.list].sort((a,b) => dateOf(a)-dateOf(b))[0];
    const completedChronologically = [...lifetime.completed].sort((a,b) => dateOf(a)-dateOf(b));
    const firstCompleted = completedChronologically[0] || first;
    const lastCompleted = completedChronologically[completedChronologically.length-1] || first;
    const aircraft = selected.aircraft?.key.split('|');
    const overall = overallSummaries();
    const rankOf = (ranking,id=current.id) => ranking.findIndex(item => (item.summary?.id || item.id) === id)+1;
    const medalForRank = rank => rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
    const rankHtml = (rank,total=0) => rank > 0
      ? `<span class="profile-rank-place">#${rank} місце</span>${medalForRank(rank)?`<span class="profile-rank-medal" aria-label="${rank} місце">${medalForRank(rank)}</span>`:total>1&&rank===total?`<span class="profile-rank-medal anti" aria-label="Суперантигерой рейтингу">😎</span>`:''}`
      : '—';
    const lastFlightDate = summary => summary.completed.length
      ? dateOf([...summary.completed].sort((a,b) => dateOf(b)-dateOf(a))[0])
      : null;
    const isActivePilot = summary => {
      const lastDate = lastFlightDate(summary);
      return Boolean(lastDate && referenceNow-lastDate <= 40*86400000);
    };
    const rankingCandidates = overall.filter(item => item.completed.length >= 10);
    const rankedPilots = rankingCandidates.filter(isActivePilot);
    const currentHasTenFlights = lifetime.completed.length >= 10;
    const currentIsActive = isActivePilot(lifetime);
    const minimumTenGeneralTip = 'Необхідно мінімум 10 польотів за авіакомпанію для участі в рейтингу.';
    const inactivePilotTip = 'Пілот не літав більше 40 днів і тимчасово виключений із рейтингу.';
    const minimumTenTip = 'Необхідно мінімум 10 придатних польотів за авіакомпанію для участі у відсотковому рейтингу.';
    const hoursSorter = (a,b) => b.minutes-a.minutes || b.completed.length-a.completed.length;
    const profitSorter = (a,b) => b.companyProfit-a.companyProfit || b.completed.length-a.completed.length;
    const flightsSorter = (a,b) => b.completed.length-a.completed.length || b.minutes-a.minutes;
    const salarySorter = (a,b) => b.salary-a.salary || b.completed.length-a.completed.length;
    const ratingSorter = (a,b) => b.rating-a.rating || b.completed.length-a.completed.length;
    const hoursRanking = [...rankedPilots].sort(hoursSorter);
    const profitRanking = [...rankedPilots].sort(profitSorter);
    const flightsRanking = [...rankedPilots].sort(flightsSorter);
    const salaryRanking = [...rankedPilots].sort(salarySorter);
    const ratingRanking = [...rankedPilots].filter(item => item.rating > 0).sort(ratingSorter);
    const hoursFullRanking = [...rankingCandidates].sort(hoursSorter);
    const profitFullRanking = [...rankingCandidates].sort(profitSorter);
    const flightsFullRanking = [...rankingCandidates].sort(flightsSorter);
    const salaryFullRanking = [...rankingCandidates].sort(salarySorter);
    const ratingFullRanking = [...rankingCandidates].filter(item => item.rating > 0).sort(ratingSorter);
    const hoursRank = rankOf(hoursRanking);
    const profitRank = rankOf(profitRanking);
    const flightsRank = rankOf(flightsRanking);
    const salaryRank = rankOf(salaryRanking);
    const ratingRank = rankOf(ratingRanking);
    const summaryAverageFpm = summary => {
      const flights = summary.completed.filter(flight => window.UCAAPilotPay.landingFpm(flight)>0);
      return flights.length ? sum(flights,flight => window.UCAAPilotPay.landingFpm(flight)) / flights.length : 0;
    };
    const fpmSorter = (a,b) => summaryAverageFpm(a)-summaryAverageFpm(b) || b.rating-a.rating;
    const fpmRanking = [...rankedPilots].filter(item => summaryAverageFpm(item)>0).sort(fpmSorter);
    const fpmFullRanking = [...rankingCandidates].filter(item => summaryAverageFpm(item)>0).sort(fpmSorter);
    const fpmRank = rankOf(fpmRanking);
    const qualityStats = summary => {
      const eligible = summary.rows.filter(row => row.flight.status === 'completed'
        && !row.flight.operations?.emergency
        && Number.isFinite(Number(row.flight.rating))
        && Number(row.flight.rating) > 0);
      const clean = eligible.filter(row => {
        const pay = row.direct.pilotPay || {};
        return Math.max(0,Number(row.flight.finance?.penalties)||0) === 0
          && Math.max(0,Number(pay.delayDeduction)||0) === 0
          && Math.max(0,Number(pay.fdrPenalty)||0) === 0
          && Math.max(0,Number(pay.incidentLiability)||0) === 0
          && Math.max(0,Number(pay.insuranceLiability)||0) === 0
          && !pay.seriousIncident
          && Math.max(0,Number(pay.insuranceCase)||0) === 0;
      });
      const profitable = eligible.filter(row => {
        const finalCompanyProfit = Number(row.direct.companyProfit) || 0;
        const finalPilotSalary = Number(row.direct.pilotSalary) || 0;
        return finalCompanyProfit > 0 && finalPilotSalary > 0;
      });
      const averageRating = eligible.length ? sum(eligible,row => row.flight.rating) / eligible.length : 0;
      return {
        eligible:eligible.length,
        clean:clean.length,
        profitable:profitable.length,
        cleanPct:eligible.length ? clean.length / eligible.length * 100 : 0,
        profitablePct:eligible.length ? profitable.length / eligible.length * 100 : 0,
        averageRating
      };
    };
    const qualityRows = overall.map(summary => ({summary,...qualityStats(summary)}));
    const rankedQualityCandidates = qualityRows.filter(item => item.eligible >= 10);
    const rankedQuality = rankedQualityCandidates.filter(item => isActivePilot(item.summary));
    const cleanSorter = (a,b) => b.cleanPct-a.cleanPct || b.averageRating-a.averageRating || b.eligible-a.eligible;
    const profitableSorter = (a,b) => b.profitablePct-a.profitablePct || b.eligible-a.eligible || b.averageRating-a.averageRating;
    const cleanRanking = [...rankedQuality].sort(cleanSorter);
    const profitableRanking = [...rankedQuality].sort(profitableSorter);
    const cleanFullRanking = [...rankedQualityCandidates].sort(cleanSorter);
    const profitableFullRanking = [...rankedQualityCandidates].sort(profitableSorter);
    const currentQuality = qualityRows.find(item => item.summary.id === current.id) || {...qualityStats(lifetime),summary:lifetime};
    const cleanRank = cleanRanking.findIndex(item => item.summary.id === current.id)+1;
    const profitableRank = profitableRanking.findIndex(item => item.summary.id === current.id)+1;
    const excludedRankingNote = (fullRanking, activeRanking, getSummary = item => item.summary || item) => {
      const activeIds = new Set(activeRanking.map(item => getSummary(item).id));
      const excluded = fullRanking
        .map((item,index) => ({item,index,summary:getSummary(item)}))
        .filter(entry => !activeIds.has(entry.summary.id)
          && !isActivePilot(entry.summary)
          && (entry.index < 3 || entry.index >= fullRanking.length-3));
      return excluded.length
        ? `\n@@EXCLUDED@@\n* Випали з рейтингу:\n${excluded.map(entry => `${entry.index+1}. ${entry.summary.name} (не літав 40+ днів)`).join('\n')}`
        : '';
    };
    const rankingTooltip = (ranking,fullRanking,field,label) => {
      const leaders = ranking.slice(0,3);
      const outsiders = ranking.slice(-3);
      return leaders.length
        ? `ТОП-3:\n${leaders.map((item,index) => `${index+1}. ${item.summary.name} — ${item[field].toFixed(1)}% (${field==='cleanPct'?item.clean:item.profitable}/${item.eligible})`).join('\n')}\n...\n${outsiders.map((item,index) => `${ranking.length-outsiders.length+index+1}. ${item.summary.name} — ${item[field].toFixed(1)}% (${field==='cleanPct'?item.clean:item.profitable}/${item.eligible})`).join('\n')}${excludedRankingNote(fullRanking,ranking)}`
        : `ТОП-3 ще не сформовано: немає пілотів із 10+ придатними рейсами.`;
    };
    const cleanNameTip = 'Чисті польоти без штрафів, FDR, затримок, інцидентів і страхових випадків.\nЗбитковий рейс теж вважається чистим, якщо порушень не було.\nEmergency-рейси та рейси без фінального рейтингу не враховуються.\nМісця порівнюються лише після 10 придатних рейсів.\nПри однаковому відсотку вище пілот із кращим середнім рейтингом.';
    const profitableNameTip = 'Прибутковим вважається рейс, де обидва фінальні результати позитивні:\n• Прибуток авіакомпанії > $0\n• Зарплата пілота > $0\n\nУсі штрафи, інциденти, компенсації та утримання вже враховані у фінальних сумах.\nEmergency-рейси та рейси без фінального рейтингу не враховуються.\nМісця порівнюються лише після 10 придатних рейсів.\nПри однаковому відсотку вище пілот із більшою кількістю придатних рейсів.';
    const cleanValueTip = currentQuality.eligible < 10
      ? `${currentQuality.clean}/${currentQuality.eligible} рейсів без штрафів (${currentQuality.cleanPct.toFixed(0)}%).\n\n${minimumTenTip}`
      : `${currentQuality.clean}/${currentQuality.eligible} рейсів без штрафів (${currentQuality.cleanPct.toFixed(0)}%).\n\n${currentIsActive?'':`${inactivePilotTip}\n\n`}${rankingTooltip(cleanRanking,cleanFullRanking,'cleanPct','польоти без штрафів')}`;
    const profitableValueTip = currentQuality.eligible < 10
      ? `${currentQuality.profitable}/${currentQuality.eligible} прибуткових рейсів (${currentQuality.profitablePct.toFixed(0)}%).\n\n${minimumTenTip}`
      : `${currentQuality.profitable}/${currentQuality.eligible} прибуткових рейсів (${currentQuality.profitablePct.toFixed(0)}%).\n\n${currentIsActive?'':`${inactivePilotTip}\n\n`}${rankingTooltip(profitableRanking,profitableFullRanking,'profitablePct','прибуткові польоти')}`;
    const averageDifficulty = summary => summary.completed.length
      ? sum(summary.completed,flight => window.UCAAPilotPay.aircraftCoefficient(flight.aircraft?.icao,flight.flightType)) / summary.completed.length
      : 0;
    const difficultySorter = (a,b) => averageDifficulty(b)-averageDifficulty(a) || b.completed.length-a.completed.length;
    const difficultyRanking = [...rankedPilots].sort(difficultySorter);
    const difficultyFullRanking = [...rankingCandidates].sort(difficultySorter);
    const difficultyRank = rankOf(difficultyRanking);
    const averageCrosswind = summary => {
      const flights = summary.completed.filter(flight => Number.isFinite(Number(flight.operations?.touchdownWeather?.crosswind)));
      return flights.length ? sum(flights,flight => Math.abs(Number(flight.operations.touchdownWeather.crosswind))) / flights.length : 0;
    };
    const crosswindSorter = (a,b) => averageCrosswind(b)-averageCrosswind(a) || summaryAverageFpm(a)-summaryAverageFpm(b) || b.completed.length-a.completed.length;
    const crosswindRanking = [...rankedPilots].filter(item => averageCrosswind(item)>0).sort(crosswindSorter);
    const crosswindFullRanking = [...rankingCandidates].filter(item => averageCrosswind(item)>0).sort(crosswindSorter);
    const crosswindRank = rankOf(crosswindRanking);
    const flightsWithFpm = lifetime.completed.filter(flight => window.UCAAPilotPay.landingFpm(flight)>0);
    const averageFpm = flightsWithFpm.length
      ? sum(flightsWithFpm,flight => window.UCAAPilotPay.landingFpm(flight)) / flightsWithFpm.length
      : 0;
    const latestFlight = [...lifetime.completed].sort((a,b) => dateOf(b)-dateOf(a))[0];
    const latestPay = latestFlight ? directFlightFinance(latestFlight).pilotPay : null;
    const loyaltyK = Number(latestPay?.loyaltyK) || 1;
    const regularityK = Number(latestPay?.regularityK) || 1;
    const baseRegularityK = Number(latestPay?.baseRegularityK || latestPay?.regularityK) || 1;
    const streakDays = liveRegularityStreakForPilot(current.id, availableFlights, referenceNow || new Date());
    const streakK = window.UCAAPilotPay.streakCoefficient(streakDays);
    const streakText = streakDays >= 5 ? '5+ вогників' : streakDays > 0 ? `${streakDays} вогн${streakDays === 1 ? 'ик' : 'ики/иків'}` : 'без вогників';
    const regularityDisplay = `×${baseRegularityK.toFixed(2)}${streakK > 1 ? `×${streakK.toFixed(2)}🔥` : ''}`;
    const loyaltyTip = 'Лояльність залежить від часу в авіакомпанії та загальної кількості рейсів.\n\n×1.05 — 1 день і 1 рейс\n×1.10 — 7 днів і 5 рейсів\n×1.15 — 14 днів і 10 рейсів\n×1.20 — 1 місяць і 15 рейсів\n×1.25 — 2 місяці і 20 рейсів\n×1.30 — 3 місяці і 30 рейсів\n×1.35 — 4 місяці і 40 рейсів\n×1.40 — 5 місяців і 50 рейсів\n×1.45 — 6 місяців і 60 рейсів\n×1.50 — понад 6 місяців і понад 60 рейсів';
    const regularityTip = `Регулярність залежить від кількості рейсів за останні періоди.\n\n×1.05 — 1 рейс за 30 днів\n×1.10 — 5 рейсів за 10 днів\n×1.20 — 10 рейсів за 20 днів\n×1.30 — 15 рейсів за 30 днів\n×1.40 — 20 рейсів за 30 днів\n×1.50 — 30+ рейсів за 30 днів\n\nLIVE flight streak станом на сьогодні: ${streakText} → ×${streakK.toFixed(2)}.\n1 вогник — ×1.10; 2 — ×1.20; 3 — ×1.30; 4 — ×1.40; 5+ — ×1.50.`;
    const difficultyVisibleTypes = new Set(companyFleetTypes);
    availableFlights.forEach(flight => {
      const code = String(flight.aircraft?.icao || '').trim().toUpperCase();
      if (!code) return;
      difficultyVisibleTypes.add(code);
      if (String(flight.flightType || '').toLowerCase() === 'cargo'
        && window.UCAAAircraftDifficulty?.coefficients?.[`${code}F`] != null) {
        difficultyVisibleTypes.add(`${code}F`);
      }
    });
    const defaultDifficulty = Number(window.UCAAAircraftDifficulty?.defaultCoefficient || 1.25);
    const difficultyGroups = new Map();
    Object.entries(window.UCAAAircraftDifficulty?.coefficients || {}).forEach(([icao,value]) => {
      const coefficient = Number(value);
      const code = String(icao).toUpperCase();
      if (!Number.isFinite(coefficient) || !difficultyVisibleTypes.has(code) || coefficient === defaultDifficulty) return;
      const codes = difficultyGroups.get(coefficient) || [];
      codes.push(code);
      difficultyGroups.set(coefficient,codes);
    });
    const difficultyRows = [...difficultyGroups.entries()]
      .map(([coefficient,codes]) => ({
        coefficient,
        text:`${coefficient.toFixed(2).replace('.',',')} — ${codes.sort((a,b) => a.localeCompare(b)).join(', ')}`
      }));
    difficultyRows.push({
      coefficient:defaultDifficulty,
      text:`${defaultDifficulty.toFixed(2).replace('.',',')} — усі інші типи, відсутні у списку.`
    });
    const difficultyTip = [
      'Середнє арифметичне коефіцієнтів складності літаків, на яких пілот виконував рейси.',
      ...difficultyRows.sort((a,b) => a.coefficient-b.coefficient).map(row => row.text)
    ].join('\n@@LINE@@\n');
    const crosswindTip = 'Середня сила бокового вітру під час посадок, для яких доступні погодні дані.\nВищий середній crosswind дає вище місце.\nЯкщо значення однакові, вище пілот із середнім FPM ближчим до нуля.';
    const metricTooltip = (ranking,fullRanking,valueFn,formatFn,label) => {
      if (!ranking.length) return `Рейтинг «${label}» ще не сформовано.`;
      const top = ranking.slice(0,3);
      const bottom = ranking.slice(-3);
      const lines = items => items.map((item,index) => {
        const rank = ranking.indexOf(item)+1;
        return `${rank}. ${item.name} — ${formatFn(valueFn(item))}`;
      }).join('\n');
      return `ТОП-3:\n${lines(top)}\n...\n${lines(bottom)}${excludedRankingNote(fullRanking,ranking,item=>item)}`;
    };
    const ratedTip = (ranking,fullRanking,valueFn,formatFn,label) => !currentHasTenFlights
      ? minimumTenGeneralTip
      : `${currentIsActive?'':`${inactivePilotTip}\n\n`}${metricTooltip(ranking,fullRanking,valueFn,formatFn,label)}`;
    const hoursValueTip = ratedTip(hoursRanking,hoursFullRanking,item=>item.minutes,compactTime,'наліт');
    const flightsValueTip = ratedTip(flightsRanking,flightsFullRanking,item=>item.completed.length,value=>`${value} ${flightWord(value)}`,'кількість рейсів');
    const profitValueTip = ratedTip(profitRanking,profitFullRanking,item=>item.companyProfit,value=>money(value,true),'прибуток для авіакомпанії');
    const salaryValueTip = ratedTip(salaryRanking,salaryFullRanking,item=>item.salary,value=>money(value,true),'зарплата пілота');
    const ratingValueTip = ratedTip(ratingRanking,ratingFullRanking,item=>item.rating,value=>value.toFixed(2),'середній рейтинг');
    const fpmValueTip = ratedTip(fpmRanking,fpmFullRanking,summaryAverageFpm,value=>`−${Math.round(value)} fpm`,'середній FPM');
    const difficultyValueTip = ratedTip(difficultyRanking,difficultyFullRanking,averageDifficulty,value=>value.toFixed(2),'середня складність літака');
    const crosswindValueTip = ratedTip(crosswindRanking,crosswindFullRanking,averageCrosswind,value=>`${value.toFixed(1)} kt`,'середній crosswind');
    const avatar = avatarUrl(lifetime.avatar);
    const simStats = simulatorSummary(lifetime.completed);
    const simBadge = simStats.leader
      ? `<span class="profile-sim-badge profile-tip" data-tooltip="${esc(simStats.tooltip)}">${esc(simStats.leader.label)}</span>`
      : '';
    const aircraftOptions = [...new Map(completed.map(flight => [aircraftKey(flight),{
      key:aircraftKey(flight),
      icao:String(flight.aircraft?.icao || '').toUpperCase(),
      name:flight.aircraft?.name || 'Літак'
    }])).values()].sort((a,b) => a.icao.localeCompare(b.icao));
    const selectedAircraft = aircraftOptions.find(item => item.key === current.aircraft);

    const membershipDays = profileMembershipDays(firstCompleted);
    const membershipText = membershipDays ? `${membershipDays} ${dayWord(membershipDays)}` : '—';
    page.content.innerHTML = `<div class="profile-v2">
      <div class="profile-identity"><div class="profile-avatar-wrap"><img class="profile-avatar" src="${esc(avatar)}" alt="${esc(lifetime.name)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='https://newsky.app/api/pilot/avatar/default'}">${simBadge}</div><div class="profile-person"><h3><span class="profile-title-name">${pilotNameWithStreak(lifetime)}</span></h3><div class="profile-newsky-row"><a class="profile-badge profile-tip" data-tooltip="Відкрити профіль пілота у NewSky" href="https://newsky.app/pilot/${encodeURIComponent(lifetime.id)}" target="_blank" rel="noopener noreferrer">NewSky</a><a class="profile-badge profile-tip" data-tooltip="Відкрити список всіх нагород у NewSky" href="https://newsky.app/airline/ukl/awards" target="_blank" rel="noopener noreferrer">Список Awards</a></div><small>В авіакомпанії: ${esc(membershipText)}</small>${profileFleetRoleHtml(lifetime.id)}</div>${aircraftAwardsHtml(lifetime)}</div>
      <div class="profile-section-title">ЗАГАЛЬНА ІНФОРМАЦІЯ ПРО ПІЛОТА</div>
      <table class="profile-overall"><colgroup><col style="width:14%"><col style="width:19%"><col style="width:16.7%"><col style="width:20%"><col style="width:calc(13.3% + 8px)"><col style="width:calc(17% - 8px)"></colgroup><tbody>
        <tr><th>Наліт за весь час</th><td class="profile-tip" data-tooltip="${esc(hoursValueTip)}">${compactTime(lifetime.minutes)}<span class="profile-divider">|</span>${rankHtml(hoursRank,hoursRanking.length)}</td><th>Прибуток для АК</th><td class="profile-tip" data-tooltip="${esc(profitValueTip)}">${money(lifetime.companyProfit,true)}<span class="profile-divider">|</span>${rankHtml(profitRank,profitRanking.length)}</td><th class="profile-tip" data-tooltip="${esc(cleanNameTip)}">Польотів без штрафів</th><td class="profile-tip" data-tooltip="${esc(cleanValueTip)}">${currentQuality.cleanPct.toFixed(0)}%<span class="profile-divider">|</span>${rankHtml(cleanRank,cleanRanking.length)}</td></tr>
        <tr><th>Рейсів за весь час</th><td class="profile-tip" data-tooltip="${esc(flightsValueTip)}">${lifetime.completed.length}<span class="profile-divider">|</span>${rankHtml(flightsRank,flightsRanking.length)}</td><th>Зарплата пілота</th><td class="profile-tip" data-tooltip="${esc(salaryValueTip)}">${money(lifetime.salary)}<span class="profile-divider">|</span>${rankHtml(salaryRank,salaryRanking.length)}</td><th class="profile-tip" data-tooltip="${esc(profitableNameTip)}">Прибуткових польотів</th><td class="profile-tip" data-tooltip="${esc(profitableValueTip)}">${currentQuality.profitablePct.toFixed(0)}%<span class="profile-divider">|</span>${rankHtml(profitableRank,profitableRanking.length)}</td></tr>
        <tr><th>Середній рейтинг</th><td class="profile-tip" data-tooltip="${esc(ratingValueTip)}">${lifetime.rating?lifetime.rating.toFixed(2):'—'}<span class="profile-divider">|</span>${rankHtml(ratingRank,ratingRanking.length)}</td><th class="profile-tip" data-tooltip="${esc(difficultyTip)}">Середня складність літака</th><td class="profile-tip" data-tooltip="${esc(difficultyValueTip)}">${averageDifficulty(lifetime).toFixed(2)}<span class="profile-divider">|</span>${rankHtml(difficultyRank,difficultyRanking.length)}</td><th class="profile-tip" data-tooltip="${esc(loyaltyTip)}">Бонус за лояльність</th><td class="profile-tip" data-tooltip="${esc(loyaltyTip)}">×${loyaltyK.toFixed(2)}</td></tr>
        <tr><th>Середній FPM</th><td class="profile-tip" data-tooltip="${esc(fpmValueTip)}">${averageFpm?`−${Math.round(averageFpm)} fpm`:'—'}<span class="profile-divider">|</span>${rankHtml(fpmRank,fpmRanking.length)}</td><th>Середній Crosswind</th><td class="profile-tip" data-tooltip="${esc(crosswindValueTip)}">${averageCrosswind(lifetime).toFixed(1)} kt<span class="profile-divider">|</span>${rankHtml(crosswindRank,crosswindRanking.length)}</td><th class="profile-tip" data-tooltip="${esc(regularityTip)}">Бонус за регулярність</th><td class="profile-tip" data-tooltip="${esc(regularityTip)}">${regularityDisplay}</td></tr>
      </tbody></table>
      <div class="profile-period-bar"><span class="profile-period-icon" title="Період">⏱️</span><div class="profile-period-buttons">${PERIODS.map(([key,label]) => `<button type="button" data-profile-period="${key}" class="${current.period===key?'active':''}">${label}</button>`).join('')}<span class="profile-calendar"><button type="button" id="profileCalendarButton" class="${current.period==='customDate'||current.period==='customRange'||profileCalendarOpen?'active':''}" title="Вибрати дату або період" aria-label="Вибрати дату або період">📅<span id="profileCalendarLabel" class="profile-calendar-label">${profileCalendarOpen?'':profileCalendarLabelHtml()}</span></button><div id="profileCalendarPanel" class="profile-calendar-panel" ${profileCalendarOpen?'':'hidden'}><div class="profile-calendar-modes"><button type="button" data-profile-calendar-mode="date" class="${profileCalendarMode==='date'?'active':''}">За дату</button><button type="button" data-profile-calendar-mode="range" class="${profileCalendarMode==='range'?'active':''}">За період</button></div><div id="profileCalendarFields" class="profile-calendar-fields ${profileCalendarMode==='range'?'range':''}"><input type="date" id="profileDatePicker" value="${esc(profileCalendarPickerValue || current.customDate || '')}" aria-label="Вибрати дату"><input type="text" id="profileDateEndDisplay" value="${esc(formatDateShort(current.customEndDate))}" readonly title="Вибрати кінцеву дату" ${profileCalendarMode==='range'?'':'hidden'}></div></div></span></div></div>
      <div class="profile-dashboard">
        <div class="profile-finance-grid"><div class="profile-finance-stack"><section class="profile-finance"><div class="profile-finance-title">ФІНАНСОВЕ КОЛО ПІЛОТА · ${esc(periodName(current.period))}</div><div class="profile-finance-body"><div class="profile-finance-pie" id="profileFinancePie"></div><div class="profile-finance-legend" id="profileFinanceLegend"></div></div></section><section class="profile-finance profile-airline-benefit"><div class="profile-finance-title">ПРИБУТОК ДЛЯ АВІАКОМПАНІЇ · ${esc(periodName(current.period))}</div><div class="profile-finance-body"><div class="profile-finance-pie" id="profileAirlineBenefitPie"></div><div class="profile-finance-legend" id="profileAirlineBenefitLegend"></div></div></section></div><div class="profile-mini-pies"><div class="profile-mini-pie-block"><div class="profile-mini-title">УЛЮБЛЕНИЙ АЕРОПОРТ</div><div class="profile-mini-pie" id="profileAirportPie"></div><div class="profile-mini-labels aircraft" id="profileAirportLegend"></div></div><div class="profile-mini-pie-block"><div class="profile-mini-title">ТИП ЛІТАКА</div><div class="profile-mini-pie" id="profileAircraftTypePie"></div><div class="profile-mini-labels aircraft" id="profileAircraftTypeLegend"></div></div><div class="profile-mini-pie-block"><div class="profile-mini-title">УЛЮБЛЕНА КРАЇНА</div><div class="profile-mini-pie" id="profileCountryPie"></div><div class="profile-mini-labels countries" id="profileCountryLegend"></div></div><div class="profile-mini-pie-block"><div class="profile-mini-title">ТИП РЕЙСУ</div><div class="profile-mini-pie" id="profileFlightTypePie"></div><div class="profile-mini-labels" id="profileFlightTypeLegend"></div></div></div></div>
        <div class="profile-cards"><div class="profile-card"><small>Середній рейтинг</small><strong>${selected.rating?selected.rating.toFixed(2):'—'}</strong><span>${esc(periodCaption())}</span></div><div class="profile-card"><small>Рейсів виконано</small><strong>${selected.completed.length}</strong><span>${esc(periodCaption())}</span></div><div class="profile-card"><small>Наліт пілота</small><strong>${formatMinutes(selected.minutes)}</strong><span>${esc(periodCaption())}</span></div><div class="profile-card"><small>Прибуток для АК</small><strong class="${selected.companyProfit<0?'negative':'positive'}">${money(selected.companyProfit,true)}</strong><span>${esc(periodCaption())}</span></div><div class="profile-card"><small>Зарплата пілота</small><strong>${money(selected.salary)}</strong><span>${esc(periodCaption())}</span></div></div>
      </div>
      <section class="profile-flights-panel"><div class="profile-flights-title">ВИКОНАНІ РЕЙСИ ЗА ВИБРАНИЙ ПЕРІОД</div><div class="profile-flight-window"><table class="profile-flight-table dashboard-flight-table"><colgroup><col style="width:13%"><col style="width:17%"><col style="width:22%"><col style="width:9%"><col style="width:14%"><col style="width:14%"><col style="width:11%"></colgroup><thead><tr><th>${sortButton('date','Дата /<br>Рейс')}</th><th>${sortButton('duration','Маршрут /<br>Тривалість')}</th><th class="profile-aircraft-filter-head"><button type="button" id="profileAircraftFilterButton" class="profile-aircraft-filter-button ${current.aircraft?'active':''}"><span>Літак${selectedAircraft?` ${esc(selectedAircraft.icao)}`:''}</span><span class="profile-filter-hint">(фільтр)</span></button><span id="profileAircraftFilterList" class="profile-aircraft-list" hidden></span></th><th>${sortButton('payload','Пейлоад')}</th><th>${sortButton('rating','Рейтинг /<br>посадка')}</th><th>${sortButton('profit','Прибуток<br>авіакомпанії')}</th><th>${sortButton('salary','Зарплата<br>пілота')}</th></tr></thead><tbody>${rows.length?rows.map(flightRow).join(''):'<tr><td colspan="7" style="text-align:center;padding:14px">За вибраний період рейсів немає</td></tr>'}</tbody></table></div></section>
      <p class="profile-note">* Персональна ставка формується з базових $65/год, лояльності, регулярності та flight streak-бонусу. Детальний розрахунок доступний натисканням на зарплату конкретного рейсу.</p>
    </div>`;

    wireAircraftAwardTooltips(page.content);
    page.content.querySelectorAll('.profile-tip[data-tooltip]').forEach(element => {
      const [mainText,excludedText=''] = String(element.dataset.tooltip || '').split('\n@@EXCLUDED@@\n');
      const box = document.createElement('span');
      box.className = 'profile-tooltip-box';
      const sections = mainText.split('\n@@LINE@@\n');
      sections.forEach((section,index) => {
        if (index) {
          const rule = document.createElement('hr');
          rule.className = 'profile-tooltip-rule';
          box.appendChild(rule);
        }
        const text = document.createElement('span');
        text.className = 'profile-tooltip-section';
        text.textContent = section;
        box.appendChild(text);
      });
      if (excludedText) {
        const excluded = document.createElement('em');
        excluded.className = 'profile-tooltip-excluded';
        excluded.textContent = excludedText;
        box.appendChild(excluded);
      }
      element.appendChild(box);
    });
    const getMobileProfileTooltip = () => {
      let box = document.getElementById('mobileProfileInfoTooltip');
      if (!box) {
        box = document.createElement('div');
        box.id = 'mobileProfileInfoTooltip';
        box.className = 'mobile-profile-info-tooltip';
        box.hidden = true;
        document.body.appendChild(box);
        document.addEventListener('click', event => {
          if (!isMobileProfileView()) return;
          if (box.hidden) return;
          if (box.contains(event.target)) return;
          if (event.target.closest?.('.profile-overall')) return;
          box.hidden = true;
        });
        document.addEventListener('keydown', event => {
          if (event.key === 'Escape') box.hidden = true;
        });
      }
      return box;
    };
    const profileOverallTipSource = cell => {
      if (cell?.matches?.('.profile-tip[data-tooltip]')) return cell;
      const next = cell?.nextElementSibling;
      if (next?.matches?.('.profile-tip[data-tooltip]')) return next;
      const prev = cell?.previousElementSibling;
      if (prev?.matches?.('.profile-tip[data-tooltip]')) return prev;
      return null;
    };
    page.content.querySelectorAll('.profile-overall th,.profile-overall td').forEach(cell => {
      cell.addEventListener('click', event => {
        if (!isMobileProfileView()) return;
        const source = profileOverallTipSource(cell);
        if (!source) return;
        const sourceBox = source.querySelector('.profile-tooltip-box');
        if (!sourceBox) return;
        event.preventDefault();
        event.stopPropagation();
        const mobileBox = getMobileProfileTooltip();
        mobileBox.innerHTML = sourceBox.innerHTML;
        mobileBox.hidden = false;
      });
    });
    renderFinanceAndPies(selected);
    page.content.querySelectorAll('[data-profile-period]').forEach(button => button.onclick = () => {
      current.period = button.dataset.profilePeriod;
      current.customDate = '';
      current.customEndDate = '';
      current.aircraft = null;
      profileCalendarOpen = false;
      profileCalendarRangePickingEnd = false;
      profileCalendarPickerValue = '';
      render();
    });
    const datePicker = page.content.querySelector('#profileDatePicker');
    const calendarButton = page.content.querySelector('#profileCalendarButton');
    if (calendarButton && datePicker) calendarButton.onclick = event => {
      event.preventDefault();
      profileCalendarOpen = !profileCalendarOpen;
      if (profileCalendarOpen) {
        profileCalendarRangePickingEnd = false;
        profileCalendarPickerValue = '';
        render();
        setTimeout(() => {
          const nextPicker = ensureProfilePage().content.querySelector('#profileDatePicker');
          try {
            if (typeof nextPicker?.showPicker === 'function') nextPicker.showPicker();
            else nextPicker?.click();
          } catch {
            nextPicker?.focus();
            nextPicker?.click();
          }
        }, 0);
      } else render();
    };
    page.content.querySelectorAll('[data-profile-calendar-mode]').forEach(button => button.onclick = event => {
      event.preventDefault();
      profileCalendarMode = button.dataset.profileCalendarMode || 'date';
      profileCalendarOpen = true;
      profileCalendarRangePickingEnd = false;
      profileCalendarPickerValue = '';
      render();
      setTimeout(() => {
        const nextPicker = ensureProfilePage().content.querySelector('#profileDatePicker');
        try {
          if (typeof nextPicker?.showPicker === 'function') nextPicker.showPicker();
          else nextPicker?.click();
        } catch {
          nextPicker?.focus();
          nextPicker?.click();
        }
      }, 0);
    });
    if (datePicker) {
      datePicker.onclick = () => {
        if (profileCalendarMode === 'range') profileCalendarRangePickingEnd = false;
      };
      datePicker.onchange = () => {
        if (!datePicker.value) return;
        if (profileCalendarMode === 'range' && profileCalendarRangePickingEnd) {
          current.customEndDate = datePicker.value;
          current.period = current.customDate === current.customEndDate ? 'customDate' : 'customRange';
          current.aircraft = null;
          profileCalendarOpen = false;
          profileCalendarRangePickingEnd = false;
          profileCalendarPickerValue = '';
          render();
          return;
        }
        current.customDate = datePicker.value;
        if (profileCalendarMode === 'date') {
          current.period = 'customDate';
          current.customEndDate = '';
          current.aircraft = null;
          profileCalendarOpen = false;
          render();
        } else {
          profileCalendarOpen = true;
          profileCalendarRangePickingEnd = true;
          profileCalendarPickerValue = '';
          render();
          setTimeout(() => {
            const nextPicker = ensureProfilePage().content.querySelector('#profileDatePicker');
            try {
              if (typeof nextPicker?.showPicker === 'function') nextPicker.showPicker();
              else nextPicker?.click();
            } catch {
              nextPicker?.focus();
              nextPicker?.click();
            }
          }, 0);
        }
      };
    }
    const dateEndDisplay = page.content.querySelector('#profileDateEndDisplay');
    if (dateEndDisplay) dateEndDisplay.onclick = event => {
      event.preventDefault();
      profileCalendarMode = 'range';
      profileCalendarOpen = true;
      profileCalendarRangePickingEnd = true;
      profileCalendarPickerValue = current.customEndDate || current.customDate || '';
      render();
      setTimeout(() => {
        const nextPicker = ensureProfilePage().content.querySelector('#profileDatePicker');
        try {
          if (typeof nextPicker?.showPicker === 'function') nextPicker.showPicker();
          else nextPicker?.click();
        } catch {
          nextPicker?.focus();
          nextPicker?.click();
        }
      }, 0);
    };
    page.content.querySelectorAll('[data-profile-sort]').forEach(button => button.onclick = () => {
      const field = button.dataset.profileSort;
      if (current.sortField === field) current.sortDirection = current.sortDirection === 'desc' ? 'asc' : 'desc';
      else {
        current.sortField = field;
        current.sortDirection = 'desc';
      }
      render();
    });
    const filterButton = page.content.querySelector('#profileAircraftFilterButton');
    const filterList = page.content.querySelector('#profileAircraftFilterList');
    if (filterButton && filterList) {
      filterList.innerHTML = `<button type="button" data-profile-aircraft="" class="${current.aircraft?'':'active'}"><span>Усі літаки</span><small>${completed.length} рейсів</small></button>${aircraftOptions.map(item => `<button type="button" data-profile-aircraft="${esc(item.key)}" class="${current.aircraft===item.key?'active':''}"><span>${esc(item.icao)}</span><small>${esc(item.name)}</small></button>`).join('')}`;
      filterButton.onclick = event => {
        event.stopPropagation();
        const rect = filterButton.getBoundingClientRect();
        filterList.style.left = `${Math.round(rect.left)}px`;
        filterList.style.top = `${Math.round(rect.bottom-1)}px`;
        filterList.hidden = !filterList.hidden;
      };
      filterList.querySelectorAll('[data-profile-aircraft]').forEach(button => button.onclick = event => {
        event.stopPropagation();
        current.aircraft = button.dataset.profileAircraft || null;
        render();
      });
    }
    const flightById = flightId => completed.find(flight => flight.id === flightId);
    const bindDetail = (selector,type) => page.content.querySelectorAll(selector).forEach(cell => {
      cell.onclick = () => {
        const flight = flightById(cell.dataset.flightId);
        if (flight) window.UCAADashboardFlightUI.openFlightInfo(flight,type);
      };
      cell.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          cell.click();
        }
      };
    });
    bindDetail('.profile-rating-detail','rating');
    bindDetail('.profile-company-profit-detail','finance');
    bindDetail('.profile-pilot-salary-detail','salary');
    page.pickerButton.setAttribute('aria-expanded','false');
    page.pickerList.hidden = true;
    const tab = document.querySelector('#profileTabLink');
    if (tab) tab.textContent = 'Профіль Пілота';
  }

  function warmProfileCaches() {
    if (!availableFlights.length) return;
    overallSummaries();
    buildAircraftAwardStatsCache();
    buildMonthlyAwardsCache();
    if (newskyAwardRequirements) buildNewskyAwardStatsCache();
  }

  function open(id, flights) {
    setFlights(flights);
    const latest = [...availableFlights].sort((a,b) => dateOf(b)-dateOf(a))[0];
    referenceNow = latest ? new Date(dateOf(latest).getTime()+1) : new Date();
    current = {
      id,
      flights:availableFlights,
      period:'monthToDate',
      customDate:'',
      customEndDate:'',
      aircraft:null,
      sortField:'date',
      sortDirection:'desc'
    };
    profileCalendarOpen = false;
    profileCalendarMode = 'date';
    profileCalendarRangePickingEnd = false;
    profileCalendarPickerValue = '';
    render();
    if (!String(location.hash || '').startsWith('#profile')) location.hash = 'profile';
  }

  function setFlights(flights) {
    const nextFlights = Array.isArray(flights) ? flights : [];
    const nextSignature = profileCacheSignature(nextFlights);
    availableFlights = nextFlights;
    resetProfileCaches(nextSignature);
    loadNewskyAwardRequirements();
    loadSpecialProfileAwards();
    loadCompanyFleetTypes();
    insuranceCoverage = window.UCAAInsurance?.coverageMap(availableFlights) || new Map();
    warmProfileCaches();
    renderPicker();
    if (current) {
      const latest = [...availableFlights].sort((a,b) => dateOf(b)-dateOf(a))[0];
      referenceNow = latest ? new Date(dateOf(latest).getTime()+1) : new Date();
      current.flights = availableFlights;
      render();
    }
  }

  addEventListener('hashchange', () => {
    if (String(location.hash || '').startsWith('#profile')) {
      const page = ensureProfilePage();
      if (!current) {
        renderEmptyProfilePicker();
      }
      page.pickerList.hidden = true;
      page.pickerButton.setAttribute('aria-expanded','false');
    }
  });
  function mostActiveMonthPilot() {
    const monthFlights = filterPeriod(availableFlights,'monthToDate').filter(flight => flight.status === 'completed');
    const counts = new Map();
    monthFlights.forEach(flight => counts.set(flight.pilot.id,(counts.get(flight.pilot.id)||0)+1));
    return [...counts].sort((a,b) => b[1]-a[1])[0]?.[0] || availableFlights[0]?.pilot?.id || null;
  }
  document.addEventListener('click', event => {
    const page = ensureProfilePage();
    if (event.target.closest('#profileTabLink')) {
      event.preventDefault();
      const url = new URL(window.location.href);
      url.searchParams.delete('pilot');
      url.hash = 'profile';
      history.replaceState(null, '', url);
      current = null;
      renderEmptyProfilePicker();
      page.pickerList.hidden = true;
      page.pickerButton.setAttribute('aria-expanded','false');
      return;
    }
    if (!event.target.closest('#pilotPickerList')) {
      page.pickerList.hidden = true;
      page.pickerButton.setAttribute('aria-expanded','false');
    }
    if (!event.target.closest('#profileAircraftFilterButton') && !event.target.closest('#profileAircraftFilterList')) {
      const list = document.querySelector('#profileAircraftFilterList');
      if (list) list.hidden = true;
    }
  });

  function cardAwards(pilotId) {
    const aircraftAwards = aircraftAwardStats(pilotId);
    const aircraft = {
      bronze:aircraftAwards.filter(award => award.level === 2).length,
      silver:aircraftAwards.filter(award => award.level === 3).length,
      gold:aircraftAwards.filter(award => award.level === 4).length
    };
    const monthly = monthlyAwardsForPilot(pilotId).length;
    const newsky = newskyAwardRequirements ? (buildNewskyAwardStatsCache().byPilot.get(pilotId) || []).length : 0;
    return {aircraft, monthly, newsky};
  }

  function cardAircraftAwardsHtml(pilotId) {
    const awards = aircraftAwardStats(pilotId);
    if (!awards.length) return '';
    const bestLevel = Math.max(...awards.map(award => award.level || 0));
    const visible = awards
      .filter(award => bestLevel > 1 ? award.level === bestLevel : award.level === 1 && award.flights.length >= 5)
      .sort((a,b) => b.level-a.level || b.flights.length-a.flights.length || a.family.localeCompare(b.family,'uk'))
      .slice(0,2);
    return visible.map((award,index) => {
      const familyAwards = buildAircraftAwardStatsCache().byFamily.get(award.family) || [];
      const tooltip = aircraftAwardTooltipHtml(award,familyAwards);
      return `<span class="pilot-card-aircraft-award level-${award.level} manufacturer-${aircraftAwardManufacturer(award.family)} ${award.leader?'aircraft-award-leader':''}" data-award-tooltip="${esc(tooltip)}" title="${esc(tooltip.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim())}">${aircraftAwardDecor(award.level,`pilot-card-${pilotId}-${award.family}-${index}`)}<span class="aircraft-award-circle"><span>${esc(aircraftAwardFamilyLabel(award.family))}</span></span></span>`;
    }).join('');
  }

  function cardSpecialAwardsHtml(pilotId) {
    return specialProfileAwards
      .filter(award => String(award.pilotId) === String(pilotId) && award.showLive === true)
      .map(award => {
        const colors = Array.isArray(award.cardStripeColors) ? award.cardStripeColors : (Array.isArray(award.stripeColors) ? award.stripeColors : []);
        const colorA = colors[0] || award.cardStripeColorA || award.stripeColorA || '#f2a51f';
        const colorB = colors[1] || award.cardStripeColorB || award.stripeColorB || '#111';
        const label = award.label || 'SPECIAL';
        const tooltipTitle = award.tooltipTitle || label;
        const tooltipText = award.tooltipText || award.tooltip || award.text || '';
        const tooltip = `<div><strong>${esc(tooltipTitle)}</strong><br>${esc(tooltipText)}</div>`;
        const style = `--special-stripe-a:${esc(colorA)};--special-stripe-b:${esc(colorB)};--special-text-box-width:${esc(award.cardTextBoxWidth || award.textBoxWidth || '34px')};--special-text-box-color:${esc(award.cardTextBoxColor || award.textBoxColor || '#111')};--special-text-color:${esc(award.cardTextColor || award.textColor || '#fff')}`;
        const topIcon = award.topIcon || award.emoji || '';
        const bottomIcon = award.bottomIcon || award.medal || '';
        const text = award.cardText || award.text || 'SPECIAL';
        return `<span class="pilot-card-diamond special" style="${style}" data-award-tooltip="${esc(tooltip)}"><i></i><b>${topIcon}</b><span>${esc(text)}</span><em>${bottomIcon}</em></span>`;
      }).join('');
  }

  window.UCAAPilotProfile = {open,setFlights,cardAwards,cardAircraftAwardsHtml,cardSpecialAwardsHtml,warmProfileCaches};
})();
