const DB_FILES = {
  archive: 'flights-archive.json',
  current: 'flights-current.json'
};

const PAY_RULE = {
  ...window.UCAAPilotPay.RULE
};

const app = {
  archive: null,
  current: null,
  companyData: null,
  companyLiveryData: null,
  companyLiveryMatching: null,
  companyCharterDemand: {},
  guaranteedBonuses: {},
  flights: [],
  referenceNow: null,
  period: 'today',
  pilotsPeriod: 'monthToDate',
  customDate: null,
  customEndDate: null,
  dashboardPilotId: null,
  dashboardAircraftId: null,
  dashboardFlightSort: {field: 'date', direction: 'desc'},
  liveDashboardVisible: false,
  liveNewSkyFlights: [],
  liveNewSkyFlightDetails: {},
  liveNewSkyLoaded: false,
  liveNewSkyLoading: false,
  liveNewSkyError: '',
  metric: 'hours'
};
let pilotInsuranceCoverage = new Map();
let pilotCardsMonthlyCache = null;
let mobileModeManualOverride = false;

function setMobileCabinetMode(enabled, manual = false) {
  if (manual) mobileModeManualOverride = true;
  document.body.classList.toggle('mobile-cabinet', Boolean(enabled));
  if (enabled) {
    const picker = document.querySelector('#pilotPickerList');
    const profileTab = document.querySelector('#profileTabLink');
    if (picker) picker.hidden = true;
    if (profileTab) profileTab.setAttribute('aria-expanded', 'false');
  }
  const button = document.querySelector('#versionModeButton');
  if (button) {
    button.textContent = enabled ? '\u{1F5A5}\uFE0F' : '\u{1F4F1}';
    button.setAttribute('aria-label', enabled ? '\u0417\u0432\u0438\u0447\u0430\u0439\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F' : '\u041C\u043E\u0431\u0456\u043B\u044C\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F');
  }
}

function bindMobileModeTrigger(root = document) {
  const bind = (selector, enabled) => {
    const trigger = root.querySelector(selector);
    if (!trigger || trigger.dataset.mobileBound) return;
    trigger.dataset.mobileBound = '1';
    const activate = event => {
      event.preventDefault();
      setMobileCabinetMode(enabled, true);
    };
    trigger.addEventListener('click', activate);
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
  };
  bind('#mobileModeTrigger', true);
  bind('#desktopModeTrigger', false);
}

function bindVersionModeButton() {
  const button = document.querySelector('#versionModeButton');
  if (!button || button.dataset.versionBound) return;
  button.dataset.versionBound = '1';
  button.addEventListener('click', event => {
    event.preventDefault();
    setMobileCabinetMode(!document.body.classList.contains('mobile-cabinet'), true);
  });
}

function bindManualRefreshButton() {
  const button = document.querySelector('#manualRefreshButton');
  if (!button || button.dataset.refreshBound) return;
  button.dataset.refreshBound = '1';
  button.addEventListener('click', event => {
    event.preventDefault();
    button.disabled = true;
    button.textContent = '\u23f3';
    const url = new URL(window.location.href);
    url.searchParams.set('ucaaRefresh', String(Date.now()));
    window.location.href = url.toString();
  });
}

function autoMobileCabinetMode() {
  if (mobileModeManualOverride) return;
  const shouldUseMobile = window.matchMedia?.('(max-width: 940px)').matches || window.innerWidth <= 940;
  setMobileCabinetMode(shouldUseMobile);
}

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tip = lines => esc(Array.isArray(lines) ? lines.join('\n') : lines);
const pilotAvatarUrl = value => {
  const hash = String(value || 'default').trim();
  return `https://newsky.app/api/pilot/avatar/${encodeURIComponent(hash && hash !== 'null' ? hash : 'default')}`;
};
const profileHashPilotId = () => {
  const match = String(location.hash || '').match(/^#profile\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};
const pilotProfileUrl = id => `pilot-cabinet.html#profile/${encodeURIComponent(id)}`;
const dashboardPilotCellHtml = pilot => `<td class="dashboard-pilot-cell" data-pilot-id="${esc(pilot.id)}" role="button" tabindex="0"><span class="dashboard-pilot-card"><img class="dashboard-pilot-avatar" src="${esc(pilotAvatarUrl(pilot.avatar))}" alt="${esc(pilot.name)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='https://newsky.app/api/pilot/avatar/default'}"><span class="dashboard-pilot-name">${pilotNameWithStreak(pilot)}</span></span></td>`;
const liveNewSkyAuthToken = 'UKR_uSTNynarbU8B8A61nvDLqmSl7Ji8xK';
const bindDashboardPilotCells = () => {
  $$('.dashboard-pilot-cell').forEach(cell => {
    cell.onclick = () => showPilotProfile(cell.dataset.pilotId);
    cell.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showPilotProfile(cell.dataset.pilotId);
      }
    };
  });
};

function knownPilotForLiveFlight(flight) {
  const pilot = flight?.pilot || {};
  const apiId = String(pilot._id || pilot.id || pilot.pilot_id || '').trim();
  const name = String(pilot.fullname || pilot.name || 'Unknown Pilot').trim();
  const known = app.flights.find(item => apiId && item.pilot?.id === apiId)
    || app.flights.find(item => item.pilot?.name && name && item.pilot.name.toLowerCase() === name.toLowerCase());
  return known?.pilot || {
    id: apiId || `live-${name}`,
    name,
    avatar: pilot.avatar || null
  };
}

function liveAirportObject(value) {
  return {
    icao: String(value?.icao || ''),
    name: String(value?.name || ''),
    city: String(value?.city || '')
  };
}

function liveFlightOperation(flight) {
  if (flight?.charter) return {key:'charter', label:'Charter'};
  if (flight?.schedule) return {key:'schedule', label:'Schedule'};
  return {key:'free', label:'Free'};
}

function liveFlightPayload(flight) {
  const type = String(flight?.type || '').toLowerCase();
  if (type === 'cargo') {
    const cargo = Number(flight?.cargoWeight || flight?.cargo || flight?.payload?.cargo || flight?.result?.totals?.payload?.cargo || 0);
    if (cargo > 1000) return `${(cargo / 1000).toLocaleString('uk-UA', {maximumFractionDigits:1})} т`;
    return cargo ? `${cargo} т` : '—';
  }
  const pax = Number(flight?.pax || flight?.passengers || flight?.payload?.pax || flight?.result?.totals?.payload?.pax || 0);
  return pax ? String(pax) : '—';
}

function liveFlightPayloadIcon(flight) {
  return String(flight?.type || '').toLowerCase() === 'cargo'
    ? {icon:'📦', label:'Cargo'}
    : {icon:'👨‍💼', label:'Pax'};
}

function liveAircraftIdCandidates(flight) {
  const candidates = [];
  const add = value => {
    const text = String(value || '').trim();
    if (text && !candidates.includes(text)) candidates.push(text);
  };
  const scan = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 4) return;
    ['id', '_id', 'aircraftId', 'aircraftID'].forEach(key => add(value[key]));
    Object.entries(value).forEach(([key, child]) => {
      if (!child || typeof child !== 'object') return;
      if (/aircraft|livery|fleet/i.test(key)) scan(child, depth + 1);
    });
  };
  add(flight?.aircraftId);
  add(flight?.aircraftID);
  scan(flight?.aircraft);
  return candidates;
}

function mergeLiveFlightDetail(flight, detail) {
  const source = detail?.flight || detail || {};
  if (!source || typeof source !== 'object') return flight;
  const merged = {...flight};
  const sourceAircraft = source.aircraft;
  if (sourceAircraft && typeof sourceAircraft === 'object') {
    merged.aircraft = {
      ...(flight?.aircraft && typeof flight.aircraft === 'object' ? flight.aircraft : {}),
      ...sourceAircraft,
      airframe: {
        ...(flight?.aircraft?.airframe || {}),
        ...(sourceAircraft.airframe || {})
      }
    };
    merged.aircraftId = sourceAircraft._id || sourceAircraft.id || source.aircraftId || flight?.aircraftId || '';
  }
  return merged;
}

async function loadLiveFlightDetail(flight) {
  const id = String(flight?._id || flight?.id || '').trim();
  if (!id) return flight;
  if (app.liveNewSkyFlightDetails[id]) return mergeLiveFlightDetail(flight, app.liveNewSkyFlightDetails[id]);
  try {
    const response = await fetch(`https://newsky.app/api/airline-api/flight/${encodeURIComponent(id)}`, {
      cache: 'no-store',
      headers: {Authorization: `Bearer ${liveNewSkyAuthToken}`}
    });
    if (!response.ok) return flight;
    const detail = await response.json();
    app.liveNewSkyFlightDetails[id] = detail;
    return mergeLiveFlightDetail(flight, detail);
  } catch (error) {
    console.warn('LIVE flight detail fetch failed', id, error);
    return flight;
  }
}

function liveDetailSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadLiveFlightDetailsLimited(flights) {
  const result = [];
  const batchSize = 5;
  for (let index = 0; index < flights.length; index += batchSize) {
    const batch = flights.slice(index, index + batchSize);
    result.push(...await Promise.all(batch.map(loadLiveFlightDetail)));
    if (index + batchSize < flights.length) await liveDetailSleep(10500);
  }
  return result;
}

function liveAircraftInfo(flight) {
  const airframe = flight?.aircraft?.airframe || flight?.aircraft || {};
  const id = companyLiveryLiveFlightAircraftId(flight);
  const icao = String(airframe.icao || airframe.ident || flight?.aircraft?.icao || '');
  return {
    id,
    name: String(airframe.name || flight?.aircraft?.name || airframe.icao || 'Unknown aircraft'),
    icao,
    note: aircraftTableNote({aircraft: {id, icao}})
  };
}

function liveFlightDepartureDate(flight) {
  return new Date(flight?.depTimeAct || flight?.takeoffTimeAct || flight?.depTime || flight?.open || Date.now());
}

function liveFlightDateLabel(flight) {
  const date = liveFlightDepartureDate(flight);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('uk-UA', {timeZone:'UTC'})
    : 'LIVE';
}

function liveFlightTimeLabel(flight) {
  const date = liveFlightDepartureDate(flight);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('uk-UA', {timeZone:'UTC', hour:'2-digit', minute:'2-digit'})
    : '--:--';
}

function liveFlightDurationLabel(flight) {
  const minutes = Number(flight?.durationAct || flight?.duration || 0);
  return minutes > 0 ? formatMinutes(minutes) : 'у повітрі';
}

function renderLiveDashboardRows() {
  if (!app.liveDashboardVisible) return '';
  if (app.liveNewSkyLoading) return '<tr class="dashboard-live-row"><td colspan="8" class="loading">Завантаження LIVE-рейсів NewSky…</td></tr>';
  if (app.liveNewSkyError) return `<tr class="dashboard-live-row"><td colspan="8" class="loading negative">${esc(app.liveNewSkyError)}</td></tr>`;
  const flights = app.liveNewSkyFlights.filter(flight => flight?.depTimeAct);
  if (!flights.length) return '<tr class="dashboard-live-row"><td colspan="8" class="loading">Зараз немає LIVE-рейсів NewSky у повітрі</td></tr>';
  return flights.map(flight => {
    const pilot = knownPilotForLiveFlight(flight);
    const operation = liveFlightOperation(flight);
    const aircraft = liveAircraftInfo(flight);
    const dep = liveAirportObject(flight.dep);
    const arr = liveAirportObject(flight.arr);
    const payload = liveFlightPayloadIcon(flight);
    const id = String(flight._id || flight.id || '');
    const flightNumber = String(flight.flightNumber || '—');
    const flightLink = id ? `https://newsky.app/flight/${encodeURIComponent(id)}` : 'https://newsky.app/';
    return `<tr class="dashboard-live-row">
      <td>${liveFlightDateLabel(flight)}<span class="date-flight-meta"><span class="date-flight-time">${liveFlightTimeLabel(flight)}</span><a class="flight-number-link flight-number-${operation.key}" href="${flightLink}" target="_blank" rel="noopener" title="LIVE ${operation.label}">${esc(flightNumber)}</a></span></td>
      ${dashboardPilotCellHtml(pilot)}
      <td class="route"><span class="route-airports">${airportWithFlag(dep)} → ${airportWithFlag(arr)}</span><span class="route-duration">${liveFlightDurationLabel(flight)}</span></td>
      <td>${esc(aircraft.name)}<span class="flight-note" title="${esc(aircraft.icao || aircraft.note)}">${esc(aircraft.note || aircraft.icao)}</span></td>
      <td><span class="payload-value" title="${payload.label}">${esc(liveFlightPayload(flight))}<span class="load-kind-icon" aria-hidden="true">${payload.icon}</span></span></td>
      <td class="num rating-cell"><span class="dashboard-live-badge">LIVE</span><span class="landing-line">ще в польоті</span></td>
      <td class="finance-click-cell live-finance-dash">—</td>
      <td class="finance-click-cell live-finance-dash">${guaranteedBonusAmountForFlight(flight) ? '\u{1F4B0}' : '—'}</td>
    </tr>`;
  }).join('');
}

async function loadDashboardLiveNewSkyFlights(force = false) {
  if (app.liveNewSkyLoading) return;
  if (app.liveNewSkyLoaded && !force) return;
  app.liveNewSkyLoading = true;
  app.liveNewSkyError = '';
  if (app.liveDashboardVisible) render();
  try {
    const response = await fetch('https://newsky.app/api/airline-api/flights/ongoing', {
      cache: 'no-store',
      headers: {Authorization: `Bearer ${liveNewSkyAuthToken}`}
    });
    if (!response.ok) throw new Error(`NewSky ${response.status}`);
    const data = await response.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const filtered = results
      .filter(flight => String(flight?.airline?.icao || 'UKL').trim().toUpperCase() === 'UKL')
      .filter(flight => flight?.depTimeAct)
      .sort((a,b) => liveFlightDepartureDate(b) - liveFlightDepartureDate(a));
    app.liveNewSkyFlights = await loadLiveFlightDetailsLimited(filtered);
    app.liveNewSkyLoaded = true;
  } catch (error) {
    console.warn('Не вдалося завантажити LIVE NewSky', error);
    app.liveNewSkyError = 'Не вдалося завантажити LIVE-рейси NewSky';
  } finally {
    app.liveNewSkyLoading = false;
    render();
    updateCompanyLiveryStatus();
  }
}

function dashboardLiveFlightCount() {
  return app.liveNewSkyFlights.filter(flight => flight?.depTimeAct).length;
}

function syncDashboardLiveToggle() {
  const button = $('#dashboardLiveToggle');
  if (!button) return;
  const count = dashboardLiveFlightCount();
  const shouldShow = app.liveNewSkyLoaded && !app.liveNewSkyError && count > 0;
  button.hidden = !shouldShow;
  if (!shouldShow) {
    app.liveDashboardVisible = false;
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
    return;
  }
  button.textContent = app.liveDashboardVisible ? `Сховати LIVE: ${count}` : `Показати LIVE: ${count}`;
  if (innerWidth <= 940) button.textContent = `LIVE: ${count}`;
  button.classList.toggle('active', app.liveDashboardVisible);
  button.setAttribute('aria-pressed', String(app.liveDashboardVisible));
}

const ICAO_COUNTRY = {
  UK:{cc:'ua',name:'Україна'}, UR:{cc:'ua',name:'Україна'},
  EP:{cc:'pl',name:'Польща'}, ED:{cc:'de',name:'Німеччина'}, EF:{cc:'fi',name:'Фінляндія'},
  EG:{cc:'gb',name:'Велика Британія'}, EH:{cc:'nl',name:'Нідерланди'}, EB:{cc:'be',name:'Бельгія'},
  ES:{cc:'se',name:'Швеція'}, EY:{cc:'lt',name:'Литва'}, LH:{cc:'hu',name:'Угорщина'},
  LOW:{cc:'at',name:'Австрія'}, LO:{cc:'at',name:'Австрія'}, LK:{cc:'cz',name:'Чехія'},
  LZ:{cc:'sk',name:'Словаччина'}, LR:{cc:'ro',name:'Румунія'}, LB:{cc:'bg',name:'Болгарія'},
  LG:{cc:'gr',name:'Греція'}, LQ:{cc:'ba',name:'Боснія і Герцеговина'}, LD:{cc:'hr',name:'Хорватія'},
  LY:{cc:'rs',name:'Сербія'}, LW:{cc:'mk',name:'Північна Македонія'}, LI:{cc:'it',name:'Італія'},
  LF:{cc:'fr',name:'Франція'}, LS:{cc:'ch',name:'Швейцарія'}, LE:{cc:'es',name:'Іспанія'},
  LP:{cc:'pt',name:'Португалія'}, LA:{cc:'al',name:'Албанія'}, LU:{cc:'md',name:'Молдова'},
  LT:{cc:'tr',name:'Туреччина'}, UG:{cc:'ge',name:'Грузія'}, UD:{cc:'am',name:'Вірменія'},
  UB:{cc:'az',name:'Азербайджан'}, LL:{cc:'il',name:'Ізраїль'}, HE:{cc:'eg',name:'Єгипет'},
  OE:{cc:'sa',name:'Саудівська Аравія'}, OJ:{cc:'jo',name:'Йорданія'}, OL:{cc:'lb',name:'Ліван'},
  OM:{cc:'ae',name:'ОАЕ'}, OI:{cc:'ir',name:'Іран'}, OR:{cc:'iq',name:'Ірак'},
  DT:{cc:'tn',name:'Туніс'}, GM:{cc:'ma',name:'Марокко'}, UT:{cc:'uz',name:'Узбекистан'},
  UA:{cc:'kz',name:'Казахстан'}, VI:{cc:'in',name:'Індія'}, VT:{cc:'th',name:'Таїланд'},
  VH:{cc:'hk',name:'Гонконг'}, ZB:{cc:'cn',name:'Китай'}, KJ:{cc:'us',name:'США'},
  CY:{cc:'ca',name:'Канада'}, MD:{cc:'do',name:'Домініканська Республіка'}, MM:{cc:'mx',name:'Мексика'},
  BG:{cc:'gl',name:'Гренландія'}, BI:{cc:'is',name:'Ісландія'}, DA:{cc:'dz',name:'Алжир'},
  EE:{cc:'ee',name:'Естонія'}, EI:{cc:'ie',name:'Ірландія'}, EK:{cc:'dk',name:'Данія'},
  EL:{cc:'lu',name:'Люксембург'}, EN:{cc:'no',name:'Норвегія'}, EV:{cc:'lv',name:'Латвія'},
  FA:{cc:'za',name:'Південна Африка'}, FK:{cc:'cm',name:'Камерун'}, GC:{cc:'es',name:'Іспанія'},
  HA:{cc:'et',name:'Ефіопія'}, HJ:{cc:'ss',name:'Південний Судан'}, K:{cc:'us',name:'США'},
  LC:{cc:'cy',name:'Кіпр'}, LJ:{cc:'si',name:'Словенія'}, LM:{cc:'mt',name:'Мальта'},
  LX:{cc:'gi',name:'Гібралтар'}, MH:{cc:'hn',name:'Гондурас'}, MK:{cc:'jm',name:'Ямайка'},
  MR:{cc:'cr',name:'Коста-Рика'}, MY:{cc:'bs',name:'Багамські Острови'}, OO:{cc:'om',name:'Оман'},
  OP:{cc:'pk',name:'Пакистан'}, OS:{cc:'sy',name:'Сирія'}, OT:{cc:'qa',name:'Катар'},
  PA:{cc:'us',name:'США'}, PH:{cc:'us',name:'США'}, RC:{cc:'tw',name:'Тайвань'},
  RJ:{cc:'jp',name:'Японія'}, SA:{cc:'ar',name:'Аргентина'}, SB:{cc:'br',name:'Бразилія'},
  SK:{cc:'co',name:'Колумбія'}, SL:{cc:'bo',name:'Болівія'}, SO:{cc:'gf',name:'Французька Гвіана'},
  SV:{cc:'ve',name:'Венесуела'}, SY:{cc:'gy',name:'Гаяна'}, TJ:{cc:'pr',name:'Пуерто-Рико'},
  TN:{cc:'sx',name:'Сінт-Мартен'}, UC:{cc:'kg',name:'Киргизстан'}, UM:{cc:'by',name:'Білорусь'},
  UU:{cc:'ru',name:'Росія'}, VA:{cc:'in',name:'Індія'}, VE:{cc:'in',name:'Індія'},
  VN:{cc:'np',name:'Непал'}, VO:{cc:'in',name:'Індія'}, VQ:{cc:'bt',name:'Бутан'},
  VR:{cc:'mv',name:'Мальдіви'}, WS:{cc:'sg',name:'Сінгапур'}, Y:{cc:'au',name:'Австралія'},
  ZG:{cc:'cn',name:'Китай'}, ZM:{cc:'mn',name:'Монголія'}, ZS:{cc:'cn',name:'Китай'}
};

function countryForAirport(icao) {
  const code = String(icao || '').toUpperCase();
  return ICAO_COUNTRY[code.slice(0,3)] || ICAO_COUNTRY[code.slice(0,2)] || ICAO_COUNTRY[code.slice(0,1)] || null;
}

function airportWithFlag(airport) {
  const code = String(airport?.icao || '—').toUpperCase();
  const country = countryForAirport(code);
  const airportTitle = airport?.name || airport?.city || code;
  const flag = country
    ? `<img src="https://flagcdn.com/w20/${country.cc}.png" class="airport-flag" title="${esc(country.name)}" alt="${esc(country.name)}">`
    : '<span class="airport-flag airport-flag-missing" title="Країну не визначено" aria-label="Прапор не знайдено"></span>';
  return `<span title="${esc(airportTitle)}">${esc(code)}</span>${flag}`;
}

function flagEmojiFromCountryCode(code) {
  const value = String(code || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return '';
  return [...value].map(char => String.fromCodePoint(0x1F1E6 + char.charCodeAt(0) - 65)).join('');
}

function airportWithEmojiFlag(airport) {
  const code = String(airport?.icao || '—').toUpperCase();
  const country = countryForAirport(code);
  const airportTitle = airport?.name || airport?.city || code;
  const flag = country ? ` ${flagEmojiFromCountryCode(country.cc)}` : '';
  return `<span title="${esc(airportTitle)}">${esc(code)}${flag}</span>`;
}

function liveryAirportShortName(airport) {
  const code = String(airport?.icao || '').trim().toUpperCase();
  if (code === 'UKKK') return 'Kyiv (Zhuliany)';
  const city = String(airport?.city || '').trim();
  const name = String(airport?.name || '').trim();
  if (/Ihor Sikorsky Kyiv International Airport \(Zhuliany\)/i.test(name)) return 'Kyiv (Zhuliany)';
  const shortName = city && /international/i.test(name)
    ? `${city} International`
    : (name || city || '').replace(/\s+Airport$/i, '').trim();
  return shortenAirportName(shortName);
}

function shortenAirportName(name, limit = 18) {
  const value = String(name || '').trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}.`;
}

function liveryAirportStatusText(airport) {
  const code = String(airport?.icao || '—').toUpperCase();
  const title = airport?.name || airport?.city || code;
  return `<span title="${esc(title)}">${esc(liveryAirportShortName(airport))} ${esc(code)}</span>`;
}

function liveryRegistrationFromTitle(title) {
  const match = String(title || '').match(/\bUR-[A-Z0-9]+\b/i);
  return match ? match[0].toUpperCase() : '';
}

function liveryAirportWithFlag(airport, includeName = false) {
  const code = String(airport?.icao || '—').toUpperCase();
  const country = countryForAirport(code);
  const title = airport?.name || airport?.city || code;
  const flag = country
    ? `<img src="https://flagcdn.com/w20/${country.cc}.png" class="airport-flag" title="${esc(country.name)}" alt="${esc(country.name)}">`
    : '';
  const name = includeName ? `${esc(liveryAirportShortName(airport))} ` : '';
  return `<span title="${esc(title)}"><span class="company-livery-airport-name">${name}</span><strong>${esc(code)}</strong>${flag}</span>`;
}

function money(value, signed = false) {
  const rounded = Math.round(Number(value) || 0);
  const sign = rounded < 0 ? '−' : (signed && rounded > 0 ? '+' : '');
  return `${sign}$${Math.abs(rounded).toLocaleString('uk-UA')}`;
}

function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const remainingMinutes = value % 60;
  return hours ? `${hours} год ${String(remainingMinutes).padStart(2, '0')} хв` : `${remainingMinutes} хв`;
}

function dateOf(flight) {
  return new Date(flight.times.actualArrival || flight.times.closed || flight.times.takeoff || flight.times.scheduledDeparture);
}

function flightStartDateForDisplay(flight) {
  return new Date(flight.times?.actualDeparture || flight.times?.takeoff || flight.times?.scheduledDeparture || flight.times?.open || flight.times?.actualArrival || flight.times?.closed);
}

function flightEndDateForDisplay(flight) {
  return new Date(flight.times?.closed || flight.times?.actualArrival || flight.times?.scheduledArrival || flight.times?.takeoff || flight.times?.scheduledDeparture);
}

function utcDateParts(date) {
  return {
    day: String(date.getUTCDate()).padStart(2, '0'),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    year: String(date.getUTCFullYear())
  };
}

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

function utcDayKey(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function flightStreakForPilot(pilotId, flights = app.flights, now = app.referenceNow || new Date()) {
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

function flightStreakBadge(pilotId, flights = app.flights, now = app.referenceNow || new Date()) {
  const streak = flightStreakForPilot(pilotId, flights, now);
  if (!streak) return '';
  const maxed = streak >= 5;
  const hot = streak >= 3 && streak < 5;
  const label = maxed ? 'Літає 5+ днів підряд' : `Літає ${streak} ${streak === 1 ? 'день' : 'дні/днів'} підряд`;
  return `<span class="flight-streak-badge ${maxed ? 'flight-streak-max' : hot ? 'flight-streak-hot' : ''}" title="${esc(label)}">🔥${streak > 1 && !maxed ? `<span class="flight-streak-count">${streak}</span>` : ''}</span>`;
}

function pilotNameWithStreak(pilot) {
  const name = String(pilot?.name || 'Пілот').trim();
  const badge = flightStreakBadge(pilot?.id);
  if (!badge) return esc(name);
  const parts = name.split(/\s+/);
  const last = parts.pop() || name;
  const head = parts.join(' ');
  return `${head ? `${esc(head)} ` : ''}<span class="pilot-name-tail">${esc(last)}${badge}</span>`;
}

function completedDateOf(flight) {
  return new Date(flight.times.closed || flight.updatedAt || flight.times.actualArrival || flight.times.takeoff || flight.times.scheduledDeparture);
}

function formatLiveDataStatus(current, archive, fallbackLatest = null) {
  const currentFlights = current?.flights || [];
  const archiveFlights = archive?.flights || [];
  const updatedAt = new Date().toLocaleString('uk-UA', {
    timeZone:'UTC',
    day:'2-digit',
    month:'2-digit',
    year:'numeric',
    hour:'2-digit',
    minute:'2-digit'
  });
  return `\u0437\u0430 \u0446\u0435\u0439 \u0442\u0438\u0436\u0434\u0435\u043d\u044c: ${currentFlights.length} \u0440\u0435\u0439\u0441\u0456\u0432 \u00b7 \u043c\u0438\u043d\u0443\u043b\u0456 \u0442\u0438\u0436\u043d\u0456: ${archiveFlights.length}<br>\u0434\u0430\u043d\u0456 \u043e\u043d\u043e\u0432\u043b\u0435\u043d\u043e ${updatedAt} UTC`;
}

function formatRankUpdatedAt(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.day}.${parts.month} в ${parts.hour}:${parts.minute} UTC`;
}

async function loadNewskyRankSubtitleLegacy() {
  const subtitle = $('#newskyRankSubtitle');
  if (!subtitle) return;
  try {
    const response = await fetch('newsky-rank.json', {cache: 'no-store'});
    if (!response.ok) throw new Error(`rank json ${response.status}`);
    const data = await response.json();
    const airline = data.airline || {};
    const rank = Number(airline.rank);
    const flights = Number(airline.flights);
    const aboveFlights = Number(data.above?.flights);
    const toNext = Number.isFinite(aboveFlights) && Number.isFinite(flights)
      ? Math.max(1, aboveFlights - flights + 1)
      : Number(data.above?.difference || 0) + 1;
    const toTop = Number(data.top5Target?.neededFlights ?? data.topTarget?.neededFlights);
    const updated = formatRankUpdatedAt(data.updatedAt);
    if (!Number.isFinite(rank) || !Number.isFinite(flights)) return;
    const cleanFlightWord = value => {
      const n = Math.abs(Math.round(Number(value) || 0));
      if (n % 10 === 1 && n % 100 !== 11) return '\u043F\u043E\u043B\u0456\u0442';
      if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return '\u043F\u043E\u043B\u044C\u043E\u0442\u0438';
      return '\u043F\u043E\u043B\u044C\u043E\u0442\u0456\u0432';
    };
    const flightWord = value => {
      const n = Math.abs(Math.round(Number(value) || 0));
      if (n % 10 === 1 && n % 100 !== 11) return 'політ';
      if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'польоти';
      return 'польотів';
    };
    const toTopText = Number.isFinite(toTop) ? `${toTop.toLocaleString('uk-UA')} ${flightWord(toTop)}` : '—';
    subtitle.innerHTML = `<span class="rank-subtitle-main">📊 Ми #${rank} у <a href="https://newsky.app/airlines" target="_blank" rel="noopener">рейтингу NewSky</a>!</span> Виконано ${flights.toLocaleString('uk-UA')} ${flightWord(flights)} за крайні 30 днів! 🔥<br><span class="rank-subtitle-extra">До наступного місця: ${toNext.toLocaleString('uk-UA')} ${flightWord(toNext)}, до ТОП-5: ${toTopText}. <a class="rank-join-link" href="https://newsky.app/airline/ukl/join" target="_blank" rel="noopener">Долучайся!</a>${updated ? ` (оновлено ${updated})` : ''}</span>`;
    subtitle.innerHTML = `<span class="rank-subtitle-main"><span id="mobileModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="Мобільна версія">🔥</span> 📊 Ми #${rank} у <a href="https://newsky.app/airlines" target="_blank" rel="noopener">рейтингу NewSky</a>!</span> Виконано ${flights.toLocaleString('uk-UA')} ${flightWord(flights)} за крайні 30 днів!<br><span class="rank-subtitle-extra">До наступного місця: ${toNext.toLocaleString('uk-UA')} ${flightWord(toNext)}, до ТОП-5: ${toTopText}. <a class="rank-join-link" href="https://newsky.app/airline/ukl/join" target="_blank" rel="noopener">Долучайся!</a>${updated ? ` (оновлено ${updated})` : ''}</span>`;
    bindMobileModeTrigger(subtitle);
    subtitle.innerHTML = `<span class="rank-desktop-line"><span class="rank-subtitle-main"><span id="mobileModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="\u041C\u043E\u0431\u0456\u043B\u044C\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F">\u{1F4CA}</span> \u041C\u0438 #${rank} \u0443 <a href="https://newsky.app/airlines" target="_blank" rel="noopener">\u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0443 NewSky</a>!</span> \u0412\u0438\u043A\u043E\u043D\u0430\u043D\u043E ${flights.toLocaleString('uk-UA')} ${cleanFlightWord(flights)} \u0437\u0430 \u043A\u0440\u0430\u0439\u043D\u0456 30 \u0434\u043D\u0456\u0432! <span id="desktopModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="\u0417\u0432\u0438\u0447\u0430\u0439\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F">\u{1F525}</span></span><span class="rank-mobile-line">\u0412\u0438\u043A\u043E\u043D\u0430\u043D\u043E ${flights.toLocaleString('uk-UA')} ${cleanFlightWord(flights)} / 30 \u0434\u043D\u0456\u0432 \u{1F525} #${rank} \u043C\u0456\u0441\u0446\u0435 NewSky!</span><br><span class="rank-subtitle-extra">\u0414\u043E \u043D\u0430\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043C\u0456\u0441\u0446\u044F: ${toNext.toLocaleString('uk-UA')} ${cleanFlightWord(toNext)}, \u0434\u043E \u0422\u041E\u041F-5: ${Number.isFinite(toTop) ? `${toTop.toLocaleString('uk-UA')} ${cleanFlightWord(toTop)}` : '\u2014'}. <a class="rank-join-link" href="https://newsky.app/airline/ukl/join" target="_blank" rel="noopener">\u0414\u043E\u043B\u0443\u0447\u0430\u0439\u0441\u044F!</a>${updated ? ` (\u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043E ${updated})` : ''}</span>`;
    bindMobileModeTrigger(subtitle);
  } catch (error) {
    console.warn('Не вдалося оновити рейтинг NewSky', error);
  }
}

function rankAirlineFlights(airline) {
  return Number(airline?.stats?.recentFlights ?? airline?.recentFlights ?? airline?.flights ?? 0) || 0;
}

function rankAirlineName(airline) {
  return airline?.fullname || airline?.shortname || airline?.icao || '—';
}

function rankAirlineFlag(airline) {
  const code = String(airline?.countryCode || '').trim().toLowerCase();
  if (!code) return '';
  return `<img src="https://flagcdn.com/w20/${esc(code)}.png" class="rank-tooltip-flag" alt="${esc(code.toUpperCase())}" title="${esc(code.toUpperCase())}">`;
}

function rankTooltipRow(airlines, index) {
  const airline = airlines[index];
  if (!airline) return '';
  const isOurs = String(airline.icao || '').toUpperCase() === 'UKL';
  return `<div class="rank-tooltip-row${isOurs ? ' ours' : ''}">
    <span class="rank-tooltip-place">#${index + 1}</span>
    <span class="rank-tooltip-name">${esc(rankAirlineName(airline))}</span>
    <span class="rank-tooltip-flights">${rankAirlineFlights(airline).toLocaleString('uk-UA')}</span>
    <span class="rank-tooltip-country">${rankAirlineFlag(airline)}</span>
  </div>`;
}

function buildNewskyRankTooltip(airlines, ourIndex) {
  const rows = [];
  const used = new Set();
  const addRow = index => {
    if (index < 0 || index >= airlines.length || used.has(index)) return;
    rows.push(rankTooltipRow(airlines, index));
    used.add(index);
  };
  for (let index = 0; index < Math.min(10, airlines.length); index += 1) addRow(index);
  if (ourIndex > 10) rows.push('<div class="rank-tooltip-ellipsis">...</div>');
  const catchingIndex = ourIndex - 1;
  if (catchingIndex !== 0 && catchingIndex !== 9) addRow(catchingIndex);
  addRow(ourIndex);
  const belowIndex = ourIndex + 1;
  if (belowIndex !== 9) addRow(belowIndex);
  return rows.join('');
}

async function loadNewskyRankSubtitle() {
  const subtitle = $('#newskyRankSubtitle');
  if (!subtitle) return;
  try {
    const response = await fetch('FLIGHTS/airlines.json', {cache: 'no-store'});
    if (!response.ok) throw new Error(`rank json ${response.status}`);
    const data = await response.json();
    const airlines = (Array.isArray(data) ? data : (data.airlines || data.data || [])).filter(Boolean);
    const ourIndex = airlines.findIndex(airline => String(airline?.icao || '').toUpperCase() === 'UKL');
    if (ourIndex < 0) return;
    const rank = ourIndex + 1;
    const flights = rankAirlineFlights(airlines[ourIndex]);
    const aboveFlights = ourIndex > 0 ? rankAirlineFlights(airlines[ourIndex - 1]) : flights;
    const top5Flights = airlines[4] ? rankAirlineFlights(airlines[4]) : flights;
    const toNext = ourIndex > 0 ? Math.max(1, aboveFlights - flights + 1) : 0;
    const toTop = rank > 5 ? Math.max(1, top5Flights - flights + 1) : 0;
    const updated = formatRankUpdatedAt(data.updatedAt);
    const cleanFlightWord = value => {
      const n = Math.abs(Math.round(Number(value) || 0));
      if (n % 10 === 1 && n % 100 !== 11) return '\u043F\u043E\u043B\u0456\u0442';
      if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return '\u043F\u043E\u043B\u044C\u043E\u0442\u0438';
      return '\u043F\u043E\u043B\u044C\u043E\u0442\u0456\u0432';
    };
    const rankTooltip = buildNewskyRankTooltip(airlines, ourIndex);
    const rankLink = `<a class="rank-tooltip-link" href="https://newsky.app/airlines" target="_blank" rel="noopener">\u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0443 NewSky<span class="rank-tooltip-box">${rankTooltip}</span></a>`;
    const toTopText = rank > 5 ? `${toTop.toLocaleString('uk-UA')} ${cleanFlightWord(toTop)}` : '\u2014';
    subtitle.innerHTML = `<span class="rank-desktop-line"><span class="rank-subtitle-main"><span id="mobileModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="\u041C\u043E\u0431\u0456\u043B\u044C\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F">\u{1F4CA}</span> \u041C\u0438 #${rank} \u0443 ${rankLink}!</span> \u0412\u0438\u043A\u043E\u043D\u0430\u043D\u043E ${flights.toLocaleString('uk-UA')} ${cleanFlightWord(flights)} \u0437\u0430 \u043A\u0440\u0430\u0439\u043D\u0456 30 \u0434\u043D\u0456\u0432! <span id="desktopModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="\u0417\u0432\u0438\u0447\u0430\u0439\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F">\u{1F525}</span></span><span class="rank-mobile-line">\u0412\u0438\u043A\u043E\u043D\u0430\u043D\u043E ${flights.toLocaleString('uk-UA')} ${cleanFlightWord(flights)} / 30 \u0434\u043D\u0456\u0432 \u{1F525} #${rank} \u043C\u0456\u0441\u0446\u0435 NewSky!</span><br><span class="rank-subtitle-extra">\u0414\u043E \u043D\u0430\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043C\u0456\u0441\u0446\u044F: ${toNext.toLocaleString('uk-UA')} ${cleanFlightWord(toNext)}, \u0434\u043E \u0422\u041E\u041F-5: ${toTopText}. <a class="rank-join-link" href="https://newsky.app/airline/ukl/join" target="_blank" rel="noopener">\u0414\u043E\u043B\u0443\u0447\u0430\u0439\u0441\u044F!</a>${updated ? ` (\u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043E ${updated})` : ''}</span>`;
    bindMobileModeTrigger(subtitle);
  } catch (error) {
    console.warn('Не вдалося оновити рейтинг NewSky', error);
  }
}

function referenceDate(latest) {
  const actualNow = new Date();
  if (!latest) return actualNow;
  const latestDate = dateOf(latest);
  return actualNow >= latestDate && actualNow - latestDate < 3 * 86400000 ? actualNow : new Date(latestDate.getTime() + 1);
}

function aircraftCoefficient(icao = '', flightType = '') {
  return window.UCAAPilotPay.aircraftCoefficient(icao, flightType);
}

