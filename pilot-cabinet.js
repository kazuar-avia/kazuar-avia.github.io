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
  flights: [],
  referenceNow: null,
  period: 'today',
  pilotsPeriod: 'monthToDate',
  customDate: null,
  dashboardPilotId: null,
  dashboardAircraftId: null,
  dashboardFlightSort: {field: 'date', direction: 'desc'},
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
const dashboardPilotCellHtml = pilot => `<td class="dashboard-pilot-cell" data-pilot-id="${esc(pilot.id)}" role="button" tabindex="0"><span class="dashboard-pilot-card"><img class="dashboard-pilot-avatar" src="${esc(pilotAvatarUrl(pilot.avatar))}" alt="${esc(pilot.name)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='https://newsky.app/api/pilot/avatar/default'}"><span class="dashboard-pilot-name">${esc(pilot.name)}</span></span></td>`;
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

function completedDateOf(flight) {
  return new Date(flight.times.closed || flight.updatedAt || flight.times.actualArrival || flight.times.takeoff || flight.times.scheduledDeparture);
}

function formatLiveDataStatus(current, archive, fallbackLatest = null) {
  const currentFlights = current?.flights || [];
  const archiveFlights = archive?.flights || [];
  const latestCompleted = [...currentFlights]
    .filter(flight => !flight.status || flight.status === 'completed')
    .sort((a, b) => completedDateOf(b) - completedDateOf(a))[0] || fallbackLatest;
  const updatedAt = latestCompleted
    ? `${completedDateOf(latestCompleted).toLocaleString('uk-UA', {timeZone:'UTC', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'})} UTC`
    : '—';
  return `за цей тиждень: ${currentFlights.length} рейсів · минулі тижні: ${archiveFlights.length}<br>оновлено ${updatedAt}`;
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
    const toTop = Number(data.topTarget?.neededFlights);
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
    subtitle.innerHTML = `<span class="rank-subtitle-main">📊 Ми #${rank} у <a href="https://newsky.app/airlines" target="_blank" rel="noopener">рейтингу NewSky</a>!</span> Виконано ${flights.toLocaleString('uk-UA')} ${flightWord(flights)} за крайні 30 днів! 🔥<br><span class="rank-subtitle-extra">До наступного місця: ${toNext.toLocaleString('uk-UA')} ${flightWord(toNext)}, до ТОП-10: ${toTopText}. <a class="rank-join-link" href="https://newsky.app/airline/ukl/join" target="_blank" rel="noopener">Долучайся!</a>${updated ? ` (оновлено ${updated})` : ''}</span>`;
    subtitle.innerHTML = `<span class="rank-subtitle-main"><span id="mobileModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="РњРѕР±С–Р»СЊРЅР° РІРµСЂСЃС–СЏ">рџ”Ґ</span> рџ“Љ РњРё #${rank} Сѓ <a href="https://newsky.app/airlines" target="_blank" rel="noopener">СЂРµР№С‚РёРЅРіСѓ NewSky</a>!</span> Р’РёРєРѕРЅР°РЅРѕ ${flights.toLocaleString('uk-UA')} ${flightWord(flights)} Р·Р° РєСЂР°Р№РЅС– 30 РґРЅС–РІ!<br><span class="rank-subtitle-extra">Р”Рѕ РЅР°СЃС‚СѓРїРЅРѕРіРѕ РјС–СЃС†СЏ: ${toNext.toLocaleString('uk-UA')} ${flightWord(toNext)}, РґРѕ РўРћРџ-10: ${toTopText}. <a class="rank-join-link" href="https://newsky.app/airline/ukl/join" target="_blank" rel="noopener">Р”РѕР»СѓС‡Р°Р№СЃСЏ!</a>${updated ? ` (РѕРЅРѕРІР»РµРЅРѕ ${updated})` : ''}</span>`;
    bindMobileModeTrigger(subtitle);
    subtitle.innerHTML = `<span class="rank-desktop-line"><span class="rank-subtitle-main"><span id="mobileModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="\u041C\u043E\u0431\u0456\u043B\u044C\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F">\u{1F4CA}</span> \u041C\u0438 #${rank} \u0443 <a href="https://newsky.app/airlines" target="_blank" rel="noopener">\u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0443 NewSky</a>!</span> \u0412\u0438\u043A\u043E\u043D\u0430\u043D\u043E ${flights.toLocaleString('uk-UA')} ${cleanFlightWord(flights)} \u0437\u0430 \u043A\u0440\u0430\u0439\u043D\u0456 30 \u0434\u043D\u0456\u0432! <span id="desktopModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="\u0417\u0432\u0438\u0447\u0430\u0439\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F">\u{1F525}</span></span><span class="rank-mobile-line">\u0412\u0438\u043A\u043E\u043D\u0430\u043D\u043E ${flights.toLocaleString('uk-UA')} ${cleanFlightWord(flights)} / 30 \u0434\u043D\u0456\u0432 \u{1F525} #${rank} \u043C\u0456\u0441\u0446\u0435 NewSky!</span><br><span class="rank-subtitle-extra">\u0414\u043E \u043D\u0430\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043C\u0456\u0441\u0446\u044F: ${toNext.toLocaleString('uk-UA')} ${cleanFlightWord(toNext)}, \u0434\u043E \u0422\u041E\u041F-10: ${Number.isFinite(toTop) ? `${toTop.toLocaleString('uk-UA')} ${cleanFlightWord(toTop)}` : '\u2014'}. <a class="rank-join-link" href="https://newsky.app/airline/ukl/join" target="_blank" rel="noopener">\u0414\u043E\u043B\u0443\u0447\u0430\u0439\u0441\u044F!</a>${updated ? ` (\u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043E ${updated})` : ''}</span>`;
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
    const top10Flights = airlines[9] ? rankAirlineFlights(airlines[9]) : flights;
    const toNext = ourIndex > 0 ? Math.max(1, aboveFlights - flights + 1) : 0;
    const toTop = rank > 10 ? Math.max(1, top10Flights - flights + 1) : 0;
    const updated = formatRankUpdatedAt(data.updatedAt);
    const cleanFlightWord = value => {
      const n = Math.abs(Math.round(Number(value) || 0));
      if (n % 10 === 1 && n % 100 !== 11) return '\u043F\u043E\u043B\u0456\u0442';
      if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return '\u043F\u043E\u043B\u044C\u043E\u0442\u0438';
      return '\u043F\u043E\u043B\u044C\u043E\u0442\u0456\u0432';
    };
    const rankTooltip = buildNewskyRankTooltip(airlines, ourIndex);
    const rankLink = `<a class="rank-tooltip-link" href="https://newsky.app/airlines" target="_blank" rel="noopener">\u0440\u0435\u0439\u0442\u0438\u043D\u0433\u0443 NewSky<span class="rank-tooltip-box">${rankTooltip}</span></a>`;
    const toTopText = rank > 10 ? `${toTop.toLocaleString('uk-UA')} ${cleanFlightWord(toTop)}` : '\u2014';
    subtitle.innerHTML = `<span class="rank-desktop-line"><span class="rank-subtitle-main"><span id="mobileModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="\u041C\u043E\u0431\u0456\u043B\u044C\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F">\u{1F4CA}</span> \u041C\u0438 #${rank} \u0443 ${rankLink}!</span> \u0412\u0438\u043A\u043E\u043D\u0430\u043D\u043E ${flights.toLocaleString('uk-UA')} ${cleanFlightWord(flights)} \u0437\u0430 \u043A\u0440\u0430\u0439\u043D\u0456 30 \u0434\u043D\u0456\u0432! <span id="desktopModeTrigger" class="mobile-mode-trigger" role="button" tabindex="0" aria-label="\u0417\u0432\u0438\u0447\u0430\u0439\u043D\u0430 \u0432\u0435\u0440\u0441\u0456\u044F">\u{1F525}</span></span><span class="rank-mobile-line">\u0412\u0438\u043A\u043E\u043D\u0430\u043D\u043E ${flights.toLocaleString('uk-UA')} ${cleanFlightWord(flights)} / 30 \u0434\u043D\u0456\u0432 \u{1F525} #${rank} \u043C\u0456\u0441\u0446\u0435 NewSky!</span><br><span class="rank-subtitle-extra">\u0414\u043E \u043D\u0430\u0441\u0442\u0443\u043F\u043D\u043E\u0433\u043E \u043C\u0456\u0441\u0446\u044F: ${toNext.toLocaleString('uk-UA')} ${cleanFlightWord(toNext)}, \u0434\u043E \u0422\u041E\u041F-10: ${toTopText}. <a class="rank-join-link" href="https://newsky.app/airline/ukl/join" target="_blank" rel="noopener">\u0414\u043E\u043B\u0443\u0447\u0430\u0439\u0441\u044F!</a>${updated ? ` (\u043E\u043D\u043E\u0432\u043B\u0435\u043D\u043E ${updated})` : ''}</span>`;
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

function pilotPay(flight) {
  return window.UCAAPilotPay.pay(flight, pilotInsuranceCoverage.get(flight) || 0, app.flights);
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
  if (period === 'custom' && app.customDate) {
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
  if (amount >= 1000) return `$${(amount/1000).toFixed(1)}K`;
  return money(amount);
}

function periodLabel() {
  const labels = {today:'За сьогодні',weekToDate:'З початку тижня',previousWeek:'Минулий тиждень',monthToDate:'З початку місяця',previousMonth:'Минулий місяць',sinceRestructure:'З 01.05.2026',all:'Весь період'};
  return app.period === 'custom' && app.customDate ? new Date(`${app.customDate}T00:00:00Z`).toLocaleDateString('uk-UA',{timeZone:'UTC'}) : labels[app.period];
}

function dashboardMetricPeriodLabel() {
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
  const expenseLabels = new Set(['Маршрути для регулярки','Аеропортові збори','Хендлінг',...approximateLabels,'Пальне','Зарплата пілотам','Зарплата бортпровідникам','Штрафи та інциденти','Моральні компенсації / Пошкоджений вантаж','Страхування']);
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
  view.innerHTML = `<section class="bar pilots-period-bar"><h2>ПЕРІОД:</h2><div class="periods" aria-label="Період сторінки пілотів">${periodButtons.map(([key,label]) => `<button data-pilots-period="${key}" class="${period===key?'active':''}">${label}</button>`).join('')}</div><div class="pilots-active-count">Активних пілотів: <strong>${pilotRows.length}</strong></div></section><div id="pilotCardsGrid" class="pilot-cards-grid">${pilotRows.length ? pilotRows.map((pilot,index) => {
    const rating = pilot.rating ? pilot.rating.toFixed(2) : '—';
    const hours = Math.round(pilot.minutes / 60);
    const awards = pilotCardAwardsHtml(pilot, period);
    const awardsBlock = awards ? `<div class="pilot-card-awards">${awards}</div>` : '';
    const lifetime = lifetimeRows.get(pilot.id) || pilot;
    return `<article class="pilot-card" data-pilot-id="${esc(pilot.id)}"><div class="pilot-card-row pilot-card-row-open pilot-card-name">#${index+1} ${esc(pilot.name)}</div><div class="pilot-card-row pilot-card-row-open pilot-card-visual-row"><div class="pilot-card-main"><img class="pilot-card-avatar" src="${esc(pilotAvatarUrl(pilot.avatar))}" alt="${esc(pilot.name)}" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='https://newsky.app/api/pilot/avatar/default'}"></div><div class="pilot-card-stats"><div class="pilot-card-side">${pilot.completedFlights.length}<small>рейсів</small></div><div class="pilot-card-rating"><span class="rating-badge ${pilotCardsRatingClass(pilot.rating)}">${rating}</span></div><div class="pilot-card-side">${hours}<small>годин</small></div></div></div><div class="pilot-card-row pilot-card-row-open pilot-card-money">Прибуток АК: <span class="${pilot.companyProfit>=0?'positive':'negative'}">${money(pilot.companyProfit,true)}</span><br>Зарплата: ${money(pilot.salary)}</div><div class="pilot-card-row pilot-card-awards">${awards}</div><div class="pilot-card-row pilot-card-dates">Перший політ: ${lifetime.first?dateOf(lifetime.first).toLocaleDateString('uk-UA',{timeZone:'UTC'}):'—'}<br>Крайній політ: ${lifetime.last?dateOf(lifetime.last).toLocaleDateString('uk-UA',{timeZone:'UTC'}):'—'}</div></article>`;
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
  return `Wind on touchdown: ${direction}° / ${speed} kt${crosswind===null?'':` (crosswind ${crosswind} kt)`}`;
}

function directFlightFinance(flight) {
  const insurancePayout = pilotInsuranceCoverage.get(flight) || 0;
  const pilotPay = window.UCAAPilotPay.breakdown(flight, insurancePayout, app.flights);
  return {insurancePayout, pilotPay, ...window.UCAAIncidentCompensation.breakdown(flight, insurancePayout, app.flights)};
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
    + Math.max(0, Number(pay?.managementBonus) || 0);
  const deductions = Math.max(0, Number(pay?.totalDeductions) || 0);
  const salaryRow = `<div class="flight-finance-row"><i class="finance-dot" style="background:#e89ac7"></i><span>Зарплата пілота<button type="button" class="finance-pilot-profile-link" data-pilot-id="${esc(flight.pilot.id)}">${esc(flight.pilot.name)}</button></span><strong class="negative">${grossSalary?'−':''}${money(grossSalary)}</strong></div>`;
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
  const rateCapText = pay.rateK >= 2 ? ' · застосовано ліміт ×2' : '';
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
  const formula = `(${money(pay.preparationPay)} + ${money(pay.flightBasePay)} × ${pay.routeK.toFixed(2)} × ${pay.aircraftK.toFixed(2)} × ${pay.onlineK.toFixed(2)}) ${masteryDelta>=0?'+':'−'} ${money(Math.abs(masteryDelta))} + ${money(crosswindDelta)} + ${money(pay.managementBonus)} − ${money(pay.delayDeduction)} − ${money(pay.insuranceLiability)} − ${money(pay.incidentLiability)} − ${money(pay.fdrPenalty)} = ${money(pay.total,true)}`;
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
  const salarySubtotal = `<tr class="salary-subtotal-row" title="Зароблена зарплата після оплати підготовки, польоту, льотних коефіцієнтів та бонусів за посадку і crosswind, але до премії керівництва й штрафів."><th>Зарплата пілота</th><td>до Премії і Штрафів</td><td class="num ${pay.salaryBeforeDeductions>=0?'positive':'negative'}">${money(pay.salaryBeforeDeductions,true)}</td></tr>`;
  return `<div class="flight-info-section" style="margin-top:0">ФОРМУЛА ЗАРПЛАТИ ЗА РЕЙС</div><table class="salary-formula-table"><tr title="Базова погодинна ставка однакова для всіх пілотів до врахування лояльності та регулярності."><th>Ставка</th><td>Базова ставка</td><td class="num">$${PAY_RULE.hourlyRate}/год</td></tr><tr title="${tip(loyaltyTooltip)}"><th>Лояльність</th><td>× ${pay.loyaltyK.toFixed(2)} · ${pay.context.membershipDays} дн. в АК · ${pay.context.totalFlights} рейсів</td><td class="num positive">${money(loyaltyBonus,true)}/год</td></tr><tr title="${tip(regularityTooltip)}"><th>Регулярність</th><td>× ${pay.regularityK.toFixed(2)} · ${pay.context.last10}/10 дн. · ${pay.context.last20}/20 дн. · ${pay.context.last30}/30 дн.</td><td class="num positive">${money(regularityBonus,true)}/год</td></tr><tr title="Лояльність і регулярність формують персональну ставку, але разом не можуть підняти її вище подвійної базової ставки."><th>Ставка пілота</th><td>$${PAY_RULE.hourlyRate} × ${pay.loyaltyK.toFixed(2)} × ${pay.regularityK.toFixed(2)}${rateCapText}</td><td class="num positive">${money(pay.effectiveHourlyRate)}/год</td></tr><tr title="За кожен завершений рейс оплачується одна додаткова година на передпольотну підготовку."><th>Підготовка до польоту</th><td>1 год × ${money(pay.effectiveHourlyRate)}</td><td class="num">${money(pay.preparationPay)}</td></tr><tr title="Фактичний льотний час оплачується за персональною ставкою до застосування льотних коефіцієнтів."><th>Політ</th><td>${pay.flightHours.toLocaleString('uk-UA',{minimumFractionDigits:2,maximumFractionDigits:2})} год × ${money(pay.effectiveHourlyRate)}</td><td class="num">${money(pay.flightBasePay)}</td></tr><tr title="${tip(routeTooltip)}"><th>Коефіцієнт за маршрут</th><td>${routeText}</td><td class="num ${routeBonus>=0?'positive':'negative'}">${money(routeBonus,true)}</td></tr><tr title="${tip(['Коефіцієнт береться з редагованого довідника ICAO.', 'Для cargo може використовуватися окремий запис із F.', 'Невідомий тип тимчасово отримує ×1,25.'])}"><th>Коефіцієнт за складність літака</th><td>× ${pay.aircraftK.toFixed(2)} (${aircraftPercent?`+${aircraftPercent}%`:'без доплати'}, ${esc(flight.aircraft.icao)})</td><td class="num ${aircraftBonus>=0?'positive':'negative'}">${money(aircraftBonus,true)}</td></tr><tr title="${tip(onlineTooltip)}"><th>Online (VATSIM)</th><td>× ${pay.onlineK.toFixed(2)} (${onlinePercent?`+${onlinePercent}%`:'OFFLINE'})</td><td class="num ${onlineBonus>=0?'positive':''}">${money(onlineBonus,true)}</td></tr><tr title="${tip(masteryTooltip)}"><th>Майстерність</th><td>${pay.fpm?`${Math.round(pay.fpm)} fpm × ${pay.masteryK.toFixed(2)}`:'FPM не визначено · × 1.00'}</td><td class="num ${masteryDelta>0?'positive':masteryDelta<0?'negative':''}">${money(masteryDelta,true)}</td></tr><tr title="${tip(['Кожен вузол бокового вітру додає 2% до нарахувань перед утриманнями.', '1 kt — +2%.', '5 kt — +10%.', '10 kt — +20%.'])}"><th>Доплата за crosswind</th><td>${pay.crosswindKt?`${pay.crosswindKt.toFixed(0)} kt · +${Math.round((pay.crosswindK-1)*100)}%`:'Дані відсутні · +0%'}</td><td class="num positive">${money(crosswindDelta,true)}</td></tr>${salarySubtotal}${managementBonusRow}<tr title="Пілот компенсує 10% грошового штрафу NewSky саме за затримку рейсу."><th>Затримка рейсу</th><td>${pay.delayCash?`10% від ${money(pay.delayCash)}`:'Відсутня'}</td><td class="num ${pay.delayDeduction?'negative':''}">${pay.delayDeduction?`−${money(pay.delayDeduction)}`:''}</td></tr>${insuranceRows}${fdrRows}</table><div class="salary-numeric-formula" title="${tip(['Підсумкова формула:', 'персональна ставка використовується для підготовки та польоту;', 'льотні коефіцієнти діють лише на політ;', 'майстерність і crosswind формують зарплату до премії та утримань;', 'після премії окремо віднімаються штрафи й особиста відповідальність.'])}">${formula}</div><div class="flight-finance-row flight-finance-result" title="Фінальна виплата або заборгованість пілота за цей завершений рейс."><span></span><span>${pay.total>=0?'Зарплата пілота':'Штраф пілота'}</span><strong class="${pay.total>=0?'positive':'negative'}">${money(pay.total,true)}</strong></div>`;
}

function arrangeSalaryDetails(body, flight) {
  const payout = pilotInsuranceCoverage.get(flight) || 0;
  const pay = window.UCAAPilotPay.breakdown(flight, payout, app.flights);
  const rows = [...body.querySelectorAll('.salary-formula-table tr')];
  const byLabel = label => rows.find(row => row.querySelector('th')?.textContent.trim() === label);
  const base = byLabel('Ставка');
  const loyalty = byLabel('Лояльність');
  const regularity = byLabel('Регулярність');
  const rate = byLabel('Ставка пілота');
  if (base && loyalty && regularity && rate) {
    const regularityReason = pay.regularityK >= 1.30 || pay.regularityK === 1.05
      ? `${pay.context.last30} рейсів / 30 днів`
      : pay.regularityK === 1.20
        ? `${pay.context.last20} рейсів / 20 днів`
        : pay.regularityK === 1.10
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
      '×1,05 — від 1 рейсу за останні 30 днів.',
      '×1,10 — від 5 рейсів за останні 10 днів.',
      '×1,20 — від 10 рейсів за останні 20 днів.',
      '×1,30 — від 15 рейсів за останні 30 днів.',
      '×1,40 — від 20 рейсів за останні 30 днів.',
      '×1,50 — від 30 рейсів за останні 30 днів.'
    ]);
    const rateTotalTip = tip([
      'Підсумкова персональна ставка рахується як:',
      'базова ставка + бонус за лояльність + бонус за регулярність.',
      'Загальний ліміт — не більше подвійної базової ставки.'
    ]);
    const rateTable = document.createElement('table');
    rateTable.className = 'pilot-rate-table';
    rateTable.innerHTML = `<thead><tr><th title="${rateTotalTip}">Ставка пілота</th><th title="${rateBaseTip}">Базова</th><th title="${rateLoyaltyTip}">Лояльність <span class="rate-context">(${pay.context.membershipDays} днів / ${pay.context.totalFlights} рейсів)</span></th><th title="${rateRegularityTip}">Регулярність <span class="rate-context">(${regularityReason})</span></th><th title="${rateTotalTip}">Ставка</th></tr></thead><tbody><tr><td title="${rateTotalTip}"><button type="button" class="salary-pilot-profile-link" data-pilot-id="${esc(flight.pilot.id)}">${esc(flight.pilot.name)}</button></td><td title="${rateBaseTip}">$${PAY_RULE.hourlyRate} / год</td><td title="${rateLoyaltyTip}">$${PAY_RULE.hourlyRate} / год × ${pay.loyaltyK.toFixed(2)} <strong class="positive">${money(loyaltyBonus,true)} / год</strong></td><td title="${rateRegularityTip}">$${PAY_RULE.hourlyRate} / год × ${pay.regularityK.toFixed(2)} <strong class="positive">${money(regularityBonus,true)} / год</strong></td><td class="pilot-rate-total" title="${rateTotalTip}">${money(pay.effectiveHourlyRate)} / год</td></tr></tbody>`;
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
    if (managementRow) {
      const premiumBlock = document.createElement('div');
      premiumBlock.className = 'salary-section salary-premium-section';
      premiumBlock.innerHTML = '<table class="salary-formula-table salary-premium-table"><tbody></tbody></table>';
      premiumBlock.querySelector('tbody').append(managementRow);
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
  if (!dialog.open) dialog.showModal();
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
  pilotSalaryVisual,
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
  list.innerHTML = `<button type="button" data-dashboard-pilot="" class="${selected?'':'active'}"><span>Усі пілоти</span><small>${completed.length} рейсів</small></button>${pilots.map(pilot => `<button type="button" data-dashboard-pilot="${esc(pilot.id)}" class="${pilot.id===app.dashboardPilotId?'active':''}"><span>${esc(pilot.name)}</span><small>${pilot.flights}</small></button>`).join('')}`;
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
      <td>${date.toLocaleDateString('uk-UA',{timeZone:'UTC'})}<span class="date-flight-meta"><span class="date-flight-time">${date.toLocaleTimeString('uk-UA',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})}</span><a class="flight-number-link flight-number-${operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${operation.label}">${esc(flight.flightNumber||'—')}</a></span></td>
      ${dashboardPilotCellHtml(flight.pilot)}
      <td class="route"><span class="route-airports">${airportWithFlag(flight.departure)} → ${airportWithFlag(flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times.durationMinutes)}</span></td>
      <td>${esc(flight.aircraft.name)}<span class="flight-note">${esc(flight.aircraft.icao)}</span></td>
      <td><span class="payload-value" title="${payloadKind.label}">${esc(flightLoad(flight))}<span class="load-kind-icon" aria-hidden="true">${payloadKind.icon}</span></span></td>
      <td class="num rating-cell rating-detail" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="rating-badge ${rating.className}">${rating.label}</span><span class="landing-line">${landingStats(flight)}</span></td>
      <td class="finance-click-cell company-profit-detail ${profitVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(direct.companyProfit,true)}${profitVisual.notes.map(note=>`<span class="profit-incident-note ${note.className}">${esc(note.text)}</span>`).join('')}</td>
      <td class="finance-click-cell pilot-salary-detail ${salaryVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(direct.pilotSalary,true)}${salaryVisual.note?`<span class="profit-incident-note ${salaryVisual.noteClass||''}">${esc(salaryVisual.note)}</span>`:''}</td>
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
      <td><button class="pilot-link" data-id="${esc(p.id)}">${esc(p.name)}</button><span class="role">${esc(p.role)}</span></td>
      <td class="num">${p.completed}${p.failed ? ` <small title="Незавершені">(+${p.failed})</small>` : ''}</td>
      <td class="num ${app.metric === 'balance' ? (p.balance >= 0 ? 'positive' : 'negative') : ''}">${metric.display(p)}</td>
    </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;padding:18px">За цей період рейсів немає</td></tr>';

  $$('.pilot-link').forEach(button => button.onclick = () => showPilotProfile(button.dataset.id));
  }
  if (location.hash === '#pilots') renderPilotsCardsPage();
}