function guaranteedBonusFlightKeys(flight) {
  const depIcao = String(flight?.departure?.icao || flight?.dep?.icao || flight?.dep || flight?.departure || '').trim();
  const arrIcao = String((flight?.actualArrival || flight?.arrival)?.icao || flight?.arr?.icao || flight?.arr || flight?.arrival || '').trim();
  return [
    flight?.id,
    flight?._id,
    flight?.flightId,
    flight?.newskyId,
    flight?.flightNumber ? `${flight.flightNumber}|${depIcao}|${arrIcao}` : '',
    flight?.number ? `${flight.number}|${depIcao}|${arrIcao}` : ''
  ].map(value => String(value || '').trim()).filter(Boolean);
}

function guaranteedBonusIcao(value) {
  return String(value || '').trim().toUpperCase();
}

function guaranteedBonusFlightMeta(flight) {
  return {
    pilotId: String(flight?.pilot?.id || flight?.pilotId || '').trim(),
    aircraftId: String(flight?.aircraft?.id || flight?.aircraftId || '').trim(),
    depIcao: guaranteedBonusIcao(flight?.departure?.icao || flight?.dep?.icao || flight?.dep || flight?.departure),
    arrIcao: guaranteedBonusIcao((flight?.actualArrival || flight?.arrival)?.icao || flight?.arr?.icao || flight?.arr || flight?.arrival),
    flightNumber: String(flight?.flightNumber || flight?.number || '').trim()
  };
}

function guaranteedBonusRecordMatchesFlight(record, flight) {
  if (!record || typeof record !== 'object') return false;
  const meta = guaranteedBonusFlightMeta(flight);
  const recordMeta = {
    pilotId: String(record.pilotId || record.pilot || '').trim(),
    aircraftId: String(record.aircraftId || record.aircraft || '').trim(),
    depIcao: guaranteedBonusIcao(record.depIcao || record.departureIcao || record.departure || record.dep),
    arrIcao: guaranteedBonusIcao(record.arrIcao || record.arrivalIcao || record.arrival || record.arr),
    flightNumber: String(record.flightNumber || record.number || '').trim()
  };
  const hasRoute = Boolean(recordMeta.depIcao && recordMeta.arrIcao);
  const hasIdentity = Boolean(recordMeta.pilotId || recordMeta.aircraftId || recordMeta.flightNumber);
  if (!hasRoute || !hasIdentity) return false;
  if (recordMeta.pilotId && (!meta.pilotId || recordMeta.pilotId !== meta.pilotId)) return false;
  if (recordMeta.aircraftId && (!meta.aircraftId || recordMeta.aircraftId !== meta.aircraftId)) return false;
  if (recordMeta.depIcao && (!meta.depIcao || recordMeta.depIcao !== meta.depIcao)) return false;
  if (recordMeta.arrIcao && (!meta.arrIcao || recordMeta.arrIcao !== meta.arrIcao)) return false;
  if (recordMeta.flightNumber && (!meta.flightNumber || recordMeta.flightNumber !== meta.flightNumber)) return false;
  return true;
}

function guaranteedBonusRecordForFlight(flight) {
  const source = app.guaranteedBonuses || {};
  const flights = source.flights && typeof source.flights === 'object' ? source.flights : source;
  const keys = guaranteedBonusFlightKeys(flight);
  for (const key of keys) {
    if (flights && Object.prototype.hasOwnProperty.call(flights, key)) return flights[key];
  }
  for (const record of Object.values(flights || {})) {
    if (guaranteedBonusRecordMatchesFlight(record, flight)) return record;
  }
  return null;
}

function reconcileGuaranteedBonusStatesWithCompletedFlights() {
  const source = app.guaranteedBonuses || {};
  const records = source.flights && typeof source.flights === 'object' ? source.flights : source;
  const completed = (app.flights || []).filter(flight => flight.status === 'completed');
  Object.entries(records || {}).forEach(([key, record]) => {
    if (!record || typeof record !== 'object') return;
    if (guaranteedBonusRecordState(record) !== 'LIVE') return;
    const matched = completed.find(flight => guaranteedBonusFlightKeys(flight).includes(String(key || '').trim()))
      || completed.find(flight => guaranteedBonusRecordMatchesFlight(record, flight));
    if (!matched) return;
    record.state = 'DONE';
    if (!record.status || String(record.status).toLowerCase().includes('live')) record.status = 'earned';
    record.completedFlightId = String(matched.id || matched._id || key || '').trim();
  });
}

function guaranteedBonusAmountForFlight(flight) {
  const record = guaranteedBonusRecordForFlight(flight);
  if (!record) return 0;
  if (record === true) return 0;
  const amount = Number(record.amount ?? record.sum ?? record.bonus ?? 0);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function guaranteedBonusRecordState(record) {
  return String(record?.state || record?.status || '').trim().toUpperCase();
}

function guaranteedBonusLiveRecords() {
  const source = app.guaranteedBonuses || {};
  const flights = source.flights && typeof source.flights === 'object' ? source.flights : source;
  return Object.entries(flights || {})
    .map(([key, record]) => ({key, record}))
    .filter(item => item.record && typeof item.record === 'object')
    .filter(item => guaranteedBonusRecordState(item.record) === 'LIVE');
}

function guaranteedBonusIconHtmlByAmount(amount) {
  return Number(amount || 0) > 0
    ? '<span class="guaranteed-bonus-icon" title="Guaranteed route bonus">\u{1F4B0}</span>'
    : '';
}
function guaranteedBonusIconHtml(flight) {
  return guaranteedBonusIconHtmlByAmount(guaranteedBonusAmountForFlight(flight));
}
function guaranteedBonusIconHtmlForRow(flight, amount) {
  return guaranteedBonusIconHtmlByAmount(Math.max(
    Number(amount || 0),
    guaranteedBonusAmountForFlight(flight)
  ));
}

function pilotPay(flight) {
  return window.UCAAPilotPay.pay(flight, pilotInsuranceCoverage.get(flight) || 0, app.flights)
    + guaranteedBonusAmountForFlight(flight);
}

function currentFlightById(flight) {
  const id = String(flight?.id || '');
  if (!id) return flight;
  return app.flights.find(item => String(item.id) === id) || flight;
}

function cabinCrewPay(flight) {
  if (flight.status !== 'completed') return 0;
  const hours = (Number(flight.times.durationMinutes) || 0) / 60;
  const isCargo = String(flight.flightType).toLowerCase() === 'cargo';
  const crew = isCargo ? 1 : Math.ceil((Number(flight.operations?.passengers) || 0) / 50);
  return hours * 50 * crew;
}

const pilotCompanyBalance = flight => (Number(flight.finance.balance) || 0) + (pilotInsuranceCoverage.get(flight) || 0);

function periodBounds(period) {
  const now = app.referenceNow || new Date();
  if (period === 'all') {
    const dates = app.flights.map(dateOf).filter(date => !Number.isNaN(date.getTime()));
    return {start:new Date(Math.min(...dates)), end:now};
  }
  let start;
  let end = now;
  if (period === 'customRange' && app.customDate && app.customEndDate) {
    const first = new Date(`${app.customDate}T00:00:00Z`);
    const second = new Date(`${app.customEndDate}T00:00:00Z`);
    start = first <= second ? first : second;
    const endBase = first <= second ? second : first;
    end = new Date(endBase.getTime() + 86400000);
  } else if (period === 'custom' && app.customDate) {
    start = new Date(`${app.customDate}T00:00:00Z`);
    end = new Date(start.getTime() + 86400000);
  } else if (period === 'sinceRestructure') {
    start = new Date('2026-05-01T00:00:00Z');
  } else if (period === 'today') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else if (period === 'weekToDate' || period === 'previousWeek') {
    const weekday = (now.getUTCDay() + 6) % 7;
    const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - weekday));
    if (period === 'weekToDate') start = thisMonday;
    else {
      start = new Date(thisMonday.getTime() - 7 * 86400000);
      end = thisMonday;
    }
  } else if (period === 'monthToDate') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else if (period === 'previousMonth') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else if (String(period || '').startsWith('month:')) {
    const [, value] = String(period).split(':');
    const [year, month] = String(value || '').split('-').map(Number);
    start = new Date(Date.UTC(year || now.getUTCFullYear(), (month || 1) - 1, 1));
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
  return {start, end};
}

function flightsForPeriod(period) {
  const {start, end} = periodBounds(period);
  return app.flights.filter(f => {
    const date = dateOf(f);
    return date >= start && date < end;
  });
}

function selectInitialDashboardPeriod() {
  const hasCompletedFlights = period => flightsForPeriod(period).some(flight => flight.status === 'completed');
  app.period = hasCompletedFlights('today')
    ? 'today'
    : hasCompletedFlights('weekToDate')
      ? 'weekToDate'
      : 'previousWeek';
  app.customDate = null;
  app.customEndDate = null;
  $$('#dashboardView [data-period]').forEach(button => {
    button.classList.toggle('active', button.dataset.period === app.period);
  });
  $('#dashboardCalendarButton').classList.remove('active');
}

function correctedCompanyBalance(period) {
  const selected = flightsForPeriod(period);
  return dashboardFinanceData(selected, periodBounds(period))?.balance
    ?? sum(selected, flight => flight.finance.balance);
}

function dashboardFinanceData(selected, bounds) {
  const data = app.companyData;
  if (!data?.economy?.fixedCosts) return null;
  const fixed = data.economy.fixedCosts;
  const averages = {fleet:fixed.fleet/fixed.days, airports:fixed.airports/fixed.days, handling:fixed.handling/fixed.days, schedulers:fixed.schedulers/fixed.days};
  const calibration = new Map((data.economy.calibrationDays || []).map(day => [day.date, day]));
  const fixedTotals = {fleet:0, airports:0, handling:0, schedulers:0};
  const reliableFrom = new Date(`${data.economy.baseline.from}T00:00:00Z`);
  const fixedStart = new Date(Math.max(bounds.start.getTime(), reliableFrom.getTime()));
  if (fixedStart < bounds.end) {
    const startDay = new Date(Date.UTC(fixedStart.getUTCFullYear(), fixedStart.getUTCMonth(), fixedStart.getUTCDate()));
    const boundary = bounds.end.getUTCHours() === 0 && bounds.end.getUTCMinutes() === 0 && bounds.end.getUTCSeconds() === 0;
    const endDay = new Date(Date.UTC(bounds.end.getUTCFullYear(), bounds.end.getUTCMonth(), bounds.end.getUTCDate() + (boundary ? 0 : 1)));
    for (let day=startDay; day<endDay; day=new Date(day.getTime()+86400000)) {
      const exact = calibration.get(day.toISOString().slice(0,10));
      fixedTotals.fleet += exact?.fleetFixed ?? averages.fleet;
      fixedTotals.airports += exact?.airportFixed ?? averages.airports;
      fixedTotals.handling += exact?.handlingExtra ?? averages.handling;
      fixedTotals.schedulers += exact?.schedulers ?? averages.schedulers;
    }
  }
  const insurance = window.UCAAInsurance.summary(app.flights, bounds.start, bounds.end);
  const revenue = sum(selected, f=>f.finance.revenue);
  const penalties = sum(selected, f=>f.finance.penalties);
  const payroll = sum(selected, pilotPay);
  const cabinCrewPayroll = sum(selected, cabinCrewPay);
  const incidentCompensation = sum(selected, flight => window.UCAAIncidentCompensation.breakdown(
    flight, insurance.coverageByFlight.get(flight) || 0, app.flights
  ).compensation);
  const categories = [
    ['Дохід', revenue, '#82ca87'],
    ['Маршрути для регулярки', fixedTotals.schedulers, '#70c7e8'],
    ['Аеропортові збори', sum(selected, f=>f.finance.details?.landing)+fixedTotals.airports, '#ffa62b'],
    ['Хендлінг', sum(selected, f=>f.finance.details?.handling)+fixedTotals.handling, '#37afb3'],
    ['Флот (лізинг)', sum(selected, f=>f.finance.details?.aircraft)+fixedTotals.fleet, '#949dd1'],
    ['Пальне', sum(selected, f=>f.finance.details?.fuel), '#ffd35a'],
    ['Зарплата пілотам', payroll, '#e89ac7'],
    ['Зарплата бортпровідникам', cabinCrewPayroll, '#d7a6e8'],
    ['Штрафи та інциденти', penalties, '#d8333d'],
    ['Моральні компенсації / Пошкоджений вантаж', incidentCompensation, '#ef9f76'],
    ['Страхування', insurance.premium, '#7c5cc4'],
    ['Страхове відшкодування', insurance.payout, '#4b9f68']
  ];
  const income = revenue + insurance.payout;
  const expenses = penalties + incidentCompensation + insurance.premium + payroll + cabinCrewPayroll + fixedTotals.schedulers
    + categories[2][1] + categories[3][1] + categories[4][1] + categories[5][1];
  return {categories, balance:income-expenses};
}

function compactMoney(value) {
  const amount = Math.abs(Number(value) || 0);
  if (amount >= 1000000) return `$${(amount/1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount/1000)}K`;
  return money(amount);
}

function periodLabel() {
  const labels = {today:'За сьогодні',weekToDate:'З початку тижня',previousWeek:'Минулий тиждень',monthToDate:'З початку місяця',previousMonth:'Минулий місяць',sinceRestructure:'З 01.05.2026',all:'Весь період'};
  if (app.period === 'customRange' && app.customDate && app.customEndDate) return `${liveryFlightLogFormatDateShort(app.customDate)}-${liveryFlightLogFormatDateShort(app.customEndDate)}`;
  return app.period === 'custom' && app.customDate ? new Date(`${app.customDate}T00:00:00Z`).toLocaleDateString('uk-UA',{timeZone:'UTC'}) : labels[app.period];
}

function dashboardMetricPeriodLabel() {
  if (app.period === 'customRange' && app.customDate && app.customEndDate) {
    return `за ${liveryFlightLogFormatDateShort(app.customDate)}-${liveryFlightLogFormatDateShort(app.customEndDate)}`;
  }
  if (app.period === 'custom' && app.customDate) {
    return `за ${new Date(`${app.customDate}T00:00:00Z`).toLocaleDateString('uk-UA',{timeZone:'UTC'})}`;
  }
  const labels = {
    today:'за сьогодні',
    weekToDate:'з початку тижня',
    previousWeek:'за минулий тиждень',
    monthToDate:'з початку місяця',
    previousMonth:'за минулий місяць',
    sinceRestructure:'з 01.05',
    all:'за весь період'
  };
  return labels[app.period] || 'за період';
}

function piePoint(cx, cy, radius, percent) {
  const angle = percent / 100 * 360 - 90;
  const radians = angle * Math.PI / 180;
  return {x:cx + radius * Math.cos(radians), y:cy + radius * Math.sin(radians)};
}

function pieSectorPath(startPercent, endPercent) {
  const start = piePoint(50, 50, 50, startPercent);
  const end = piePoint(50, 50, 50, endPercent);
  const largeArc = endPercent - startPercent > 50 ? 1 : 0;
  return `M 50 50 L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A 50 50 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
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
  for (const segment of visible) {
    const start = cursor;
    cursor += Number(segment.value) / total * 100;
    stops.push(`${segment.color} ${start.toFixed(3)}% ${cursor.toFixed(3)}%`);
    const share = Number(segment.value) / total * 100;
    const title = titleFn ? titleFn(segment, share, total) : `${segment.label}: ${segment.value}`;
    paths.push(`<path d="${pieSectorPath(start, cursor)}" fill="rgba(255,255,255,0.001)"><title>${esc(title)}</title></path>`);
  }
  element.style.background = `conic-gradient(${stops.join(',')})`;
  element.innerHTML = `<svg class="pie-hit-map" viewBox="0 0 100 100" aria-hidden="true">${paths.join('')}</svg>`;
  element.removeAttribute('title');
}

function renderDashboardOperationalPies(selected) {
  const completed = selected.filter(flight => flight.status === 'completed');
  const flightTypeMeta = {
    charter:{label:'Charter', color:'#f39a0a'},
    free:{label:'Free', color:'#8b8b8b'},
    schedule:{label:'Schedule', color:'#55ad55'}
  };
  const typeCounts = {charter:0, free:0, schedule:0};
  completed.forEach(flight => typeCounts[flightOperation(flight).key] = (typeCounts[flightOperation(flight).key] || 0) + 1);
  const flightTypeSegments = ['charter','free','schedule'].map(key => ({
    key,
    label:flightTypeMeta[key].label,
    color:flightTypeMeta[key].color,
    value:typeCounts[key] || 0
  }));
  renderPie($('#dashboardFlightTypePie'), flightTypeSegments, (segment, share) =>
    `${segment.label}: ${segment.value} рейсів (${share.toFixed(1)}%)`
  );
  $('#dashboardFlightTypeLegend').innerHTML = flightTypeSegments.map((segment, index) =>
    `${index === 2 ? '<br>' : ''}<span class="flight-type-badge" style="background:${segment.color}" title="${esc(`${segment.label}: ${segment.value} рейсів`)}">${esc(segment.label)}</span>`
  ).join('');

  const aircraftPalette = ['#4f7fd4','#54a85b','#f39a0a','#9a75c9','#37afb3','#d55353','#9a9a9a','#d5a52b','#6f8ec9','#c36aa0'];
  const aircraftMap = new Map();
  completed.forEach(flight => {
    const icao = String(flight.aircraft?.icao || '—').toUpperCase();
    const current = aircraftMap.get(icao) || {icao, name:flight.aircraft?.name || icao, value:0};
    current.value += 1;
    aircraftMap.set(icao, current);
  });
  const aircraftSegments = [...aircraftMap.values()]
    .sort((a,b) => b.value - a.value || a.icao.localeCompare(b.icao))
    .slice(0,8)
    .map((item,index) => ({...item, label:item.icao, color:aircraftPalette[index % aircraftPalette.length]}));
  renderPie($('#dashboardAircraftTypePie'), aircraftSegments, (segment, share) =>
    `${segment.icao} · ${segment.name}: ${segment.value} рейсів (${share.toFixed(1)}%)`
  );
  $('#dashboardAircraftTypeLegend').innerHTML = aircraftSegments.map(segment =>
    `<span class="aircraft-type-badge" style="background:${segment.color}" title="${esc(`${segment.icao} · ${segment.name}: ${segment.value} рейсів`)}">${esc(segment.icao)}</span>`
  ).join('');
}

function renderDashboardFinance(selected) {
  const result = dashboardFinanceData(selected, periodBounds(app.period));
  if (!result) return;
  renderPie($('#dashboardFinancePie'), result.categories.map(([label,value,color]) => ({label,value,color})), (segment, share) =>
    `${segment.label}: ${money(segment.value)} (${share.toFixed(1)}%)`
  );
  const approximateLabels = [];
  const expenseLabels = new Set(['Маршрути для регулярки','Аеропортові збори','Хендлінг','Флот (лізинг)',...approximateLabels,'Пальне','Зарплата пілотам','Зарплата бортпровідникам','Штрафи та інциденти','Моральні компенсації / Пошкоджений вантаж','Страхування']);
  $('#dashboardFinanceLegend').innerHTML = result.categories.map(([label,value,color]) => {
    const approximate = approximateLabels.includes(label) ? ' ≈' : '';
    const specialClass = label === 'Штрафи та інциденти' ? ' finance-special-first' : '';
    const amount = `${expenseLabels.has(label) && value ? '−' : ''}${compactMoney(value)}`;
    return `<div class="${specialClass.trim()}"><strong>${amount}</strong><i class="finance-dot" style="background:${color}"></i><span>${label}${approximate}</span></div>`;
  }).join('') + `<div class="finance-total"><strong class="${result.balance>=0?'positive':'negative'}">${money(result.balance,true)}</strong><span></span><span></span></div>`;
  $('#dashboardFinancePeriod').textContent = periodLabel();
  renderDashboardOperationalPies(selected);
}

function aggregatePilotFlights(flights) {
  const map = new Map();
  for (const flight of flights) {
    const id = flight.pilot.id;
    if (!map.has(id)) map.set(id, { id, name: flight.pilot.name, role: 'Пілот', flights: [] });
    map.get(id).flights.push(flight);
  }
  return [...map.values()].map(pilot => {
    const completed = pilot.flights.filter(f => f.status === 'completed');
    const ratings = completed.map(f => Number(f.rating)).filter(v => v > 0);
    const aircraft = favorite(completed, f => f.aircraft.icao);
    const route = favorite(completed, f => `${f.departure.icao} → ${f.arrival.icao}`);
    const latest = [...pilot.flights].sort((a, b) => dateOf(b) - dateOf(a))[0];
    return {
      ...pilot,
      completed: completed.length,
      failed: pilot.flights.length - completed.length,
      minutes: sum(completed, f => f.times.durationMinutes),
      balance: sum(pilot.flights, pilotCompanyBalance),
      salary: sum(pilot.flights, pilotPay),
      rating: ratings.length ? sum(ratings, v => v) / ratings.length : 0,
      aircraft: aircraft ? completed.find(f => f.aircraft.icao === aircraft.key)?.aircraft : null,
      aircraftFlights: aircraft?.count || 0,
      route: route?.key || '—',
      latest
    };
  });
}

function favorite(items, keyFn) {
  const counts = new Map();
  items.forEach(item => counts.set(keyFn(item), (counts.get(keyFn(item)) || 0) + 1));
  return [...counts].map(([key, count]) => ({key, count})).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))[0] || null;
}

function sum(items, valueFn) {
  return items.reduce((total, item) => total + (Number(valueFn(item)) || 0), 0);
}

const metricInfo = {
  hours: { label: 'Наліт', value: p => p.minutes, display: p => formatMinutes(p.minutes) },
  balance: { label: 'Прибуток АК', value: p => p.balance, display: p => money(p.balance, true) },
  salary: { label: 'Зарплата*', value: p => p.salary, display: p => money(p.salary) },
  rating: { label: 'Сер. рейтинг', value: p => p.rating, display: p => p.rating ? p.rating.toFixed(2) : '—' }
};

function pilotCardsRatingClass(rating) {
  const value = Number(rating) || 0;
  if (value >= 10) return 'rating-perfect';
  if (value >= 9) return 'rating-9';
  if (value >= 8) return 'rating-8';
  if (value >= 7) return 'rating-7';
  if (value >= 6) return 'rating-6';
  if (value >= 5) return 'rating-5';
  return value > 0 ? 'rating-low' : 'rating-none';
}

function pilotCardsPeriodLabel(period = app.pilotsPeriod) {
  if (String(period || '').startsWith('month:')) {
    const date = pilotCardsPeriodMonthStart(period);
    if (date) return `${String(date.getUTCMonth() + 1).padStart(2,'0')}.${date.getUTCFullYear()}`;
  }
  if (period === 'previousMonth') {
    const date = pilotCardsPeriodMonthStart(period);
    return `Минулий місяць (${String((date?.getUTCMonth() ?? 0) + 1).padStart(2,'0')})`;
  }
  const labels = {
    today:'За сьогодні (з 00:00 UTC)',
    weekToDate:'З початку тижня',
    previousWeek:'Минулий тиждень',
    monthToDate:'З початку місяця',
    previousMonth:'Минулий місяць',
    sinceRestructure:'з 01.05',
    all:'Весь період'
  };
  return labels[period] || 'Весь період';
}

function pilotCardsPeriodMonthStart(period) {
  const now = app.referenceNow || new Date();
  if (period === 'previousMonth') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  if (!String(period || '').startsWith('month:')) return null;
  const [year, month] = String(period).slice(6).split('-').map(Number);
  if (!year || !month) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

function pilotCardsMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2,'0')}`;
}

function pilotCardsMonthShortLabel(date) {
  const month = date.toLocaleDateString('uk-UA', {month:'short', timeZone:'UTC'}).replace('.', '').toUpperCase().slice(0,3);
  return `${month} ${String(date.getUTCFullYear()).slice(-2)}`;
}

function pilotCardsPeriodOptions() {
  const completedDates = app.flights
    .filter(flight => flight.status === 'completed')
    .map(dateOf)
    .filter(date => !Number.isNaN(date.getTime()));
  const now = app.referenceNow || new Date();
  const current = pilotCardsMonthStart(now);
  const first = completedDates.length
    ? pilotCardsMonthStart(new Date(Math.min(...completedDates.map(date => date.getTime()))))
    : new Date(Date.UTC(2026,0,1));
  const previous = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
  const options = [['monthToDate','З початку місяця']];
  for (let cursor = previous; cursor >= first; cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1))) {
    const key = cursor.getTime() === previous.getTime()
      ? 'previousMonth'
      : `month:${pilotCardsMonthKey(cursor)}`;
    const label = cursor.getTime() === previous.getTime()
      ? `Минулий місяць (${String(cursor.getUTCMonth() + 1).padStart(2,'0')})`
      : `${String(cursor.getUTCMonth() + 1).padStart(2,'0')}.${cursor.getUTCFullYear()}`;
    options.push([key,label]);
  }
  options.push(['all','Весь період']);
  return options;
}

function pilotCardSummary(pilot) {
  const completed = pilot.flights.filter(flight => flight.status === 'completed');
  const ratings = completed.map(flight => Number(flight.rating)).filter(value => value > 0);
  const first = [...completed].sort((a,b) => dateOf(a) - dateOf(b))[0] || null;
  const last = [...completed].sort((a,b) => dateOf(b) - dateOf(a))[0] || null;
  const avatarFlight = [...pilot.flights].reverse().find(flight => flight.pilot?.avatar) || pilot.flights[0];
  return {
    ...pilot,
    completedFlights:completed,
    first,
    last,
    avatar:avatarFlight?.pilot?.avatar || 'default',
    rating:ratings.length ? sum(ratings, value => value) / ratings.length : 0,
    minutes:sum(completed, flight => flight.times.durationMinutes),
    companyProfit:sum(completed, flight => directFlightFinance(flight).companyProfit),
    salary:sum(completed, pilotPay)
  };
}

function pilotCardLiveMedals(pilots) {
  const medalMap = new Map(pilots.map(pilot => [pilot.id, 0]));
  const ranked = [
    pilot => pilot.minutes,
    pilot => pilot.completedFlights.length,
    pilot => pilot.rating,
    pilot => pilot.companyProfit,
    pilot => pilot.salary
  ];
  ranked.forEach(valueFn => {
    [...pilots]
      .filter(pilot => pilot.completedFlights.length >= 10 && valueFn(pilot) > 0)
      .sort((a,b) => valueFn(b) - valueFn(a) || a.name.localeCompare(b.name,'uk'))
      .slice(0,3)
      .forEach(pilot => medalMap.set(pilot.id, (medalMap.get(pilot.id) || 0) + 1));
  });
  return medalMap;
}

function pilotCardsMonthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function pilotCardsMonthLabel(date) {
  return date.toLocaleDateString('uk-UA', {month:'long', year:'numeric', timeZone:'UTC'});
}

function pilotCardsNextAwardDate(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
    .toLocaleDateString('uk-UA', {day:'2-digit', month:'2-digit', year:'numeric', timeZone:'UTC'});
}

function pilotCardsCleanQuality(flights) {
  const eligible = flights.filter(flight => Number(flight.rating) > 0 && !flight.operations?.emergency);
  let clean = 0;
  eligible.forEach(flight => {
    const finance = directFlightFinance(flight);
    const pay = finance.pilotPay || {};
    const isClean = Math.max(0,Number(flight.finance?.penalties)||0) === 0
      && Math.max(0,Number(pay.delayDeduction)||0) === 0
      && Math.max(0,Number(pay.fdrPenalty)||0) === 0
      && Math.max(0,Number(pay.incidentLiability)||0) === 0
      && Math.max(0,Number(pay.insuranceLiability)||0) === 0
      && !pay.seriousIncident
      && Math.max(0,Number(pay.insuranceCase)||0) === 0;
    if (isClean) clean += 1;
  });
  return {
    eligible:eligible.length,
    clean,
    percent:eligible.length ? clean / eligible.length * 100 : 0
  };
}

function pilotCardsMonthSummary(pilotId, pilotFlights) {
  const completed = pilotFlights.filter(flight => flight.status === 'completed');
  const rated = completed.filter(flight => Number(flight.rating) > 0 && !flight.operations?.emergency);
  const finances = completed.map(flight => directFlightFinance(flight));
  return {
    id:pilotId,
    name:completed[0]?.pilot?.name || pilotFlights[0]?.pilot?.name || '',
    flights:completed.length,
    ratedFlights:rated.length,
    minutes:sum(completed, flight => flight.times.durationMinutes),
    rating:rated.length ? sum(rated, flight => Number(flight.rating) || 0) / rated.length : 0,
    companyProfit:sum(finances, finance => finance.companyProfit),
    salary:sum(completed, pilotPay),
    difficulty:completed.length ? sum(completed, flight => aircraftCoefficient(flight.aircraft?.icao, flight.flightType)) / completed.length : 0,
    scheduledFlights:completed.filter(flight => Boolean(flight.operations?.scheduled)).length,
    charterFlights:completed.filter(flight => Boolean(flight.operations?.charter)).length,
    quality:pilotCardsCleanQuality(completed)
  };
}

function buildPilotCardsMonthlyCache() {
  const completed = app.flights.filter(flight => flight.status === 'completed' && flight.pilot?.id);
  const latest = completed.reduce((max, flight) => Math.max(max, dateOf(flight).getTime() || 0), 0);
  const earned = new Map();
  const pending = new Map();
  const monthAwards = new Map();
  const currentMonth = pilotCardsMonthStart(app.referenceNow || new Date());
  const cacheKey = `${completed.length}:${latest}:${pilotCardsMonthKey(currentMonth)}`;
  if (pilotCardsMonthlyCache?.cacheKey === cacheKey) return pilotCardsMonthlyCache;
  const byMonth = new Map();
  completed.forEach(flight => {
    const date = dateOf(flight);
    const monthStart = pilotCardsMonthStart(date);
    const key = pilotCardsMonthKey(monthStart);
    if (!byMonth.has(key)) byMonth.set(key, {monthStart, flights:[]});
    byMonth.get(key).flights.push(flight);
  });

  const definitions = [
    {key:'hours', emoji:'⏱️', label:'Найбільший наліт', value:item=>item.minutes, format:value=>formatMinutes(value), eligible:item=>item.minutes>0},
    {key:'flights', emoji:'🛫', label:'Найбільша кількість рейсів', value:item=>item.flights, format:value=>`${value} рейсів`, eligible:item=>item.flights>0},
    {key:'rating', emoji:'✅', label:'Найвищий середній рейтинг', value:item=>item.rating, format:value=>value.toFixed(2), eligible:item=>item.ratedFlights>=10},
    {key:'profit', emoji:'💵', label:'Найбільший прибуток авіакомпанії', value:item=>item.companyProfit, format:value=>money(value,true), eligible:item=>item.companyProfit>0},
    {key:'salary', emoji:'👷', label:'Найбільша зарплата пілота', value:item=>item.salary, format:value=>money(value,true), eligible:item=>item.salary>0},
    {key:'difficulty', emoji:'⚙️', label:'Найвища середня складність літака', value:item=>item.difficulty, format:value=>value.toFixed(2), eligible:item=>item.difficulty>0},
    {key:'clean', emoji:'🧑‍✈️', label:'Найбільший відсоток польотів без штрафів', value:item=>item.quality.percent, format:(value,item)=>`${value.toFixed(0)}% (${item.quality.clean}/${item.quality.eligible})`, eligible:item=>item.quality.eligible>=10},
    {key:'scheduleFlights', emoji:'📅', label:'Найбільше schedule-рейсів', value:item=>item.scheduledFlights, format:value=>`${value} рейсів`, eligible:item=>item.scheduledFlights>=5},
    {key:'charterFlights', emoji:'📅', label:'Найбільше charter-рейсів', value:item=>item.charterFlights, format:value=>`${value} рейсів`, eligible:item=>item.charterFlights>=5}
  ];

  byMonth.forEach(({monthStart, flights}) => {
    const pilotGroups = new Map();
    flights.forEach(flight => {
      const list = pilotGroups.get(flight.pilot.id) || [];
      list.push(flight);
      pilotGroups.set(flight.pilot.id, list);
    });
    const candidates = [...pilotGroups.entries()]
      .map(([pilotId, pilotFlights]) => pilotCardsMonthSummary(pilotId, pilotFlights))
      .filter(item => item.flights > 0);
    const isCurrent = monthStart.getTime() === currentMonth.getTime();
    definitions.forEach(definition => {
      const ranked = candidates
        .filter(item => definition.eligible(item))
        .sort((a,b) => definition.value(b) - definition.value(a) || b.flights - a.flights || a.name.localeCompare(b.name,'uk'));
      const winner = ranked[0];
      if (!winner) return;
      const runnerUp = ranked.find(item => item.id !== winner.id) || null;
      const award = {
        key:definition.key,
        emoji:definition.emoji,
        label:definition.label,
        month:pilotCardsMonthLabel(monthStart),
        monthShort:pilotCardsMonthShortLabel(monthStart),
        monthKey:pilotCardsMonthKey(monthStart),
        awardDate:pilotCardsNextAwardDate(monthStart),
        value:definition.value(winner),
        formatted:definition.format(definition.value(winner), winner),
        runnerUp:runnerUp ? {
          id:runnerUp.id,
          name:runnerUp.name,
          value:definition.value(runnerUp),
          formatted:definition.format(definition.value(runnerUp), runnerUp)
        } : null
      };
      const target = isCurrent ? pending : earned;
      const current = target.get(winner.id) || [];
      current.push(award);
      target.set(winner.id, current);
      if (!isCurrent) {
        const monthMap = monthAwards.get(award.monthKey) || new Map();
        const monthPilotAwards = monthMap.get(winner.id) || [];
        monthPilotAwards.push(award);
        monthMap.set(winner.id, monthPilotAwards);
        monthAwards.set(award.monthKey, monthMap);
      }
    });
  });

  pilotCardsMonthlyCache = {cacheKey, earned, pending, monthAwards};
  return pilotCardsMonthlyCache;
}

function pilotCardPendingIcon(pending) {
  if (pending.length > 1) return `<b class="multi">${pending.length}</b>`;
  const emoji = pending[0]?.emoji || '';
  const allowed = new Set(['✅','⏱️','👷','🧑‍✈️','🛫','💵','⚙️']);
  return `<b>${allowed.has(emoji) ? emoji : '🛫'}</b>`;
}

function pilotCardAwardTooltipLine(award) {
  return `• ${esc(award.label)}<br><span class="tooltip-award-month">${esc(award.month)}</span><br><span class="tooltip-award-value">${esc(award.formatted)} за місяць</span>`;
}

function pilotCardPastAwardsTooltip(awards, specific = false) {
  if (!awards.length) return '';
  const header = specific
    ? `Пілот отримав ${awards.length} ${awards.length === 1 ? 'нагороду' : 'нагороди'} за ${esc(awards[0].month)}:`
    : `Пілот вже отримав ${awards.length} нагород за минулі періоди:`;
  return `<div><strong>${header}</strong><br>${awards.map(pilotCardAwardTooltipLine).join('<br>')}</div>`;
}

function pilotCardLiveAwardsTooltip(awards) {
  if (!awards.length) return '';
  const month = awards[0].month;
  const header = awards.length === 1
    ? `Пілот поки що лідирує у битві за нагороду за ${esc(month)}:`
    : `Пілот поки що лідирує у битві за нагородами за ${esc(month)}:`;
  const rows = awards.map(award => {
    const chase = award.runnerUp
      ? `але його переслідує ${esc(award.runnerUp.name)} з ${esc(award.runnerUp.formatted)}.`
      : 'і його ніхто не переслідує.';
    return `${pilotCardAwardTooltipLine(award)}<br>${chase}`;
  });
  return `<div><strong>${header}</strong><br>${rows.join('<br><br>')}</div>`;
}

function pilotCardDiamondHtml(kind, awards, tooltip, centerText = null, extraClass = '') {
  if (!awards.length) return '';
  const isLive = kind === 'pending';
  const icon = isLive
    ? pilotCardPendingIcon(awards)
    : (centerText ? `<b${awards.length > 1 ? ' class="multi"' : ''}>${awards.length > 1 ? awards.length : '↩'}</b>` : `<b>↩</b>`);
  const text = centerText || (isLive ? 'LIVE' : String(awards.length));
  return `<span class="pilot-card-diamond ${kind} ${extraClass}" data-award-tooltip="${esc(tooltip)}"><i></i>${icon}<span>${esc(text)}</span><em>🥇</em></span>`;
}

function pilotCardAwardsHtml(pilot, period = app.pilotsPeriod) {
  const monthly = buildPilotCardsMonthlyCache();
  const earned = monthly.earned.get(pilot.id) || [];
  const pending = monthly.pending.get(pilot.id) || [];
  const selectedMonth = pilotCardsPeriodMonthStart(period);
  const selectedMonthAwards = selectedMonth ? (monthly.monthAwards.get(pilotCardsMonthKey(selectedMonth))?.get(pilot.id) || []) : [];
  const showLive = period === 'monthToDate';
  const pieces = [];
  const aircraftAwards = window.UCAAPilotProfile?.cardAircraftAwardsHtml?.(pilot.id) || '';
  if (aircraftAwards) pieces.push(aircraftAwards);
  const specialAwards = showLive ? (window.UCAAPilotProfile?.cardSpecialAwardsHtml?.(pilot.id) || '') : '';
  if (specialAwards) pieces.push(specialAwards);
  if (selectedMonthAwards.length > 0) {
    pieces.push(pilotCardDiamondHtml('earned', selectedMonthAwards, pilotCardPastAwardsTooltip(selectedMonthAwards, true), selectedMonthAwards[0].monthShort, 'month-specific'));
  } else if (!selectedMonth && earned.length > 0) {
    pieces.push(pilotCardDiamondHtml('earned', earned, pilotCardPastAwardsTooltip(earned, false)));
  }
  if (showLive && pending.length > 0) pieces.push(pilotCardDiamondHtml('pending', pending, pilotCardLiveAwardsTooltip(pending)));
  return pieces.join('');
}

function wirePilotCardsAwardTooltips() {
  document.querySelector('#pilotCardsAwardTooltip')?.remove();
  const tooltip = document.createElement('div');
  tooltip.id = 'pilotCardsAwardTooltip';
  tooltip.className = 'profile-aircraft-award-tooltip';
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  const show = element => {
    tooltip.innerHTML = element.dataset.awardTooltip || '';
    tooltip.hidden = false;
    const rect = element.getBoundingClientRect();
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    tooltip.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2))}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - height - 8, Math.max(8, rect.bottom + 6))}px`;
  };
  const hide = () => { tooltip.hidden = true; };
  $$('#pilotsView [data-award-tooltip]').forEach(element => {
    if (element.title) {
      element.dataset.nativeTitle = element.title;
      element.removeAttribute('title');
    }
    element.addEventListener('mouseenter', () => show(element));
    element.addEventListener('mouseleave', hide);
  });
}

function renderPilotsCardsPage() {
  const view = $('#pilotsView');
  if (!view) return;
  const period = app.pilotsPeriod || 'all';
  const periodFlights = flightsForPeriod(period);
  const lifetimeRows = new Map(
    aggregatePilotFlights(app.flights).map(pilot => [pilot.id, pilotCardSummary(pilot)])
  );
  const pilotRows = aggregatePilotFlights(periodFlights)
    .filter(pilot => pilot.completed > 0)
    .map(pilotCardSummary)
    .sort((a,b) => b.completedFlights.length - a.completedFlights.length || b.minutes - a.minutes || a.name.localeCompare(b.name,'uk'));
  const periodButtons = pilotCardsPeriodOptions();
  view.innerHTML = `<section class="bar pilots-period-bar"><h2>ПЕРІОД:</h2><div class="periods" aria-label="Період сторінки пілотів">${periodButtons.map(([key,label]) => `<button data-pilots-period="${key}" class="${period===key?'active':''}">${label}</button>`).join('')}</div><div class="pilots-active-count" style="font-size:16px;">Літало: <strong>${pilotRows.length}</strong></div></section><div id="pilotCardsGrid" class="pilot-cards-grid">${pilotRows.length ? pilotRows.map((pilot,index) => {
    const rating = pilot.rating ? pilot.rating.toFixed(2) : '—';
    const hours = Math.round(pilot.minutes / 60);
    const awards = pilotCardAwardsHtml(pilot, period);
    const awardsBlock = awards ? `<div class="pilot-card-awards">${awards}</div>` : '';
    const lifetime = lifetimeRows.get(pilot.id) || pilot;
    return `<article class="pilot-card" data-pilot-id="${esc(pilot.id)}"><div class="pilot-card-row pilot-card-row-open pilot-card-name"><span class="pilot-card-rank">#${index+1}</span> ${pilotNameWithStreak(pilot)}</div><div class="pilot-card-row pilot-card-row-open pilot-card-visual-row"><div class="pilot-card-main"><img class="pilot-card-avatar" src="${esc(pilotAvatarUrl(pilot.avatar))}" alt="${esc(pilot.name)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='https://newsky.app/api/pilot/avatar/default'}"></div><div class="pilot-card-stats"><div class="pilot-card-side">${pilot.completedFlights.length}<small>рейсів</small></div><div class="pilot-card-rating"><span class="rating-badge ${pilotCardsRatingClass(pilot.rating)}">${rating}</span></div><div class="pilot-card-side">${hours}<small>годин</small></div></div></div><div class="pilot-card-row pilot-card-row-open pilot-card-money">Прибуток АК: <span class="${pilot.companyProfit>=0?'positive':'negative'}">${money(pilot.companyProfit,true)}</span><br>Зарплата: ${money(pilot.salary)}</div><div class="pilot-card-row pilot-card-awards">${awards}</div><div class="pilot-card-row pilot-card-dates">Перший політ: ${lifetime.first?dateOf(lifetime.first).toLocaleDateString('uk-UA',{timeZone:'UTC'}):'—'}<br>Крайній політ: ${lifetime.last?dateOf(lifetime.last).toLocaleDateString('uk-UA',{timeZone:'UTC'}):'—'}</div></article>`;
  }).join('') : `<div class="loading">За період «${esc(pilotCardsPeriodLabel(period))}» завершених рейсів немає</div>`}</div>`;
  $$('#pilotsView [data-pilots-period]').forEach(button => button.onclick = () => {
    app.pilotsPeriod = button.dataset.pilotsPeriod || 'all';
    renderPilotsCardsPage();
  });
  $$('#pilotsView .pilot-card').forEach(card => {
    card.removeAttribute('role');
    card.removeAttribute('tabindex');
    card.removeAttribute('title');
  });
  $$('#pilotsView .pilot-card-row-open').forEach(zone => {
    const card = zone.closest('.pilot-card');
    zone.tabIndex = 0;
    zone.setAttribute('role','button');
    zone.title ||= 'Відкрити профіль пілота';
    zone.onclick = () => showPilotProfile(card.dataset.pilotId);
    zone.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showPilotProfile(card.dataset.pilotId);
      }
    };
  });
  wirePilotCardsAwardTooltips();
}

function landingStats(flight) {
  for (const violation of flight.operations?.violations || []) {
    const title = String(violation?.title || '');
    const match = title.match(/([0-9.]+)G\s*\(([0-9.]+)\s*ft\/min/i);
    if (match) return `−${Math.round(Number(match[2]))} fpm / ${Number(match[1]).toFixed(2)} G`;
  }
  return '—';
}

function landingDetails(flight) {
  for (const violation of flight.operations?.violations || []) {
    const title = String(violation?.title || '');
    if (!/touchdown/i.test(title)) continue;
    const force = title.match(/([0-9.]+)G\s*\(([0-9.]+)\s*ft\/min/i);
    const threshold = title.match(/Distance from threshold:\s*([0-9.]+)m/i);
    const average = title.match(/Average centerline deviation:\s*([0-9.]+)m/i);
    const maximum = title.match(/Max centerline deviation:\s*([0-9.]+)m/i);
    const wind = title.match(/wind[^:<]*:\s*([^<]+)/i);
    const runway = title.match(/runway length:\s*([0-9.]+)m/i);
    return {g:force?Number(force[1]):null,fpm:force?Number(force[2]):null,threshold:threshold?Number(threshold[1]):null,average:average?Number(average[1]):null,maximum:maximum?Number(maximum[1]):null,wind:wind?.[1]||null,runway:runway?Number(runway[1]):null};
  }
  return {};
}

function violationPoints(violation) {
  return (Number(violation?.points ?? violation?.penalty?.points) || 0) / 100;
}

function insuranceIncidentLabel(flight) {
  const classify = title => {
    const value = String(title || '');
    if (/main gear collapse/i.test(value)) return 'Main gear collapse';
    if (/engine failure/i.test(value)) return 'Engine failure';
    if (/wing\/engine strike/i.test(value)) return 'Wing/engine strike';
    if (/tail strike/i.test(value)) return 'Tail strike';
    if (/crashed on landing/i.test(value)) return 'Crashed on landing';
    if (/MLW exceeded/i.test(value)) return 'MLW exceeded';
    if (/departed .*too early/i.test(value)) return 'Early departure';
    if (/flight delayed/i.test(value)) return 'Flight delay';
    return value.split(/[(:]/)[0].trim() || 'Серйозний інцидент';
  };
  const labels = (flight.operations?.violations || [])
    .filter(violation => Number(violation?.cash ?? violation?.penalty?.cash) > 0)
    .map(violation => classify(violation.title));
  return [...new Set(labels)].join(' + ') || 'Серйозний інцидент';
}

function incidentLabelWithTouchdown(flight, label) {
  const landing = landingDetails(flight);
  const details = [];
  if (Number.isFinite(landing.fpm) && Number.isFinite(landing.g)) {
    details.push(`−${Math.round(landing.fpm)} fpm / ${landing.g.toFixed(2)} G`);
  }
  const weather = flight.operations?.touchdownWeather;
  if (weather && Number.isFinite(Number(weather.windDir)) && Number.isFinite(Number(weather.windSpd))) {
    const direction = String(Math.round(Number(weather.windDir)) % 360).padStart(3, '0');
    const speed = Math.round(Number(weather.windSpd));
    const crosswind = Number.isFinite(Number(weather.crosswind)) ? Math.round(Math.abs(Number(weather.crosswind))) : null;
    details.push(`вітер ${direction}° / ${speed} kt${crosswind===null?'':`, crosswind ${crosswind} kt`}`);
  }
  return `${label}${details.length ? ` (${details.join(' · ')})` : ''}`;
}

function violationText(title) {
  return String(title||'').split(/<br\s*\/?>/i).map(esc).join('<br>');
}

function utcTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('uk-UA',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});
}

function simulatorLabel(value) {
  const simulator = String(value||'').toLowerCase();
  if (simulator === 'xp') return 'XP11 / XP12';
  if (simulator === 'xp11') return 'XP11';
  if (simulator === 'xp12') return 'XP12';
  if (simulator === 'msfs') return 'MSFS 2020';
  if (simulator === 'msfs2024') return 'MSFS 2024';
  return value || '—';
}

function touchdownWindLabel(weather) {
  if (!weather || !Number.isFinite(Number(weather.windDir)) || !Number.isFinite(Number(weather.windSpd))) return '';
  const direction = String(Math.round(Number(weather.windDir)) % 360).padStart(3, '0');
  const speed = Math.round(Number(weather.windSpd));
  const crosswind = Number.isFinite(Number(weather.crosswind)) ? Math.round(Math.abs(Number(weather.crosswind))) : null;
  return `Wind on touchdown: ${direction}В° / ${speed} kt${crosswind===null?'':` (crosswind ${crosswind} kt)`}`;
}

function directFlightFinance(flight) {
  const insurancePayout = pilotInsuranceCoverage.get(flight) || 0;
  const pilotPay = window.UCAAPilotPay.breakdown(flight, insurancePayout, app.flights);
  const guaranteedBonus = guaranteedBonusAmountForFlight(flight);
  if (guaranteedBonus) {
    pilotPay.guaranteedBonus = guaranteedBonus;
    pilotPay.total = (Number(pilotPay.total) || 0) + guaranteedBonus;
  }
  const direct = {insurancePayout, pilotPay, ...window.UCAAIncidentCompensation.breakdown(flight, insurancePayout, app.flights)};
  if (guaranteedBonus) {
    direct.guaranteedBonus = guaranteedBonus;
    direct.pilotSalary = (Number(direct.pilotSalary) || 0) + guaranteedBonus;
    direct.companyProfit = (Number(direct.companyProfit) || 0) - guaranteedBonus;
  }
  return direct;
}

function financeDetailRow(label, value, color, expense = false, note = '', noteOnNewLine = false, title = '') {
  const noteHtml = note ? String(note).split('\n').map((line,index) =>
    `<small class="finance-row-note${index||noteOnNewLine?' finance-row-note-break':''}">${esc(line)}</small>`
  ).join('') : '';
  const titleAttr = title ? ` title="${tip(title)}"` : '';
  return `<div class="flight-finance-row"${titleAttr}><i class="finance-dot" style="background:${color}"></i><span>${esc(label)}${noteHtml}</span><strong class="${expense?'negative':'positive'}">${expense&&value?'−':''}${money(value)}</strong></div>`;
}

function pilotFinanceDetailRows(flight, direct) {
  const pay = direct.pilotPay;
  const grossSalary = Math.max(0, Number(pay?.salaryBeforeDeductions) || 0)
    + Math.max(0, Number(pay?.managementBonus) || 0)
    + Math.max(0, Number(pay?.guaranteedBonus) || 0);
  const deductions = Math.max(0, Number(pay?.totalDeductions) || 0);
  const salaryRow = `<div class="flight-finance-row"><i class="finance-dot" style="background:#e89ac7"></i><span>Зарплата пілота<button type="button" class="finance-pilot-profile-link" data-pilot-id="${esc(flight.pilot.id)}">${pilotNameWithStreak(flight.pilot)}</button></span><strong class="negative">${grossSalary?'−':''}${money(grossSalary)}</strong></div>`;
  const penaltyRow = deductions
    ? `<div class="flight-finance-row" title="Повна сума штрафів та особистої відповідальності пілота за цей рейс."><i class="finance-dot" style="background:#a45a7f"></i><span>Штраф пілота</span><strong class="positive">+${money(deductions)}</strong></div>`
    : '';
  return salaryRow + penaltyRow;
}

function penaltyDetailRow(flight, value) {
  const reason = insuranceIncidentLabel(flight);
  return `<div class="flight-finance-row"><i class="finance-dot" style="background:#d8333d"></i><span>Штрафи та інциденти<small class="finance-row-note">${esc(reason)}</small></span><strong class="negative">−${money(value)}</strong></div>`;
}

function flightFinanceDetails(flight) {
  const direct = directFlightFinance(flight);
  const details = flight.finance.details || {};
  const tickets = Number(details.tickets) || 0;
  const cargo = Number(details.cargo) || 0;
  const revenue = Number(flight.finance.revenue) || 0;
  const otherRevenue = Math.max(0, revenue - tickets - cargo);
  const aircraft = Number(details.aircraft) || 0;
  const fuel = Number(details.fuel) || 0;
  const handling = Number(details.handling) || 0;
  const landing = Number(details.landing) || 0;
  const newSkyExpenses = Number(flight.finance.expenses) || 0;
  const otherExpenses = Math.max(0, newSkyExpenses - aircraft - fuel - handling - landing);
  const penalties = Number(flight.finance.penalties) || 0;
  const isCargo = String(flight.flightType).toLowerCase() === 'cargo';
  const passengerClasses = flight.operations?.passengersByClass || {};
  const passengerCount = Math.max(0, Number(flight.operations?.passengers) || 0);
  const cabinCrewCount = isCargo ? 1 : Math.ceil(passengerCount / 50);
  const cabinCrewHours = (Number(flight.times?.durationMinutes) || 0) / 60;
  const cabinCrewRate = 50;
  const cabinCrewLabel = isCargo
    ? 'Зарплата load manager'
    : `Зарплата ${cabinCrewCount} ${cabinCrewCount === 1 ? 'бортпровіднику' : 'бортпровідникам'}`;
  const cabinCrewTooltip = [
    isCargo
      ? 'Для cargo-рейсу рахуємо одного load manager на весь вантаж.'
      : `На кожні 50 пасажирів потрібен 1 бортпровідник: ${passengerCount} пас. → ${cabinCrewCount}.`,
    `Ставка: $${cabinCrewRate}/год.`,
    `Формула: ${cabinCrewCount} × ${cabinCrewHours.toLocaleString('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2})} год × $${cabinCrewRate}/год = ${money(direct.cabinSalary)}.`
  ];
  const averageTicketPrice = Number(flight.operations?.ticketPrice) || (passengerCount ? tickets / passengerCount : 0);
  const soldClasses = [
    ['економ', Number(passengerClasses.Y) || 0],
    ['бізнес', Number(passengerClasses.C) || 0],
    ['перший', Number(passengerClasses.F) || 0]
  ].filter(([,count]) => count > 0).map(([name,count]) => `${name} — ${count}`);
  const ticketLabel = `Квитки: ${passengerCount} продано`;
  const ticketNote = [
    soldClasses.length ? `з них ${soldClasses.join(', ')}` : '',
    averageTicketPrice ? `середня вартість 1 квитка: ${money(averageTicketPrice)}` : ''
  ].filter(Boolean).join('\n');
  const cargoWeightKg = Math.max(0, Number(flight.operations?.cargoWeightKg) || 0);
  const cargoPricePer100Kg = cargoWeightKg ? cargo / cargoWeightKg * 100 : 0;
  const cargoTonnes = cargoWeightKg
    ? (cargoWeightKg/1000).toLocaleString('uk-UA',{minimumFractionDigits:1,maximumFractionDigits:1})
    : '';
  const cargoLabel = cargoTonnes ? `Вантаж: ${cargoTonnes} тонни` : 'Вантаж';
  const cargoNote = cargoPricePer100Kg
    ? `вартість перевозки 100 кг вантажу: ${Math.round(cargoPricePer100Kg).toLocaleString('uk-UA')}$`
    : '';
  const fuelUsedKg = Math.max(0, Number(flight.operations?.fuel) || 0);
  const distanceKm = Math.max(0, Number(flight.operations?.distance) || 0) * 1.852;
  const fuelPer100Km = distanceKm ? fuelUsedKg * 100 / distanceKm : 0;
  const fuelNote = fuelUsedKg
    ? `${(fuelUsedKg/1000).toLocaleString('uk-UA',{minimumFractionDigits:1,maximumFractionDigits:1})} т${distanceKm?` на ${Math.round(distanceKm).toLocaleString('uk-UA')} км (${Math.round(fuelPer100Km).toLocaleString('uk-UA')} кг на 100 км)`:''}`
    : '';
  const routeAirports = `${flight.departure.icao}, ${flight.arrival.icao}`;
  const compensationLabel = direct.type?.mode === 'refund20'
    ? `${direct.type.label} (20% ${isCargo?'доходу від вантажу':'вартості квитків'})`
    : direct.type?.label;
  const compensationTooltip = [
    'Компенсація після серйозної події рейсу.',
    isCargo
      ? 'Для cargo це витрати на пошкоджений або проблемний вантаж.'
      : 'Для пасажирського рейсу це моральна компенсація або часткове повернення пасажирам.',
    direct.type?.label ? `Причина: ${direct.type.label}.` : ''
  ].filter(Boolean);
  const insurancePayoutTooltip = [
    'Страхове відшкодування — частина збитку за страховим випадком, яку покрила страхова.',
    'Сума обмежена доступним місячним страховим лімітом.',
    `У цьому рейсі страхова покрила: ${money(direct.insurancePayout)}.`
  ];
  const incomeRowItems = [
    tickets ? financeDetailRow(ticketLabel, tickets, '#82ca87', false, ticketNote) : '',
    cargo ? financeDetailRow(cargoLabel, cargo, '#67b878', false, cargoNote, true) : '',
    otherRevenue ? financeDetailRow('Інший дохід NewSky', otherRevenue, '#9bd29e') : '',
    direct.insurancePayout ? financeDetailRow('Страхове відшкодування', direct.insurancePayout, '#4b9f68', false, '', false, insurancePayoutTooltip) : ''
  ].filter(Boolean);
  const incomeRows = incomeRowItems.join('');
  const incomeSubtotal = incomeRowItems.length > 1
    ? `<div class="flight-finance-row flight-finance-subtotal"><span></span><span>Усього доходів</span><strong class="positive">${money(revenue + direct.insurancePayout)}</strong></div>`
    : '';
  const expenseRows = [
    aircraft ? financeDetailRow('Флот (лізинг)', aircraft, '#949dd1', true, flight.aircraft.icao) : '',
    fuel ? financeDetailRow('Пальне', fuel, '#ffd35a', true, fuelNote) : '',
    handling ? financeDetailRow('Хендлінг', handling, '#37afb3', true, routeAirports) : '',
    landing ? financeDetailRow('Аеропортові збори', landing, '#ffa62b', true, flight.arrival.icao) : '',
    otherExpenses ? financeDetailRow('Інші витрати NewSky', otherExpenses, '#999', true) : '',
    penalties ? penaltyDetailRow(flight, penalties) : '',
    direct.compensation ? financeDetailRow(compensationLabel, direct.compensation, '#ef9f76', true, '', false, compensationTooltip) : '',
    pilotFinanceDetailRows(flight, direct),
    financeDetailRow(cabinCrewLabel, direct.cabinSalary, '#d7a6e8', true, '', false, cabinCrewTooltip)
  ].join('');
  const totalExpenses = newSkyExpenses + penalties + direct.pilotSalary + direct.cabinSalary + direct.compensation;
  return `<div class="flight-info-section" style="margin-top:0">ДОХОДИ</div><div class="flight-finance-list">${incomeRows}${incomeSubtotal}</div><div class="flight-info-section">ВИТРАТИ</div><div class="flight-finance-list">${expenseRows}<div class="flight-finance-row flight-finance-subtotal"><span></span><span>Усього витрат</span><strong class="negative">−${money(totalExpenses)}</strong></div></div><div class="flight-finance-row flight-finance-result company-final-result" title="Місячна страхова плата й загальні витрати мережі враховуються у фінансовому колі, але не розподіляються між окремими рейсами."><span></span><span>Прибуток авіакомпанії</span><strong class="${direct.companyProfit>0?'positive':direct.companyProfit<0?'negative':''}">${money(direct.companyProfit,true)}</strong></div>`;
}

function pilotSalaryDetails(flight) {
  const payout = pilotInsuranceCoverage.get(flight) || 0;
  const pay = window.UCAAPilotPay.breakdown(flight, payout, app.flights);
  const guaranteedBonus = guaranteedBonusAmountForFlight(flight);
  const displayedTotal = (Number(pay.total) || 0) + guaranteedBonus;
  const routeText = flight.routeType === 'UA-UA'
    ? `× ${pay.routeK.toFixed(2)} (+25%, рейс у межах України)`
    : flight.routeType === 'UA-INT'
      ? `× ${pay.routeK.toFixed(2)} (+15%, рейс до/з України)`
      : '× 1.00 (міжнародний рейс поза Україною)';
  const aircraftPercent = Math.round((pay.aircraftK - 1) * 100);
  const onlinePercent = Math.round((pay.onlineK - 1) * 100);
  const routeBonus = pay.flightBasePay * (pay.routeK - 1);
  const aircraftBonus = pay.flightBasePay * pay.routeK * (pay.aircraftK - 1);
  const onlineBonus = pay.flightBasePay * pay.routeK * pay.aircraftK * (pay.onlineK - 1);
  const masteryDelta = pay.masteryAdjustment;
  const crosswindDelta = pay.crosswindAdjustment;
  const loyaltyRate = PAY_RULE.hourlyRate * pay.loyaltyK;
  const loyaltyBonus = loyaltyRate - PAY_RULE.hourlyRate;
  const regularityBonus = pay.effectiveHourlyRate - loyaltyRate;
  const baseRegularityK = Number(pay.baseRegularityK || pay.regularityK || 1);
  const streakDays = Number(pay.streakDays || 0);
  const streakK = Number(pay.streakK || 1);
  const streakText = streakDays >= 5 ? '5+ вогників' : streakDays > 0 ? `${streakDays} вогн${streakDays === 1 ? 'ик' : 'ики/иків'}` : 'без вогників';
  const regularityFormulaText = streakK > 1
    ? `× ${baseRegularityK.toFixed(2)} × ${streakK.toFixed(2)}`
    : `× ${baseRegularityK.toFixed(2)}`;
  const rateCapText = '';
  const loyaltyTooltip = [
    'Лояльність: коефіцієнт за стаж у авіакомпанії та загальну кількість завершених рейсів.',
    '×1,05 — від 1 дня в АК і від 1 рейсу.',
    '×1,10 — від 1 тижня і від 5 рейсів.',
    '×1,15 — від 2 тижнів і від 10 рейсів.',
    '×1,20 — від 1 місяця і від 15 рейсів.',
    '×1,25 — від 2 місяців і від 20 рейсів.',
    '×1,30 — від 3 місяців і від 30 рейсів.',
    '×1,35 — від 4 місяців і від 40 рейсів.',
    '×1,40 — від 5 місяців і від 50 рейсів.',
    '×1,45 — від 6 місяців і від 60 рейсів.',
    '×1,50 — понад 6 місяців і понад 60 рейсів.'
  ].join('\n');
  const regularityTooltip = [
    'Регулярність: коефіцієнт за активність перед конкретним рейсом.',
    `Додатково множиться на flight streak на дату рейсу: ${streakText} → ×${streakK.toFixed(2)}.`,
    '1 вогник — ×1,10; 2 — ×1,20; 3 — ×1,30; 4 — ×1,40; 5+ — ×1,50.',
    '×1,05 — від 1 рейсу за останні 30 днів.',
    '×1,10 — від 5 рейсів за останні 10 днів.',
    '×1,20 — від 10 рейсів за останні 20 днів.',
    '×1,30 — від 15 рейсів за останні 30 днів.',
    '×1,40 — від 20 рейсів за останні 30 днів.',
    '×1,50 — від 30 рейсів за останні 30 днів.'
  ].join('\n');
  const routeTooltip = [
    'Маршрутний коефіцієнт діє лише на льотний час.',
    '×1,25 — рейс у межах України.',
    '×1,15 — виліт з України або приліт в Україну.',
    '×1,00 — міжнародний рейс поза Україною.'
  ].join('\n');
  const onlineTooltip = [
    'Онлайн-коефіцієнт діє лише на льотний час.',
    '×1,30 — рейс виконувався у мережі VATSIM.',
    '×1,00 — OFFLINE.'
  ].join('\n');
  const masteryTooltip = [
    'Бонус/штраф за якість посадки рахується від зарплати до бонусів і премій.',
    '0–50 fpm — ×1,00.',
    '51–99 fpm — ×1,05.',
    '100–150 fpm — ×1,10.',
    '151–199 fpm — ×1,15.',
    '200–300 fpm — ×1,30.',
    '301–349 fpm — ×1,20.',
    '350–399 fpm — ×1,10.',
    '400–449 fpm — ×1,05.',
    '450–500 fpm — ×1,00.',
    '501–599 fpm — ×0,90.',
    '600–749 fpm — ×0,75.',
    '750+ fpm — ×0,50.'
  ].join('\n');
  const fdrTooltip = [
    'Аналіз FDR запускається автоматично тільки якщо:',
    '• рейтинг рейсу нижче 8,00;',
    '• рейс завершений;',
    '• у рейсі ще немає грошового штрафу NewSky або страхового/інцидентного штрафу, щоб не карати двічі.',
    '',
    'Вогні та altimeter setting не враховуються.',
    '',
    'Правила FDR-штрафів:',
    '• stall warning — до $2 500, залежно від штрафних балів/тривалості.',
    '• тривалий overspeed — до $2 500, залежно від штрафних балів/тривалості.',
    '• недостатній резерв пального — мінімум $500 або сума за нестачу пального в кг.',
    '• неправильні закрилки — $750, тільки якщо є додатковий ризик.',
    '• нестабільний захід — до $1 500, тільки при суттєвому мінусі балів.',
    '• пізня посадкова конфігурація нижче 800 ft — штраф $800 мінус фактична висота конфігурації.',
    '• відхилення від осі від 15 м — відхилення × $10.',
    '• long landing — штраф дорівнює кількості метрів понад максимальну допустиму точку.',
    '• short landing — штраф дорівнює кількості метрів, яких не вистачило до мінімальної допустимої точки.',
    '• Max G/Min G поза посадкою — штрафні бали NewSky × $1 000 (−0,18 бала = −$180).',
    '• посадка від 1,80G — hard landing за формулою від $50 до $2 500.',
    '• посадка від 2,50G — terrifying landing і компенсації.',
    '',
    'Ліміт FDR:',
    '• звичайні FDR-порушення — максимум $1 500 за рейс.',
    '• якщо є hard/terrifying landing — максимум $2 500 за рейс.',
    'Серйозний FDR-інцидент скасовує премію керівництва.',
    'Бонуси за FPM і crosswind скасовуються лише тоді, коли порушення стосується самої посадки.'
  ].join('\n');
  const formatIncidentExplanation = value => esc(
    String(value || '').replace(/<br\s*\/?>/gi, '\n')
  ).replace(/\n/g, '<br>');
  const incidentDetails = (pay.seriousIncidentItems || []).map(item =>
    `<div class="salary-incident-item"><strong class="negative">−${money(item.cash)}</strong><br><span>${formatIncidentExplanation(incidentLabelWithTouchdown(flight, item.title))}</span></div>`
  ).join('');
  const incidentRateText = (pay.seriousIncidentItems || []).length && pay.seriousIncidentItems.every(item => item.liabilityRate === 0.05)
    ? '5%, максимум $2 500'
    : (pay.seriousIncidentItems || []).some(item => item.liabilityRate === 0.05)
      ? '5% для MLW/MTOW, 10% для інших · максимум $2 500'
      : '10%, максимум $2 500';
  const insuranceRows = pay.insuranceCase
    ? `<tr class="salary-deduction-row" title="Страховий випадок виникає, коли штрафи за рейс досягають установленого страхового порога."><th>Інцидент / Штраф</th><td><strong class="negative">−${money(pay.insuranceCase)}</strong><br><span>${formatIncidentExplanation(incidentLabelWithTouchdown(flight, insuranceIncidentLabel(flight)))}</span></td><td class="insurance-look-left" title="Деталі вказані ліворуч">←</td></tr><tr class="salary-deduction-row" title="Частина страхового випадку, яку компенсує страхова компанія в межах місячного ліміту."><th>Страхове відшкодування</th><td>${money(pay.insurancePayout)}</td><td class="insurance-look-left" title="Деталі вказані ліворуч">←</td></tr><tr class="salary-deduction-row" title="Непокрита страховкою частина збитку залишається витратою авіакомпанії."><th>Покрито з рахунку авіакомпанії</th><td>${money(pay.companyUncovered)}</td><td class="insurance-look-left" title="Деталі вказані ліворуч">←</td></tr><tr class="salary-deduction-row" title="Особиста частка відповідальності пілота за страховий випадок, але не більше $5 000."><th>Відповідальність пілота</th><td>2%, максимум $5 000</td><td class="num negative">−${money(pay.insuranceLiability)}</td></tr>`
    : pay.seriousIncident
      ? `<tr class="salary-deduction-row" title="Серйозний інцидент нижче страхового порога повністю покриває авіакомпанія."><th>Інцидент / Штраф</th><td>${incidentDetails}</td><td class="insurance-look-left" title="Деталі вказані ліворуч">←</td></tr><tr class="salary-deduction-row" title="Штраф NewSky залишається витратою авіакомпанії."><th>Покрито авіакомпанією</th><td>${money(pay.seriousIncidentPenalty)}</td><td class="insurance-look-left" title="Деталі вказані ліворуч">←</td></tr><tr class="salary-deduction-row" title="Для MLW/MTOW пілот компенсує 5% штрафу; для інших серйозних інцидентів — 10%. Загальний максимум $2 500."><th>Відповідальність пілота</th><td>${incidentRateText}</td><td class="num negative">−${money(pay.incidentLiability)}</td></tr>`
      : `<tr title="Страховий поріг для цього рейсу не був досягнутий."><th>Страховий випадок</th><td>Не застосовувався</td><td></td></tr>`;
  const fdrRows = pay.fdrPenalty
    ? `<tr class="salary-deduction-row" title="${tip(fdrTooltip)}"><th>Інцидент / Штраф</th><td><strong>Аналіз FDR</strong>${pay.fdrItems.map(item => `<div class="salary-incident-item"><strong class="negative">−${money(item.amount)}</strong><br><span>${esc(item.label)}</span></div>`).join('')}${pay.fdrCapped?`<div class="finance-status">Застосовано загальний ліміт FDR: ${money(pay.fdrCap)}</div>`:''}</td><td class="num negative">−${money(pay.fdrPenalty)}</td></tr>`
    : '';
  const formula = `(${money(pay.preparationPay)} + ${money(pay.flightBasePay)} × ${pay.routeK.toFixed(2)} × ${pay.aircraftK.toFixed(2)} × ${pay.onlineK.toFixed(2)}) ${masteryDelta>=0?'+':'−'} ${money(Math.abs(masteryDelta))} + ${money(crosswindDelta)} + ${money(pay.managementBonus)}${guaranteedBonus?` + ${money(guaranteedBonus)}`:''} − ${money(pay.delayDeduction)} − ${money(pay.insuranceLiability)} − ${money(pay.incidentLiability)} − ${money(pay.fdrPenalty)} = ${money(displayedTotal,true)}`;
  const managementMessage = pay.insuranceCase
    ? 'Пише пояснювальні і тоне у паперовій роботі'
    : pay.seriousIncident
      ? 'Не нараховується через інцидент'
      : pay.fdrBlocksBonuses
        ? 'Не нараховується за результатами аналізу FDR'
      : `${money(Math.max(0,pay.newSkyProfit),true)} × 1% × ${pay.ratingK.toFixed(2)} · рейтинг ${Number(flight.rating||0).toFixed(2)} · максимум $2 500`;
  const managementBonusTooltip = [
    'Премія керівництва: 1% від позитивного результату NewSky, максимум $2 500.',
    'Якщо результат NewSky від’ємний — премія $0.',
    'Рейтинг 10,00 — ×1,30.',
    'Рейтинг 9,00–9,99 — ×1,20.',
    'Рейтинг 8,00–8,99 — ×1,10.',
    'Рейтинг 7,50–7,99 — ×1,00.',
    'Рейтинг 7,00–7,49 — ×0,90.',
    'Рейтинг 6,50–6,99 — ×0,80.',
    'Рейтинг 6,00–6,49 — ×0,70.',
    'Рейтинг 5,50–5,99 — ×0,60.',
    'Нижче 5,50 — коефіцієнт дорівнює рейтингу / 10.',
    'При страховому випадку, серйозному інциденті або серйозному FDR-інциденті премія не нараховується.'
  ].join('\n');
  const managementBonusRow = `<tr class="management-bonus-row" title="${tip(managementBonusTooltip)}"><th>Премія від керівництва</th><td>${managementMessage}</td><td class="num ${pay.managementBonus?'positive':''}">${pay.managementBonus?`+${money(pay.managementBonus)}`:'$0'}</td></tr>`;
  const guaranteedBonusRow = guaranteedBonus
    ? `<tr class="guaranteed-bonus-row" title="${tip('\u0413\u0430\u0440\u0430\u043d\u0442\u043e\u0432\u0430\u043d\u0430 \u043f\u0440\u0435\u043c\u0456\u044f \u0437\u0430 \u0440\u0435\u0439\u0441, \u044f\u043a\u0438\u0439 \u0431\u0443\u0432 \u0443 \u0441\u043f\u0438\u0441\u043a\u0443 \u0437\u0430\u043f\u0440\u043e\u043f\u043e\u043d\u043e\u0432\u0430\u043d\u0438\u0445 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0456\u0432.')}" ><th>\u0413\u0430\u0440\u0430\u043d\u0442\u043e\u0432\u0430\u043d\u0430 \u043f\u0440\u0435\u043c\u0456\u044f</th><td>\u0417\u0430 \u0437\u0430\u043f\u0440\u043e\u043f\u043e\u043d\u043e\u0432\u0430\u043d\u0438\u0439 \u0440\u0435\u0439\u0441 \u{1F4B0}</td><td class="num positive">+${money(guaranteedBonus)}</td></tr>`
    : '';
  const salarySubtotal = `<tr class="salary-subtotal-row" title="Зароблена зарплата після оплати підготовки, польоту, льотних коефіцієнтів та бонусів за посадку і crosswind, але до премії керівництва й штрафів."><th>Зарплата пілота</th><td>до Премії і Штрафів</td><td class="num ${pay.salaryBeforeDeductions>=0?'positive':'negative'}">${money(pay.salaryBeforeDeductions,true)}</td></tr>`;
  return `<div class="flight-info-section" style="margin-top:0">ФОРМУЛА ЗАРПЛАТИ ЗА РЕЙС</div><table class="salary-formula-table"><tr title="Базова погодинна ставка однакова для всіх пілотів до врахування лояльності та регулярності."><th>Ставка</th><td>Базова ставка</td><td class="num">$${PAY_RULE.hourlyRate}/год</td></tr><tr title="${tip(loyaltyTooltip)}"><th>Лояльність</th><td>× ${pay.loyaltyK.toFixed(2)} · ${pay.context.membershipDays} дн. в АК · ${pay.context.totalFlights} рейсів</td><td class="num positive">${money(loyaltyBonus,true)}/год</td></tr><tr title="${tip(regularityTooltip)}"><th>Регулярність</th><td>${regularityFormulaText} · ${pay.context.last10}/10 дн. · ${pay.context.last20}/20 дн. · ${pay.context.last30}/30 дн. · ${streakText}</td><td class="num positive">${money(regularityBonus,true)}/год</td></tr><tr title="Лояльність і регулярність формують персональну ставку, але разом не можуть підняти її вище подвійної базової ставки."><th>Ставка пілота</th><td>$${PAY_RULE.hourlyRate} × ${pay.loyaltyK.toFixed(2)} × ${baseRegularityK.toFixed(2)}${streakK>1?` × ${streakK.toFixed(2)}`:''}${rateCapText}</td><td class="num positive">${money(pay.effectiveHourlyRate)}/год</td></tr><tr title="За кожен завершений рейс оплачується одна додаткова година на передпольотну підготовку."><th>Підготовка до польоту</th><td>1 год × ${money(pay.effectiveHourlyRate)}</td><td class="num">${money(pay.preparationPay)}</td></tr><tr title="Фактичний льотний час оплачується за персональною ставкою до застосування льотних коефіцієнтів."><th>Політ</th><td>${pay.flightHours.toLocaleString('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2})} год × ${money(pay.effectiveHourlyRate)}</td><td class="num">${money(pay.flightBasePay)}</td></tr><tr title="${tip(routeTooltip)}"><th>Коефіцієнт за маршрут</th><td>${routeText}</td><td class="num ${routeBonus>=0?'positive':'negative'}">${money(routeBonus,true)}</td></tr><tr title="${tip(['Коефіцієнт береться з редагованого довідника ICAO.', 'Для cargo може використовуватися окремий запис із F.', 'Невідомий тип тимчасово отримує ×1,25.'])}"><th>Коефіцієнт за складність літака</th><td>× ${pay.aircraftK.toFixed(2)} (${aircraftPercent?`+${aircraftPercent}%`:'без доплати'}, ${esc(flight.aircraft.icao)})</td><td class="num ${aircraftBonus>=0?'positive':'negative'}">${money(aircraftBonus,true)}</td></tr><tr title="${tip(onlineTooltip)}"><th>Online (VATSIM)</th><td>× ${pay.onlineK.toFixed(2)} (${onlinePercent?`+${onlinePercent}%`:'OFFLINE'})</td><td class="num ${onlineBonus>=0?'positive':''}">${money(onlineBonus,true)}</td></tr><tr title="${tip(masteryTooltip)}"><th>Майстерність</th><td>${pay.fpm?`${Math.round(pay.fpm)} fpm × ${pay.masteryK.toFixed(2)}`:'FPM не визначено · × 1.00'}</td><td class="num ${masteryDelta>0?'positive':masteryDelta<0?'negative':''}">${money(masteryDelta,true)}</td></tr><tr title="${tip(['Кожен вузол бокового вітру додає 2% до нарахувань перед утриманнями.', '1 kt — +2%.', '5 kt — +10%.', '10 kt — +20%.'])}"><th>Доплата за crosswind</th><td>${pay.crosswindKt?`${pay.crosswindKt.toFixed(0)} kt · +${Math.round((pay.crosswindK-1)*100)}%`:'Дані відсутні · +0%'}</td><td class="num positive">${money(crosswindDelta,true)}</td></tr>${salarySubtotal}${managementBonusRow}${guaranteedBonusRow}<tr title="Пілот компенсує 10% грошового штрафу NewSky саме за затримку рейсу."><th>Затримка рейсу</th><td>${pay.delayCash?`10% від ${money(pay.delayCash)}`:'Відсутня'}</td><td class="num ${pay.delayDeduction?'negative':''}">${pay.delayDeduction?`−${money(pay.delayDeduction)}`:''}</td></tr>${insuranceRows}${fdrRows}</table><div class="salary-numeric-formula" title="${tip(['Підсумкова формула:', 'персональна ставка використовується для підготовки та польоту;', 'льотні коефіцієнти діють лише на політ;', 'майстерність і crosswind формують зарплату до премії та утримань;', 'після премії окремо віднімаються штрафи й особиста відповідальність.'])}">${formula}</div><div class="flight-finance-row flight-finance-result" title="Фінальна виплата або заборгованість пілота за цей завершений рейс."><span></span><span>${displayedTotal>=0?'Зарплата пілота':'Штраф пілота'}</span><strong class="${displayedTotal>=0?'positive':'negative'}">${money(displayedTotal,true)}</strong></div>`;
}