function showPilotProfile(id) {
  window.UCAAPilotProfile.open(id, app.flights);
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
    pilotList.innerHTML = `<button type="button" data-dashboard-pilot="" class="${selectedPilot ? '' : 'active'}"><span>Усі пілоти</span><small>${pilotMenuFlights.length} рейсів</small></button>${pilots.map(pilot => `<button type="button" data-dashboard-pilot="${esc(pilot.id)}" class="${pilot.id === app.dashboardPilotId ? 'active' : ''}"><span>${esc(pilot.name)}</span><small>${pilot.flights}</small></button>`).join('')}`;
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
    $('#dashboardFlights').innerHTML = rows.length ? rows.map(row => {
      const flight = row.flight;
      return `<tr>
        <td>${row.date.toLocaleDateString('uk-UA',{timeZone:'UTC'})}<span class="date-flight-meta"><span class="date-flight-time">${row.date.toLocaleTimeString('uk-UA',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})}</span><a class="flight-number-link flight-number-${row.operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${row.operation.label}">${esc(flight.flightNumber||'—')}</a></span></td>
        ${dashboardPilotCellHtml(flight.pilot)}
        <td class="route"><span class="route-airports">${airportWithFlag(flight.departure)} → ${airportWithFlag(flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times.durationMinutes)}</span></td>
        <td>${esc(flight.aircraft.name)}<span class="flight-note">${esc(flight.aircraft.icao)}</span></td>
        <td><span class="payload-value" title="${row.payloadKind.label}">${esc(flightLoad(flight))}<span class="load-kind-icon" aria-hidden="true">${row.payloadKind.icon}</span></span></td>
        <td class="num rating-cell rating-detail" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="rating-badge ${row.rating.className}">${row.rating.label}</span><span class="landing-line">${landingStats(flight)}</span></td>
        <td class="finance-click-cell company-profit-detail ${row.profitVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(row.direct.companyProfit,true)}${row.profitVisual.notes.map(note=>`<span class="profit-incident-note ${note.className}">${esc(note.text)}</span>`).join('')}</td>
        <td class="finance-click-cell pilot-salary-detail ${row.salaryVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(row.direct.pilotSalary,true)}${row.salaryVisual.note?`<span class="profit-incident-note ${row.salaryVisual.noteClass||''}">${esc(row.salaryVisual.note)}</span>`:''}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="8" class="loading">За вибраний період завершених рейсів немає</td></tr>';
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
      <td>${date.toLocaleDateString('uk-UA',{timeZone:'UTC'})}<span class="date-flight-meta"><span class="date-flight-time">${date.toLocaleTimeString('uk-UA',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})}</span><a class="flight-number-link flight-number-${operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${operation.label}">${esc(flight.flightNumber||'вЂ”')}</a></span></td>
      ${dashboardPilotCellHtml(flight.pilot)}
      <td class="route"><span class="route-airports">${airportWithFlag(flight.departure)} в†’ ${airportWithFlag(flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times.durationMinutes)}</span></td>
      <td>${esc(flight.aircraft.name)}<span class="flight-note">${esc(flight.aircraft.icao)}</span></td>
      <td><span class="payload-value" title="${payloadKind.label}">${esc(flightLoad(flight))}<span class="load-kind-icon" aria-hidden="true">${payloadKind.icon}</span></span></td>
      <td class="num rating-cell rating-detail" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="rating-badge ${rating.className}">${rating.label}</span><span class="landing-line">${landingStats(flight)}</span></td>
      <td class="finance-click-cell company-profit-detail ${profitVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(direct.companyProfit,true)}${profitVisual.notes.map(note=>`<span class="profit-incident-note ${note.className}">${esc(note.text)}</span>`).join('')}</td>
      <td class="finance-click-cell pilot-salary-detail ${salaryVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(direct.pilotSalary,true)}${salaryVisual.note?`<span class="profit-incident-note ${salaryVisual.noteClass||''}">${esc(salaryVisual.note)}</span>`:''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="loading">Р—Р° РІРёР±СЂР°РЅРёР№ РїРµСЂС–РѕРґ Р·Р°РІРµСЂС€РµРЅРёС… СЂРµР№СЃС–РІ РЅРµРјР°С”</td></tr>';
  bindDashboardPilotCells();
  $$('.rating-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'rating')});
  $$('.rating-detail').forEach(cell=>cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click()}});
  $$('.company-profit-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'finance')});
  $$('.pilot-salary-detail').forEach(button=>button.onclick=()=>{const flight=app.flights.find(item=>item.id===button.dataset.flightId);if(flight)openFlightInfo(flight,'salary')});
  $$('.finance-click-cell').forEach(cell=>cell.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();cell.click()}});
}

async function loadDatabases() {
  const status = $('#dataStatus');
  try {
    const [loaded, companyData] = await Promise.all([
      window.UCAAFlightData.loadWeeklyFlights(message => { status.textContent = message; }),
      fetch('COMPANY/company-data.json', {cache:'default'}).then(response => response.ok ? response.json() : null).catch(() => null)
    ]);
    const {archive, current} = loaded;
    app.archive = archive;
    app.current = current;
    app.companyData = companyData;
    app.flights = loaded.flights;
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
    status.innerHTML = formatLiveDataStatus(current, archive, latest);
    selectInitialDashboardPeriod();
    render();
    const requestedPilot = new URLSearchParams(location.search).get('pilot');
    if (requestedPilot) showPilotProfile(requestedPilot);
  } catch (error) {
    console.error(error);
    status.textContent = 'Не вдалося завантажити файли з FLIGHTS';
    $('#leaderboard').innerHTML = '<tr><td colspan="4" style="padding:18px;text-align:center" class="negative">Не вдалося прочитати тижневі JSON-файли з папки FLIGHTS.</td></tr>';
  }
}

$$('#dashboardView [data-period]').forEach(button => button.onclick = () => {
  app.period = button.dataset.period;
  app.customDate = null;
  $$('#dashboardView [data-period]').forEach(x => x.classList.toggle('active', x === button));
  $('#dashboardCalendarButton').classList.remove('active');
  render();
});

$('#dashboardCalendarButton').onclick = () => {
  const picker = $('#dashboardDatePicker');
  try {
    if (typeof picker.showPicker === 'function') picker.showPicker();
    else picker.click();
  } catch {
    picker.focus();
    picker.click();
  }
};

$('#dashboardDatePicker').onchange = event => {
  if (!event.target.value) return;
  app.period = 'custom';
  app.customDate = event.target.value;
  $$('#dashboardView [data-period]').forEach(button=>button.classList.remove('active'));
  const calendar = $('#dashboardCalendarButton');
  calendar.classList.add('active');
  calendar.title = `Вибрана дата: ${periodLabel()}`;
  render();
};

$('#flightInfoClose').onclick = () => $('#flightInfoDialog').close();
$('#flightInfoDialog').onclick = event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
};

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
autoMobileCabinetMode();
addEventListener('resize', autoMobileCabinetMode);
loadNewskyRankSubtitle();
loadDatabases();

addEventListener('ucaa-flights-updated', event => {
  const loaded = event.detail;
  app.archive = loaded.archive;
  app.current = loaded.current;
  app.flights = loaded.flights;
  pilotCardsMonthlyCache = null;
  pilotInsuranceCoverage = window.UCAAInsurance.coverageMap(app.flights);
  const latest = loaded.latest || [...app.flights].sort((a,b) => dateOf(b)-dateOf(a))[0];
  app.referenceNow = referenceDate(latest);
  window.UCAAPilotProfile.setFlights(app.flights);
  $('#dataStatus').innerHTML = formatLiveDataStatus(loaded.current, loaded.archive, latest);
  render();
});

addEventListener('hashchange', () => {
  if (location.hash === '#pilots') renderPilotsCardsPage();
});