function arrangeSalaryDetails(body, flight) {
  const payout = pilotInsuranceCoverage.get(flight) || 0;
  const pay = window.UCAAPilotPay.breakdown(flight, payout, app.flights);
  const baseRegularityK = Number(pay.baseRegularityK || pay.regularityK || 1);
  const streakDays = Number(pay.streakDays || 0);
  const streakK = Number(pay.streakK || 1);
  const streakText = streakDays >= 5 ? '5+ вогників' : streakDays > 0 ? `${streakDays} вогн${streakDays === 1 ? 'ик' : 'ики/иків'}` : 'без вогників';
  const regularityFormulaText = streakK > 1
    ? `× ${baseRegularityK.toFixed(2)} × ${streakK.toFixed(2)}`
    : `× ${baseRegularityK.toFixed(2)}`;
  const rows = [...body.querySelectorAll('.salary-formula-table tr')];
  const byLabel = label => rows.find(row => row.querySelector('th')?.textContent.trim() === label);
  const base = byLabel('Ставка');
  const loyalty = byLabel('Лояльність');
  const regularity = byLabel('Регулярність');
  const rate = byLabel('Ставка пілота');
  if (base && loyalty && regularity && rate) {
    const regularityReason = baseRegularityK >= 1.30 || baseRegularityK === 1.05
      ? `${pay.context.last30} рейсів / 30 днів`
      : baseRegularityK === 1.20
        ? `${pay.context.last20} рейсів / 20 днів`
        : baseRegularityK === 1.10
          ? `${pay.context.last10} рейсів / 10 днів`
          : 'коефіцієнт не активний';
    const loyaltyBonus = PAY_RULE.hourlyRate * (pay.loyaltyK - 1);
    const regularityBonus = PAY_RULE.hourlyRate * (pay.regularityK - 1);
    const rateBaseTip = tip([
      'Базова ставка: $65 / год.',
      'Вона однакова для всіх пілотів до персональних коефіцієнтів.'
    ]);
    const rateLoyaltyTip = tip([
      'Лояльність: доплата за стаж у авіакомпанії та загальну кількість завершених рейсів.',
      '×1,05 — від 1 дня в АК і від 1 рейсу.',
      '×1,10 — від 1 тижня і від 5 рейсів.',
      '×1,15 — від 2 тижнів і від 10 рейсів.',
      '×1,20 — від 1 місяця і від 15 рейсів.',
      '×1,25 — від 2 місяців і від 20 рейсів.',
      '×1,30 — від 3 місяців і від 30 рейсів.',
      '×1,35 — від 4 місяців і від 40 рейсів.',
      '×1,40 — від 5 місяців і від 50 рейсів.',
      '×1,45 — від 6 місяців і від 60 рейсів.',
      '×1,50 — понад 6 місяців і понад 60 рейсів.'
    ]);
    const rateRegularityTip = tip([
      'Регулярність: доплата за активність перед конкретним рейсом.',
      `Flight streak на дату рейсу: ${streakText} → ×${streakK.toFixed(2)}.`,
      '×1,05 — від 1 рейсу за останні 30 днів.',
      '×1,10 — від 5 рейсів за останні 10 днів.',
      '×1,20 — від 10 рейсів за останні 20 днів.',
      '×1,30 — від 15 рейсів за останні 30 днів.',
      '×1,40 — від 20 рейсів за останні 30 днів.',
      '×1,50 — від 30 рейсів за останні 30 днів.'
    ]);
    const rateTotalTip = tip([
      'Підсумкова персональна ставка рахується як:',
      'базова ставка + бонус за лояльність + бонус за регулярність із множником flight streak.',
      'Flight streak може підняти персональну ставку вище старого ліміту подвійної базової ставки.'
    ]);
    const rateTable = document.createElement('table');
    rateTable.className = 'pilot-rate-table';
    rateTable.innerHTML = `<thead><tr><th title="${rateTotalTip}">Ставка пілота</th><th title="${rateBaseTip}">Базова</th><th title="${rateLoyaltyTip}">Лояльність <span class="rate-context">(${pay.context.membershipDays} днів / ${pay.context.totalFlights} рейсів)</span></th><th title="${rateRegularityTip}">Регулярність <span class="rate-context">(${regularityReason})</span></th><th title="${rateTotalTip}">Ставка</th></tr></thead><tbody><tr><td title="${rateTotalTip}"><button type="button" class="salary-pilot-profile-link" data-pilot-id="${esc(flight.pilot.id)}">${pilotNameWithStreak(flight.pilot)}</button></td><td title="${rateBaseTip}">$${PAY_RULE.hourlyRate}/год</td><td title="${rateLoyaltyTip}">$${PAY_RULE.hourlyRate}/год×${pay.loyaltyK.toFixed(2)} <strong class="positive">${money(loyaltyBonus,true)}/год</strong></td><td title="${rateRegularityTip}">$${PAY_RULE.hourlyRate}/год×${baseRegularityK.toFixed(2)}${streakK>1?`×${streakK.toFixed(2)}🔥`:''} <strong class="positive">${money(regularityBonus,true)}/год</strong></td><td class="pilot-rate-total" title="${rateTotalTip}">${money(pay.effectiveHourlyRate)}/год</td></tr></tbody>`;
    body.querySelector('.salary-formula-table').before(rateTable);
    [base, loyalty, regularity, rate].forEach(row => row.remove());
  }
  const subtotal = rows.find(row => row.classList.contains('salary-subtotal-row'));
  const mastery = byLabel('Майстерність');
  const crosswind = byLabel('Доплата за crosswind');
  const aircraft = byLabel('Коефіцієнт за складність літака');
  const delay = byLabel('Затримка рейсу');
  const insurance = byLabel('Страховий випадок');
  if (aircraft) aircraft.querySelector('th').textContent = 'Коефіцієнт за літак';
  if (delay && !pay.delayDeduction) {
    delay.remove();
  } else if (delay) {
    delay.classList.add('salary-deduction-row');
    delay.querySelector('td:nth-child(2)').textContent = `5% від ${money(pay.delayCash)}`;
    delay.title = 'Пілот компенсує 5% грошового штрафу NewSky за затримку рейсу.';
  }
  if (insurance && !pay.insuranceCase) insurance.remove();
  if (subtotal) subtotal.querySelector('td:nth-child(2)').textContent = 'до Премії і Штрафів';
  if (mastery) {
    mastery.querySelector('th').textContent = 'Бонус за FPM';
    mastery.classList.add('salary-mastery-row');
    if (pay.insuranceLandingRelated) {
      mastery.querySelector('td:nth-child(2)').textContent = 'Яка нафіг майстерність?!';
      mastery.querySelector('td:nth-child(3)').textContent = '$0';
    } else if (pay.incidentLandingRelated) {
      mastery.querySelector('td:nth-child(2)').textContent = 'Скасовано через інцидент під час посадки';
      mastery.querySelector('td:nth-child(3)').textContent = '$0';
    } else if (pay.fdrBlocksLandingBonuses) {
      mastery.querySelector('td:nth-child(2)').textContent = 'Скасовано через порушення під час посадки';
      mastery.querySelector('td:nth-child(3)').textContent = '$0';
    }
  }
  if (crosswind) {
    crosswind.querySelector('th').textContent = 'Бонус за crosswind';
    crosswind.classList.add('salary-crosswind-row');
    if (pay.insuranceLandingRelated) {
      crosswind.querySelector('td:nth-child(2)').textContent = 'Які ще бонуси?!';
      crosswind.querySelector('td:nth-child(3)').textContent = '$0';
    } else if (pay.incidentLandingRelated) {
      crosswind.querySelector('td:nth-child(2)').textContent = 'Скасовано через інцидент під час посадки';
      crosswind.querySelector('td:nth-child(3)').textContent = '$0';
    } else if (pay.fdrBlocksLandingBonuses) {
      crosswind.querySelector('td:nth-child(2)').textContent = 'Скасовано через порушення під час посадки';
      crosswind.querySelector('td:nth-child(3)').textContent = '$0';
    }
  }
  if (subtotal && mastery && crosswind) subtotal.before(mastery, crosswind);
  const managementRow = rows.find(row => row.classList.contains('management-bonus-row'));
  const guaranteedRow = rows.find(row => row.classList.contains('guaranteed-bonus-row'));
  const salaryTable = body.querySelector('.salary-formula-table');
  if (salaryTable) {
    const deductionRows = [...salaryTable.querySelectorAll('.salary-deduction-row')];
    if (deductionRows.length) {
      deductionRows[0].classList.add('salary-deductions-start');
      const deductionBlock = document.createElement('div');
      deductionBlock.className = 'salary-section salary-deductions-section';
      deductionBlock.innerHTML = '<table class="salary-formula-table salary-deduction-table"><tbody></tbody></table>';
      const deductionBody = deductionBlock.querySelector('tbody');
      deductionRows.forEach(row => deductionBody.append(row));
      salaryTable.after(deductionBlock);
    }
    if (managementRow || guaranteedRow) {
      const premiumBlock = document.createElement('div');
      premiumBlock.className = 'salary-section salary-premium-section';
      premiumBlock.innerHTML = '<table class="salary-formula-table salary-premium-table"><tbody></tbody></table>';
      const premiumBody = premiumBlock.querySelector('tbody');
      if (managementRow) premiumBody.append(managementRow);
      if (guaranteedRow) premiumBody.append(guaranteedRow);
      (body.querySelector('.salary-deductions-section') || salaryTable).after(premiumBlock);
    }
  }
  const finalResult = body.querySelector('.flight-finance-result');
  const numericFormula = body.querySelector('.salary-numeric-formula');
  if (finalResult) {
    finalResult.classList.add('salary-final-result');
    const finalLabel = finalResult.querySelector('span:nth-child(2)');
    if (finalLabel) finalLabel.textContent = 'Прибуток пілота за рейс 💵';
    if (numericFormula) {
      finalResult.title = numericFormula.textContent.trim();
      numericFormula.remove();
    }
  }
  body.querySelector('.flight-info-section')?.remove();
  const pilotLink = body.querySelector('.salary-pilot-profile-link');
  if (pilotLink) pilotLink.onclick = () => {
    $('#flightInfoDialog').close();
    showPilotProfile(pilotLink.dataset.pilotId);
  };
  const financeLink = document.createElement('button');
  financeLink.type = 'button';
  financeLink.className = 'flight-popup-jump jump-company';
  financeLink.textContent = '<-- подивитись ПРИБУТОК АВІАКОМПАНІЇ за цей рейс';
  financeLink.onclick = () => openFlightInfo(flight, 'finance');
  body.append(financeLink);
}

function arrangeFinanceDetails(body, flight) {
  const pilotLink = body.querySelector('.finance-pilot-profile-link');
  if (pilotLink) pilotLink.onclick = () => {
    $('#flightInfoDialog').close();
    showPilotProfile(pilotLink.dataset.pilotId);
  };
  const salaryJump = document.createElement('button');
  salaryJump.type = 'button';
  salaryJump.className = 'flight-popup-jump jump-salary';
  salaryJump.textContent = 'подивитись ЗАРПЛАТУ ПІЛОТА за цей рейс -->';
  salaryJump.onclick = () => openFlightInfo(flight, 'salary');
  body.append(salaryJump);
}

function openFlightInfo(flight, type) {
  flight = currentFlightById(flight);
  const dialog = $('#flightInfoDialog');
  const body = $('#flightInfoBody');
  dialog.classList.toggle('finance-mode', type === 'finance');
  dialog.classList.toggle('salary-mode', type === 'salary');
  const titles = {load:'Завантаження і час', rating:'Порушення і штрафні бали', finance:'Прибуток авіакомпанії'};
  const flightNumber = String(flight.flightNumber || '').trim();
  const callsign = /^UKL/i.test(flightNumber) ? flightNumber.toUpperCase() : `UKL${flightNumber}`;
  const title = $('#flightInfoTitle');
  title.classList.toggle('finance-title', type === 'finance');
  if (type === 'finance') {
    title.innerHTML = `<strong>Прибуток авіакомпанії</strong> з рейсу ${esc(callsign)} ${esc(flight.departure.icao)} - ${esc(flight.arrival.icao)} на ${esc(flight.aircraft.icao)}`;
  } else {
    title.textContent = type === 'salary'
      ? `Зарплата пілота за рейс ${callsign} по маршруту ${flight.departure.icao}-${flight.arrival.icao}`
      : `${flight.flightNumber||'Рейс'} · ${titles[type] || ''}`;
  }
  if (type === 'load') {
    const classes = flight.operations?.passengersByClass || {};
    const isCargo = String(flight.flightType).toLowerCase() === 'cargo';
    const layout = isCargo
      ? `${flightLoad(flight)}`
      : `F ${Number(classes.F)||0} (перший) / C ${Number(classes.C)||0} (бізнес) / Y ${Number(classes.Y)||0} (економ)`;
    const price = isCargo ? Number(flight.operations?.cargoUnitPrice)||0 : Number(flight.operations?.ticketPrice)||0;
    body.innerHTML = `<table><tr><th>${isCargo?'Вантаж':'Компоновка салону'}</th><td>${esc(layout)}</td></tr><tr><th>${isCargo?'Середня вартість вантажної одиниці':'Середня вартість квитка'}</th><td>${price?money(price):'—'}</td></tr></table><div class="flight-info-section">ПЛАНОВИЙ / ФАКТИЧНИЙ ЧАС UTC</div><table><tr><th>Виліт</th><td>${utcTime(flight.times.scheduledDeparture)} / ${utcTime(flight.times.actualDeparture)}</td></tr><tr><th>Приліт</th><td>${utcTime(flight.times.scheduledArrival)} / ${utcTime(flight.times.actualArrival)}</td></tr></table>`;
  } else if (type === 'rating') {
    const violations = flight.operations?.violations || [];
    const wind = touchdownWindLabel(flight.operations?.touchdownWeather);
    body.innerHTML = `<div class="flight-info-section" style="margin-top:0">ПОРУШЕННЯ І ШТРАФНІ БАЛИ</div><ul class="violation-list">${violations.length?violations.map(v=>{const points=violationPoints(v);const onlyClean=violations.length===1&&points===0;return `<li><span class="violation-points ${onlyClean?'ok':''}">${onlyClean?'Відсутні!':points===0?'':points.toFixed(2)}</span><span>${violationText(v.title)}</span></li>`}).join(''):'<li><span class="violation-points ok">Відсутні!</span><span>Порушень немає</span></li>'}</ul>${wind?`<div class="flight-info-footer">${esc(wind)}</div>`:''}<div class="flight-info-footer"><strong>Sim:</strong> ${esc(simulatorLabel(flight.operations?.simulator))}</div>`;
  } else if (type === 'finance') {
    body.innerHTML = flightFinanceDetails(flight);
    arrangeFinanceDetails(body, flight);
  }
  else {
    body.innerHTML = pilotSalaryDetails(flight);
    arrangeSalaryDetails(body, flight);
  }
  showCompanyLiveryDialog(dialog);
}

function flightOperation(flight) {
  if (flight.operations?.charter) return {key:'charter', label:'Charter'};
  if (flight.operations?.scheduled) return {key:'schedule', label:'Schedule'};
  return {key:'free', label:'Free'};
}

function flightPayloadKind(flight) {
  const isCargo = String(flight.flightType).toLowerCase() === 'cargo' || (!flight.operations?.passengers && flight.operations?.cargo);
  return isCargo ? {icon:'📦', label:'Cargo'} : {icon:'👨‍💼', label:'Pax'};
}

function flightLoad(flight) {
  const isCargo = String(flight.flightType).toLowerCase() === 'cargo' || (!flight.operations?.passengers && flight.operations?.cargo);
  if (isCargo) {
    const kilograms = Number(flight.operations?.cargoWeightKg) || 0;
    if (kilograms) return `${(kilograms/1000).toLocaleString('uk-UA',{maximumFractionDigits:1})} т`;
    return `${Number(flight.operations?.cargo)||0}`;
  }
  const pax = Number(flight.operations?.passengers) || 0;
  return `${pax}`;
}

function flightRatingPresentation(flight) {
  const rating = Number(flight.rating) || 0;
  const label = rating === 10 ? '10.0' : rating > 0 ? rating.toFixed(2) : '—';
  const className = rating <= 0 ? 'rating-none'
    : rating === 10 ? 'rating-perfect'
    : rating >= 9 ? 'rating-9'
      : rating >= 8 ? 'rating-8'
        : rating >= 7 ? 'rating-7'
          : rating >= 6 ? 'rating-6'
            : rating >= 5 ? 'rating-5' : 'rating-low';
  return {label, className};
}

function pilotSalaryVisual(flight, direct) {
  const violations = flight.operations?.violations || [];
  const insuranceCase = window.UCAAInsurance.eligibleDamage(flight);
  const touchdown = violations
    .map(violation => String(violation?.title || '').match(/^(Hard|Bad|Terrible) touchdown:/i))
    .find(Boolean);
  const seriousViolations = window.UCAAPilotPay.seriousIncidentViolations(flight);
  const hasMlw = violations.some(violation => /\bMLW exceeded/i.test(String(violation?.title || '')));
  const hasMtow = violations.some(violation => /\bMTOW exceeded/i.test(String(violation?.title || '')));
  const seriousIncident = seriousViolations.some(violation => !/\b(?:MLW|MTOW) exceeded/i.test(String(violation?.title || '')));

  if (insuranceCase) {
    return {className:'profit-incident-red', note:'*пошкоджене ПС', noteClass:''};
  }
  const fdr = window.UCAAPilotPay.fdrAnalysis(flight);
  if (fdr.total) return {
    className:direct.pilotSalary < 0 ? 'negative' : direct.pilotSalary > 0 ? 'positive' : '',
    note:'*аналіз FDR',
    noteClass:'profit-note-compensation'
  };
  if (touchdown) return {className:'profit-incident-orange', note:`*${touchdown[1].toLowerCase()} landing`, noteClass:''};
  if (seriousIncident) return {className:'profit-incident-orange', note:'*інцидент', noteClass:''};
  const className = direct.pilotSalary < 0 ? 'negative' : direct.pilotSalary > 0 ? 'positive' : '';
  const limitNotes = [hasMtow ? 'MTOW exceeded' : '', hasMlw ? 'MLW exceeded' : ''].filter(Boolean);
  return {className, note:limitNotes.join(' · '), noteClass:limitNotes.length?'profit-note-muted':''};
}

function companyProfitVisual(flight, direct) {
  const baseClass = direct.companyProfit < 0 ? 'profit-routine-loss' : direct.companyProfit > 0 ? 'positive' : '';
  const violations = flight.operations?.violations || [];
  const insuranceCase = window.UCAAInsurance.eligibleDamage(flight) > 0;
  if (insuranceCase && direct.insurancePayout > 0) {
    const notes = [{text:'*залучалась страхова', className:''}];
    if (direct.compensation > 0) notes.push({
      text:direct.type?.key === 'cargo' ? '*компенсації за вантаж' : '*компенсації паксам',
      className:'profit-note-compensation'
    });
    return {className:'profit-incident-red', notes};
  }
  if (direct.compensation > 0) {
    return {
      className:'profit-incident-orange',
      notes:[{text:direct.type?.key === 'cargo' ? '*компенсації за вантаж' : '*компенсації паксам', className:''}]
    };
  }
  const seriousIncident = window.UCAAPilotPay.seriousIncidentViolations(flight)
    .some(violation => !/\b(?:MLW|MTOW) exceeded/i.test(String(violation?.title || '')));
  const penalties = Math.max(0, Number(flight.finance?.penalties) || 0);
  const onlyWeightLimits = penalties > 0 && violations.some(violation => /\b(?:MLW|MTOW) exceeded/i.test(String(violation?.title || '')))
    && !violations.some(violation => !/\b(?:MLW|MTOW) exceeded/i.test(String(violation?.title || '')) && Math.abs(Number(violation?.cash) || 0) > 0);
  if (!onlyWeightLimits && (seriousIncident || penalties > 0)) {
    const profitableAfterPenalties = direct.companyProfit > 0;
    return {
      className:profitableAfterPenalties ? 'positive' : 'profit-incident-orange',
      notes:[{
        text:seriousIncident?'*інцидент':'*штрафи',
        className:profitableAfterPenalties?'profit-note-compensation':''
      }]
    };
  }
  return {className:baseClass, notes:[]};
}

window.UCAADashboardFlightUI = {
  openFlightInfo,
  directFlightFinance,
  airportWithFlag,
  countryForAirport,
  flightOperation,
  flightPayloadKind,
  flightLoad,
  flightRatingPresentation,
  landingStats,
  aircraftTableNote,
  pilotSalaryVisual,
  guaranteedBonusIconHtmlForRow,
  companyProfitVisual
};

function renderDashboardPilotFilter(completed) {
  const counts = new Map();
  completed.forEach(flight => {
    const current = counts.get(flight.pilot.id) || {id:flight.pilot.id, name:flight.pilot.name, flights:0};
    current.flights += 1;
    counts.set(flight.pilot.id, current);
  });
  const pilots = [...counts.values()].sort((a,b) => a.name.localeCompare(b.name, 'uk'));
  if (app.dashboardPilotId && !counts.has(app.dashboardPilotId)) app.dashboardPilotId = null;
  const selected = app.dashboardPilotId ? counts.get(app.dashboardPilotId) : null;
  const button = $('#dashboardPilotFilterButton');
  const list = $('#dashboardPilotFilterList');
  button.textContent = selected ? `${selected.name} ▾` : 'Пілот ▾';
  button.title = selected ? `Фільтр: ${selected.name}` : 'Вибрати пілота';
  button.classList.toggle('active', Boolean(selected));
  list.innerHTML = `<button type="button" data-dashboard-pilot="" class="${selected?'':'active'}"><span>Усі пілоти</span><small>${completed.length} рейсів</small></button>${pilots.map(pilot => `<button type="button" data-dashboard-pilot="${esc(pilot.id)}" class="${pilot.id===app.dashboardPilotId?'active':''}"><span>${pilotNameWithStreak(pilot)}</span><small>${pilot.flights}</small></button>`).join('')}`;
  button.onclick = event => {
    event.stopPropagation();
    const rect = button.getBoundingClientRect();
    list.style.left = `${Math.round(rect.left)}px`;
    list.style.top = `${Math.round(rect.bottom - 2)}px`;
    list.hidden = !list.hidden;
    button.setAttribute('aria-expanded', String(!list.hidden));
  };
  list.querySelectorAll('[data-dashboard-pilot]').forEach(option => option.onclick = event => {
    event.stopPropagation();
    app.dashboardPilotId = option.dataset.dashboardPilot || null;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    render();
  });
}

function renderDashboardFlightsOld(completed) {
  renderDashboardPilotFilter(completed);
  const visible = app.dashboardPilotId ? completed.filter(flight => flight.pilot.id === app.dashboardPilotId) : completed;
  const rows = [...visible].sort((a,b)=>dateOf(b)-dateOf(a));
  $('#dashboardFlights').innerHTML = rows.length ? rows.map(flight => {
    const date = dateOf(flight);
    const direct = directFlightFinance(flight);
    const salaryVisual = pilotSalaryVisual(flight, direct);
    const profitVisual = companyProfitVisual(flight, direct);
    const operation = flightOperation(flight);
    const payloadKind = flightPayloadKind(flight);
    const rating = flightRatingPresentation(flight);
    return `<tr>
      <td>${formatFlightDateLabel(flight)}<span class="date-flight-meta"><span class="date-flight-time">${formatFlightCloseTime(flight)}</span><a class="flight-number-link flight-number-${operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${operation.label}">${esc(flight.flightNumber||'—')}</a></span></td>
      ${dashboardPilotCellHtml(flight.pilot)}
      <td class="route"><span class="route-airports">${airportWithFlag(flight.departure)} → ${airportWithFlag(flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times.durationMinutes)}</span></td>
      <td>${esc(flight.aircraft.name)}<span class="flight-note">${esc(aircraftTableNote(flight))}</span></td>
      <td><span class="payload-value" title="${payloadKind.label}">${esc(flightLoad(flight))}<span class="load-kind-icon" aria-hidden="true">${payloadKind.icon}</span></span></td>
      <td class="num rating-cell rating-detail" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="rating-badge ${rating.className}">${rating.label}</span><span class="landing-line">${landingStats(flight)}</span></td>
      <td class="finance-click-cell company-profit-detail ${profitVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(direct.companyProfit,true)}${profitVisual.notes.map(note=>`<span class="profit-incident-note ${note.className}">${esc(note.text)}</span>`).join('')}</td>
      <td class="finance-click-cell pilot-salary-detail ${salaryVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="salary-amount-inline">${money(direct.pilotSalary,true)}${guaranteedBonusIconHtmlForRow(flight, direct.guaranteedBonus)}</span>${salaryVisual.note?`<span class="profit-incident-note ${salaryVisual.noteClass||''}">${esc(salaryVisual.note)}</span>`:''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="loading">За вибраний період завершених рейсів немає</td></tr>';
  bindDashboardPilotCells();
  $$('.rating-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'rating')});
  $$('.rating-detail').forEach(cell=>cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click()}});
  $$('.company-profit-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'finance')});
  $$('.pilot-salary-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'salary')});
  $$('.finance-click-cell').forEach(cell=>cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click()}});
}

function render() {
  const periodFlights = flightsForPeriod(app.period);
  const pilots = aggregatePilotFlights(periodFlights).filter(pilot=>pilot.completed>0);
  const metric = metricInfo[app.metric];
  const rows = pilots.sort((a, b) => metric.value(b) - metric.value(a) || a.name.localeCompare(b.name));
  const completed = periodFlights.filter(f => f.status === 'completed');

  renderDashboardFinance(periodFlights);
  renderDashboardFlights(completed);
  syncDashboardCalendarUi();

  const metricPeriod = dashboardMetricPeriodLabel();
  $('#pilotCount').previousElementSibling.textContent = 'Пілотів літало';
  $('#pilotCount').textContent = pilots.length.toLocaleString('uk-UA');
  $('#pilotCount').nextElementSibling.textContent = metricPeriod;
  $('#totalHours').previousElementSibling.textContent = 'Наліт пілотів';
  $('#totalHours').textContent = formatMinutes(sum(completed, f => f.times.durationMinutes));
  $('#flightsLabel').textContent = metricPeriod;
  $('#completedFlightsCount').previousElementSibling.textContent = 'Рейсів виконано';
  $('#completedFlightsCount').textContent = completed.length.toLocaleString('uk-UA');
  $('#completedFlightsCount').nextElementSibling.textContent = metricPeriod;
  const companyBalanceValue = correctedCompanyBalance(app.period);
  $('#companyBalance').previousElementSibling.textContent = 'Баланс авіакомпанії';
  $('#companyBalance').textContent = money(companyBalanceValue, true);
  $('#companyBalance').className = companyBalanceValue >= 0 ? 'positive' : 'negative';
  $('#companyBalance').nextElementSibling.textContent = metricPeriod;
  $('#pilotPayroll').previousElementSibling.textContent = 'Зарплата пілотам';
  $('#pilotPayroll').textContent = money(sum(periodFlights, pilotPay));
  $('#pilotPayroll').nextElementSibling.textContent = metricPeriod;
  if ($('#metricHead') && $('#leaderboard')) {
  $('#metricHead').textContent = metric.label;
  $('#leaderboard').innerHTML = rows.length ? rows.map((p, index) => `
    <tr>
      <td class="rank"><span class="medal">${['🥇','🥈','🥉'][index] || index + 1}</span></td>
      <td><button class="pilot-link" data-id="${esc(p.id)}">${pilotNameWithStreak(p)}</button><span class="role">${esc(p.role)}</span></td>
      <td class="num">${p.completed}${p.failed ? ` <small title="Незавершені">(+${p.failed})</small>` : ''}</td>
      <td class="num ${app.metric === 'balance' ? (p.balance >= 0 ? 'positive' : 'negative') : ''}">${metric.display(p)}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;padding:18px">За цей період рейсів немає</td></tr>';

  $$('.pilot-link').forEach(button => button.onclick = () => showPilotProfile(button.dataset.id));
  }
  if (location.hash === '#pilots') renderPilotsCardsPage();
}

function showPilotProfile(id) {
  if (!id) return;
  window.UCAAPilotProfile.open(id, app.flights);
  const selected = 'profile';
  document.querySelectorAll('.app-view').forEach(view => { view.hidden = view.id !== `${selected}View`; });
  document.querySelectorAll('[data-view-link]').forEach(link => {
    link.classList.toggle('active', link.dataset.viewLink === selected);
    link.setAttribute('aria-current', link.dataset.viewLink === selected ? 'page' : 'false');
  });
  const url = new URL(window.location.href);
  url.searchParams.delete('pilot');
  url.hash = `profile/${encodeURIComponent(id)}`;
  history.replaceState(null, '', url);
  const scrollProfileTop = () => {
    window.scrollTo({top: 0, left: 0, behavior: 'auto'});
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  };
  requestAnimationFrame(() => {
    scrollProfileTop();
    setTimeout(scrollProfileTop, 0);
  });
}

function dashboardAircraftKey(flight) {
  return String(flight.aircraft?.icao || flight.aircraft?.name || '').trim().toUpperCase();
}

function dashboardAircraftLabel(flight) {
  const icao = String(flight.aircraft?.icao || '').trim().toUpperCase();
  const genericNames = {
    B738: 'Boeing 737-800'
  };
  const name = genericNames[icao] || String(flight.aircraft?.name || icao || '—').trim();
  return {key: dashboardAircraftKey(flight), icao, name};
}

function renderDashboardSortButtons() {
  $$('[data-dashboard-sort]').forEach(button => {
    const active = button.dataset.dashboardSort === app.dashboardFlightSort.field;
    button.classList.toggle('active', active);
    button.dataset.direction = active ? app.dashboardFlightSort.direction : '';
    button.setAttribute('aria-pressed', String(active));
  });
}

function ensureDashboardFilterReset(button, id, label) {
  let reset = document.getElementById(id);
  if (!reset) {
    reset = document.createElement('button');
    reset.type = 'button';
    reset.id = id;
    reset.className = 'dashboard-filter-reset';
    reset.textContent = '×';
    reset.setAttribute('aria-label', label);
    reset.title = label;
    button.insertAdjacentElement('afterend', reset);
  }
  return reset;
}

function renderDashboardFilters(completed) {
  const pilotMenuFlights = app.dashboardAircraftId
    ? completed.filter(flight => dashboardAircraftKey(flight) === app.dashboardAircraftId)
    : completed;
  const aircraftMenuFlights = app.dashboardPilotId
    ? completed.filter(flight => flight.pilot.id === app.dashboardPilotId)
    : completed;

  const pilotCounts = new Map();
  pilotMenuFlights.forEach(flight => {
    const current = pilotCounts.get(flight.pilot.id) || {id: flight.pilot.id, name: flight.pilot.name, flights: 0};
    current.flights += 1;
    pilotCounts.set(flight.pilot.id, current);
  });

  const aircraftCounts = new Map();
  aircraftMenuFlights.forEach(flight => {
    const label = dashboardAircraftLabel(flight);
    const current = aircraftCounts.get(label.key) || {id: label.key, name: label.name, icao: label.icao, flights: 0};
    current.name = label.name;
    current.icao = label.icao;
    current.flights += 1;
    aircraftCounts.set(label.key, current);
  });

  if (app.dashboardPilotId && !pilotCounts.has(app.dashboardPilotId)) app.dashboardPilotId = null;
  if (app.dashboardAircraftId && !aircraftCounts.has(app.dashboardAircraftId)) app.dashboardAircraftId = null;

  const pilots = [...pilotCounts.values()].sort((a, b) => b.flights - a.flights || a.name.localeCompare(b.name, 'uk'));
  const aircraft = [...aircraftCounts.values()].sort((a, b) => b.flights - a.flights || a.name.localeCompare(b.name, 'uk'));
  const selectedPilot = app.dashboardPilotId ? pilotCounts.get(app.dashboardPilotId) : null;
  const selectedAircraft = app.dashboardAircraftId ? aircraftCounts.get(app.dashboardAircraftId) : null;
  const pilotButton = $('#dashboardPilotFilterButton');
  const pilotList = $('#dashboardPilotFilterList');
  const aircraftButton = $('#dashboardAircraftFilterButton');
  const aircraftList = $('#dashboardAircraftFilterList');
  const pilotReset = pilotButton ? ensureDashboardFilterReset(pilotButton, 'dashboardPilotFilterReset', 'Скинути фільтр пілота') : null;
  const aircraftReset = aircraftButton ? ensureDashboardFilterReset(aircraftButton, 'dashboardAircraftFilterReset', 'Скинути фільтр літака') : null;

  if (pilotButton && pilotList) {
    pilotButton.innerHTML = `<span class="dashboard-filter-label">Пілот</span><span class="dashboard-filter-hint">(фільтр <i class="dashboard-filter-funnel" aria-hidden="true"></i>)</span>`;
    pilotButton.title = selectedPilot ? `Фільтр пілота: ${selectedPilot.name}` : 'Вибрати пілота';
    pilotButton.classList.toggle('active', Boolean(selectedPilot));
    pilotButton.classList.toggle('has-reset', Boolean(selectedPilot));
    pilotReset.hidden = !selectedPilot;
    pilotReset.onclick = event => {
      event.stopPropagation();
      app.dashboardPilotId = null;
      pilotList.hidden = true;
      render();
    };
    pilotList.innerHTML = `<button type="button" data-dashboard-pilot="" class="${selectedPilot ? '' : 'active'}"><span>Усі пілоти</span><small>${pilotMenuFlights.length} рейсів</small></button>${pilots.map(pilot => `<button type="button" data-dashboard-pilot="${esc(pilot.id)}" class="${pilot.id === app.dashboardPilotId ? 'active' : ''}"><span>${pilotNameWithStreak(pilot)}</span><small>${pilot.flights}</small></button>`).join('')}`;
    pilotButton.onclick = event => {
      event.stopPropagation();
      const rect = pilotButton.getBoundingClientRect();
      pilotList.style.left = `${Math.round(rect.left)}px`;
      pilotList.style.top = `${Math.round(rect.bottom - 2)}px`;
      pilotList.hidden = !pilotList.hidden;
      pilotButton.setAttribute('aria-expanded', String(!pilotList.hidden));
      if (!pilotList.hidden && aircraftList) {
        aircraftList.hidden = true;
        aircraftButton?.setAttribute('aria-expanded', 'false');
      }
    };
    pilotList.querySelectorAll('[data-dashboard-pilot]').forEach(option => option.onclick = event => {
      event.stopPropagation();
      app.dashboardPilotId = option.dataset.dashboardPilot || null;
      pilotList.hidden = true;
      pilotButton.setAttribute('aria-expanded', 'false');
      render();
    });
  }

  if (aircraftButton && aircraftList) {
    aircraftButton.innerHTML = `<span class="dashboard-filter-label">Літак${selectedAircraft ? ` ${esc(selectedAircraft.icao || selectedAircraft.name)}` : ''}</span><span class="dashboard-filter-hint">(фільтр <i class="dashboard-filter-funnel" aria-hidden="true"></i>)</span>`;
    aircraftButton.title = selectedAircraft ? `Фільтр літака: ${selectedAircraft.name}${selectedAircraft.icao ? ` (${selectedAircraft.icao})` : ''}` : 'Вибрати літак';
    aircraftButton.classList.toggle('active', Boolean(selectedAircraft));
    aircraftButton.classList.toggle('has-reset', Boolean(selectedAircraft));
    aircraftReset.hidden = !selectedAircraft;
    aircraftReset.onclick = event => {
      event.stopPropagation();
      app.dashboardAircraftId = null;
      aircraftList.hidden = true;
      render();
    };
    aircraftList.innerHTML = `<button type="button" data-dashboard-aircraft="" class="${selectedAircraft ? '' : 'active'}"><span>Усі літаки</span><small>${aircraftMenuFlights.length} рейсів</small></button>${aircraft.map(item => `<button type="button" data-dashboard-aircraft="${esc(item.id)}" class="${item.id === app.dashboardAircraftId ? 'active' : ''}"><span>${esc(item.icao || item.name)}</span><small>${esc(item.name)} · ${item.flights}</small></button>`).join('')}`;
    aircraftButton.onclick = event => {
      event.stopPropagation();
      const rect = aircraftButton.getBoundingClientRect();
      aircraftList.style.left = `${Math.round(rect.left)}px`;
      aircraftList.style.top = `${Math.round(rect.bottom - 2)}px`;
      aircraftList.hidden = !aircraftList.hidden;
      aircraftButton.setAttribute('aria-expanded', String(!aircraftList.hidden));
      if (!aircraftList.hidden && pilotList) {
        pilotList.hidden = true;
        pilotButton?.setAttribute('aria-expanded', 'false');
      }
    };
    aircraftList.querySelectorAll('[data-dashboard-aircraft]').forEach(option => option.onclick = event => {
      event.stopPropagation();
      app.dashboardAircraftId = option.dataset.dashboardAircraft || null;
      aircraftList.hidden = true;
      aircraftButton.setAttribute('aria-expanded', 'false');
      render();
    });
  }
}

function sortDashboardFlights(rows) {
  const direction = app.dashboardFlightSort.direction === 'asc' ? 1 : -1;
  const field = app.dashboardFlightSort.field;
  const value = row => {
    if (field === 'date') return dateOf(row.flight).getTime();
    if (field === 'duration') return Number(row.flight.times?.durationMinutes || 0);
    if (field === 'payload') {
      const isCargo = String(row.flight.flightType).toLowerCase() === 'cargo' || (!row.flight.operations?.passengers && row.flight.operations?.cargo);
      return isCargo
        ? Number(row.flight.operations?.cargoWeightKg || 0)
        : Number(row.flight.operations?.passengers || 0) * 100;
    }
    if (field === 'rating') return Number(row.flight.rating || 0);
    if (field === 'profit') return Number(row.direct.companyProfit || 0);
    if (field === 'salary') return Number(row.direct.pilotSalary || 0);
    return 0;
  };
  return rows.sort((a, b) => {
    const diff = value(a) - value(b);
    if (diff) return diff * direction;
    return dateOf(b.flight) - dateOf(a.flight);
  });
}

function renderDashboardFlights(completed) {
  try {
    renderDashboardFilters(completed);
    renderDashboardSortButtons();
    syncDashboardLiveToggle();
    const visible = completed.filter(flight => (!app.dashboardPilotId || flight.pilot.id === app.dashboardPilotId) && (!app.dashboardAircraftId || dashboardAircraftKey(flight) === app.dashboardAircraftId));
    const rows = sortDashboardFlights(visible.map(flight => {
      const date = dateOf(flight);
      const direct = directFlightFinance(flight);
      return {
        flight,
        date,
        direct,
        salaryVisual: pilotSalaryVisual(flight, direct),
        profitVisual: companyProfitVisual(flight, direct),
        operation: flightOperation(flight),
        payloadKind: flightPayloadKind(flight),
        rating: flightRatingPresentation(flight)
      };
    }));
    const completedRowsHtml = rows.length ? rows.map(row => {
      const flight = row.flight;
      return `<tr>
        <td>${formatFlightDateLabel(flight)}<span class="date-flight-meta"><span class="date-flight-time">${formatFlightCloseTime(flight)}</span><a class="flight-number-link flight-number-${row.operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${row.operation.label}">${esc(flight.flightNumber||'—')}</a></span></td>
        ${dashboardPilotCellHtml(flight.pilot)}
        <td class="route"><span class="route-airports">${airportWithFlag(flight.departure)} → ${airportWithFlag(flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times.durationMinutes)}</span></td>
        <td>${esc(flight.aircraft.name)}<span class="flight-note">${esc(aircraftTableNote(flight))}</span></td>
        <td><span class="payload-value" title="${row.payloadKind.label}">${esc(flightLoad(flight))}<span class="load-kind-icon" aria-hidden="true">${row.payloadKind.icon}</span></span></td>
        <td class="num rating-cell rating-detail" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="rating-badge ${row.rating.className}">${row.rating.label}</span><span class="landing-line">${landingStats(flight)}</span></td>
        <td class="finance-click-cell company-profit-detail ${row.profitVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(row.direct.companyProfit,true)}${row.profitVisual.notes.map(note=>`<span class="profit-incident-note ${note.className}">${esc(note.text)}</span>`).join('')}</td>
        <td class="finance-click-cell pilot-salary-detail ${row.salaryVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="salary-amount-inline">${money(row.direct.pilotSalary,true)}${guaranteedBonusIconHtmlForRow(flight, row.direct.guaranteedBonus)}</span>${row.salaryVisual.note?`<span class="profit-incident-note ${row.salaryVisual.noteClass||''}">${esc(row.salaryVisual.note)}</span>`:''}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="8" class="loading">За вибраний період завершених рейсів немає</td></tr>';
    $('#dashboardFlights').innerHTML = `${renderLiveDashboardRows()}${completedRowsHtml}`;
    bindDashboardPilotCells();
    $$('.rating-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'rating')});
    $$('.rating-detail').forEach(cell=>cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click()}});
    $$('.company-profit-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'finance')});
    $$('.pilot-salary-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'salary')});
    $$('.finance-click-cell').forEach(cell=>cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click()}});
  } catch (error) {
    console.error('Dashboard flights render failed, falling back to legacy layout', error);
    renderDashboardFlightsLegacy(completed);
  }
}

function renderDashboardFlightsLegacy(completed) {
  renderDashboardPilotFilter(completed);
  const visible = app.dashboardPilotId ? completed.filter(flight => flight.pilot.id === app.dashboardPilotId) : completed;
  const rows = [...visible].sort((a,b)=>dateOf(b)-dateOf(a));
  $('#dashboardFlights').innerHTML = rows.length ? rows.map(flight => {
    const date = dateOf(flight);
    const direct = directFlightFinance(flight);
    const salaryVisual = pilotSalaryVisual(flight, direct);
    const profitVisual = companyProfitVisual(flight, direct);
    const operation = flightOperation(flight);
    const payloadKind = flightPayloadKind(flight);
    const rating = flightRatingPresentation(flight);
    return `<tr>
      <td>${formatFlightDateLabel(flight)}<span class="date-flight-meta"><span class="date-flight-time">${formatFlightCloseTime(flight)}</span><a class="flight-number-link flight-number-${operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${operation.label}">${esc(flight.flightNumber||'—')}</a></span></td>
      ${dashboardPilotCellHtml(flight.pilot)}
      <td class="route"><span class="route-airports">${airportWithFlag(flight.departure)} → ${airportWithFlag(flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times.durationMinutes)}</span></td>
      <td>${esc(flight.aircraft.name)}<span class="flight-note">${esc(aircraftTableNote(flight))}</span></td>
      <td><span class="payload-value" title="${payloadKind.label}">${esc(flightLoad(flight))}<span class="load-kind-icon" aria-hidden="true">${payloadKind.icon}</span></span></td>
      <td class="num rating-cell rating-detail" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="rating-badge ${rating.className}">${rating.label}</span><span class="landing-line">${landingStats(flight)}</span></td>
      <td class="finance-click-cell company-profit-detail ${profitVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(direct.companyProfit,true)}${profitVisual.notes.map(note=>`<span class="profit-incident-note ${note.className}">${esc(note.text)}</span>`).join('')}</td>
      <td class="finance-click-cell pilot-salary-detail ${salaryVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="salary-amount-inline">${money(direct.pilotSalary,true)}${guaranteedBonusIconHtmlForRow(flight, direct.guaranteedBonus)}</span>${salaryVisual.note?`<span class="profit-incident-note ${salaryVisual.noteClass||''}">${esc(salaryVisual.note)}</span>`:''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="loading">За вибраний період завершених рейсів немає</td></tr>';
  bindDashboardPilotCells();
  $$('.rating-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'rating')});
  $$('.rating-detail').forEach(cell=>cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click()}});
  $$('.company-profit-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'finance')});
  $$('.pilot-salary-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'salary')});
  $$('.finance-click-cell').forEach(cell=>cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click()}});
}

function bindDashboardLiveToggle() {
  const button = $('#dashboardLiveToggle');
  if (!button || button.dataset.liveBound) return;
  button.dataset.liveBound = '1';
  syncDashboardLiveToggle();
  button.addEventListener('click', async event => {
    event.preventDefault();
    app.liveDashboardVisible = !app.liveDashboardVisible;
    syncDashboardLiveToggle();
    if (app.liveDashboardVisible && !app.liveNewSkyLoaded) {
      await loadDashboardLiveNewSkyFlights();
    } else {
      render();
    }
  });
}

function parseCompanyCharterDemand(text) {
  const airports = {};
  let section = 'header';
  let currentAirport = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'ТОП-5 міжнародних на виліт') { section = 'topInternationalOut'; continue; }
    if (line === 'ТОП-5 міжнародних на приліт') { section = 'topInternationalIn'; continue; }
    if (line === 'ТОП-5 місцевих пасажирських') { section = 'topDomesticPax'; continue; }
    if (line === 'ТОП-5 місцевих карго') { section = 'topDomesticCargo'; continue; }
    if (line.startsWith('----')) { section = 'details'; currentAirport = ''; continue; }
    if (section !== 'details') continue;
    const header = line.match(/^([A-Z0-9]{4})\s+\((.*?)\)$/);
    if (header) {
      currentAirport = header[1].toUpperCase();
      airports[currentAirport] = {
        name: header[2],
        out: {pax: null, cargo: null},
        in: {pax: null, cargo: null}
      };
      continue;
    }
    const match = line.match(/^(out|in)\s+(pax|cargo)\s+([A-Z0-9]{4}|NONE)-([A-Z0-9]{4}|NONE)(?:\s+\((\d+)nm\)\s+([^|]+)\|.*)?$/);
    if (!match || !currentAirport) continue;
    const from = match[3].toUpperCase();
    const to = match[4].toUpperCase();
    if (from === 'NONE' || to === 'NONE') continue;
    airports[currentAirport][match[1]][match[2]] = {
      from,
      to,
      distNm: match[5] ? Number(match[5]) : null,
      amount: String(match[6] || '').trim()
    };
  }
  return airports;
}

async function loadCompanyCharterDemand(cacheMode = 'default') {
  try {
    const response = await fetch(`newsky-charter-results.txt${cacheMode === 'no-store' ? `?v=${Date.now()}` : ''}`, {cache: cacheMode});
    if (!response.ok) return {};
    return parseCompanyCharterDemand(await response.text());
  } catch (error) {
    return {};
  }
}

async function loadDatabases() {
  const status = $('#dataStatus');
  try {
    const [loaded, companyData, companyLiveryData, companyLiveryMatching, companyCharterDemand, guaranteedBonuses] = await Promise.all([
      window.UCAAFlightData.loadWeeklyFlights(message => { status.textContent = message; }),
      fetch('COMPANY/company-data.json', {cache:'default'}).then(response => response.ok ? response.json() : null).catch(() => null),
      fetch('COMPANY/ucaa-livery-database.json', {cache:'default'}).then(response => response.ok ? response.json() : null).catch(() => null),
      fetch('COMPANY/livery-matching.json', {cache:'default'}).then(response => response.ok ? response.json() : null).catch(() => null),
      loadCompanyCharterDemand('default'),
      fetch('COMPANY/guaranteed-bonuses.json', {cache:'default'}).then(response => response.ok ? response.json() : null).catch(() => null)
    ]);
    const {archive, current} = loaded;
    app.archive = archive;
    app.current = current;
    app.companyData = companyData;
    app.companyLiveryData = companyLiveryData;
    app.companyLiveryMatching = companyLiveryMatching;
    window.UCAACompanyLiveryMatching = companyLiveryMatching || null;
    app.companyCharterDemand = companyCharterDemand || {};
    app.guaranteedBonuses = guaranteedBonuses || {};
    app.flights = loaded.flights;
    reconcileGuaranteedBonusStatesWithCompletedFlights();
    pilotCardsMonthlyCache = null;
    pilotInsuranceCoverage = window.UCAAInsurance.coverageMap(app.flights);
    const latest = loaded.latest;
    const latestAvailable = latest || [...app.flights].sort((a,b) => dateOf(b)-dateOf(a))[0];
    app.referenceNow = referenceDate(latestAvailable);
    const picker = $('#dashboardDatePicker');
    picker.max = app.referenceNow.toISOString().slice(0,10);
    const earliest = [...app.flights].sort((a,b)=>dateOf(a)-dateOf(b))[0];
    if (earliest) picker.min = dateOf(earliest).toISOString().slice(0,10);
    window.UCAAPilotProfile.setFlights(app.flights);
    status.innerHTML = formatLiveDataStatusClean(current, archive, latest);
    selectInitialDashboardPeriod();
    render();
    updateCompanyLiveryStatus();
    const legacyPilot = new URLSearchParams(location.search).get('pilot');
    const requestedPilot = profileHashPilotId() || (location.hash === '#profile' ? legacyPilot : null);
    if (requestedPilot) showPilotProfile(requestedPilot);
    loadDashboardLiveNewSkyFlights(true);
  } catch (error) {
    console.error(error);
    status.textContent = 'Не вдалося завантажити файли з FLIGHTS';
    $('#leaderboard').innerHTML = '<tr><td colspan="4" style="padding:18px;text-align:center" class="negative">Не вдалося прочитати тижневі JSON-файли з папки FLIGHTS.</td></tr>';
  }
}

function formatLiveDataStatusClean(current, archive, fallbackLatest = null) {
  const currentFlights = current?.flights || [];
  const archiveFlights = archive?.flights || [];
  const updatedAt = new Date().toLocaleString('uk-UA', {
    timeZone:'UTC',
    day:'2-digit',
    month:'2-digit',
    year:'numeric',
    hour:'2-digit',
    minute:'2-digit'
  });
  return `З початку тижня виконано: ${currentFlights.length} рейсів<br>Дані оновлено ${updatedAt} UTC`;
}

async function refreshDatabasesSoft() {
  const status = $('#dataStatus');
  const loader = window.UCAAFlightData?.reloadWeeklyFlights || window.UCAAFlightData?.loadWeeklyFlights;
  if (!loader) return loadDatabases();
  const [loaded, companyData, companyLiveryData, companyLiveryMatching, companyCharterDemand, guaranteedBonuses] = await Promise.all([
    loader(message => { if (status) status.textContent = message; }),
    fetch('COMPANY/company-data.json', {cache:'no-store'}).then(response => response.ok ? response.json() : null).catch(() => null),
    fetch('COMPANY/ucaa-livery-database.json', {cache:'no-store'}).then(response => response.ok ? response.json() : null).catch(() => null),
    fetch('COMPANY/livery-matching.json', {cache:'no-store'}).then(response => response.ok ? response.json() : null).catch(() => null),
    loadCompanyCharterDemand('no-store'),
    fetch(`COMPANY/guaranteed-bonuses.json?v=${Date.now()}`, {cache:'no-store'}).then(response => response.ok ? response.json() : null).catch(() => null)
  ]);
  const {archive, current} = loaded;
  app.archive = archive;
  app.current = current;
  app.companyData = companyData;
  app.companyLiveryData = companyLiveryData;
  app.companyLiveryMatching = companyLiveryMatching;
  window.UCAACompanyLiveryMatching = companyLiveryMatching || null;
  app.companyCharterDemand = companyCharterDemand || {};
  app.guaranteedBonuses = guaranteedBonuses || {};
  app.flights = loaded.flights;
  reconcileGuaranteedBonusStatesWithCompletedFlights();
  app.liveNewSkyLoaded = false;
  app.liveNewSkyFlights = [];
  app.liveNewSkyError = '';
  pilotCardsMonthlyCache = null;
  pilotInsuranceCoverage = window.UCAAInsurance.coverageMap(app.flights);
  const latest = loaded.latest || [...app.flights].sort((a,b) => dateOf(b)-dateOf(a))[0];
  app.referenceNow = referenceDate(latest);
  const picker = $('#dashboardDatePicker');
  if (picker) {
    picker.max = app.referenceNow.toISOString().slice(0,10);
    const earliest = [...app.flights].sort((a,b)=>dateOf(a)-dateOf(b))[0];
    if (earliest) picker.min = dateOf(earliest).toISOString().slice(0,10);
  }
  window.UCAAPilotProfile.setFlights(app.flights);
  if (status) status.innerHTML = formatLiveDataStatusClean(current, archive, latest);
  if (app.liveDashboardVisible) {
    await loadDashboardLiveNewSkyFlights(true);
    updateCompanyLiveryStatus();
    return;
  }
  render();
  updateCompanyLiveryStatus();
  loadDashboardLiveNewSkyFlights(true);
}

function bindManualRefreshButtonClean() {
  const button = document.querySelector('#manualRefreshButton');
  if (!button || button.dataset.refreshBound) return;
  button.dataset.refreshBound = '1';
  button.addEventListener('click', async event => {
    event.preventDefault();
    if (button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '\u23f3';
    try {
      await refreshDatabasesSoft();
    } catch (error) {
      console.error(error);
      const status = $('#dataStatus');
      if (status) status.textContent = 'Не вдалося оновити дані';
    } finally {
      button.disabled = false;
      button.textContent = originalText || '🔄';
    }
  });
}


let dashboardCalendarOpen = false;
let dashboardCalendarMode = 'date';
let dashboardCalendarRangePickingEnd = false;
let dashboardCalendarPickerValue = '';

function dashboardCalendarDateLabelHtml() {
  if (app.period === 'customRange' && app.customDate && app.customEndDate) {
    return `<span>${esc(liveryFlightLogFormatDateShort(app.customDate))}</span><span>${esc(liveryFlightLogFormatDateShort(app.customEndDate))}</span>`;
  }
  if (app.period === 'custom' && app.customDate) return esc(liveryFlightLogFormatDateShort(app.customDate));
  return '';
}

function syncDashboardCalendarUi() {
  const button = $('#dashboardCalendarButton');
  const label = $('#dashboardDateLabel');
  const panel = $('#dashboardCalendarPanel');
  const fields = $('#dashboardCalendarFields');
  const startInput = $('#dashboardDatePicker');
  const endDisplay = $('#dashboardDateEndDisplay');
  if (!button || !label || !panel || !fields || !startInput || !endDisplay) return;
  const isCustom = app.period === 'custom' || app.period === 'customRange';
  const pickerValue = dashboardCalendarMode === 'range' && dashboardCalendarRangePickingEnd
    ? (dashboardCalendarPickerValue || app.customDate || '')
    : (app.customDate || '');
  button.classList.toggle('active', isCustom || dashboardCalendarOpen);
  label.innerHTML = !dashboardCalendarOpen ? dashboardCalendarDateLabelHtml() : '';
  panel.hidden = !dashboardCalendarOpen;
  fields.classList.toggle('range', dashboardCalendarMode === 'range');
  startInput.value = pickerValue;
  endDisplay.hidden = dashboardCalendarMode !== 'range';
  endDisplay.value = liveryFlightLogFormatDateShort(app.customEndDate);
  panel.querySelectorAll('[data-dashboard-calendar-mode]').forEach(modeButton => {
    modeButton.classList.toggle('active', modeButton.dataset.dashboardCalendarMode === dashboardCalendarMode);
  });
}

$$('#dashboardView [data-period]').forEach(button => button.onclick = () => {
  app.period = button.dataset.period;
  app.customDate = null;
  app.customEndDate = null;
  dashboardCalendarOpen = false;
  dashboardCalendarRangePickingEnd = false;
  dashboardCalendarPickerValue = '';
  $$('#dashboardView [data-period]').forEach(x => x.classList.toggle('active', x === button));
  render();
});

function openDashboardDatePicker() {
  const picker = $('#dashboardDatePicker');
  if (!picker) return;
  try {
    if (typeof picker.showPicker === 'function') picker.showPicker();
    else picker.click();
  } catch {
    picker.focus();
    picker.click();
  }
}

$('#dashboardCalendarButton').onclick = event => {
  event.preventDefault();
  dashboardCalendarOpen = !dashboardCalendarOpen;
  if (dashboardCalendarOpen) {
    dashboardCalendarRangePickingEnd = false;
    dashboardCalendarPickerValue = '';
    syncDashboardCalendarUi();
    setTimeout(openDashboardDatePicker, 0);
  } else {
    syncDashboardCalendarUi();
  }
};

$$('[data-dashboard-calendar-mode]').forEach(button => button.onclick = event => {
  event.preventDefault();
  dashboardCalendarMode = button.dataset.dashboardCalendarMode || 'date';
  dashboardCalendarRangePickingEnd = false;
  dashboardCalendarPickerValue = '';
  dashboardCalendarOpen = true;
  syncDashboardCalendarUi();
  setTimeout(openDashboardDatePicker, 0);
});

$('#dashboardDatePicker').onclick = () => {
  if (dashboardCalendarMode === 'range') dashboardCalendarRangePickingEnd = false;
};

$('#dashboardDatePicker').onchange = event => {
  if (!event.target.value) return;
  if (dashboardCalendarMode === 'range' && dashboardCalendarRangePickingEnd) {
    app.customEndDate = event.target.value;
    app.period = app.customDate === app.customEndDate ? 'custom' : 'customRange';
    dashboardCalendarOpen = false;
    dashboardCalendarRangePickingEnd = false;
    dashboardCalendarPickerValue = '';
    $$('#dashboardView [data-period]').forEach(button=>button.classList.remove('active'));
    render();
    return;
  }
  app.customDate = event.target.value;
  if (dashboardCalendarMode === 'date') {
    app.period = 'custom';
    app.customEndDate = null;
    dashboardCalendarOpen = false;
  } else {
    dashboardCalendarOpen = true;
    dashboardCalendarRangePickingEnd = true;
    dashboardCalendarPickerValue = '';
    syncDashboardCalendarUi();
    setTimeout(openDashboardDatePicker, 0);
    return;
  }
  $$('#dashboardView [data-period]').forEach(button=>button.classList.remove('active'));
  render();
};

const dashboardDateEndDisplay = $('#dashboardDateEndDisplay');
if (dashboardDateEndDisplay) {
  dashboardDateEndDisplay.onclick = event => {
    event.preventDefault();
    dashboardCalendarMode = 'range';
    dashboardCalendarOpen = true;
    dashboardCalendarRangePickingEnd = true;
    dashboardCalendarPickerValue = app.customEndDate || app.customDate || '';
    syncDashboardCalendarUi();
    openDashboardDatePicker();
  };
}

$('#flightInfoClose').onclick = () => $('#flightInfoDialog').close();
$('#flightInfoDialog').onclick = event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
};

let companyLiveryDialogReturn = null;

function closeCompanyLiveryDialog(dialog) {
  if (companyLiveryDialogReturn) {
    const restore = companyLiveryDialogReturn;
    companyLiveryDialogReturn = null;
    restore();
    return;
  }
  dialog.classList.remove('company-route-map-dialog');
  dialog.close();
}

function newskyAircraftUrl(id) {
  return `https://newsky.app/airline/ukl/manage/aircraft/${encodeURIComponent(id)}`;
}

const NEWSKY_AIRCRAFT_NAMES = {
  '695a69723dc76275bad0fd2c': 'UCAA l 737-800 (cargo) based in UKLR UKDE l UR-CAA',
  '696285163dc76275ba9ef60c': 'UCAA l 737-800 (pax) based in UKKK l UR-UCA',
  '699ae4f09da57b990ac12987': 'UCAA l 777F (cargo) based in UKBB l UR-CRG',
  '69ac6222c739a30ec84c1abb': 'UCAA l A300-600 (cargo) based in UKKM l UR-LDC',
  '69ef3747a5e61d69a7aad0da': 'UCAA l A320 based in UKLL l UR-BUS',
  '69ff1763a5e61d69a71adbb5': 'UCAA l Cessna 208 (pax) based in UKCM l UR-PAX',
  '69ff17f1a5e61d69a71af116': 'UCAA l Cessna 208 (cargo) based in UKCW l UR-VAN',
  '695a3f3a3dc76275bacaf6a7': 'E190 - UCAA l Embraer 190F (cargo) based in UKOO l UR-ECA',
  '6a44988d5760ec7cdb8cca2a': 'UCAA l Fokker 100 based in UKKK UKKV l UR-FKR',
  '695a67f93dc76275bad0c740': 'Bravo Anda Khors l MD-82 based in UKKK UKBB UKLL l UR-CRX',
  '696bb9e13dc76275ba8ddf8f': 'Windrose vs AUI l A330-200 based in UKBB l UR-WRQ',
  '695ebf3c3dc76275ba3e31f1': 'SkyLine Express l 777-300ER based in UKBB l UR-AZR',
  '695a82b73dc76275bad4f381': 'Windrose l ATR-72 based in UKBB l UR-RWC',
  '695a63363dc76275bacff63f': 'Ukraine Int l 777-200 based in UKBB l UR-GOA',
  '695a2a573dc76275bac8ccc8': 'Supernova l 737-800F based in LKMT l UR-NPA',
  '695a3cec3dc76275bacaaa27': 'Air Onix l 737-600 based in UKFF l UR-KRD',
  '695a3bf33dc76275baca8db5': 'Ukraine Int l 737-800 based in UKBB UKDE l UR-UIA',
  '6a4e7b3c5760ec7cdb4f39a3': 'Ukraine Int l 737-800 based in UKLL UKHH l UR-PSE',
  '695a7b183dc76275bad3a123': 'Ukraine Int l 737-800 based in UKOO UKDE UKOH l UR-PSO',
  '6a4f68e35760ec7cdb5e6c2d': 'SkyUp l 737-800 based in UKLL UKHH UKDE l UR-SQB',
  '6a4f69f85760ec7cdb5e7cef': 'SkyUp l 737-800 based in UKOO l UR-SQC',
  '6a4f8c7c5760ec7cdb60d2ea': 'Aerosvit l 737-800 based in UKBB l UR-AAN',
  '6a4f95025760ec7cdb6176e7': 'DART l A320 CFM based in UKKK l UR-CII',
  '695a7f7e3dc76275bad45051': 'Bukovyna Airlines l RJ100 based in UKLN l UR-CJM',
  '695a7b833dc76275bad3af85': 'Kharkiv Airlines l 737-800 based in UKHH UKBB UKCC l UR-CLR',
  '695a82f03dc76275bad4fcbd': 'DonbassAero l A320 IAE based in UKCC UKOO l UR-DAB',
  '6a4f90ec5760ec7cdb612ec3': 'Aerosvit vs DonbassAero l A320 CFM based in UKBB l UR-DAH',
  '6a4f7c085760ec7cdb5fbade': 'Dniproavia l 737-600 based in UKDD l UR-DNC',
  '695a86b43dc76275bad5a644': 'Ukraine Int l E190 based in UKBB UKHH UKOO UKDD l UR-EMA',
  '695a67383dc76275bad0a952': 'Ukraine Int l 737-800F based in UKBB l UR-FAA',
  '69f0eb2ca5e61d69a7cfbe9e': 'Ukraine Int l 737-900 Dual Class based in UKBB l UR-PSI',
  '695a7ab13dc76275bad3933a': 'SkyLine Express l 737-800 based in UKDE UKLL l UR-SLG',
  '69e3df6ea5e61d69a7a56c57': 'SkyUp l 737-700 based in UKBB UKON l UR-SQE',
  '695a7a463dc76275bad385fd': 'Bees l 737-800 based in UKKK UKLL UKOH l UR-UBA',
  '6a4fd8a95760ec7cdb679905': 'UTair Ukraine l 737-800 based in UKBB l UR-UTQ',
  '69ef2326a5e61d69a7a9a128': 'Windrose l A320 based in UKDD UKBB l UR-WRW',
  '6963db883dc76275baca3967': 'Windrose l A321 based in UKBB UKLL l UR-WRX',
  '69ef2347a5e61d69a7a9a2b0': 'WizzAir Ukraine l A320 IAE SL based in UKBB l UR-WUB',
  '695a3c883dc76275baca9e49': 'WizzAir Ukraine l A320 IAE WL based in UKKK l UR-WUC',
  '6980e9459da57b990a02e1bd': 'Dry Lease l 737-MAX8 189 pax l MSFS',
  '695a7f1f3dc76275bad440eb': 'Air Ukraine l 727-200 super based in UKBB l UR-85499',
  '6a4fd7e55760ec7cdb6783b0': 'Air Ukraine l Fokker 28 (Yak-40) based in UKKK l UR-40393',
  '6999ffea9da57b990aa9d81b': 'UTair Ukraine l Aerosoft CRJ-550 l UR-UTZ',
  '6a1c2fb3a5e61d69a78961aa': 'Antonov AN-2 l UR-40308',
  '6a325d16840ade899ebbaa5b': 'Motor-Sich l Fokker 27 (An24) based in UKDE l UR-KZR',
  '6a4fd97e5760ec7cdb67b063': 'Supernova l 727-200F (cargo) based in UKHH l UR-NPB',
  '69a3f2119da57b990aaa1899': 'UkrPost l BAe 146-300 QT (cargo) based in UKLN l UR-UPS',
  '696d16883dc76275bababd67': 'UkrPost l ATR 42-600 (pseudo cargo) l UR-ATR',
  '6988b9149da57b990ad5b53e': 'DRY LEASE l free A320neo v2 msfs2024',
  '6a4687cc5760ec7cdbae102b': 'Dry Lease l 737-MAX8 160 pax 3 classes l XP11',
  '6a4671586748d36670c9277b': 'Dry Lease l 737-MAX8 197 pax l msfs 2024',
  '6a017caea5e61d69a759b0a8': 'Dry Lease l 747-400 l 375 pax elite',
  '6a4fa2fb5760ec7cdb629836': 'Dry Lease l 777-200ER PW 294 pax',
  '6a4fa1d65760ec7cdb62803f': 'Dry Lease l 777-300ER GE 370 pax',
  '6a27e52ea5e61d69a774349a': 'Dry Lease l 787-8 GEnx by Bravo l 227 pax',
  '695a66383dc76275bad0826f': 'Dry Lease l A320 CFM FENIX msfs2024',
  '6a4fa6895760ec7cdb62e44d': 'Dry Lease l A330-200 RR iniBuilds l 257 pax elite',
  '69847d4e9da57b990a58cf4f': 'Dry Lease l A350-900 by iniBuilds l 324 pax elite',
  '6a4fa15e5760ec7cdb627803': 'Dry Lease l BOEING 737-800',
  '6a18241ea5e61d69a736205d': 'Dry Lease l E195',
  '6a4498cb5760ec7cdb8ccbed': 'Dry Lease l Fokker 70 l msfs',
  '6a4b7caa5760ec7cdb148f25': 'Dry Lease l Fokker F50 l XP11',
  '6a44e1d65760ec7cdb906917': 'Dry Lease l Saab 340 based in UKDR',
  '69ff231aa5e61d69a71c50f5': 'Dry Lease l Toliss A340-600 msfs l 372 pax in 3 class',
  '6988b97c9da57b990ad5c8f7': 'Dry Lease l iniBuilds A321LR (neo) l 220 pax',
  '6a0b23a267cd7e249842bd81': 'Dry lease l FBW A380-800 l 446 pax elite'
};

function newskyAircraftName(id) {
  const key = String(id || '').trim();
  const records = Array.isArray(app.companyLiveryMatching?.liveries) ? app.companyLiveryMatching.liveries : [];
  const liveRecord = records.find(item => key && String(item?._id || item?.aircraftId || '').trim() === key);
  const liveName = String(liveRecord?.name || liveRecord?.newskyName || '').trim();
  return liveName || NEWSKY_AIRCRAFT_NAMES[key] || '';
}

function showCompanyLiveryDialog(dialog) {
  if (!dialog || dialog.open) return;
  try {
    dialog.showModal();
  } catch (error) {
    console.error('Livery dialog open failed', error);
    dialog.setAttribute('open', '');
  }
}

function openCompanyLiveryGroupDialogSafe(card) {
  const dialog = $('#liveryInfoDialog');
  const title = $('#liveryInfoTitle');
  const body = $('#liveryInfoBody');
  try {
    openCompanyLiveryGroupDialog(card);
  } catch (error) {
    console.error('Group livery dialog failed', error);
    if (dialog && title && body) {
      companyLiveryDialogReturn = null;
      dialog.style.width = 'min(96vw,660px)';
      title.textContent = 'Група бортів';
      body.innerHTML = `<div class="company-note">Не вдалося відкрити групу бортів: ${esc(error?.message || error)}</div>`;
      showCompanyLiveryDialog(dialog);
    }
  }
}

function bindCompanyLiveryDialogs() {
  const grid = document.querySelector('.company-fleet-liveries');
  if (!grid && !document.querySelector('.company-livery-card')) return;
  let wetCards = grid ? [...grid.querySelectorAll(':scope > .company-livery-card')] : [];
  if (grid && !grid.dataset.liveryOrderReady && wetCards.length >= 9) {
    const orderedCards = [0, 4, 5, 1, 3, 2, 6, 7, 8].map(index => wetCards[index]).filter(Boolean);
    orderedCards.forEach(card => grid.appendChild(card));
    grid.dataset.liveryOrderReady = '1';
    wetCards = orderedCards;
  }
  const displayTitles = [
    'Boeing 737-800 (pax) | UR-UCA',
    'Airbus A320 | UR-BUS',
    'Fokker 100 | UR-FKR',
    'Boeing 737-800 (cargo) | UR-CAA',
    'Airbus A300-600 (cargo) | UR-LDC',
    'Boeing 777F (cargo) | UR-CRG',
    'Cessna 208 (pax) | UR-PAX',
    'Cessna 208 (cargo) | UR-VAN',
    'Embraer 190F (cargo) | UR-ECA'
  ];
  const modalTitles = [
    'PMDG 737-800 UR-UCA (pax)',
    'Fenix A320 UR-BUS',
    'Just Flight Fokker 100 UR-FKR',
    'PMDG 737-800 BCF UR-CAA (cargo)',
    'iniBuilds A300-600 PW | UR-LDC (cargo)',
    'PMDG Boeing 777F UR-CRG (cargo)',
    'Black Square C208 Grand Caravan (pax) UR-PAX',
    'Black Square C208 Grand Caravan (cargo) UR-VAN',
    'FSS Embraer 190F red/blue (cargo)'
  ];
  const liveryAircraftIds = [
    ['UR-UCA','696285163dc76275ba9ef60c'],
    ['UR-BUS','69ef3747a5e61d69a7aad0da'],
    ['UR-FKR','6a44988d5760ec7cdb8cca2a'],
    ['UR-CAA','695a69723dc76275bad0fd2c'],
    ['UR-LDC','69ac6222c739a30ec84c1abb'],
    ['UR-CRG','699ae4f09da57b990ac12987'],
    ['UR-PAX','69ff1763a5e61d69a71adbb5'],
    ['UR-VAN','69ff17f1a5e61d69a71af116'],
    ['UR-ECA','695a3f3a3dc76275bacaf6a7'],
    ['UR-CRX','695a67f93dc76275bad0c740'],
    ['UR-WRQ','696bb9e13dc76275ba8ddf8f'],
    ['UR-AZR','695ebf3c3dc76275ba3e31f1'],
    ['UR-RWC','695a82b73dc76275bad4f381'],
    ['UR-GOA','695a63363dc76275bacff63f'],
    ['UR-NPA','695a2a573dc76275bac8ccc8'],
    ['UR-MXA','6980e9459da57b990a02e1bd'],
    ['UR-85499','695a7f1f3dc76275bad440eb'],
    ['UR-40393','6a4fd7e55760ec7cdb6783b0'],
    ['UR-UTZ','6999ffea9da57b990aa9d81b'],
    ['UR-UTQ','6a4fd8a95760ec7cdb679905'],
    ['UR-40308','6a1c2fb3a5e61d69a78961aa'],
    ['UR-KZR','6a325d16840ade899ebbaa5b'],
    ['UR-NPB','6a4fd97e5760ec7cdb67b063'],
    ['UR-ATR','696d16883dc76275bababd67']
  ];
  const aircraftIdForTitle = title => {
    const text = String(title || '').toUpperCase();
    const match = liveryAircraftIds.find(([reg]) => text.includes(reg));
    return match ? match[1] : '';
  };
  const newskyAircraftUrl = id => `https://newsky.app/airline/ukl/manage/aircraft/${encodeURIComponent(id)}`;
  const openAircraftPage = (event, id) => {
    event.preventDefault();
    event.stopPropagation();
    window.open(newskyAircraftUrl(id), '_blank', 'noopener');
  };
  const setupCard = (card, titleText, modalTitle, specialIndex = -1) => {
    ensureCompanyLiveryImageWrap(card);
    if (card.dataset.liveryReady) return;
    card.dataset.liveryReady = '1';
    card.dataset.liveryDisplayTitle = titleText;
    const title = card.querySelector('.company-livery-title');
    const links = card.querySelector('.company-livery-links');
    if (links) links.className = 'company-livery-details';
    if (title) {
      title.textContent = '';
      const name = document.createElement('span');
      name.className = 'company-livery-name';
      name.textContent = titleText;
      const aircraftId = String(card.dataset.aircraftId || aircraftIdForTitle(titleText) || aircraftIdForTitle(modalTitle)).trim();
      if (aircraftId) {
        card.dataset.aircraftId = aircraftId;
        name.classList.add('company-aircraft-link');
        name.title = 'NewSky aircraft';
        name.tabIndex = 0;
        name.addEventListener('click', event => openAircraftPage(event, aircraftId));
        name.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') openAircraftPage(event, aircraftId);
        });
      }
      title.append(name);
      const group = liveryGroupAircraft(card);
      if (group.length) {
        const groupButton = document.createElement('button');
        groupButton.type = 'button';
        groupButton.className = 'company-livery-group-button';
        groupButton.textContent = `${group.length} ${group.length === 1 ? 'борт' : 'борта'}`;
        groupButton.title = 'Показати борти цієї лівреї';
        title.append(groupButton);
        groupButton.onclick = event => {
          event.preventDefault();
          event.stopPropagation();
          openCompanyLiveryGroupDialogSafe(card);
        };
      }
      if (card.dataset.noDownload !== '1') {
        const wrap = card.querySelector(':scope > .company-livery-image-wrap');
        if (wrap && !wrap.querySelector('.company-livery-download-overlay')) {
          wrap.classList.add('company-livery-image-downloadable');
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'company-livery-download-overlay';
          button.textContent = '📥';
          button.title = 'Скачати ліврею';
          button.tabIndex = -1;
          button.setAttribute('aria-hidden', 'true');
          button.setAttribute('aria-label', `Скачати ліврею: ${modalTitle}`);
          wrap.append(button);
          const openDownload = event => {
            event.preventDefault();
            event.stopPropagation();
            openCompanyLiveryDialog(card, modalTitle, specialIndex);
          };
          wrap.addEventListener('click', event => {
            if (event.target.closest('button:not(.company-livery-download-overlay),a')) return;
            openDownload(event);
          });
        }
      }
      if (!card.closest('.drylease-section') && !card.closest('.waiting-section')) {
        const mapButton = document.createElement('button');
        mapButton.type = 'button';
        mapButton.className = 'company-livery-map-button';
        mapButton.textContent = '📅';
        mapButton.title = 'Маршрутна сітка борта';
        mapButton.setAttribute('aria-label', `Маршрутна сітка: ${titleText}`);
        mapButton.dataset.liveryMap = '1';
        title.append(mapButton);
        mapButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          openCompanyLiveryRouteMap(card);
        });
      }
    }
  };
  wetCards.forEach((card, index) => {
    const titleText = displayTitles[index] || card.querySelector('.company-livery-title')?.textContent?.trim() || 'Livery UCAA';
    const modalTitle = modalTitles[index] || titleText;
    setupCard(card, titleText, modalTitle, index);
  });
  $$('.company-livery-card[data-livery-title]').forEach(card => {
    setupCard(
      card,
      card.dataset.liveryTitle || card.querySelector('.company-livery-title')?.textContent?.trim() || 'Livery UCAA',
      card.dataset.liveryModalTitle || card.dataset.liveryTitle || 'Livery UCAA',
      Number(card.dataset.liverySpecialIndex ?? -1)
    );
  });
  ensureCompanyLiveryLoadingStatus();
  setupCompanyLiverySortControls();
  const dialog = $('#liveryInfoDialog');
  const close = $('#liveryInfoClose');
  if (dialog && close && !dialog.dataset.bound) {
    dialog.dataset.bound = '1';
    close.onclick = () => closeCompanyLiveryDialog(dialog);
    dialog.onclick = event => {
      if (event.target === event.currentTarget) closeCompanyLiveryDialog(event.currentTarget);
    };
  }
}

function companyLiverySortTitle(card) {
  return String(
    card.dataset.liveryDisplayTitle
    || card.dataset.liveryTitle
    || card.querySelector('.company-livery-name')?.textContent
    || card.querySelector('.company-livery-title')?.textContent
    || ''
  ).trim().toLocaleLowerCase('uk-UA');
}

function sortCompanyLiveryGrid(grid, mode, direction = 'asc') {
  if (!grid) return;
  const cards = [...grid.querySelectorAll(':scope > .company-livery-card')];
  cards.sort((a, b) => {
    let result = 0;
    if (mode === 'hours') {
      result = (Number(b.dataset.liveryHours) || 0) - (Number(a.dataset.liveryHours) || 0);
      if (!result) result = companyLiverySortTitle(a).localeCompare(companyLiverySortTitle(b), 'uk');
    } else {
      result = companyLiverySortTitle(a).localeCompare(companyLiverySortTitle(b), 'uk');
    }
    return direction === 'desc' ? -result : result;
  });
  grid.dataset.sortMode = mode;
  grid.dataset.sortDirection = direction;
  cards.forEach(card => grid.appendChild(card));
}

function applyCompanyLiverySortModes() {
  $$('#companyView .company-fleet-liveries[data-sort-mode]').forEach(grid => {
    sortCompanyLiveryGrid(grid, grid.dataset.sortMode || 'alpha', grid.dataset.sortDirection || 'asc');
  });
}

function companyLiveryHeadingParts(text) {
  const value = String(text || '').trim();
  const match = value.match(/^(.*?)\s*(\(.+\))$/);
  return match
    ? { title: match[1].trim(), note: ` ${match[2]}` }
    : { title: value, note: '' };
}

function setupCompanyLiverySortControls() {
  $$('#companyView .company-section').forEach(section => {
    const grid = section.querySelector(':scope > .company-fleet-liveries');
    const heading = section.querySelector(':scope > .company-heading');
    if (!grid || !heading || heading.dataset.sortReady) return;
    heading.dataset.sortReady = '1';
    const headingParts = companyLiveryHeadingParts(heading.textContent);
    heading.classList.add('company-livery-heading-row');
    heading.textContent = '';
    [...grid.querySelectorAll(':scope > .company-livery-card')].forEach((card, index) => {
      if (!card.dataset.liveryDefaultOrder) card.dataset.liveryDefaultOrder = String(index);
    });
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'company-livery-collapse';
    collapse.textContent = '−';
    collapse.title = 'Згорнути список';
    collapse.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const collapsed = !grid.hidden;
      grid.hidden = collapsed;
      collapse.textContent = collapsed ? '+' : '−';
      collapse.title = collapsed ? 'Розгорнути список' : 'Згорнути список';
    });
    heading.appendChild(collapse);
    const title = document.createElement('span');
    title.className = 'company-livery-heading-title';
    title.textContent = headingParts.title;
    heading.appendChild(title);
    if (headingParts.note) {
      const note = document.createElement('span');
      note.className = 'company-livery-heading-note';
      note.textContent = headingParts.note;
      heading.appendChild(note);
    }
    const controls = document.createElement('span');
    controls.className = 'company-livery-sort-controls';
    controls.innerHTML = '<button type="button" class="company-livery-sort-button" data-livery-sort="alpha" title="Сортувати по алфавіту">AB</button><button type="button" class="company-livery-sort-button" data-livery-sort="hours" title="Сортувати по нальоту">🛫</button>';
    if (!grid.dataset.sortMode && (
      section.classList.contains('fictional-section') ||
      section.classList.contains('drylease-section')
    )) {
      grid.dataset.sortMode = 'hours';
      grid.dataset.sortDirection = 'asc';
    }
    controls.querySelectorAll('.company-livery-sort-button').forEach(button => {
      button.classList.toggle('active', button.dataset.liverySort === grid.dataset.sortMode);
    });
    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-livery-sort]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const mode = button.dataset.liverySort;
      const direction = grid.dataset.sortMode === mode && grid.dataset.sortDirection !== 'desc' ? 'desc' : 'asc';
      sortCompanyLiveryGrid(grid, mode, direction);
      controls.querySelectorAll('.company-livery-sort-button').forEach(item => {
        item.classList.toggle('active', item === button);
        if (item === button) item.title = `${item.title.replace(/ ↑| ↓/g, '')} ${direction === 'desc' ? '↓' : '↑'}`;
      });
    });
    heading.appendChild(controls);
  });
}

function openCompanyLiveryDialog(card, titleText, index = -1) {
  const dialog = $('#liveryInfoDialog');
  const title = $('#liveryInfoTitle');
  const body = $('#liveryInfoBody');
  if (!dialog || !title || !body) return;
  companyLiveryDialogReturn = null;
  dialog.classList.remove('company-route-map-dialog');
  dialog.style.width = '';
  const image = card.querySelector('img');
  const details = card.querySelector('.company-livery-details');
  title.textContent = titleText || 'Ліврея UCAA';
  let imageHtml = image ? `<img class="company-livery-modal-image" src="${esc(image.getAttribute('src') || '')}" alt="${esc(image.getAttribute('alt') || title.textContent)}">` : '';
  if (index === 8) {
    imageHtml = `<img class="company-livery-modal-image" src="E190-UCAA-red-grey.jpg" alt="${esc(title.textContent)}">`;
  }
  body.innerHTML = `${imageHtml}<div class="company-livery-downloads">${normalizeLiveryDownloadDetails(details ? details.innerHTML : '')}</div>`;
  showCompanyLiveryDialog(dialog);
}

function normalizeLiveryDownloadDetails(html) {
  const label = '\u0421\u043a\u0430\u0447\u0430\u0442\u0438 \u043b\u0456\u0432\u0440\u0435\u044e';
  return String(html || '').replace(/(^|>|\s)\u0441\u043a\u0430\u0447\u0430\u0442\u0438(\s+[^:<]+)?\s*:/giu, (match, prefix, suffix = '') => `${prefix}${label}${suffix}:`);
}

function liveryPassengerClasses(flight) {
  return flight?.operations?.passengersByClass || flight?.payload?.paxByClass || null;
}

function liveryHasPremiumCabin(flight) {
  const classes = liveryPassengerClasses(flight);
  if (!classes) return false;
  return (Number(classes.F) || 0) > 0 || (Number(classes.C) || 0) > 0;
}

function liveryAircraftCode(flight) {
  return String(flight?.aircraft?.icao || '').toUpperCase();
}

function liveryIsCargo(flight) {
  return String(flight?.flightType || '').toLowerCase() === 'cargo'
    || (Number(flight?.operations?.passengers) || 0) === 0 && (Number(flight?.operations?.cargoWeightKg) || Number(flight?.operations?.cargo) || 0) > 0;
}

function liveryTrackerForTitle(title) {
  const value = String(title || '').toLowerCase();
  const includes = text => value.includes(text.toLowerCase());
  if (includes('UR-UCA') || includes('737-800 (pax)')) return flight => liveryAircraftCode(flight) === 'B738' && !liveryIsCargo(flight) && liveryHasPremiumCabin(flight);
  if (includes('UR-CAA') || includes('737-800 (cargo)')) return flight => liveryAircraftCode(flight) === 'B738' && liveryIsCargo(flight);
  if (includes('UR-CRG') || includes('777F')) return flight => ['B77L','B77F'].includes(liveryAircraftCode(flight)) && liveryIsCargo(flight);
  if (includes('UR-LDC') || includes('A300-600')) return flight => ['A306','A300'].includes(liveryAircraftCode(flight));
  if (includes('UR-BUS') || includes('Airbus A320')) return flight => liveryAircraftCode(flight) === 'A320' && liveryHasPremiumCabin(flight);
  if (includes('UR-SFS') || includes('757')) return flight => ['B752','B757'].includes(liveryAircraftCode(flight));
  if (includes('UR-PAX') || includes('UR-VAN') || includes('Cessna 208')) return flight => ['C208','C208B'].includes(liveryAircraftCode(flight));
  if (includes('UR-ECA') || includes('E190')) return flight => ['E190','E195'].includes(liveryAircraftCode(flight));
  if (includes('UR-FKR') || includes('Fokker 100')) return flight => ['F100'].includes(liveryAircraftCode(flight));
  if (includes('UR-CRX') || includes('MD-82')) return flight => ['MD82','MD83','MD88','MD80'].includes(liveryAircraftCode(flight));
  if (includes('UR-WRQ') || includes('A330-200')) return flight => ['A332','A330'].includes(liveryAircraftCode(flight));
  if (includes('UR-AZR') || includes('777-300')) return flight => ['B77W','B773'].includes(liveryAircraftCode(flight));
  if (includes('UR-RWC') || includes('ATR 72')) return flight => ['AT76','AT72','ATR'].includes(liveryAircraftCode(flight));
  if (includes('UR-GOA') || includes('777-200')) return flight => ['B772','B77L'].includes(liveryAircraftCode(flight)) && !liveryIsCargo(flight);
  if (includes('UR-NPA') || includes('737-800F')) return flight => liveryAircraftCode(flight) === 'B738' && liveryIsCargo(flight);
  if (includes('UR-DSA')) return flight => ['E190','E195'].includes(liveryAircraftCode(flight)) && !liveryIsCargo(flight);
  if (includes('UR-MXA') || includes('737-MAX8')) return flight => ['B38M','B738'].includes(liveryAircraftCode(flight));
  if (includes('UR-85499') || includes('727-200')) return flight => ['B722','B721','B727'].includes(liveryAircraftCode(flight));
  if (includes('UR-40393') || includes('Fokker F28')) return flight => ['F28','F27'].includes(liveryAircraftCode(flight));
  if (includes('UR-UTZ') || includes('CRJ-550')) return flight => ['CRJ5','CRJ7','CRJ9','CRJ'].includes(liveryAircraftCode(flight));
  if (includes('UR-40308') || includes('Ан-2')) return flight => ['AN2','AN-2'].includes(liveryAircraftCode(flight));
  if (includes('UR-KZR') || includes('Fokker F27')) return flight => ['F27'].includes(liveryAircraftCode(flight));
  if (includes('UR-NPB') || includes('Supernova')) return flight => ['B722','B721','B727'].includes(liveryAircraftCode(flight)) && liveryIsCargo(flight);
  if (includes('BAe146') || includes('Avro RJ')) return flight => ['B461','B462','B463','B464','RJ70','RJ85','RJ1H'].includes(liveryAircraftCode(flight));
  if (includes('UR-ATR') || includes('ATR 42')) return flight => ['AT42','AT45'].includes(liveryAircraftCode(flight));
  return null;
}

function liveryCardTitle(card) {
  return card?.dataset?.liveryDisplayTitle
    || card?.dataset?.liveryTitle
    || card?.querySelector('.company-livery-name')?.textContent
    || card?.querySelector('.company-livery-title')?.textContent
    || '';
}

function liveryAircraftFullNameFromFlights(flights) {
  const names = (flights || [])
    .map(flight => newskyAircraftName(flight?.aircraft?.id)
      || String(flight?.aircraft?.title || flight?.aircraft?.fullName || flight?.aircraft?.fullname || '').trim())
    .filter(Boolean);
  return names[0] || '';
}

function liveryFlightLogTitle(card, titleText, flights) {
  const cardAircraftId = String(card?.dataset?.aircraftId || '').trim();
  return companyLiveryMatchingNameByAircraftId(cardAircraftId)
    || newskyAircraftName(cardAircraftId)
    || liveryAircraftFullNameFromFlights(flights)
    || String(card?.dataset?.liveryModalTitle || card?.dataset?.liveryTitle || titleText || '').trim()
    || titleText
    || 'літак UCAA';
}

function liveryFlightLogAircraftCode(flights) {
  const code = (flights || []).map(flight => liveryAircraftCode(flight)).find(Boolean);
  return code || '';
}

function liveryFlightLogHeading(card, titleText, flights) {
  const code = liveryFlightLogAircraftCode(flights);
  return `Logbook ${code ? `${code} - ` : ''}${liveryFlightLogTitle(card, titleText, flights)}`;
}

function liveryMatcherForCard(card, title = liveryCardTitle(card)) {
  const aircraftIds = String(card?.dataset?.aircraftIds || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (aircraftIds.length) {
    const idSet = new Set(aircraftIds);
    return flight => idSet.has(String(flight?.aircraft?.id || '').trim());
  }
  const aircraftId = String(card?.dataset?.aircraftId || '').trim();
  if (aircraftId) return flight => String(flight?.aircraft?.id || '').trim() === aircraftId;
  return liveryTrackerForTitle(title);
}

function liveryGroupAircraft(card) {
  const ids = String(card?.dataset?.aircraftIds || '').split(',').map(item => item.trim()).filter(Boolean);
  const regs = String(card?.dataset?.liveryGroupRegistrations || '').split(',').map(item => item.trim()).filter(Boolean);
  const titles = String(card?.dataset?.liveryGroupTitles || '').split(',').map(item => item.trim()).filter(Boolean);
  const images = String(card?.dataset?.liveryGroupImages || '').split(',').map(item => item.trim()).filter(Boolean);
  const fixedIds = new Map([
    ['UR-UIA', '695a3bf33dc76275baca8db5'],
    ['UR-PSE', '6a4e7b3c5760ec7cdb4f39a3'],
    ['UR-PSO', '695a7b183dc76275bad3a123'],
    ['UR-SQB', '6a4f68e35760ec7cdb5e6c2d'],
    ['UR-SQC', '6a4f69f85760ec7cdb5e7cef']
  ]);
  return ids.map((id, index) => ({
    id: fixedIds.get(regs[index]) || id,
    reg: regs[index] || titles[index] || `Борт ${index + 1}`,
    title: titles[index] || regs[index] || `Борт ${index + 1}`,
    image: images[index] || `${(regs[index] || '').replace('-', '')}.png`
  }));
}

function liveryHeadlineForCard(card, completedFlights, groupedFlights) {
  const group = liveryGroupAircraft(card);
  if (!group.length) {
    return {
      registration: '',
      flights: groupedFlights,
      totalMinutes: groupedFlights.reduce((sum, flight) => sum + (Number(flight.times?.durationMinutes) || 0), 0)
    };
  }
  const ranked = group.map(item => {
    const flights = completedFlights
      .filter(flight => String(flight?.aircraft?.id || '').trim() === item.id)
      .sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a));
    return {
      ...item,
      flights,
      totalMinutes: flights.reduce((sum, flight) => sum + (Number(flight.times?.durationMinutes) || 0), 0)
    };
  }).sort((a,b) => b.totalMinutes - a.totalMinutes);
  const top = ranked[0];
  return top ? {...top, registration: top.reg || ''} : {registration:'', flights:groupedFlights, totalMinutes:0};
}

function liveryCardFallbackAirport(card) {
  const icao = String(card?.dataset?.currentIcao || '').trim().toUpperCase();
  if (!icao) return null;
  return {
    icao,
    name: String(card?.dataset?.currentName || icao),
    city: ''
  };
}

function liveryFlightLogLink(flight) {
  const id = String(flight?.id || '').trim();
  return id ? `<a href="https://newsky.app/flight/${encodeURIComponent(id)}" target="_blank" rel="noopener">Flight Log</a>` : '<span class="muted">Flight Log</span>';
}

function liveryFlightLogButton(cardIndex, aircraftId = '') {
  const idAttr = aircraftId ? ` data-livery-log-aircraft-id="${esc(aircraftId)}"` : '';
  return `<button type="button" class="company-livery-log-button" data-livery-log-index="${cardIndex}"${idAttr}>Журнал</button>`;
}

function formatLiveryMinutesCompact(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function liveryFlightsWord(count) {
  const value = Math.abs(Number(count) || 0);
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'рейсів';
  if (last === 1) return 'рейс';
  if (last >= 2 && last <= 4) return 'рейси';
  return 'рейсів';
}

function companyLiveryAircraftById(id) {
  const needle = String(id || '').trim();
  if (!needle) return null;
  return (app.companyLiveryData?.aircraft || []).find(item => String(item?.id || '').trim() === needle) || null;
}

function companyLiveryMatchingRecord(aircraft) {
  const id = String(aircraft?.id || aircraft?.aircraftId || '').trim();
  const reg = String(aircraft?.registration || '').trim().toUpperCase();
  const records = Array.isArray(app.companyLiveryMatching?.liveries) ? app.companyLiveryMatching.liveries : [];
  return records.find(item => id && String(item?._id || item?.aircraftId || '').trim() === id)
    || records.find(item => reg && String(item?.registration || '').trim().toUpperCase() === reg)
    || null;
}

function companyLiveryMatchingRecordByKey(id = '', registration = '') {
  const key = String(id || '').trim();
  const reg = String(registration || '').trim().toUpperCase();
  const records = Array.isArray(app.companyLiveryMatching?.liveries) ? app.companyLiveryMatching.liveries : [];
  return records.find(item => key && String(item?._id || item?.aircraftId || '').trim() === key)
    || records.find(item => reg && String(item?.registration || '').trim().toUpperCase() === reg)
    || null;
}

function companyLiveryMatchingNameByAircraftId(id) {
  const key = String(id || '').trim();
  if (!key) return '';
  const records = Array.isArray(app.companyLiveryMatching?.liveries) ? app.companyLiveryMatching.liveries : [];
  const record = records.find(item => String(item?._id || item?.aircraftId || '').trim() === key);
  return String(record?.name || record?.newskyName || '').trim();
}

function liveryShortOperatorFromName(name) {
  const text = String(name || '').trim();
  const parts = text.split(/\s+l\s+/i).map(item => item.trim()).filter(Boolean);
  return parts[0] || '';
}

function liveryRegistrationFromRecord(record) {
  const direct = String(record?.registration || record?.reg || '').trim().toUpperCase();
  if (direct) return direct;
  const name = String(record?.name || record?.newskyName || '').toUpperCase();
  const match = name.match(/\bUR-[A-Z0-9]+\b/);
  return match ? match[0] : '';
}

function companyLiveryShortNoteByAircraftId(id, fallbackIcao = '') {
  const record = companyLiveryMatchingRecordByKey(id);
  if (record) {
    const operator = liveryShortOperatorFromName(record.name || record.newskyName);
    const registration = liveryRegistrationFromRecord(record);
    const note = [operator, registration].filter(Boolean).join(' | ');
    if (note) return note;
  }
  const icao = String(fallbackIcao || '').trim().toUpperCase();
  return icao ? `${icao} · Dry Leasing` : 'Dry Leasing';
}

function aircraftTableNote(flight) {
  const id = String(flight?.aircraft?.id || flight?.aircraftId || '').trim();
  const icao = String(flight?.aircraft?.icao || flight?.aircraft?.airframe?.icao || flight?.aircraft?.airframe?.ident || '').trim().toUpperCase();
  return companyLiveryShortNoteByAircraftId(id, icao);
}

function companyLiveryMatchingIcao(aircraft, fieldNames = ['lastflightlocationICAO', 'lastFlightLocationIcao', 'locationIcao']) {
  const record = companyLiveryMatchingRecord(aircraft);
  for (const field of fieldNames) {
    const icao = String(record?.[field] || '').trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(icao)) return icao;
  }
  return '';
}

function companyLiveryAircraftForCard(card, flights = [], latest = null, headline = null) {
  const titleRegistration = liveryRegistrationFromTitle(card?.dataset?.liveryTitle || card?.querySelector?.('.company-livery-title')?.textContent || '');
  const ids = [
    headline?.id,
    latest?.aircraft?.id,
    card?.dataset?.aircraftId,
    ...String(card?.dataset?.aircraftIds || '').split(',')
  ].map(item => String(item || '').trim()).filter(Boolean);
  for (const id of ids) {
    const aircraft = companyLiveryAircraftById(id);
    if (aircraft) return aircraft;
  }
  const matching = companyLiveryMatchingRecordByKey(ids[0] || '', headline?.registration || headline?.reg || titleRegistration);
  if (matching) {
    return {
      id: String(matching._id || matching.aircraftId || ids[0] || '').trim(),
      registration: String(matching.registration || headline?.registration || headline?.reg || titleRegistration || '').trim().toUpperCase(),
      name: String(matching.name || matching.newskyName || '').trim(),
      airframeIdent: String(matching.airframeIdent || '').trim(),
      airframeType: String(matching.airframeIdent || '').trim(),
      locationIcao: String(matching.locationIcao || '').trim().toUpperCase(),
      basesFromName: []
    };
  }
  const firstFlight = latest || flights.find(flight => flight?.aircraft?.id);
  const fallbackId = String(firstFlight?.aircraft?.id || '').trim();
  return fallbackId ? {
    id: fallbackId,
    registration: '',
    airframeIdent: liveryAircraftCode(firstFlight),
    airframeType: liveryAircraftCode(firstFlight),
    locationIcao: '',
    basesFromName: []
  } : null;
}

function liveryTodayKey() {
  const date = app.referenceNow instanceof Date && Number.isFinite(app.referenceNow.getTime())
    ? app.referenceNow
    : new Date();
  return ['sun','mon','tue','wed','thu','fri','sat'][date.getUTCDay()];
}

function liveryTomorrowKey() {
  const date = app.referenceNow instanceof Date && Number.isFinite(app.referenceNow.getTime())
    ? new Date(app.referenceNow.getTime())
    : new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return ['sun','mon','tue','wed','thu','fri','sat'][date.getUTCDay()];
}

function liveryRouteRunsToday(route) {
  const key = liveryTodayKey();
  return route?.[key] === true || (Array.isArray(route?.days) && route.days.includes(key));
}

function liveryRouteRunsTomorrow(route) {
  const key = liveryTomorrowKey();
  return route?.[key] === true || (Array.isArray(route?.days) && route.days.includes(key));
}

function liveryRouteRunsTodayOrTomorrow(route) {
  const today = liveryTodayKey();
  const tomorrow = liveryTomorrowKey();
  const days = Array.isArray(route?.days) ? route.days : [];
  return route?.[today] === true || route?.[tomorrow] === true || days.includes(today) || days.includes(tomorrow);
}

function normalizeLiveryScheduleRoute(route) {
  if (!route) return null;
  return {
    number: String(route.number || '').trim(),
    dep: String(route.dep || '').trim().toUpperCase(),
    arr: String(route.arr || '').trim().toUpperCase(),
    type: String(route.type || '').trim().toLowerCase(),
    durationMin: Number(route.durationMin ?? route.duration) || 0,
    airframes: Array.isArray(route.airframes)
      ? route.airframes.map(item => String(item || '').trim().toUpperCase()).filter(Boolean)
      : String(route.airframes || route.airframesRaw || '').split(',').map(item => item.trim().toUpperCase()).filter(Boolean),
    days: Array.isArray(route.days) ? route.days : [],
    active: route.active !== false,
    mon: route.mon, tue: route.tue, wed: route.wed, thu: route.thu, fri: route.fri, sat: route.sat, sun: route.sun
  };
}

function liveryRouteMatchesAircraft(route, aircraft) {
  const airframes = normalizeLiveryScheduleRoute(route)?.airframes || [];
  if (!airframes.length) return false;
  const codes = [
    aircraft?.airframeIdent,
    aircraft?.airframeType,
    aircraft?.airframeName,
    aircraft?.icao,
    aircraft?.variant
  ].map(item => String(item || '').trim().toUpperCase()).filter(Boolean);
  return airframes.some(code => codes.includes(code));
}

function liveryScheduleRoutesForAircraft(aircraft) {
  if (!aircraft) return [];
  const id = String(aircraft.id || '').trim();
  const reg = String(aircraft.registration || '').trim().toUpperCase();
  const assignments = Object.values(app.companyLiveryData?.scheduleAssignments || {});
  const assigned = assignments
    .map(normalizeLiveryScheduleRoute)
    .filter(route => route && route.active)
    .filter(route => {
      const raw = assignments.find(item => String(item?.number || '') === route.number && String(item?.dep || '').toUpperCase() === route.dep && String(item?.arr || '').toUpperCase() === route.arr);
      const ids = (raw?.assignedAircraftIds || []).map(item => String(item || '').trim());
      const regs = (raw?.assignedRegistrations || []).map(item => String(item || '').trim().toUpperCase());
      return (id && ids.includes(id)) || (reg && regs.includes(reg));
    });
  return assigned;
}

function liveryScheduleRoutesConnectedToIcao(routes, startIcao) {
  const starts = (Array.isArray(startIcao) ? startIcao : [startIcao])
    .map(item => String(item || '').trim().toUpperCase())
    .filter(item => /^[A-Z0-9]{4}$/.test(item));
  const list = (routes || []).filter(route => route && route.active !== false);
  if (!starts.length) return list;
  const adjacency = new Map();
  list.forEach(route => {
    const dep = String(route.dep || '').trim().toUpperCase();
    const arr = String(route.arr || '').trim().toUpperCase();
    if (!dep || !arr) return;
    if (!adjacency.has(dep)) adjacency.set(dep, new Set());
    if (!adjacency.has(arr)) adjacency.set(arr, new Set());
    adjacency.get(dep).add(arr);
    adjacency.get(arr).add(dep);
  });
  const seeds = starts.filter(start => adjacency.has(start));
  if (!seeds.length) return [];
  const reachable = new Set(seeds);
  const queue = seeds.slice();
  while (queue.length) {
    const icao = queue.shift();
    (adjacency.get(icao) || []).forEach(next => {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    });
  }
  return list.filter(route => reachable.has(String(route.dep || '').trim().toUpperCase()) || reachable.has(String(route.arr || '').trim().toUpperCase()));
}

function liveryScheduleRoutesIncludeIcao(routes, icao) {
  const code = String(icao || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return true;
  const list = (routes || []).filter(route => route && route.active !== false);
  if (!list.length) return true;
  return list.some(route => {
    const dep = String(route.dep || '').trim().toUpperCase();
    const arr = String(route.arr || '').trim().toUpperCase();
    return dep === code || arr === code;
  });
}

function liveryAirportObjectByIcao(icao, fallbackName = '') {
  const code = String(icao || '').trim().toUpperCase();
  if (!code) return null;
  for (const flight of app.flights || []) {
    for (const candidate of [flight.departure, flight.arrival, flight.actualArrival, flight.dep, flight.arr]) {
      if (String(candidate?.icao || '').trim().toUpperCase() === code) return candidate;
    }
  }
  const aircraft = (app.companyLiveryData?.aircraft || []).find(item => String(item?.locationIcao || '').trim().toUpperCase() === code && (item.locationName || item.locationCity));
  return {icao: code, name: fallbackName || aircraft?.locationName || code, city: aircraft?.locationCity || ''};
}

function liveryBlockSpeedNmPerHour(aircraft, title = '') {
  const text = `${aircraft?.registration || ''} ${aircraft?.airframeIdent || ''} ${aircraft?.airframeType || ''} ${aircraft?.name || ''} ${newskyAircraftName(aircraft?.id) || ''} ${title}`.toUpperCase();
  if (text.includes('AN2') || text.includes('AN-2') || text.includes('UR-40308')) return 60;
  if (text.includes('C208') || text.includes('UR-PAX') || text.includes('UR-VAN')) return 150;
  if (text.includes('AT42') || text.includes('AT72') || text.includes('AT75') || text.includes('AT76') || text.includes('ATR') || text.includes('UR-RWC') || text.includes('UR-ATR')) return 200;
  return 300;
}

function liveryRouteDistanceNmText(from, to, aircraft = null, title = '') {
  const km = liveryAirportDistanceKm(from, to);
  if (!km) return '';
  const nm = Math.max(1, Math.round(km / 1.852));
  const speed = liveryBlockSpeedNmPerHour(aircraft, title);
  const blockMinutes = Math.max(10, Math.round((40 + nm / speed * 60) / 10) * 10);
  const timeText = `${String(Math.floor(blockMinutes / 60)).padStart(2, '0')}:${String(blockMinutes % 60).padStart(2, '0')}`;
  return ` <span class="company-route-block-time" title="BLOCK TIME, ~${nm.toLocaleString('uk-UA')} nm">(~${timeText})</span>`;
}

function liveryRouteDistanceNm(fromIcao, toIcao) {
  const from = liveryAirportObjectByIcao(fromIcao);
  const to = liveryAirportObjectByIcao(toIcao);
  const km = from && to ? liveryAirportDistanceKm(from, to) : 0;
  return km ? Math.max(1, Math.round(km / 1.852)) : 0;
}

function liveryAircraftMaxRangeNm(aircraft) {
  const matching = companyLiveryMatchingRecord(aircraft);
  const raw = matching?.maxRange ?? aircraft?.maxRange;
  const value = Number(String(raw ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function liveryRouteFitsAircraftRange(aircraft, fromIcao, toIcao) {
  const maxRange = liveryAircraftMaxRangeNm(aircraft);
  if (!maxRange) return true;
  const distance = liveryRouteDistanceNm(fromIcao, toIcao);
  return !distance || distance <= maxRange;
}

function liveryAircraftDifficultyForBonus(aircraft, title = '') {
  const code = String(aircraft?.airframeIdent || aircraft?.airframeType || '').trim().toUpperCase();
  const text = `${aircraft?.name || ''} ${newskyAircraftName(aircraft?.id) || ''} ${code} ${title}`.toLowerCase();
  const flightType = /(cargo|freighter|737-800f|737f|777f|\bf\b|bcf|qt)/i.test(text) ? 'cargo' : '';
  const value = aircraftCoefficient(code, flightType);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function liveryGuaranteedPremiumAmount(originIcao, destinationIcao, aircraft, title = '') {
  const distance = liveryRouteDistanceNm(originIcao, destinationIcao);
  if (!distance) return 0;
  return Math.round((100 + distance) * liveryAircraftDifficultyForBonus(aircraft, title));
}

function liveryProposalPremiumHtml(proposal, disabled = false) {
  if (disabled || typeof proposal === 'string') return '&mdash;';
  const amount = Number(proposal?.guaranteedPremium) || 0;
  return amount > 0 ? `<span class="positive">${money(amount)}</span>` : '&mdash;';
}

function liveryLatestScheduleAirportIcao(flights, aircraft) {
  const matching = companyLiveryMatchingRecord(aircraft);
  const manualScheduleIcao = String(matching?.locationIcao || matching?.scheduleLocationIcao || '').trim().toUpperCase();
  if (manualScheduleIcao) return manualScheduleIcao;
  const latestSchedule = (flights || [])
    .filter(flight => flightOperation(flight).key === 'schedule')
    .sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a))[0];
  const scheduleArrival = String((latestSchedule?.actualArrival || latestSchedule?.arrival || {})?.icao || '').trim().toUpperCase();
  return scheduleArrival || String(aircraft?.locationIcao || '').trim().toUpperCase();
}

function liveryProposalBadge(kind, label, meta = {}) {
  const key = kind === 'schedule' ? 'schedule' : 'free';
  const extraClass = meta.badgeClass ? ` ${esc(meta.badgeClass)}` : '';
  const title = meta.title ? ` title="${esc(meta.title)}"` : '';
  return `<span class="flight-number-link flight-number-${key} company-livery-proposal-badge${extraClass}"${title}>${esc(label)}</span>`;
}

function liveryRouteProposalText(kind, label, originIcao, destinationIcao, meta = {}) {
  const origin = String(originIcao || '').trim().toUpperCase();
  const destination = String(destinationIcao || '').trim().toUpperCase();
  if (origin && destination && origin === destination) return '&mdash;';
  const from = liveryAirportObjectByIcao(originIcao);
  const to = liveryAirportObjectByIcao(destinationIcao);
  if (!to) return '&mdash;';
  const route = from
    ? `${liveryAirportWithFlag(from, false)} - ${liveryAirportWithFlag(to, false)}`
    : liveryAirportWithFlag(to, false);
  const distanceText = from ? liveryRouteDistanceNmText(from, to, meta.aircraft, meta.aircraftTitle || '') : '';
  return `${liveryProposalBadge(kind, label, meta)} ${route}${distanceText}`;
}

function liveryRouteProposalData(kind, label, originIcao, destinationIcao, meta = {}) {
  const origin = String(originIcao || '').trim().toUpperCase();
  const destination = String(destinationIcao || '').trim().toUpperCase();
  const html = liveryRouteProposalText(kind, label, origin, destination, meta);
  const guaranteedPremium = liveryGuaranteedPremiumAmount(origin, destination, meta.aircraft, meta.aircraftTitle || '');
  return html === '&mdash;' ? null : {kind, label, origin, destination, html, ...meta, guaranteedPremium};
}

function liveryScheduleCandidateRoutes(routes) {
  return (routes || [])
    .filter(route => route?.active !== false)
    .filter(liveryRouteRunsToday);
}

function liveryChooseScheduleRoute(routes, depIcao) {
  const dep = String(depIcao || '').trim().toUpperCase();
  const pool = liveryScheduleCandidateRoutes(routes);
  if (dep) {
    const fromDep = pool.find(route => route.dep === dep);
    if (fromDep) return fromDep;
    return null;
  }
  return pool[0] || null;
}

function liveryScheduleRouteFrom(routes, depIcao) {
  const dep = String(depIcao || '').trim().toUpperCase();
  if (!dep) return null;
  const pool = liveryScheduleCandidateRoutes(routes);
  return pool.find(route => route.dep === dep) || null;
}

function liveryBaseIcaosForAircraft(aircraft) {
  const bases = Array.isArray(aircraft?.basesFromName) ? aircraft.basesFromName : [];
  const matching = companyLiveryMatchingRecord(aircraft);
  const liveName = String(matching?.name || matching?.newskyName || '').trim();
  const fromName = String(liveName || aircraft?.name || newskyAircraftName(aircraft?.id) || '').match(/based in\s+([A-Z0-9 ]+)/i);
  const parsed = fromName ? fromName[1].split(/\s+/) : [];
  return [...bases, ...parsed].map(item => String(item || '').trim().toUpperCase()).filter(item => /^[A-Z0-9]{4}$/.test(item));
}

function liveryMatchingBaseIcaosForAircraft(aircraft) {
  const matching = companyLiveryMatchingRecord(aircraft);
  const liveName = String(matching?.name || matching?.newskyName || '').trim();
  const fromName = liveName.match(/based in\s+([A-Z0-9 ]+)/i);
  const parsed = fromName ? fromName[1].split(/\s+/) : [];
  return parsed.map(item => String(item || '').trim().toUpperCase()).filter(item => /^[A-Z0-9]{4}$/.test(item));
}

function liveryAircraftCurrentIcao(aircraft) {
  const id = String(aircraft?.id || '').trim();
  const latest = (app.flights || [])
    .filter(flight => flight.status === 'completed' && String(flight?.aircraft?.id || '').trim() === id)
    .sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a))[0];
  return String((latest?.actualArrival || latest?.arrival || {})?.icao || companyLiveryMatchingIcao(aircraft) || aircraft?.locationIcao || '').trim().toUpperCase();
}

function liveryFreeUcaaBaseIcao(currentIcao) {
  const current = String(currentIcao || '').trim().toUpperCase();
  const ucaaAircraft = (app.companyLiveryData?.aircraft || [])
    .filter(aircraft => String(aircraft?.name || '').toUpperCase().includes('UCAA'))
    .filter(aircraft => liveryBaseIcaosForAircraft(aircraft).length);
  const occupied = new Set(ucaaAircraft.map(liveryAircraftCurrentIcao).filter(Boolean));
  const bases = [];
  ucaaAircraft.forEach(aircraft => {
    liveryBaseIcaosForAircraft(aircraft).forEach(icao => {
      if (!bases.includes(icao)) bases.push(icao);
    });
  });
  return bases.find(icao => icao !== current && !occupied.has(icao)) || '';
}

function liveryScheduleTimingLabel(route) {
  if (!route) return 'сьогодні';
  if (liveryRouteRunsToday(route)) return 'сьогодні';
  const tomorrow = liveryTomorrowKey();
  const days = Array.isArray(route?.days) ? route.days : [];
  if (route?.[tomorrow] === true || days.includes(tomorrow)) return 'завтра';
  return 'сьогодні/завтра';
}

function liveryAircraftDemandMode(aircraft, title = '') {
  const text = `${aircraft?.name || ''} ${newskyAircraftName(aircraft?.id) || ''} ${aircraft?.airframeIdent || ''} ${aircraft?.airframeType || ''} ${title}`.toLowerCase();
  return /(cargo|freighter|737-800f|737f|777f|\bf\b|bcf|qt)/i.test(text) ? 'cargo' : 'pax';
}

function liveryCharterDemandProposal(currentIcao, aircraft, title = '') {
  const current = String(currentIcao || '').trim().toUpperCase();
  if (!current) return null;
  const info = app.companyCharterDemand?.[current];
  if (!info?.out) return null;
  const mode = liveryAircraftDemandMode(aircraft, title);
  const record = info.out[mode] || null;
  const destination = String(record?.to || '').trim().toUpperCase();
  if (!destination || destination === current) return null;
  const modeText = mode === 'cargo' ? 'вантаж' : 'пасажири';
  const amount = String(record.amount || '').trim();
  return liveryRouteProposalData('free', 'FREE', current, destination, {
    aircraft,
    aircraftTitle: title,
    reason: 'demand',
    badgeClass: 'company-livery-free-demand',
    title: `FREE flight за попитом NewSky: ${modeText}${amount ? ` ${amount}` : ''} з ${current} до ${destination}`
  });
}

function liveryInboundDemandProposal(targetIcao, aircraft, title = '') {
  const target = String(targetIcao || '').trim().toUpperCase();
  if (!target) return null;
  const info = app.companyCharterDemand?.[target];
  if (!info?.in) return null;
  const mode = liveryAircraftDemandMode(aircraft, title);
  const record = info.in[mode] || null;
  const origin = String(record?.from || '').trim().toUpperCase();
  const destination = String(record?.to || '').trim().toUpperCase();
  if (!origin || !destination || destination !== target || origin === destination) return null;
  const maxRange = liveryAircraftMaxRangeNm(aircraft);
  const distance = Number(record?.distNm) || liveryRouteDistanceNm(origin, destination);
  if (maxRange && distance && distance > maxRange) return null;
  const modeText = mode === 'cargo' ? 'cargo' : 'pax';
  const amount = String(record.amount || '').trim();
  return liveryRouteProposalData('free', 'FREE', origin, destination, {
    aircraft,
    aircraftTitle: title,
    reason: 'range-inbound-demand',
    badgeClass: 'company-livery-free-demand',
    title: `FREE flight by NewSky inbound demand: ${modeText}${amount ? ` ${amount}` : ''} from ${origin} to ${destination}`
  });
}

function liveryRangeSafeFreeProposal(currentIcao, targetIcao, aircraft, title, meta = {}) {
  const current = String(currentIcao || '').trim().toUpperCase();
  const target = String(targetIcao || '').trim().toUpperCase();
  if (!current || !target || current === target) return null;
  if (liveryRouteFitsAircraftRange(aircraft, current, target)) {
    return liveryRouteProposalData('free', 'FREE', current, target, {...meta, aircraft, aircraftTitle: title});
  }
  const inboundProposal = liveryInboundDemandProposal(target, aircraft, title);
  if (inboundProposal) return inboundProposal;
  if (meta.allowDirectWhenNoInbound) {
    return liveryRouteProposalData('free', 'FREE', current, target, {...meta, aircraft, aircraftTitle: title, rangeExceeded: true});
  }
  return null;
}

function liveryIsScheduleStuck(aircraft, routes, currentIcao) {
  const current = String(currentIcao || '').trim().toUpperCase();
  const scheduleLocation = String(companyLiveryMatchingIcao(aircraft, ['locationIcao']) || '').trim().toUpperCase();
  if (!current || !scheduleLocation || current !== scheduleLocation) return false;
  const list = (routes || []).filter(route => route?.active !== false);
  if (!list.length) return false;
  if (liveryScheduleRoutesIncludeIcao(list, current)) return false;
  const matchingBases = liveryMatchingBaseIcaosForAircraft(aircraft);
  if (matchingBases.includes(current)) return false;
  return true;
}

function liveryScheduleStuckMessage(icao) {
  return `Літак застряг на тех.обслуговуванні в ${esc(icao || 'XXXX')}. SCHEDULE недоступні. Зверніться до СЕО`;
}

function liveryScheduleStuckCardMessage() {
  return 'Літак застряг на ТО. Зверніться до СЕО';
}

function liverySuggestedRouteText(card, title, flights, latest, headline) {
  const proposal = liverySuggestedRouteData(card, title, flights, latest, headline);
  return typeof proposal === 'string' ? proposal : proposal?.html || '&mdash;';
}

function liverySuggestedRouteData(card, title, flights, latest, headline) {
  if (String(title || '').includes('UR-SFS')) return 'борт віддано в SUB-LEASE';
  const aircraft = companyLiveryAircraftForCard(card, flights, latest, headline);
  const currentIcao = String((latest?.actualArrival || latest?.arrival || liveryCardFallbackAirport(card) || {})?.icao || companyLiveryMatchingIcao(aircraft) || '').trim().toUpperCase();
  const routes = liveryScheduleRoutesForAircraft(aircraft);
  const scheduleIcao = liveryLatestScheduleAirportIcao(flights, aircraft);
  const scheduleCandidates = liveryScheduleCandidateRoutes(routes);
  const activeScheduleRoutes = (routes || []).filter(route => route?.active !== false);
  const hasScheduleRoutes = activeScheduleRoutes.length > 0;
  const routeFromCurrent = liveryChooseScheduleRoute(routes, currentIcao);
  if (scheduleCandidates.length && routeFromCurrent && currentIcao && scheduleIcao && currentIcao === scheduleIcao && routeFromCurrent.dep === currentIcao) {
    return liveryRouteProposalData('schedule', routeFromCurrent.number, currentIcao || routeFromCurrent.dep, routeFromCurrent.arr, {aircraft, aircraftTitle: title});
  }
  if (hasScheduleRoutes) {
    const routeFromSchedule = liveryScheduleRouteFrom(routes, scheduleIcao) || activeScheduleRoutes.find(route => route.dep === scheduleIcao) || null;
    if (scheduleIcao && currentIcao && currentIcao !== scheduleIcao) {
      const hasNearScheduleFromTarget = scheduleCandidates.includes(routeFromSchedule);
      const timing = hasNearScheduleFromTarget ? liveryScheduleTimingLabel(routeFromSchedule) : 'політ на тех.обслуговування / зміна екіпажа';
      const proposal = liveryRangeSafeFreeProposal(currentIcao, scheduleIcao, aircraft, title, {
        reason: hasNearScheduleFromTarget ? 'schedule-positioning' : 'maintenance-positioning',
        badgeClass: hasNearScheduleFromTarget ? 'company-livery-free-schedule' : 'company-livery-free-maintenance',
        title: hasNearScheduleFromTarget ? `FREE flight для подальшого SCHEDULE ${timing}` : timing,
        allowDirectWhenNoInbound: true
      });
      if (proposal) return proposal;
    }
    if (scheduleIcao && currentIcao && currentIcao === scheduleIcao) {
      const tomorrowFromSchedule = activeScheduleRoutes.find(route => route.dep === scheduleIcao && liveryRouteRunsTomorrow(route));
      if (tomorrowFromSchedule) return 'Очікує на SCHEDULE завтра';
      const demandProposal = liveryCharterDemandProposal(currentIcao, aircraft, title);
      if (demandProposal) return demandProposal;
      if (liveryIsScheduleStuck(aircraft, routes, currentIcao)) {
        return `<span class="company-livery-stuck-text">${liveryScheduleStuckCardMessage()}</span>`;
      }
    }
    return null;
  }
  const bases = liveryBaseIcaosForAircraft(aircraft);
  if (bases.includes(currentIcao)) {
    const demandProposal = liveryCharterDemandProposal(currentIcao, aircraft, title);
    if (demandProposal) return demandProposal;
  }
  const targetBase = bases.find(icao => icao !== currentIcao) || bases[0];
  if (targetBase) {
    const proposal = liveryRangeSafeFreeProposal(currentIcao, targetBase, aircraft, title, {
      reason: 'base',
      badgeClass: 'company-livery-free-base',
      title: 'FREE flight на базу'
    });
    if (proposal) return proposal;
  }
  return null;
}

function ensureCompanyLiveryImageWrap(card) {
  if (!card) return null;
  const existing = card.querySelector(':scope > .company-livery-image-wrap');
  if (existing) return existing;
  const image = [...card.children].find(child => child.tagName === 'IMG');
  if (!image) return null;
  const wrap = document.createElement('div');
  wrap.className = 'company-livery-image-wrap';
  image.parentNode.insertBefore(wrap, image);
  wrap.appendChild(image);
  return wrap;
}

function updateCompanyLiveryAircraftStatsBadge(card, flights, cardIndex, aircraftId = '') {
  const wrap = ensureCompanyLiveryImageWrap(card);
  if (!wrap) return;
  let badge = wrap.querySelector('.company-livery-aircraft-stats');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'company-livery-aircraft-stats';
    wrap.appendChild(badge);
  }
  const list = Array.isArray(flights) ? flights : [];
  const minutes = list.reduce((sum, flight) => sum + (Number(flight.times?.durationMinutes) || 0), 0);
  const logAircraftId = aircraftId || String(list[0]?.aircraft?.id || '').trim();
  badge.innerHTML = `<span class="company-livery-stat-flights">${list.length} ${liveryFlightsWord(list.length)}</span><span class="company-livery-stat-time">${formatMinutes(minutes)}</span><span class="company-livery-stat-log">${liveryFlightLogButton(cardIndex, logAircraftId)}</span>`;
}

function companyLiveryCardAircraftIds(card, headline = null) {
  return [
    headline?.id,
    card?.dataset?.aircraftId,
    ...String(card?.dataset?.aircraftIds || '').split(',')
  ].map(item => String(item || '').trim()).filter(Boolean);
}

function companyLiveryCardAircraftIcaos(card, headline = null) {
  const values = [];
  companyLiveryCardAircraftIds(card, headline).forEach(id => {
    const aircraft = companyLiveryAircraftById(id);
    values.push(
      aircraft?.airframeIdent,
      aircraft?.aircraftIdent,
      aircraft?.airframeType,
      aircraft?.icao
    );
  });
  values.push(headline?.airframeIdent, headline?.aircraftIdent, headline?.airframeType, headline?.icao);
  return [...new Set(values.map(item => String(item || '').trim().toUpperCase()).filter(Boolean))];
}

function companyLiveryLiveRecordForCard(card, headline = null) {
  const ids = new Set(companyLiveryCardAircraftIds(card, headline));
  if (!ids.size) return null;
  return guaranteedBonusLiveRecords()
    .map(item => item.record)
    .find(record => ids.has(String(record.aircraftId || record.aircraft || '').trim())) || null;
}

function companyLiveryLiveFlightAircraftId(flight) {
  const candidates = liveAircraftIdCandidates(flight);
  const records = Array.isArray(app.companyLiveryMatching?.liveries) ? app.companyLiveryMatching.liveries : [];
  const matched = candidates.find(id => records.some(item => String(item?._id || item?.aircraftId || '').trim() === id));
  if (matched) return matched;
  const texts = [];
  const collectText = (value, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) texts.push(text.toLowerCase());
      return;
    }
    if (typeof value !== 'object') return;
    Object.entries(value).forEach(([key, child]) => {
      if (depth === 0 || /aircraft|livery|fleet|airframe|registration|name|ident/i.test(key)) {
        collectText(child, depth + 1);
      }
    });
  };
  collectText(flight?.aircraft);
  const textMatched = records.find(item => {
    const id = String(item?._id || item?.aircraftId || '').trim();
    if (!id) return false;
    const reg = String(item?.registration || '').trim().toLowerCase();
    const name = String(item?.name || item?.newskyName || '').trim().toLowerCase();
    return texts.some(text => (reg && text.includes(reg)) || (name && text.includes(name)));
  });
  return String(textMatched?._id || textMatched?.aircraftId || '').trim() || candidates[0] || '';
}

function companyLiveryLiveFlightAircraftIcao(flight) {
  return String(liveAircraftInfo(flight).icao || flight?.aircraft?.airframe?.icao || flight?.aircraft?.airframe?.ident || '').trim().toUpperCase();
}

function companyLiveryLiveRecordFromFlight(flight) {
  if (!flight) return null;
  const dep = liveAirportObject(flight.dep);
  const arr = liveAirportObject(flight.arr);
  const operation = liveFlightOperation(flight);
  return {
    aircraftId: companyLiveryLiveFlightAircraftId(flight),
    depIcao: dep.icao,
    arrIcao: arr.icao,
    flightNumber: String(flight.flightNumber || flight.number || '').trim(),
    operationKey: operation.key,
    operationLabel: operation.label,
    state: 'LIVE',
    source: 'newsky-live'
  };
}

function companyLiveryAnyLiveRecordForCard(card, headline = null) {
  const premiumRecord = companyLiveryLiveRecordForCard(card, headline);
  if (premiumRecord) return premiumRecord;
  const ids = new Set(companyLiveryCardAircraftIds(card, headline));
  const liveFlights = (app.liveNewSkyFlights || [])
    .filter(flight => flight?.depTimeAct);
  let liveFlight = ids.size
    ? liveFlights.find(flight => ids.has(companyLiveryLiveFlightAircraftId(flight)))
    : null;
  if (!liveFlight) {
    const cardIcaos = companyLiveryCardAircraftIcaos(card, headline);
    const allCards = [...document.querySelectorAll('#companyView .company-livery-card')];
    liveFlight = liveFlights.find(flight => {
      const icao = companyLiveryLiveFlightAircraftIcao(flight);
      if (!icao || !cardIcaos.includes(icao)) return false;
      const sameIcaoCards = allCards.filter(item => companyLiveryCardAircraftIcaos(item).includes(icao));
      return sameIcaoCards.length === 1;
    });
  }
  return companyLiveryLiveRecordFromFlight(liveFlight);
}

function companyLiveryLiveRouteText(record) {
  const number = String(record?.flightNumber || record?.number || '').trim();
  const dep = String(record?.depIcao || record?.departureIcao || record?.departure || record?.dep || '').trim().toUpperCase();
  const arr = String(record?.arrIcao || record?.arrivalIcao || record?.arrival || record?.arr || '').trim().toUpperCase();
  const route = dep && arr ? `${esc(dep)} \u2192 ${esc(arr)}` : esc(String(record?.route || '').trim() || 'LIVE');
  return `${companyLiveryLiveNumberBadge(record, number)}${route}`;
}

function companyLiveryLiveNumberBadge(record, number) {
  const label = String(number || '').trim();
  if (!label) return '';
  const isPremium = String(record?.status || '').toLowerCase() === 'matched' || Number(record?.amount) > 0;
  if (!isPremium) {
    const operationKey = String(record?.operationKey || record?.operation || 'free').trim().toLowerCase();
    const key = ['schedule', 'charter', 'free'].includes(operationKey) ? operationKey : 'free';
    const title = esc(String(record?.operationLabel || key).trim());
    return `<span class="flight-number-link flight-number-${key}" title="${title}">${esc(label)}</span> `;
  }
  const kind = String(record?.proposalType || record?.kind || '').toLowerCase() === 'schedule' ? 'schedule' : 'free';
  const reason = String(record?.proposalReason || record?.reason || '').toLowerCase();
  let badgeClass = '';
  let title = '';
  if (kind === 'schedule' || reason === 'schedule') {
    return `${liveryProposalBadge('schedule', label)} `;
  }
  if (reason === 'schedule-positioning') {
    badgeClass = 'company-livery-free-schedule';
    title = 'FREE flight for later SCHEDULE';
  } else if (reason === 'maintenance-positioning') {
    badgeClass = 'company-livery-free-maintenance';
    title = 'FREE flight to maintenance / crew change';
  } else if (reason === 'demand' || reason === 'charter-demand' || reason === 'inbound-demand' || reason === 'range-inbound-demand') {
    badgeClass = 'company-livery-free-demand';
    title = 'FREE flight by NewSky demand';
  } else {
    badgeClass = 'company-livery-free-base';
    title = 'FREE flight to base';
  }
  return `${liveryProposalBadge('free', label, {badgeClass, title})} `;
}

function companyLiveryLiveStatusHtml(record) {
  return `<span class="company-livery-live-dot" aria-hidden="true"></span><span class="company-livery-live-word">LIVE</span> ${companyLiveryLiveRouteText(record)}`;
}

function companyLiveryLivePilotName(record) {
  const id = String(record?.pilotId || record?.pilot || '').trim();
  if (!id) return '';
  const direct = (app.flights || [])
    .map(flight => flight?.pilot)
    .find(pilot => String(pilot?.id || '').trim() === id);
  if (direct?.name) return String(direct.name).trim();
  const aggregated = aggregatePilotFlights(app.flights || [])
    .find(pilot => String(pilot?.id || '').trim() === id);
  return String(aggregated?.name || '').trim();
}

function companyLiveryLivePayoutText(record) {
  const id = String(record?.pilotId || record?.pilot || '').trim();
  const name = companyLiveryLivePilotName(record);
  if (id && name) {
    return `<strong>\u0431\u0443\u0434\u0435 \u0432\u0438\u043F\u043B\u0430\u0447\u0435\u043D\u0430 <a href="${esc(pilotProfileUrl(id))}">${esc(name)}</a></strong>`;
  }
  return `<strong>\u0431\u0443\u0434\u0435 \u0432\u0438\u043F\u043B\u0430\u0447\u0435\u043D\u0430 \u043F\u0456\u043B\u043E\u0442\u0443</strong>`;
}

function updateCompanyLiveryLiveBadge(card, record) {
  const wrap = ensureCompanyLiveryImageWrap(card);
  if (!wrap) return;
  wrap.querySelector('.company-livery-live-badge')?.remove();
  card.classList.toggle('company-livery-live', Boolean(record));
  if (!record) return;
  const badge = document.createElement('div');
  badge.className = 'company-livery-live-badge';
  badge.textContent = 'LIVE';
  wrap.appendChild(badge);
}

function ensureCompanyLiveryLoadingStatus() {
  $$('#companyView .company-livery-card').forEach((card, cardIndex) => {
    if (card.closest('.drylease-section') || card.closest('.waiting-section')) return;
    if (card.querySelector('.company-livery-status')) return;
    const fallbackAirport = liveryCardFallbackAirport(card);
    const currentLine = fallbackAirport
      ? `в ${liveryAirportStatusText(fallbackAirport)} з 08.07`
      : 'локація уточнюється';
    updateCompanyLiveryAircraftStatsBadge(card, [], cardIndex);
    const status = document.createElement('div');
    status.className = 'company-livery-status company-livery-status-loading';
    status.innerHTML = `<div class="company-livery-status-line company-livery-status-location">📌 ${currentLine}</div><div class="company-livery-status-rule"></div><div class="company-livery-status-line company-livery-status-offer">💰 Гарантована премія <span class="positive">$100</span> за рейс:<div class="company-livery-offer-route"><span class="flight-number-link flight-number-free company-livery-proposal-badge">FREE</span> <span class="company-livery-loading-text">----</span> - <span class="company-livery-loading-text">----</span></div></div><div class="company-livery-status-top">ТОП наліт: &mdash;</div>`;
    card.appendChild(status);
  });
}

function ensureDryLeaseTitleLogbook(card, cardIndex) {
  const title = card.querySelector('.company-livery-title');
  if (!title) return;
  title.querySelector('.company-livery-title-logbook')?.remove();
}

function liveryFlightDateShort(flight) {
  return formatFlightDateLabel(flight).replace(/\.(20)?(\d{2})$/, '.$2');
}

function liveryEndDateShort(flight) {
  const end = flightEndDateForDisplay(flight);
  if (!Number.isFinite(end.getTime())) return liveryFlightDateShort(flight);
  return end.toLocaleDateString('uk-UA', {timeZone:'UTC', day:'2-digit', month:'2-digit', year:'2-digit'});
}

function liveryGapDateLabel(newerFlight, olderFlight) {
  const start = flightEndDateForDisplay(olderFlight);
  const end = flightStartDateForDisplay(newerFlight);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return '—';
  const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  if (startDay.getTime() === endDay.getTime()) return startDay.toLocaleDateString('uk-UA', {timeZone:'UTC', day:'2-digit', month:'2-digit', year:'2-digit'});
  return `${startDay.toLocaleDateString('uk-UA', {timeZone:'UTC', day:'2-digit', month:'2-digit', year:'2-digit'})} - ${endDay.toLocaleDateString('uk-UA', {timeZone:'UTC', day:'2-digit', month:'2-digit', year:'2-digit'})}`;
}

function liveryOperationIcon(flight) {
  const operation = flightOperation(flight);
  if (operation.key === 'schedule') return '<span title="Schedule">📅</span>';
  if (operation.key === 'charter') return '<span title="Charter">🧳</span>';
  return '<span title="Free">🛫</span>';
}

function liveryFlightNumberBadge(flight) {
  const operation = flightOperation(flight);
  return `<a class="flight-number-link flight-number-${operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${operation.label}">${esc(flight.flightNumber || '—')}</a>`;
}

function liveryTeleportBadge() {
  return `<span class="flight-number-link flight-number-free" title="Ferry Flight">↔</span>`;
}

function liveryAirportLatLon(airport) {
  const location = airport?.location || airport?.loc || {};
  const lat = Number(location.lat ?? airport?.lat);
  const lon = Number(location.lon ?? location.lng ?? airport?.lon ?? airport?.lng);
  return Number.isFinite(lat) && Number.isFinite(lon) ? {lat, lon} : null;
}

function liveryAirportWithKnownLocation(airport) {
  if (liveryAirportLatLon(airport)) return airport;
  const code = String(airport?.icao || '').toUpperCase();
  if (!code) return airport;
  for (const flight of app.flights || []) {
    for (const candidate of [flight.departure, flight.arrival, flight.actualArrival, flight.dep, flight.arr]) {
      if (String(candidate?.icao || '').toUpperCase() === code && liveryAirportLatLon(candidate)) return candidate;
    }
  }
  return airport;
}

function liveryAirportDistanceKm(from, to) {
  const a = liveryAirportLatLon(liveryAirportWithKnownLocation(from));
  const b = liveryAirportLatLon(liveryAirportWithKnownLocation(to));
  if (!a || !b) return 0;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function liveryTeleportCost(from, to) {
  const distanceKm = Math.round(liveryAirportDistanceKm(from, to));
  return distanceKm > 0 ? {distanceKm, cost: distanceKm} : {distanceKm:0, cost:0};
}

function liveryWetLeaseTransferCost(from, to, baseFlight) {
  const distanceKm = Math.round(liveryAirportDistanceKm(from, to));
  const baseFuelKg = Math.max(0, Number(baseFlight?.operations?.fuel) || 0);
  const baseDistanceKm = Math.max(0, Number(baseFlight?.operations?.distance) || 0) * 1.852;
  if (!distanceKm || !baseFuelKg || !baseDistanceKm) {
    return {distanceKm, fuelCost:0, crewCost:0, total:0};
  }
  const fuelPerKm = baseFuelKg / baseDistanceKm;
  const fuelCost = Math.round(distanceKm * fuelPerKm);
  const crewBaseCost = Math.round((distanceKm / 700) * 2 * 65);
  const crewCost = crewBaseCost + Math.round(fuelCost * 0.01);
  return {distanceKm, fuelCost, crewCost, total:fuelCost + crewCost};
}

function liveryTeleportRow(newerFlight, olderFlight) {
  const from = olderFlight.actualArrival || olderFlight.arrival || {};
  const to = newerFlight.departure || {};
  const fromCode = String(from.icao || '').toUpperCase();
  const toCode = String(to.icao || '').toUpperCase();
  const sameAirport = fromCode && toCode && fromCode === toCode;
  const gapDate = liveryEndDateShort(olderFlight);
  const start = flightEndDateForDisplay(olderFlight);
  const end = flightStartDateForDisplay(newerFlight);
  const sameDay = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    && start.getUTCFullYear() === end.getUTCFullYear()
    && start.getUTCMonth() === end.getUTCMonth()
    && start.getUTCDate() === end.getUTCDate();
  if (sameAirport) {
    return `<tr class="company-livery-log-row company-livery-log-teleport"><td>${esc(gapDate)}<span class="date-flight-meta">${liveryTeleportBadge()}</span></td><td class="route"><span class="route-airports">${liveryAirportWithFlag(to)} → ${liveryAirportWithFlag(to)}</span><span class="route-duration">стоянка</span></td><td colspan="2">Відпочинок екіпажу</td></tr>`;
  }
  const reason = sameDay ? 'Надано у SUB-LEASE для чартерного рейсу' : 'Повернуто лізингодавцю для тех. інспекції';
  return `<tr class="company-livery-log-row company-livery-log-teleport"><td>${esc(gapDate)}<span class="date-flight-meta">${liveryTeleportBadge()}</span></td><td class="route"><span class="route-airports">${liveryAirportWithFlag(from)} → ${liveryAirportWithFlag(to)}</span><span class="route-duration">Ferry Flight</span></td><td colspan="2">${reason}</td></tr>`;
}

function liveryFlightLogRows(flights) {
  const rows = [];
  const selected = flights.slice(0, 6);
  selected.forEach((flight, index) => {
    const rating = flightRatingPresentation(flight);
    rows.push(`<tr class="company-livery-log-row"><td>${liveryFlightDateShort(flight)}<span class="date-flight-meta">${liveryFlightNumberBadge(flight)}</span></td><td class="route"><span class="route-airports">${liveryAirportWithFlag(flight.departure)} → ${liveryAirportWithFlag(flight.actualArrival || flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times?.durationMinutes)}</span></td><td><a href="${esc(pilotProfileUrl(flight.pilot?.id || ''))}">${esc(flight.pilot?.name || 'Pilot')}</a></td><td class="company-livery-log-rating"><span class="rating-badge ${rating.className}">${rating.label}</span></td></tr>`);
    const nextOlder = selected[index + 1];
    if (nextOlder) rows.push(liveryTeleportRow(flight, nextOlder));
  });
  return rows.join('');
}

function openCompanyLiveryFlightLogLegacy(card, titleText, flights) {
  const dialog = $('#liveryInfoDialog');
  const title = $('#liveryInfoTitle');
  const body = $('#liveryInfoBody');
  if (!dialog || !title || !body) return;
  dialog.style.width = '';
  title.textContent = liveryFlightLogHeading(card, titleText, flights);
  if (!flights.length) {
    body.innerHTML = '<div class="company-note">Рейсів цим бортом ще не знайдено.</div>';
  } else {
    body.innerHTML = `<table class="company-livery-log-table"><colgroup><col class="company-livery-log-date"><col class="company-livery-log-route-col"><col class="company-livery-log-pilot"><col class="company-livery-log-rating-col"></colgroup><thead><tr><th>Дата / Рейс</th><th>Маршрут / Тривалість</th><th>Пілот</th><th>Рейтинг</th></tr></thead><tbody>${liveryFlightLogRows(flights)}</tbody></table>`;
  }
  showCompanyLiveryDialog(dialog);
}

function openCompanyLiveryGroupDialog(card) {
  const dialog = $('#liveryInfoDialog');
  const title = $('#liveryInfoTitle');
  const body = $('#liveryInfoBody');
  if (!dialog || !title || !body) return;
  companyLiveryDialogReturn = null;
  const group = liveryGroupAircraft(card);
  dialog.style.width = group.length >= 3 ? 'min(96vw,880px)' : 'min(96vw,660px)';
  const completedFlights = app.flights.filter(flight => flight.status === 'completed');
  title.textContent = liveryCardTitle(card).replace(/\s*\|?\s*$/, '') || 'Група бортів';
  body.innerHTML = `<div class="company-livery-group-grid">${group.map(item => {
    const flights = completedFlights
      .filter(flight => String(flight?.aircraft?.id || '').trim() === item.id)
      .sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a));
    const latest = flights[0];
    const airport = latest ? (latest.actualArrival || latest.arrival || liveryCardFallbackAirport(card)) : liveryCardFallbackAirport(card);
    const latestDate = latest ? flightEndDateForDisplay(latest) : null;
    const latestDateText = latestDate && Number.isFinite(latestDate.getTime())
      ? latestDate.toLocaleDateString('uk-UA', {timeZone:'UTC', day:'2-digit', month:'2-digit'})
      : '—';
    const pilotMinutes = new Map();
    const pilotNames = new Map();
    flights.forEach(flight => {
      const id = String(flight.pilot?.id || flight.pilot?.name || '');
      if (!id) return;
      pilotNames.set(id, flight.pilot?.name || 'Pilot');
      pilotMinutes.set(id, (pilotMinutes.get(id) || 0) + (Number(flight.times?.durationMinutes) || 0));
    });
    const topPilot = [...pilotMinutes.entries()].sort((a,b) => b[1] - a[1])[0];
    const topPilotText = topPilot ? `<a href="${esc(pilotProfileUrl(topPilot[0]))}">${esc(pilotNames.get(topPilot[0]) || 'Pilot')}</a> | ${formatLiveryMinutesCompact(topPilot[1])}` : '—';
    const aircraftLink = `<a class="company-livery-group-reg" href="${esc(newskyAircraftUrl(item.id))}" target="_blank" rel="noopener" title="Відкрити борт у NewSky">${esc(item.title)}</a>`;
    const locationLine = airport ? `в ${liveryAirportStatusText(airport)} з ${esc(latestDateText)}` : 'локація невідома';
    const suggestedProposal = liverySuggestedRouteData(card, item.title, flights, latest, {id:item.id, registration:item.reg});
    const suggestedText = typeof suggestedProposal === 'string' ? suggestedProposal : suggestedProposal?.html || '&mdash;';
    const premiumText = liveryProposalPremiumHtml(suggestedProposal);
    return `<div class="company-livery-group-item"><div class="company-livery-group-title">${aircraftLink}</div><img class="company-livery-group-image" src="${esc(item.image)}" alt="${esc(item.title)}"><div class="company-livery-status"><div class="company-livery-status-line company-livery-status-location">📌 ${locationLine}</div><div class="company-livery-status-rule"></div><div class="company-livery-status-line company-livery-status-offer">💰 Гарантована премія ${premiumText} за рейс:<div class="company-livery-offer-route">${suggestedText}</div></div><div class="company-livery-status-top">ТОП наліт: ${topPilotText}</div></div></div>`;
  }).join('')}</div>`;
  body.querySelectorAll('.company-livery-group-item').forEach((itemElement, index) => {
    const item = group[index];
    if (!item) return;
    const flights = completedFlights
      .filter(flight => String(flight?.aircraft?.id || '').trim() === item.id)
      .sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a));
    const img = itemElement.querySelector('.company-livery-group-image');
    if (!img || img.closest('.company-livery-image-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'company-livery-image-wrap company-livery-group-image-wrap';
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    const minutes = flights.reduce((sum, flight) => sum + (Number(flight.times?.durationMinutes) || 0), 0);
    const badge = document.createElement('div');
    badge.className = 'company-livery-aircraft-stats';
    badge.innerHTML = `<span class="company-livery-stat-flights">${flights.length} ${liveryFlightsWord(flights.length)}</span><span class="company-livery-stat-time">${formatMinutes(minutes)}</span><span class="company-livery-stat-log"><button type="button" class="company-livery-log-button" data-group-log-aircraft-id="${esc(item.id)}" data-group-log-title="${esc(item.reg)}">Журнал</button></span>`;
    wrap.appendChild(badge);
  });
  body.querySelectorAll('[data-group-log-aircraft-id]').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const aircraftId = button.dataset.groupLogAircraftId;
      const flights = completedFlights
        .filter(flight => String(flight?.aircraft?.id || '').trim() === aircraftId)
        .sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a));
      openCompanyLiveryFlightLog(card, button.dataset.groupLogTitle || liveryCardTitle(card), flights);
      companyLiveryDialogReturn = () => openCompanyLiveryGroupDialog(card);
    });
  });
  showCompanyLiveryDialog(dialog);
}

function liveryTeleportRowCompact(newerFlight, olderFlight) {
  const from = olderFlight.actualArrival || olderFlight.arrival || {};
  const to = newerFlight.departure || {};
  const fromCode = String(from.icao || '').toUpperCase();
  const toCode = String(to.icao || '').toUpperCase();
  const sameAirport = fromCode && toCode && fromCode === toCode;
  const start = flightEndDateForDisplay(olderFlight);
  const end = flightStartDateForDisplay(newerFlight);
  const startDay = Number.isFinite(start.getTime()) ? Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) : NaN;
  const endDay = Number.isFinite(end.getTime()) ? Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) : NaN;
  const gapDays = Number.isFinite(startDay) && Number.isFinite(endDay) ? Math.round((endDay - startDay) / 86400000) : 0;
  if (sameAirport) return '';
  if (!options.wetLease && gapDays <= 1) return '';
  const gapDate = liveryEndDateShort(olderFlight);
  const sameDay = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    && start.getUTCFullYear() === end.getUTCFullYear()
    && start.getUTCMonth() === end.getUTCMonth()
    && start.getUTCDate() === end.getUTCDate();
  const reason = sameDay ? 'Надано у SUB-LEASE для чартерного рейсу' : 'Повернуто лізингодавцю для тех. інспекції';
  return `<tr class="company-livery-log-row company-livery-log-teleport"><td>${esc(gapDate)}<span class="date-flight-meta">${liveryTeleportBadge()}</span></td><td>${reason}</td><td class="route"><span class="route-airports">${liveryAirportWithFlag(from)} → ${liveryAirportWithFlag(to)}</span><span class="route-duration">Ferry Flight</span></td><td class="company-livery-log-rating"></td></tr>`;
}

function liveryFlightLogRowsCompact(flights) {
  const rows = [];
  const selected = flights.slice(0, 6);
  selected.forEach((flight, index) => {
    const rating = flightRatingPresentation(flight);
    rows.push(`<tr class="company-livery-log-row"><td>${liveryFlightDateShort(flight)}<span class="date-flight-meta">${liveryFlightNumberBadge(flight)}</span></td><td><a href="${esc(pilotProfileUrl(flight.pilot?.id || ''))}">${esc(flight.pilot?.name || 'Pilot')}</a></td><td class="route"><span class="route-airports">${liveryAirportWithFlag(flight.departure)} → ${liveryAirportWithFlag(flight.actualArrival || flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times?.durationMinutes)}</span></td><td class="company-livery-log-rating"><span class="rating-badge ${rating.className}">${rating.label}</span></td></tr>`);
    const nextOlder = selected[index + 1];
    if (nextOlder) {
      const teleportRow = liveryTeleportRowCompact(flight, nextOlder);
      if (teleportRow) rows.push(teleportRow);
    }
  });
  return rows.join('');
}

function liveryTeleportRowCompactV2(newerFlight, olderFlight, options = {}) {
  if (!options.wetLease) return '';
  const from = olderFlight.actualArrival || olderFlight.arrival || {};
  const to = newerFlight.departure || {};
  const fromCode = String(from.icao || '').toUpperCase();
  const toCode = String(to.icao || '').toUpperCase();
  const sameAirport = fromCode && toCode && fromCode === toCode;
  const start = flightEndDateForDisplay(olderFlight);
  const end = flightStartDateForDisplay(newerFlight);
  const startDay = Number.isFinite(start.getTime()) ? Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) : NaN;
  const endDay = Number.isFinite(end.getTime()) ? Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) : NaN;
  const gapDays = Number.isFinite(startDay) && Number.isFinite(endDay) ? Math.round((endDay - startDay) / 86400000) : 0;
  if (sameAirport) return '';
  const gapDate = liveryEndDateShort(olderFlight);
  const idleDays = Math.max(0, gapDays - 1);
  const sameDay = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
    && start.getUTCFullYear() === end.getUTCFullYear()
    && start.getUTCMonth() === end.getUTCMonth()
    && start.getUTCDate() === end.getUTCDate();
  const isLongWetLeaseGap = options.wetLease && idleDays >= 6;
  const serviceLabel = options.wetLease
    ? (isLongWetLeaseGap ? 'MAINTENANCE' : (idleDays >= 3 ? 'Technical Flight' : 'Ferry Flight'))
    : 'Політ іншим суб-орендатором';
  let transferCost = '';
  if (options.wetLease && !isLongWetLeaseGap) {
    const transfer = liveryWetLeaseTransferCost(from, to, olderFlight);
    if (transfer.total) {
      const title = `Придбано палива: ${money(transfer.fuelCost)} (дистанція ${transfer.distanceKm.toLocaleString('uk-UA')} км)\nЗалучення стороннього екіпажу: ${money(transfer.crewCost)}`;
      transferCost = `<span title="${esc(title)}">${money(-transfer.total,true)}</span>`;
    }
  }
  const routeText = isLongWetLeaseGap ? '<span class="company-livery-owner-note">Передано власнику</span>' : `<span class="route-airports">${liveryAirportWithFlag(from)} → ${liveryAirportWithFlag(to)}</span>`;
  return `<tr class="company-livery-log-row company-livery-log-teleport"><td>${esc(gapDate)}<span class="date-flight-meta">${liveryTeleportBadge()}</span></td><td class="company-livery-log-service">${serviceLabel}</td><td class="route company-livery-log-service">${routeText}</td><td class="company-livery-log-duration"></td><td class="company-livery-log-rating"></td><td class="company-livery-log-money company-livery-log-ferry-cost">${transferCost}</td><td class="company-livery-log-money"></td></tr>`;
}

function liveryFlightLogRowsCompactV2(flights, options = {}) {
  const rows = [];
  const selected = flights.slice(0, 6);
  selected.forEach((flight, index) => {
    const rating = flightRatingPresentation(flight);
    const direct = directFlightFinance(flight);
    const profitClass = direct.companyProfit > 0 ? 'positive' : direct.companyProfit < 0 ? 'negative' : '';
    const salaryClass = direct.pilotSalary > 0 ? 'positive' : direct.pilotSalary < 0 ? 'negative' : '';
    rows.push(`<tr class="company-livery-log-row"><td>${liveryFlightDateShort(flight)}<span class="date-flight-meta">${liveryFlightNumberBadge(flight)}</span></td><td><a href="${esc(pilotProfileUrl(flight.pilot?.id || ''))}">${esc(flight.pilot?.name || 'Pilot')}</a></td><td class="route"><span class="route-airports">${liveryAirportWithFlag(flight.departure)} → ${liveryAirportWithFlag(flight.actualArrival || flight.arrival)}</span></td><td class="company-livery-log-duration">${formatMinutes(flight.times?.durationMinutes)}</td><td class="company-livery-log-rating"><span class="rating-badge ${rating.className}">${rating.label}</span></td><td class="company-livery-log-money ${profitClass}">${money(direct.companyProfit,true)}</td><td class="company-livery-log-money ${salaryClass}">${money(direct.pilotSalary,true)}</td></tr>`);
    const nextOlder = selected[index + 1];
    if (nextOlder) {
      const teleportRow = liveryTeleportRowCompactV2(flight, nextOlder, options);
      if (teleportRow) rows.push(teleportRow);
    }
  });
  return rows.join('');
}

function liveryFlightLogPeriodBounds(period, customDate = '', customEndDate = '') {
  const now = app.referenceNow || new Date();
  if (period === 'all') return {start:null, end:null};
  let start;
  let end = now;
  if (period === 'customRange' && customDate && customEndDate) {
    const first = new Date(`${customDate}T00:00:00Z`);
    const second = new Date(`${customEndDate}T00:00:00Z`);
    start = first <= second ? first : second;
    const last = first <= second ? second : first;
    end = new Date(last.getTime() + 86400000);
  } else if (period === 'custom' && customDate) {
    start = new Date(`${customDate}T00:00:00Z`);
    end = new Date(start.getTime() + 86400000);
  } else if (period === 'sinceRestructure') {
    start = new Date('2026-05-01T00:00:00Z');
  } else if (period === 'today') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else if (period === 'weekToDate' || period === 'previousWeek') {
    const weekday = (now.getUTCDay() + 6) % 7;
    const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - weekday));
    if (period === 'weekToDate') start = thisMonday;
    else {
      start = new Date(thisMonday.getTime() - 7 * 86400000);
      end = thisMonday;
    }
  } else if (period === 'monthToDate') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else if (period === 'previousMonth') {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  return {start, end};
}

function liveryFlightLogFilterPeriod(flights, period, customDate = '', customEndDate = '') {
  const {start, end} = liveryFlightLogPeriodBounds(period, customDate, customEndDate);
  return flights
    .filter(flight => flight.status === 'completed')
    .filter(flight => {
      if (!start || !end) return true;
      const date = dateOf(flight);
      return date >= start && date < end;
    })
    .slice()
    .sort((a, b) => dateOf(b) - dateOf(a));
}

function liveryFlightLogRowsSimple(flights) {
  return flights.map(flight => {
    const rating = flightRatingPresentation(flight);
    const direct = directFlightFinance(flight);
    const profitClass = direct.companyProfit > 0 ? 'positive' : direct.companyProfit < 0 ? 'negative' : '';
    const salaryClass = direct.pilotSalary > 0 ? 'positive' : direct.pilotSalary < 0 ? 'negative' : '';
    return `<tr class="company-livery-log-row"><td>${liveryFlightDateShort(flight)}<span class="date-flight-meta">${liveryFlightNumberBadge(flight)}</span></td><td><a href="${esc(pilotProfileUrl(flight.pilot?.id || ''))}">${esc(flight.pilot?.name || 'Pilot')}</a></td><td class="route"><span class="route-airports">${liveryAirportWithFlag(flight.departure)} → ${liveryAirportWithFlag(flight.actualArrival || flight.arrival)}</span></td><td class="company-livery-log-duration">${formatMinutes(flight.times?.durationMinutes)}</td><td class="company-livery-log-rating"><span class="rating-badge ${rating.className}">${rating.label}</span></td><td class="company-livery-log-money ${profitClass}">${money(direct.companyProfit,true)}</td><td class="company-livery-log-money ${salaryClass}">${money(direct.pilotSalary,true)}</td></tr>`;
  }).join('');
}

function liveryFlightLogDefaultPeriod(flights) {
  const order = ['weekToDate','previousWeek','monthToDate','previousMonth','today','all'];
  return order.find(period => liveryFlightLogFilterPeriod(flights, period).length) || 'weekToDate';
}

function liveryFlightLogPilotOptions(flights, selectedPilotId = '') {
  const pilots = new Map();
  flights.forEach(flight => {
    const id = flight.pilot?.id || '';
    if (!id) return;
    const entry = pilots.get(id) || {id, name:flight.pilot?.name || 'Pilot', minutes:0};
    entry.minutes += Number(flight.times?.durationMinutes) || 0;
    pilots.set(id, entry);
  });
  const options = [...pilots.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'uk'));
  return `<select class="company-livery-log-pilot-filter" data-livery-log-pilot><option value="">Усі пілоти</option>${options.map(pilot => `<option value="${esc(pilot.id)}" ${pilot.id===selectedPilotId?'selected':''}>${esc(pilot.name)} · ${esc(formatLiveryMinutesCompact(pilot.minutes))}</option>`).join('')}</select>`;
}

function liveryFlightLogFormatDateShort(value) {
  if (!value) return '';
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${day}.${month}.${String(year).slice(2)}` : '';
}

function liveryFlightLogDateLabel(customDate = '', customEndDate = '') {
  if (customDate && customEndDate && customDate !== customEndDate) return `${liveryFlightLogFormatDateShort(customDate)}-${liveryFlightLogFormatDateShort(customEndDate)}`;
  return liveryFlightLogFormatDateShort(customDate);
}

function liveryFlightLogDateLabelHtml(customDate = '', customEndDate = '') {
  if (customDate && customEndDate && customDate !== customEndDate) {
    return `<span>${esc(liveryFlightLogFormatDateShort(customDate))}</span><span>${esc(liveryFlightLogFormatDateShort(customEndDate))}</span>`;
  }
  return esc(liveryFlightLogFormatDateShort(customDate));
}

function liveryFlightLogPeriodControls(activePeriod, customDate = '', customEndDate = '', calendarOpen = false, calendarMode = 'date') {
  const buttons = [
    ['today','За сьогодні (з 00:00 UTC)'],
    ['weekToDate','З початку тижня'],
    ['previousWeek','Минулий тиждень'],
    ['monthToDate','З початку місяця'],
    ['previousMonth','Минулий місяць'],
    ['all','Весь період']
  ];
  const dateLabel = liveryFlightLogDateLabel(customDate, customEndDate);
  const panel = calendarOpen ? `<div class="company-livery-log-calendar-panel">
    <div class="company-livery-log-calendar-modes"><button type="button" data-livery-log-calendar-mode="date" class="${calendarMode==='date'?'active':''}">За дату</button><button type="button" data-livery-log-calendar-mode="range" class="${calendarMode==='range'?'active':''}">За період</button></div>
    <div class="company-livery-log-calendar-fields ${calendarMode === 'range' ? 'range' : ''}">
      ${calendarMode === 'range'
        ? `<input type="date" data-livery-log-date value="${esc(customDate || '')}" title="Вибрати початкову дату"><input type="text" data-livery-log-date-end-display value="${esc(liveryFlightLogFormatDateShort(customEndDate))}" readonly title="Вибрати кінцеву дату">`
        : `<input type="date" data-livery-log-date value="${esc(customDate || '')}">`}
    </div>
  </div>` : '';
  return `<section class="bar company-livery-log-period-bar"><div class="periods">${buttons.map(([key,label]) => `<button type="button" data-livery-log-period="${key}" class="${activePeriod===key?'active':''}">${label}</button>`).join('')}<span class="company-livery-log-calendar-wrap"><button type="button" class="company-livery-log-date-pick ${calendarOpen?'active':''}" data-livery-log-calendar title="Вибрати дату або період">📅${dateLabel && !calendarOpen ? `<span class="company-livery-log-date-label">${liveryFlightLogDateLabelHtml(customDate, customEndDate)}</span>` : ''}</button>${panel}</span></div></section>`;
}

function liveryFlightLogTableHtml(periodFlights, selectedPilotId = '') {
  const visibleFlights = selectedPilotId ? periodFlights.filter(flight => flight.pilot?.id === selectedPilotId) : periodFlights;
  const rows = visibleFlights.length
    ? liveryFlightLogRowsSimple(visibleFlights)
    : '<tr><td colspan="7" class="loading">За вибраний період завершених рейсів немає</td></tr>';
  return `<div class="company-livery-log-scroll"><table class="company-livery-log-table"><colgroup><col class="company-livery-log-date"><col class="company-livery-log-pilot"><col class="company-livery-log-route-col"><col class="company-livery-log-duration-col"><col class="company-livery-log-rating-col"><col class="company-livery-log-profit-col"><col class="company-livery-log-salary-col"></colgroup><thead><tr><th>Дата / Рейс</th><th>${liveryFlightLogPilotOptions(periodFlights, selectedPilotId)}</th><th>Маршрут</th><th>Тривалість</th><th>Рейтинг</th><th>Прибуток Авіакомпанії</th><th>Зарплата пілота</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function openCompanyLiveryFlightLog(card, titleText, flights) {
  const dialog = $('#liveryInfoDialog');
  const title = $('#liveryInfoTitle');
  const body = $('#liveryInfoBody');
  if (!dialog || !title || !body) return;
  dialog.classList.remove('company-route-map-dialog');
  dialog.style.width = 'min(96vw,900px)';
  title.textContent = liveryFlightLogHeading(card, titleText, flights);
  let logPeriod = liveryFlightLogDefaultPeriod(flights);
  let logCustomDate = '';
  let logCustomEndDate = '';
  let logCalendarOpen = false;
  let logCalendarMode = 'date';
  let logCalendarAutoPick = '';
  let logCalendarRangePickingEnd = false;
  let logCalendarPickerValue = '';
  let logPilotId = '';
  const renderLog = () => {
    try {
      const selected = liveryFlightLogFilterPeriod(flights, logPeriod, logCustomDate, logCustomEndDate);
      if (logPilotId && !selected.some(flight => flight.pilot?.id === logPilotId)) logPilotId = '';
      const pickerStartValue = logCalendarMode === 'range' && logCalendarRangePickingEnd ? (logCalendarPickerValue || logCustomDate) : logCustomDate;
      body.innerHTML = `${liveryFlightLogPeriodControls(logPeriod, pickerStartValue, logCustomEndDate, logCalendarOpen, logCalendarMode)}${liveryFlightLogTableHtml(selected, logPilotId)}`;
      if (logCalendarAutoPick) {
        const target = logCalendarAutoPick;
        logCalendarAutoPick = '';
        setTimeout(() => {
          const input = body.querySelector(target === 'end' ? '[data-livery-log-date-end]' : '[data-livery-log-date]');
          if (!input) return;
          input.focus({preventScroll:true});
          if (typeof input.showPicker === 'function') input.showPicker();
        }, 0);
      }
      body.querySelectorAll('a[href^="pilot-cabinet.html#profile/"]').forEach(link => {
        link.addEventListener('click', () => {
          if (dialog.open) dialog.close();
        });
      });
      body.querySelectorAll('[data-livery-log-period]').forEach(button => {
        button.addEventListener('click', () => {
          logPeriod = button.dataset.liveryLogPeriod || 'weekToDate';
          logCalendarRangePickingEnd = false;
          logCalendarPickerValue = '';
          if (logPeriod !== 'custom' && logPeriod !== 'customRange') {
            logCustomDate = '';
            logCustomEndDate = '';
            logCalendarOpen = false;
          }
          renderLog();
        });
      });
      const calendarButton = body.querySelector('[data-livery-log-calendar]');
      if (calendarButton) {
        calendarButton.addEventListener('click', event => {
          event.preventDefault();
          logCalendarOpen = !logCalendarOpen;
          if (logCalendarOpen) {
            logCalendarRangePickingEnd = false;
            logCalendarPickerValue = '';
            logCalendarAutoPick = 'start';
          }
          renderLog();
        });
      }
      body.querySelectorAll('[data-livery-log-calendar-mode]').forEach(button => {
        button.addEventListener('click', event => {
          event.preventDefault();
          logCalendarMode = button.dataset.liveryLogCalendarMode || 'date';
          logCalendarRangePickingEnd = false;
          logCalendarPickerValue = '';
          logCalendarAutoPick = 'start';
          renderLog();
        });
      });
      const dateInput = body.querySelector('[data-livery-log-date]');
      if (dateInput) {
        dateInput.addEventListener('click', () => {
          if (logCalendarMode === 'range') logCalendarRangePickingEnd = false;
        });
        dateInput.addEventListener('change', event => {
          if (!event.target.value) return;
          if (logCalendarMode === 'range' && logCalendarRangePickingEnd) {
            logCustomEndDate = event.target.value;
            logPeriod = logCustomDate === logCustomEndDate ? 'custom' : 'customRange';
            logCalendarOpen = false;
            logCalendarRangePickingEnd = false;
            logCalendarPickerValue = '';
            renderLog();
            return;
          }
          logCustomDate = event.target.value;
          if (logCalendarMode === 'date') {
            logPeriod = 'custom';
            logCustomEndDate = '';
            logCalendarOpen = false;
          } else if (logCustomEndDate) {
            logPeriod = logCustomDate === logCustomEndDate ? 'custom' : 'customRange';
          } else {
            logCalendarOpen = true;
            logCalendarRangePickingEnd = true;
            logCalendarPickerValue = '';
            logCalendarAutoPick = 'start';
          }
          renderLog();
        });
      }
      const dateEndDisplay = body.querySelector('[data-livery-log-date-end-display]');
      if (dateEndDisplay && dateInput) {
        dateEndDisplay.addEventListener('click', event => {
          event.preventDefault();
          logCalendarRangePickingEnd = true;
          logCalendarPickerValue = logCustomEndDate || logCustomDate || '';
          dateInput.focus({preventScroll:true});
          if (typeof dateInput.showPicker === 'function') dateInput.showPicker();
        });
      }
      const dateEndInput = body.querySelector('[data-livery-log-date-end]');
      if (dateEndInput) {
        dateEndInput.addEventListener('change', event => {
          if (!event.target.value) return;
          if (!logCustomDate) logCustomDate = event.target.value;
          logCustomEndDate = event.target.value;
          logPeriod = logCustomDate === logCustomEndDate ? 'custom' : 'customRange';
          logCalendarOpen = false;
          renderLog();
        });
      }
      const pilotSelect = body.querySelector('[data-livery-log-pilot]');
      if (pilotSelect) {
        pilotSelect.addEventListener('change', event => {
          logPilotId = event.target.value || '';
          renderLog();
        });
      }
    } catch (error) {
      console.error('Logbook render failed', error);
      body.innerHTML = `<div class="company-note">Не вдалося відкрити Logbook: ${esc(error?.message || error)}</div>`;
    }
  };
  renderLog();
  showCompanyLiveryDialog(dialog);
}

function updateCompanyLiveryStatus() {
  const completedFlights = app.flights.filter(flight => flight.status === 'completed');
  $$('.company-livery-card').forEach((card, cardIndex) => {
    const title = liveryCardTitle(card);
    const matcher = liveryMatcherForCard(card, title);
    const old = card.querySelector('.company-livery-status');
    if (old) old.remove();
    const status = document.createElement('div');
    status.className = 'company-livery-status';
    updateCompanyLiveryLiveBadge(card, null);
    const isDryLeaseCard = Boolean(card.closest('.drylease-section'));
    const isWaitingCard = Boolean(card.closest('.waiting-section'));
    if (isDryLeaseCard || isWaitingCard) {
      if (isDryLeaseCard || card.dataset.waitingLogbook === '1') ensureDryLeaseTitleLogbook(card, cardIndex);
      card.dataset.liveryHours = '0';
      let dryFlights = [];
      if (matcher) {
        dryFlights = completedFlights.filter(matcher);
        card.dataset.liveryHours = String(dryFlights.reduce((sum, flight) => sum + (Number(flight.times?.durationMinutes) || 0), 0));
      }
      updateCompanyLiveryAircraftStatsBadge(card, dryFlights, cardIndex);
      if (isDryLeaseCard) updateCompanyLiveryLiveBadge(card, companyLiveryAnyLiveRecordForCard(card));
      return;
    }
    if (!matcher) {
      card.dataset.liveryHours = '0';
      updateCompanyLiveryAircraftStatsBadge(card, [], cardIndex);
      status.innerHTML = '<div class="muted">Дані по борту ще не привʼязані</div>';
      card.appendChild(status);
      return;
    }
    const groupedFlights = completedFlights.filter(matcher).sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a));
    const headline = liveryHeadlineForCard(card, completedFlights, groupedFlights);
    const displayRegistration = headline.registration || liveryRegistrationFromTitle(title);
    const flights = headline.flights || groupedFlights;
    const premiumLiveRecord = companyLiveryLiveRecordForCard(card, headline);
    const anyLiveRecord = companyLiveryAnyLiveRecordForCard(card, headline);
    updateCompanyLiveryLiveBadge(card, anyLiveRecord);
    card.dataset.liveryHours = String(groupedFlights.reduce((sum, flight) => sum + (Number(flight.times?.durationMinutes) || 0), 0));
    updateCompanyLiveryAircraftStatsBadge(card, flights, cardIndex, headline.id || '');
    const latest = flights[0];
    const fallbackAirport = liveryCardFallbackAirport(card);
    if (!latest) {
      card.dataset.liveryHours = '0';
      const headlinePrefix = displayRegistration ? `${esc(displayRegistration)} ` : '';
      const fallbackAircraft = companyLiveryAircraftForCard(card, flights, null, headline);
      const matchingCurrentIcao = companyLiveryMatchingIcao(fallbackAircraft);
      const matchingAirport = matchingCurrentIcao ? liveryAirportObjectByIcao(matchingCurrentIcao) : null;
      const currentLine = (fallbackAirport || matchingAirport)
        ? `${headlinePrefix}в ${liveryAirportStatusText(fallbackAirport || matchingAirport)}`
        : 'локація уточнюється';
      const suggestedProposal = liverySuggestedRouteData(card, title, flights, null, headline);
      const suggestedText = typeof suggestedProposal === 'string' ? suggestedProposal : suggestedProposal?.html || '&mdash;';
      const offerText = premiumLiveRecord ? companyLiveryLivePayoutText(premiumLiveRecord) : suggestedText;
      const premiumText = isDryLeaseCard ? '&mdash;' : liveryProposalPremiumHtml(suggestedProposal);
      const offerMutedClass = anyLiveRecord && !premiumLiveRecord ? ' company-livery-status-offer-muted' : '';
      const locationLine = anyLiveRecord
        ? `<div class="company-livery-status-line company-livery-status-location company-livery-status-live">${companyLiveryLiveStatusHtml(anyLiveRecord)}</div>`
        : `<div class="company-livery-status-line company-livery-status-location">\u{1F4CC} ${currentLine}</div>`;
      status.innerHTML = `${locationLine}<div class="company-livery-status-rule"></div><div class="company-livery-status-line company-livery-status-offer${offerMutedClass}">\u{1F4B0} \u0413\u0430\u0440\u0430\u043D\u0442\u043E\u0432\u0430\u043D\u0430 \u043F\u0440\u0435\u043C\u0456\u044F ${premiumText} \u0437\u0430 \u0440\u0435\u0439\u0441:<div class="company-livery-offer-route">${offerText}</div></div><div class="company-livery-status-top">\u0422\u041E\u041F \u043D\u0430\u043B\u0456\u0442: &mdash;</div>`;
      const logButton = status.querySelector('[data-livery-log-index]');
      if (logButton) {
        logButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          openCompanyLiveryFlightLog(card, title, flights);
        });
      }
      card.appendChild(status);
      return;
    }
    const airport = latest.actualArrival || latest.arrival || {};
    const latestDate = flightEndDateForDisplay(latest);
    const latestDateText = Number.isFinite(latestDate.getTime())
      ? latestDate.toLocaleDateString('uk-UA', {timeZone:'UTC', day:'2-digit', month:'2-digit'})
      : '—';
    const pilotMinutes = new Map();
    const pilotNames = new Map();
    flights.forEach(flight => {
      const id = String(flight.pilot?.id || flight.pilot?.name || '');
      if (!id) return;
      pilotNames.set(id, flight.pilot?.name || 'Pilot');
      pilotMinutes.set(id, (pilotMinutes.get(id) || 0) + (Number(flight.times?.durationMinutes) || 0));
    });
    const topPilot = [...pilotMinutes.entries()].sort((a,b) => b[1] - a[1])[0];
    const topPilotText = topPilot ? `<a href="${esc(pilotProfileUrl(topPilot[0]))}">${esc(pilotNames.get(topPilot[0]) || 'Pilot')}</a> | ${formatLiveryMinutesCompact(topPilot[1])}` : '—';
    const isInactiveSubleaseOnly = String(title || '').includes('UR-SFS');
    const suggestedProposal = liverySuggestedRouteData(card, title, flights, latest, headline);
    const suggestedText = typeof suggestedProposal === 'string' ? suggestedProposal : suggestedProposal?.html || '&mdash;';
    const offerText = premiumLiveRecord ? companyLiveryLivePayoutText(premiumLiveRecord) : suggestedText;
    const premiumText = (isInactiveSubleaseOnly || isDryLeaseCard) ? '&mdash;' : liveryProposalPremiumHtml(suggestedProposal);
    const offerMutedClass = anyLiveRecord && !premiumLiveRecord ? ' company-livery-status-offer-muted' : '';
    const headlinePrefix = displayRegistration ? `${esc(displayRegistration)} ` : '';
    const locationLine = anyLiveRecord
      ? `<div class="company-livery-status-line company-livery-status-location company-livery-status-live">${companyLiveryLiveStatusHtml(anyLiveRecord)}</div>`
      : `<div class="company-livery-status-line company-livery-status-location">\u{1F4CC} ${headlinePrefix}\u0432 ${liveryAirportStatusText(airport)} \u0437 ${latestDateText}</div>`;
    status.innerHTML = `${locationLine}<div class="company-livery-status-rule"></div><div class="company-livery-status-line company-livery-status-offer${offerMutedClass}">\u{1F4B0} \u0413\u0430\u0440\u0430\u043D\u0442\u043E\u0432\u0430\u043D\u0430 \u043F\u0440\u0435\u043C\u0456\u044F ${premiumText} \u0437\u0430 \u0440\u0435\u0439\u0441:<div class="company-livery-offer-route">${offerText}</div></div><div class="company-livery-status-top">\u0422\u041E\u041F \u043D\u0430\u043B\u0456\u0442: ${topPilotText}</div>`;
    const logButton = status.querySelector('[data-livery-log-index]');
    if (logButton) {
      logButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openCompanyLiveryFlightLog(card, title, flights);
      });
    }
    card.appendChild(status);
  });
  applyCompanyLiverySortModes();
}

const COMPANY_ROUTE_MAP_DAYS = [
  ['mon', 'Пн'], ['tue', 'Вт'], ['wed', 'Ср'], ['thu', 'Чт'], ['fri', 'Пт'], ['sat', 'Сб'], ['sun', 'Нд']
];

function liveryRouteMapRouteRuns(route, mode) {
  if (!route) return false;
  if (mode === 'all') return true;
  if (mode === 'today') return liveryRouteRunsToday(route);
  return route?.[mode] === true || (Array.isArray(route?.days) && route.days.includes(mode));
}

function liveryRouteMapAirport(icao) {
  const code = String(icao || '').trim().toUpperCase();
  if (!code) return null;
  return liveryAirportWithKnownLocation(liveryAirportObjectByIcao(code) || {icao: code, name: code});
}

function liveryRouteMapAirportPoint(icao) {
  const airport = liveryRouteMapAirport(icao);
  const point = liveryAirportLatLon(airport);
  return point ? {...point, airport, icao: String(airport?.icao || icao || '').trim().toUpperCase()} : null;
}

function liveryRouteMapAirportTitle(airport) {
  const code = String(airport?.icao || '').trim().toUpperCase();
  return String(airport?.name || airport?.city || code || 'Аеропорт');
}

function liveryRouteMapContext(card) {
  const title = liveryCardTitle(card);
  const matcher = liveryMatcherForCard(card, title);
  const completedFlights = (app.flights || []).filter(flight => flight.status === 'completed');
  const groupedFlights = matcher
    ? completedFlights.filter(matcher).sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a))
    : [];
  const headline = liveryHeadlineForCard(card, completedFlights, groupedFlights);
  const flights = headline.flights || groupedFlights;
  const latest = flights[0] || null;
  const aircraft = companyLiveryAircraftForCard(card, flights, latest, headline);
  const fullTitle = newskyAircraftName(aircraft?.id) || companyLiveryMatchingNameByAircraftId(aircraft?.id) || title;
  const matchingCurrentIcao = companyLiveryMatchingIcao(aircraft);
  const currentAirport = latest
    ? (latest.actualArrival || latest.arrival || liveryCardFallbackAirport(card) || liveryAirportObjectByIcao(matchingCurrentIcao))
    : liveryCardFallbackAirport(card) || liveryAirportObjectByIcao(matchingCurrentIcao || aircraft?.locationIcao);
  const proposal = liverySuggestedRouteData(card, title, flights, latest, headline);
  const proposalHtml = typeof proposal === 'string'
    ? proposal
    : card.querySelector('.company-livery-status-offer')?.innerHTML || proposal?.html || '&mdash;';
  const scheduleRoutes = liveryScheduleRoutesForAircraft(aircraft);
  const scheduleBaseIcao = companyLiveryMatchingIcao(aircraft, ['locationIcao']);
  const proposalTargetIcao = typeof proposal === 'object' ? String(proposal?.destination || '').trim().toUpperCase() : '';
  const currentIcao = String(currentAirport?.icao || matchingCurrentIcao || '').trim().toUpperCase();
  const isScheduleStuck = liveryIsScheduleStuck(aircraft, scheduleRoutes, currentIcao);
  return {
    title,
    fullTitle,
    aircraft,
    currentAirport: liveryAirportWithKnownLocation(currentAirport),
    scheduleBaseIcao,
    routes: scheduleRoutes,
    isScheduleStuck,
    stuckIcao: currentIcao,
    proposal: typeof proposal === 'object' ? proposal : null,
    proposalHtml
  };
}

function openCompanyLiveryRouteMap(card) {
  const dialog = $('#liveryInfoDialog');
  const titleNode = $('#liveryInfoTitle');
  const body = $('#liveryInfoBody');
  if (!dialog || !titleNode || !body) return;
  const context = liveryRouteMapContext(card);
  dialog.classList.add('company-route-map-dialog');
  dialog.style.width = 'min(96vw,980px)';
  titleNode.textContent = `\u041a\u0430\u0440\u0442\u0430 \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u0456\u0432 - ${context.fullTitle || context.title || '\u043b\u0456\u0442\u0430\u043a'}`;
  const proposalButtonHtml = context.proposalHtml || '&mdash;';
  const hasScheduleRoutes = (context.routes || []).some(route => route?.active !== false);
  const routeFilterState = mode => {
    const count = (context.routes || []).filter(route => liveryRouteMapRouteRuns(route, mode)).length;
    return {count, disabled: count ? '' : ' disabled title="\u0440\u0435\u0439\u0441\u0438 \u0432\u0456\u0434\u0441\u0443\u0442\u043d\u0456"'};
  };
  const todayFilter = routeFilterState('today');
  const allFilter = routeFilterState('all');
  const dayButtonsHtml = COMPANY_ROUTE_MAP_DAYS.map(([key, label]) => {
    const state = routeFilterState(key);
    return `<button type="button" data-route-filter="${key}"${state.disabled}>${label}</button>`;
  }).join('');
  body.innerHTML = `
    <div class="company-route-map-shell">
      <div id="companyRouteMap" class="company-route-map"></div>
      ${context.isScheduleStuck ? `<div class="company-route-map-warning">${liveryScheduleStuckMessage(context.stuckIcao)}</div>` : ''}
      <div class="company-route-map-filter">
        <button type="button" class="company-route-proposal-button active" data-route-filter="proposal"><span class="company-route-proposal-button-inner">${proposalButtonHtml}</span></button>
        <div class="company-route-schedule-box">
          ${hasScheduleRoutes ? `<div class="company-route-map-filter-main">
            <span class="flight-number-link flight-number-schedule company-route-schedule-badge">SCHEDULE</span>
            <button type="button" data-route-filter="today"${todayFilter.disabled}>\u0441\u044c\u043e\u0433\u043e\u0434\u043d\u0456</button>
            <button type="button" data-route-filter="all"${allFilter.disabled}>\u0432\u0441\u0456 \u0440\u0435\u0439\u0441\u0438</button>
          </div>
          <div class="company-route-map-filter-days">${dayButtonsHtml}</div>` : `<div class="company-route-map-filter-main company-route-no-schedule"><span class="flight-number-link flight-number-schedule company-route-schedule-badge">SCHEDULE</span><span>\u0412\u0406\u0414\u0421\u0423\u0422\u041d\u0406. \u0412\u0438\u043a\u043e\u043d\u0443\u0454 \u0447\u0430\u0440\u0442\u0435\u0440\u0438</span></div>`}
        </div>
      </div>
      <div class="company-route-map-panel company-route-map-list">
        <div class="company-route-map-list-title">SCHEDULE рейси:</div>
        <div class="company-route-flight-list" data-route-list></div>
      </div>
    </div>`;
  showCompanyLiveryDialog(dialog);
  setTimeout(() => initCompanyLiveryRouteMap(body, context), 0);
}

function initCompanyLiveryRouteMap(container, context) {
  const mapEl = container.querySelector('#companyRouteMap');
  const listEl = container.querySelector('[data-route-list]');
  const listTitleEl = container.querySelector('.company-route-map-list-title');
  const filterButtons = [...container.querySelectorAll('[data-route-filter]')];
  if (!mapEl || !listEl) return;
  if (typeof L === 'undefined') {
    mapEl.innerHTML = '<div class="company-route-empty">Карта не завантажилась: Leaflet недоступний.</div>';
    return;
  }
  const map = L.map(mapEl, {scrollWheelZoom: true});
  map.on('movestart zoomstart', () => {
    if (!map._companyRouteFitting) map._companyRouteAtHome = false;
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);
  let visibleBounds = [];
  const currentPoint = liveryRouteMapAirportPoint(context.currentAirport?.icao);
  const fitRouteMapHome = () => {
    const bounds = visibleBounds || [];
    const scheduleOffset = currentMode !== 'proposal';
    map._companyRouteFitting = true;
    if (!bounds.length) {
      map.setView([49, 31], 5);
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 6);
      if (scheduleOffset) map.panBy([115, 0], {animate: false});
    } else {
      map.fitBounds(bounds, {
        paddingTopLeft: [36, 36],
        paddingBottomRight: scheduleOffset ? [266, 36] : [36, 36],
        maxZoom: 6
      });
      if (scheduleOffset) map.panBy([115, 0], {animate: false});
    }
    setTimeout(() => {
      map._companyRouteFitting = false;
      map._companyRouteAtHome = true;
    }, 80);
  };
  const fitRouteMapAircraft = () => {
    if (!currentPoint) return;
    map._companyRouteFitting = true;
    map.setView([currentPoint.lat, currentPoint.lon], 7);
    map.panBy([115, 0], {animate: false});
    setTimeout(() => {
      map._companyRouteFitting = false;
      map._companyRouteAtHome = false;
    }, 80);
  };
  const homeControl = L.Control.extend({
    options: {position: 'topleft'},
    onAdd() {
      const link = L.DomUtil.create('a', 'company-route-home-control');
      link.href = '#';
      link.title = 'Показати всі маршрути';
      link.setAttribute('aria-label', 'Показати всі маршрути');
      link.innerHTML = '<span aria-hidden="true">⌂</span>';
      L.DomEvent.disableClickPropagation(link);
      L.DomEvent.on(link, 'click', event => {
        L.DomEvent.preventDefault(event);
        if (map._companyRouteHomeLocked || map._companyRouteAtHome) return;
        map._companyRouteHomeLocked = true;
        fitRouteMapHome();
        setTimeout(() => { map._companyRouteHomeLocked = false; }, 120);
      });
      return link;
    }
  });
  map.addControl(new homeControl());
  const planeControl = L.Control.extend({
    options: {position: 'topleft'},
    onAdd() {
      const link = L.DomUtil.create('a', 'company-route-home-control company-route-plane-control');
      link.href = '#';
      link.title = 'Центрувати на літаку';
      link.setAttribute('aria-label', 'Центрувати на літаку');
      link.innerHTML = '<span aria-hidden="true">✈</span>';
      L.DomEvent.disableClickPropagation(link);
      L.DomEvent.on(link, 'click', event => {
        L.DomEvent.preventDefault(event);
        fitRouteMapAircraft();
      });
      return link;
    }
  });
  map.addControl(new planeControl());
  const layers = [];
  const clear = () => {
    while (layers.length) map.removeLayer(layers.pop());
  };
  const addLayer = layer => {
    layer.addTo(map);
    layers.push(layer);
    return layer;
  };
  const scheduleBaseIcao = String(context.scheduleBaseIcao || '').trim().toUpperCase();
  const airportIcon = airport => {
    const icao = String(airport?.icao || '').trim().toUpperCase();
    const country = countryForAirport(icao);
    const airportTitle = liveryRouteMapAirportTitle(airport || {icao});
    const flag = country
      ? `<img src="https://flagcdn.com/w20/${esc(country.cc)}.png" class="airport-flag" title="${esc(country.name)}" alt="${esc(country.name)}">`
      : '';
    const baseClass = icao && icao === scheduleBaseIcao ? ' company-route-airport-base' : '';
    return L.divIcon({
    className: `company-route-airport-label${baseClass}`,
    html: `<span title="${esc(airportTitle)}">${esc(icao)}</span>${flag}`,
    title: airportTitle,
    iconSize: null,
    iconAnchor: [18, 0]
    });
  };
  const currentIcon = L.divIcon({
    className: 'company-route-current-marker',
    html: '<span class="ukraine-flight-marker newsky company-route-aircraft-marker"><span class="ukraine-flight-icon-wrap"><span class="ukraine-flight-icon">🛪</span></span></span>',
    iconSize: [52, 28],
    iconAnchor: [54, 3]
  });
  const badgeClass = () => 'flight-number-schedule';
  let currentMode = 'proposal';
  let selectedNumber = '';
  const draw = (shouldFit = true) => {
    clear();
    const bounds = [];
    const airportSeen = new Set();
    const addAirport = (icao, current = false, includeInBounds = true) => {
      const point = liveryRouteMapAirportPoint(icao);
      if (!point) return null;
      if (includeInBounds) bounds.push([point.lat, point.lon]);
      if (current) {
        addLayer(L.marker([point.lat, point.lon], {icon: currentIcon, zIndexOffset: 800}));
      }
      if (!airportSeen.has(point.icao)) {
        airportSeen.add(point.icao);
        const airport = point.airport || {icao: point.icao};
        const marker = L.marker([point.lat, point.lon], {icon: airportIcon(airport), zIndexOffset: 600});
        marker.bindTooltip(liveryRouteMapAirportTitle(airport), {direction: 'top', offset: [0, -8], opacity: 0.95});
        addLayer(marker);
      }
      return point;
    };
    const currentIcao = String(context.currentAirport?.icao || '').trim().toUpperCase();
    if (scheduleBaseIcao) addAirport(scheduleBaseIcao, false, false);
    if (currentIcao) addAirport(currentIcao, true, false);
    listEl.closest('.company-route-map-list')?.classList.toggle('company-route-proposal-panel', currentMode === 'proposal');
    if (currentMode === 'proposal') {
      if (listTitleEl) listTitleEl.textContent = '';
      listEl.innerHTML = '';
      const proposal = context.proposal;
      if (proposal?.origin && proposal?.destination) {
        const dep = addAirport(proposal.origin);
        const arr = addAirport(proposal.destination);
        if (dep && arr) {
          addLayer(L.polyline([[dep.lat, dep.lon], [arr.lat, arr.lon]], {
            color: '#ff4fa3',
            weight: 5,
            opacity: 0.9
          }));
        }
      }
      visibleBounds = bounds.slice();
      if (!bounds.length) {
        if (shouldFit) fitRouteMapHome();
        addLayer(L.marker([49, 31], {icon: L.divIcon({className:'company-route-empty', html:'Немає координат для карти', iconSize:null})}));
      } else if (shouldFit) {
        fitRouteMapHome();
      }
      setTimeout(() => map.invalidateSize(), 50);
      return;
    }
    const listRoutes = (context.routes || []).filter(route => liveryRouteMapRouteRuns(route, currentMode));
    if (listTitleEl) listTitleEl.textContent = `${listRoutes.length} SCHEDULE ${liveryFlightsWord(listRoutes.length)}:`;
    const mapRoutes = selectedNumber
      ? listRoutes.filter(route => String(route.number) === selectedNumber)
      : listRoutes;
    listEl.innerHTML = listRoutes.length
      ? listRoutes.map(route => `<button type="button" data-route-number="${esc(route.number)}" class="${String(route.number) === selectedNumber ? 'active' : ''}"><span class="flight-number-link ${badgeClass(route)}">${esc(route.number || '—')}</span> ${esc(route.dep)}→${esc(route.arr)}</button>`).join('')
      : '<span class="muted">Немає рейсів для цього фільтра</span>';
    mapRoutes.forEach(route => {
      const dep = addAirport(route.dep);
      const arr = addAirport(route.arr);
      if (!dep || !arr) return;
      const line = addLayer(L.polyline([[dep.lat, dep.lon], [arr.lat, arr.lon]], {
        color: selectedNumber ? '#f29f05' : '#2468b2',
        weight: selectedNumber ? 5 : 2,
        opacity: selectedNumber ? 0.95 : 0.55
      }));
    });
    visibleBounds = bounds.slice();
    if (!bounds.length) {
      if (shouldFit) fitRouteMapHome();
      addLayer(L.marker([49, 31], {icon: L.divIcon({className:'company-route-empty', html:'Немає координат для карти', iconSize:null})}));
    } else if (shouldFit) {
      fitRouteMapHome();
    }
    setTimeout(() => map.invalidateSize(), 50);
  };
  listEl.addEventListener('click', event => {
    const button = event.target.closest('[data-route-number]');
    if (!button) return;
    const nextNumber = button.dataset.routeNumber || '';
    if (nextNumber === selectedNumber) return;
    selectedNumber = nextNumber;
    draw(false);
  });
  filterButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      if ((button.dataset.routeFilter || 'all') === currentMode) return;
      currentMode = button.dataset.routeFilter || 'all';
      selectedNumber = '';
      filterButtons.forEach(item => item.classList.toggle('active', item === button));
      draw();
    });
  });
  draw();
}

document.addEventListener('click', event => {
  const mapButton = event.target.closest('[data-livery-map]');
  if (mapButton) {
    const card = mapButton.closest('.company-livery-card');
    if (card) {
      event.preventDefault();
      event.stopPropagation();
      openCompanyLiveryRouteMap(card);
      return;
    }
  }
  const groupButton = event.target.closest('.company-livery-group-button');
  if (groupButton) {
    const card = groupButton.closest('.company-livery-card');
    if (card) {
      event.preventDefault();
      event.stopPropagation();
      openCompanyLiveryGroupDialogSafe(card);
      return;
    }
  }
  const logButton = event.target.closest('[data-livery-log-index]');
  if (!logButton) return;
  const card = logButton.closest('.company-livery-card');
  if (!card) return;
  event.preventDefault();
  event.stopPropagation();
  const title = liveryCardTitle(card);
  const matcher = liveryMatcherForCard(card, title);
  const aircraftId = String(logButton.dataset.liveryLogAircraftId || '').trim();
  const completedFlights = app.flights.filter(flight => flight.status === 'completed');
  const flights = aircraftId
    ? completedFlights
      .filter(flight => String(flight?.aircraft?.id || '').trim() === aircraftId)
      .sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a))
    : matcher
      ? completedFlights
        .filter(matcher)
        .sort((a,b) => flightEndDateForDisplay(b) - flightEndDateForDisplay(a))
      : [];
  openCompanyLiveryFlightLog(card, title, flights);
});

document.addEventListener('click', event => {
  if (event.target.closest('.dashboard-filter-head')) return;
  const pilotList = $('#dashboardPilotFilterList');
  const pilotButton = $('#dashboardPilotFilterButton');
  const aircraftList = $('#dashboardAircraftFilterList');
  const aircraftButton = $('#dashboardAircraftFilterButton');
  if (pilotList) pilotList.hidden = true;
  if (pilotButton) pilotButton.setAttribute('aria-expanded', 'false');
  if (aircraftList) aircraftList.hidden = true;
  if (aircraftButton) aircraftButton.setAttribute('aria-expanded', 'false');
});

function configureDashboardSortableHeaders() {
  const headers = $$('.dashboard-flight-table thead th');
  const sortIcon = '<span class="dashboard-sort-icon" aria-hidden="true"><span class="dashboard-sort-up">▲</span><span class="dashboard-sort-down">▼</span></span>';
  const configure = (index, field, label) => {
    const header = headers[index];
    if (!header) return;
    header.className = 'dashboard-sort-head';
    header.innerHTML = `<button type="button" class="dashboard-sort-button" data-dashboard-sort="${field}" aria-pressed="false"><span class="dashboard-sort-label">${label}</span>${sortIcon}</button>`;
  };
  configure(2, 'duration', 'Маршрут /<br>Тривалість');
  configure(4, 'payload', 'Пейлоад');
}

configureDashboardSortableHeaders();
bindDashboardLiveToggle();

$$('[data-dashboard-sort]').forEach(button => button.onclick = () => {
  const field = button.dataset.dashboardSort;
  if (app.dashboardFlightSort.field === field) {
    app.dashboardFlightSort.direction = app.dashboardFlightSort.direction === 'desc' ? 'asc' : 'desc';
  } else {
    app.dashboardFlightSort = {field, direction: 'desc'};
  }
  render();
});

$$('#pilotsView [data-metric]').forEach(button => button.onclick = () => {
  app.metric = button.dataset.metric;
  $$('#pilotsView [data-metric]').forEach(x => x.classList.toggle('active', x === button));
  render();
});

bindVersionModeButton();
bindManualRefreshButtonClean();
bindCompanyLiveryDialogs();
autoMobileCabinetMode();
addEventListener('resize', autoMobileCabinetMode);
addEventListener('resize', syncDashboardLiveToggle);
loadNewskyRankSubtitle();
loadDatabases();

addEventListener('ucaa-flights-updated', event => {
  const loaded = event.detail;
  app.archive = loaded.archive;
  app.current = loaded.current;
  app.flights = loaded.flights;
  app.liveNewSkyLoaded = false;
  app.liveNewSkyFlights = [];
  app.liveNewSkyError = '';
  pilotCardsMonthlyCache = null;
  pilotInsuranceCoverage = window.UCAAInsurance.coverageMap(app.flights);
  const latest = loaded.latest || [...app.flights].sort((a,b) => dateOf(b)-dateOf(a))[0];
  app.referenceNow = referenceDate(latest);
  window.UCAAPilotProfile.setFlights(app.flights);
  $('#dataStatus').innerHTML = formatLiveDataStatusClean(loaded.current, loaded.archive, latest);
  render();
  updateCompanyLiveryStatus();
  loadDashboardLiveNewSkyFlights(true);
});

addEventListener('ucaa-profile-awards-updated', () => {
  if (location.hash === '#pilots') renderPilotsCardsPage();
});

addEventListener('hashchange', () => {
  if (location.hash === '#pilots') renderPilotsCardsPage();
  const requestedPilot = profileHashPilotId();
  if (requestedPilot && app.flights.length) showPilotProfile(requestedPilot);
});
