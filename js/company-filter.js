// «Флот і рейси»: панель фільтру запропонованих рейсів (під LIVE NOW, перед WET LEASE). Схована за замовчуванням (+ / −).
// Поля: Тип літака (текст або список виробник → модель), Авіакомпанія (UCAA = WET LEASE першою, далі АК з карток за кількістю),
// DRY LEASE і «Чекаємо у 2026 році» у фільтрі не беруть участі (без маршрутів); списки — за кількістю пропозицій.
// Виліт / Прибуття (ICAO із запропонованих рейсів карток; можна писати самому, укр/рос розкладка → латиниця).
// Фільтр лише ховає картки (клас cff-hide), сам сайт не змінює; після перемальовування сторінки застосовується знову.
(function () {
  'use strict';
  const SECTIONS = ['liveair', 'wetlease', 'sublease', 'fictional', 'drylease', 'waiting'];
  const MFRS = [   // [назва, перевірка за текстом типу, коротка літера для пошуку]
    ['Airbus', /\bairbus\b|\bA\d{3}/i, 'A'], ['Boeing', /\bboeing\b|\b7[0-8]7\b|\b7[0-8]7[- ]|737-?MAX|\bMAX ?8/i, 'B'],
    ['Embraer', /embraer|\bE1\d\d|\bE-?1\d\d|\bERJ|\bE145/i, 'E'], ['Bombardier', /bombardier|\bCRJ|\bdash ?8|\bQ400/i, 'C'],
    ['McDonnell Douglas', /\bMD-?\d|douglas|\bDC-?\d/i, 'M'], ['Fokker', /fokker|\bF ?\d{2,3}\b/i, 'F'], ['ATR', /\bATR\b/i, ''],
    ['BAe / Avro', /\bBAe|avro|\bRJ ?\d{2,3}/i, ''], ['Cessna', /cessna/i, ''], ['Saab', /saab/i, 'S'],
    ['Антонов', /(^|\s)(Ан|An)-\d/i, ''], ['Туполєв', /(^|\s)(Ту|Tu)-\d/i, ''], ['Яковлєв', /(^|\s)(Як|Yak)-\d/i, ''], ['Lockheed', /lockheed|L-?1011/i, 'L']
  ];
  const KEYS = {'й':'Q','ц':'W','у':'E','к':'R','е':'T','н':'Y','г':'U','ш':'I','щ':'O','з':'P','ф':'A','і':'S','ы':'S','в':'D','а':'F',
    'п':'G','р':'H','о':'J','л':'K','д':'L','я':'Z','ч':'X','с':'C','м':'V','и':'B','т':'N','ь':'M'};
  const icaoOnly = v => [...String(v).toLowerCase()].map(ch => KEYS[ch] || (/[a-z0-9]/.test(ch) ? ch.toUpperCase() : '')).join('').slice(0, 4);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const norm = s => String(s || '').toLowerCase().replace(/[\s\-_.]/g, '');

  const state = {open: false, type: {kind: 'text', value: ''}, airline: {kind: 'text', value: ''}, dep: '', arr: ''};

  // ---------- дані карток ----------
  function cardInfo(card) {
    const section = SECTIONS.find(s => card.closest(`.${s}-section`)) || '';
    const raw = String(card.dataset.liveryTitle || card.querySelector('.company-livery-title')?.textContent || '').replace(/📅/g, '').trim();
    const parts = raw.split(/\s*\|\s*|\s+l\s+/).map(p => p.trim()).filter(Boolean);
    const isReg = p => /^[A-Z]{1,2}-?[A-Z0-9]{2,5}$/.test(p) && /-/.test(p);
    let airline = '', type = parts[0] || '';
    if (parts.length >= 3) { airline = parts[0]; type = parts[1]; }
    else if (parts.length === 2 && !isReg(parts[1]) && !/pax|xp|msfs/i.test(parts[1])) { airline = parts[0]; type = parts[1]; }
    if (section === 'wetlease') airline = 'UCAA';
    if (section === 'drylease') airline = 'DRY LEASE';
    const mfr = (MFRS.find(([, re]) => re.test(type)) || ['Інші'])[0];
    const model = modelOf(type, mfr);
    const codes = [...card.querySelectorAll('.company-livery-offer-route strong')].filter(s => /^[A-Z0-9]{4}$/.test(s.textContent.trim())).map(s => {
      const c = s.textContent.trim();
      const flag = s.parentElement?.querySelector('img.airport-flag');   // прапор країни, який сайт уже малює біля коду на картці
      if (flag && !FLAGS.has(c)) FLAGS.set(c, {src: flag.getAttribute('src'), title: flag.getAttribute('title') || ''});
      return c;
    });
    return {card, section, airline, type, mfr, model, icao: icaoTypes(type), dep: codes[0] || '', arr: codes[1] || ''};
  }
  // ICAO-коди типу для пошуку: 737-600 → B736, 727-200 → B722, 737 MAX8 → B38M, A330-200 → A332, A320neo → A20N, ATR 72-600 → AT76…
  function icaoTypes(type) {
    const t = String(type).replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
    const out = [];
    let m;
    if (/737[ -]?MAX ?8|MAX ?8/i.test(t)) out.push('B38M');
    else if (/777-?300 ?ER/i.test(t)) out.push('B77W');
    else if (/777-?200 ?LR|777F/i.test(t)) out.push('B77L');
    else if ((m = t.match(/\b7([0-8])7-?(\d)\d\d/))) out.push(`B7${m[1]}${m[2]}`);
    else if ((m = t.match(/\b787-?(\d+)/))) out.push(`B78${m[1].slice(-1)}`);
    else if ((m = t.match(/\b7([0-8])7\b/))) out.push(`B7${m[1]}7`);
    if ((m = t.match(/\bA3(\d)(\d)\s?neo/i))) out.push(`A${m[1]}${m[2]}N`);   // A320neo → A20N, A321neo → A21N
    else if (/\bA350-?1000/i.test(t)) out.push('A35K');
    else if ((m = t.match(/\bA3(\d)0-?(\d)\d\d/i))) out.push(`A3${m[1]}${m[2]}`);
    else if ((m = t.match(/\bA3(\d\d)\b/i))) out.push(`A3${m[1]}`);
    if (/\bA220-?300/i.test(t)) out.push('BCS3');
    if (/\bA220-?100/i.test(t)) out.push('BCS1');
    if ((m = t.match(/\bATR ?(\d)2-?\d00/i))) out.push(`AT${m[1]}6`);
    if ((m = t.match(/\bMD-?(\d\d)/i))) out.push(`MD${m[1]}`);
    if ((m = t.match(/\bE-?1(\d\d)/i))) out.push(`E1${m[1]}`);
    if ((m = t.match(/Embraer ?(1\d\d)/i))) out.push(`E${m[1]}`);
    if (/E-?145|ERJ/i.test(t)) out.push('E145');
    if ((m = t.match(/Fokker ?F?(\d{2,3})|\bF(\d{2,3})\b/i))) out.push(`F${m[1] || m[2]}`);
    if ((m = t.match(/\bRJ ?(\d{2,3})/i))) out.push(m[1] === '100' ? 'RJ1H' : `RJ${m[1]}`);
    if (/BAe ?146/i.test(t)) out.push('B461');
    if ((m = t.match(/CRJ-?(\d{3,4})/i))) out.push(m[1] === '550' ? 'CRJ7' : `CRJ${m[1].slice(0, 1)}`);
    if (/cessna ?208/i.test(t)) out.push('C208');
    if (/saab ?340/i.test(t)) out.push('SF34');
    if (/L-?1011/i.test(t)) out.push('L101');
    if ((m = t.match(/(Ан|An)-(\d+)/i))) out.push(`AN${m[2]}`);
    if ((m = t.match(/(Ту|Tu)-(\d+)/i))) out.push(`T${m[2]}`);
    if ((m = t.match(/(Як|Yak)-(\d+)/i))) out.push(`YK${m[2]}`);
    return out;
  }
  function modelOf(type, mfr) {
    let t = type.replace(/\(.*?\)/g, ' ').replace(/\b(airbus|boeing|embraer|bombardier|fokker|cessna|saab|lockheed)\b/ig, ' ').replace(/\s+/g, ' ').trim();
    const w = t.split(' ');
    const two = w.length > 1 && (!/\d/.test(w[0]) || /^MAX/i.test(w[1]));   // ATR 72-600, Saab 340, 737 MAX8
    t = w.slice(0, two ? 2 : 1).join(' ');
    if (mfr === 'Fokker' && /^\d/.test(t)) t = `F${t}`;
    if (mfr === 'Cessna' && /^\d/.test(t)) t = `C${t}`;
    return t.replace(/\s+(SL|WL|QT|XP)$/i, '').replace(/-MAX/i, ' MAX') || type;
  }
  // DRY LEASE і «Чекаємо у 2026 році» — без маршрутів (і літаків ще нема): у фільтрі не беруть участі, при увімкненому фільтрі ховаються
  const OUT = ['drylease', 'waiting'];
  const FLAGS = new Map();   // ICAO → {src, title} прапора з карток
  const flagImg = c => { const f = FLAGS.get(c); return f ? `<img class="cff-flag" src="${esc(f.src)}" alt="" title="${esc(f.title)}">` : ''; };
  const allCards = () => [...document.querySelectorAll('#companyView .company-section .company-livery-card')].filter(c => !OUT.some(s => c.closest(`.${s}-section`)));
  const byCount = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk', {numeric: true});   // більше пропозицій — вище
  const infos = () => allCards().map(cardInfo);

  // ---------- перевірки ----------
  function typeOk(i) {
    const t = state.type;
    if (!t.value) return true;
    if (t.kind === 'mfr') return i.mfr === t.value;
    if (t.kind === 'model') return i.mfr === t.mfr && i.model === t.value;
    const q = norm(t.value);
    if (q.length === 1) { const m = MFRS.find(([, , l]) => l && l.toLowerCase() === q); if (m) return i.mfr === m[0]; }
    return norm(i.type).includes(q) || norm(i.mfr).startsWith(q) || norm(i.model).includes(q) || i.icao.some(c => norm(c).includes(q));
  }
  function airlineOk(i) {
    const a = state.airline;
    if (!a.value) return true;
    if (a.kind === 'pick') return i.airline === a.value;
    return norm(i.airline).includes(norm(a.value));
  }
  const depOk = i => !state.dep || i.dep.startsWith(state.dep);
  const arrOk = i => !state.arr || i.arr.startsWith(state.arr);
  const active = () => Boolean(state.type.value || state.airline.value || state.dep || state.arr);

  // ---------- панель ----------
  let panel = null;
  function ensurePanel() {
    const view = document.getElementById('companyView');
    const live = view?.querySelector('.liveair-section');
    const wet = view?.querySelector('.wetlease-section');
    if (!view || !wet) return null;
    if (panel && panel.isConnected && panel.nextElementSibling === wet) return panel;
    if (!panel) build();
    wet.parentElement.insertBefore(panel, wet);
    void live;
    return panel;
  }
  function build() {
    // заголовок панелі вже є в pilot-cabinet.html (#cffPanel) — видно одразу, без «смикання»; тут лише наповнюємо
    panel = document.getElementById('cffPanel') || document.createElement('section');
    panel.className = 'company-panel cff-panel';
    if (!panel.querySelector('.cff-head .cff-rnd')) {   // запасний варіант, якщо в HTML заголовка нема
      panel.innerHTML = `<div class="company-heading cff-head"><button type="button" class="cff-tog" title="Розгорнути фільтр">+</button>
        <span class="cff-title">Фільтр запропонованих рейсів</span><span class="cff-count"></span><button type="button" class="cff-reset" hidden>✕ Скинути</button>
        <button type="button" class="cff-rnd" title="Місія за пиріжки або просто випадковий рейс">🎯 МІСІЯ / Випадковий рейс</button></div>`;
    }
    panel.querySelector('.cff-body')?.remove();
    panel.insertAdjacentHTML('beforeend', `
      <div class="cff-body" hidden>
        ${field('type', 'Тип літака', 'напр. 319, A, Boeing')}
        ${field('airline', 'Авіакомпанія', 'UCAA, Windrose, SkyUp…')}
        ${field('dep', 'Виліт', 'ICAO')}
        ${field('arr', 'Прибуття', 'ICAO')}
      </div>`);
    panel.querySelector('.cff-rnd').onclick = pickRandom;
    panel.querySelector('.cff-tog').onclick = () => { state.open = !state.open; syncOpen(); };
    panel.querySelector('.cff-title').onclick = () => { state.open = !state.open; syncOpen(); };
    panel.querySelector('.cff-reset').onclick = () => {
      state.type = {kind: 'text', value: ''}; state.airline = {kind: 'text', value: ''}; state.dep = ''; state.arr = '';
      panel.querySelectorAll('.cff-field input').forEach(i => { i.value = ''; });
      closePop(); apply();
    };
    panel.querySelectorAll('.cff-field').forEach(f => {
      const key = f.dataset.k, input = f.querySelector('input');
      input.addEventListener('input', () => {
        if (key === 'dep' || key === 'arr') { const v = icaoOnly(input.value); if (input.value !== v) input.value = v; state[key] = v; }
        else state[key] = {kind: 'text', value: input.value.trim()};
        apply();
        // тип літака: почали писати — список закривається (не перекриває результат); інші поля — підказки оновлюються під введене
        if (key === 'type' && input.value.trim()) closePop();
        else if (pop?.dataset.k === key) openPop(key);
      });
      input.addEventListener('focus', () => { if (!(key === 'type' && input.value.trim())) openPop(key); });
      f.querySelector('.cff-pick').onclick = e => { e.stopPropagation(); if (pop?.dataset.k === key) closePop(); else openPop(key); };
      f.querySelector('.cff-clear').onclick = () => {
        input.value = '';
        if (key === 'dep' || key === 'arr') state[key] = ''; else state[key] = {kind: 'text', value: ''};
        closePop(); apply();
      };
    });
    document.addEventListener('click', e => { if (pop && !e.target.closest('.cff-pop') && !e.target.closest('.cff-field')) closePop(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
    syncOpen();
  }
  // «Підібрати випадковий рейс» — рулетка у вікні. Пул: картки з запропонованим рейсом (під фільтр, якщо він увімкнений; згорнуті розділи — теж беремо).
  // Увійшов пілот — лише типи, на яких він уже літав (сімейства як у нагородах за типи: UCAAPilotProfile.pilotAircraftFamilies).
  const FAMILY = {
    A318:'A320',A319:'A320',A320:'A320',A321:'A320',A20N:'A20N',A21N:'A20N',
    B735:'B738',B736:'B738',B737:'B738',B738:'B738',B739:'B738',B38M:'B38M',
    E170:'ERJ',E175:'ERJ',E190:'ERJ',E195:'ERJ',E145:'ERJ',CRJ5:'CRJ',CRJ7:'CRJ',CRJ9:'CRJ',CRJX:'CRJ',
    B752:'B757',B753:'B757',B762:'B767',B763:'B767',B764:'B767',B772:'B777',B773:'B777',B77W:'B777',B77L:'B777',
    B788:'B787',B789:'B787',B78X:'B787',B742:'B747',B744:'B747',B748:'B747',
    A306:'A300',A310:'A300',A332:'A330',A333:'A330',A339:'A330',A342:'A340',A343:'A340',A345:'A340',A346:'A340',
    A359:'A350',A35K:'A350',A388:'A380',AT46:'ATR',AT76:'ATR',AT72:'ATR',AT75:'ATR',AT45:'ATR',AT42:'ATR',
    F28:'F28',F70:'F100',F100:'F100',F27:'F27',F50:'F50',B461:'BAE',B462:'BAE',B463:'BAE',RJ1H:'BAE',RJ85:'BAE',RJ70:'BAE',
    MD80:'MD80',MD82:'MD80',MD83:'MD80',MD88:'MD80',B722:'B727',B727:'B727',MD11:'MD11',L101:'L1011',
    C208:'C208',SF34:'SF34',T154:'T154',YK40:'YK40',AN2:'AN2'
  };
  const famLabel = f => f === 'B738' ? 'B737' : f;
  const familiesOf = i => [...new Set(i.icao.map(c => FAMILY[c] || c))];
  function myFamilies() {
    const me = localStorage.getItem('devCabinetAuth');
    if (!me) return null;
    try { const f = window.UCAAPilotProfile?.pilotAircraftFamilies?.(me); return Array.isArray(f) && f.length ? new Set(f) : null; } catch (e) { return null; }
  }
  function flightPool() {
    // літаки, що зараз у польоті (є в LIVE NOW або картка позначена LIVE), — не в рулетку
    const liveIds = new Set([...document.querySelectorAll('#companyView .liveair-section .company-livery-card')].map(c => c.dataset.aircraftId).filter(Boolean));
    const base = infos().filter(i => i.section !== 'liveair' && i.dep && i.arr && !i.card.classList.contains('cff-hide')
      && !i.card.classList.contains('company-livery-live') && !liveIds.has(i.card.dataset.aircraftId));
    const fam = myFamilies();
    if (!fam) return {list: base, note: active() ? 'з рейсів під фільтр' : 'з усіх запропонованих рейсів'};
    const mine = base.filter(i => familiesOf(i).some(f => fam.has(f)));
    const names = [...fam].map(famLabel).sort().join(', ');
    if (!mine.length) return {list: base, note: `на ваших типах (${names}) зараз рейсів нема — з усіх${active() ? ' під фільтр' : ''}`};
    return {list: mine, note: `на типах, якими ви вже літали: ${names}`};
  }
  const routeHtml = i => `<b>${i.dep}</b>${flagImg(i.dep)} → <b>${i.arr}</b>${flagImg(i.arr)}`;
  // мініатюра літака — та сама картинка, що на картці (вже в кеші браузера)
  const imgOf = i => { const im = i.card.querySelector('img:not(.airport-flag)'); return im ? (im.currentSrc || im.getAttribute('src') || im.dataset.ucaaImgSrc || '') : ''; };
  const tileHtml = i => `<div class="cff-tile">${imgOf(i) ? `<img class="t0" src="${esc(imgOf(i))}" alt="" loading="eager">` : '<div class="t0"></div>'}<div class="t1">${esc(i.model)}</div><div class="t2">${esc(i.airline || '')}</div><div class="t3">${routeHtml(i)}</div></div>`;
  let rouletteBusy = false;
  // ---------- місії (сервер кабінету): прокрутка → «Прийняти місію» / «Відмовитись»; правила й перевірку польоту веде сервер ----------
  const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
  const API = (LOCAL && localStorage.getItem('kazuarApiOverride')) || 'https://kazuar-cabinet-api-production.up.railway.app';
  const loggedIn = () => Boolean(localStorage.getItem('devCabinetAuth') && localStorage.getItem('kazuarCabToken'));
  async function mapi(path, body) {
    const tok = localStorage.getItem('kazuarCabToken');
    try {
      const r = await fetch(API + path, {method: body ? 'POST' : 'GET', cache: 'no-store',
        headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: `Bearer ${tok}`} : {})}, body: body ? JSON.stringify(body) : undefined});
      const data = await r.json().catch(() => ({}));
      return {ok: r.ok, status: r.status, data, error: r.ok ? null : (data.error || `Помилка сервера (${r.status})`)};
    } catch (e) {
      return {ok: false, status: 0, data: {}, error: 'Сервер кабінету недоступний — спробуйте за хвилину.'};
    }
  }
  // час в UTC: «14:30 UTC» (інший день — «28.11 14:30 UTC»)
  const utc = iso => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';
    const t = d.toLocaleTimeString('uk-UA', {timeZone: 'UTC', hour: '2-digit', minute: '2-digit'});
    const day = x => x.toISOString().slice(0, 10);
    return `${day(d) === day(new Date()) ? '' : d.toLocaleDateString('uk-UA', {timeZone: 'UTC', day: '2-digit', month: '2-digit'}) + ' '}${t} UTC`;
  };
  const PIE = '<img class="cff-pie" src="assets/icons/pyrih.png" alt="пиріжки">';
  const pies = n => `${n} ${PIE}`;
  const WHEEL_SVG = '<svg class="cff-wheel" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#fff" stroke="#444" stroke-width="2"/><path d="M16 16L16.00 2.00A14 14 0 0 1 29.31 11.67Z" fill="#ffd43b" stroke="#fff"/><path d="M16 16L29.31 11.67A14 14 0 0 1 24.23 27.33Z" fill="#4dabf7" stroke="#fff"/><path d="M16 16L24.23 27.33A14 14 0 0 1 7.77 27.33Z" fill="#ff6b6b" stroke="#fff"/><path d="M16 16L7.77 27.33A14 14 0 0 1 2.69 11.67Z" fill="#51cf66" stroke="#fff"/><path d="M16 16L2.69 11.67A14 14 0 0 1 16.00 2.00Z" fill="#9775fa" stroke="#fff"/><circle cx="16" cy="16" r="3.2" fill="#fff" stroke="#444" stroke-width="1.5"/></svg>';
  const cardById = id => document.querySelector(`#companyView .company-section:not(.liveair-section) .company-livery-card[data-aircraft-id="${CSS.escape(id || '')}"]`);
  function offerOf(i) {
    const badge = i.card.querySelector('.company-livery-offer-route .company-livery-proposal-badge');
    const type = badge?.classList.contains('flight-number-schedule') ? 'schedule' : 'free';
    const title = String(i.card.dataset.liveryTitle || i.card.querySelector('.company-livery-title')?.textContent || '').replace(/📅/g, '').trim();
    const reg = (title.match(/\b[A-Z]{1,2}-[A-Z0-9]{2,5}\b/) || [''])[0];
    return {aircraftId: i.card.dataset.aircraftId || '', title, model: i.model, airline: i.airline, registration: reg, dep: i.dep, arr: i.arr,
            type, flightNumber: type === 'schedule' ? String(badge?.childNodes[0]?.textContent || '').trim() : ''};
  }
  function cardCopy(card) {
    const copy = card.cloneNode(true);
    copy.classList.remove('cff-hide', 'cff-picked', 'cff-onmission');
    copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach(e => e.removeAttribute('id'));
    return copy;
  }
  // показати рейс місії (картку зі сторінки або коротко текстом)
  function showMissionCard(back, m, title) {
    const res = back.querySelector('.cff-rres');
    res.innerHTML = `<div class="cff-rwin">${title}</div>`;
    const card = cardById(m.offer.aircraftId);
    if (card) res.appendChild(cardCopy(card));
    else res.insertAdjacentHTML('beforeend', `<div class="cff-rmtxt"><b>${esc(m.offer.title || m.offer.model)}</b><br>${esc(m.offer.dep)} → ${esc(m.offer.arr)}</div>`);
  }
  // кнопки внизу: spin — «Підібрати» (місія) / «… (без місії)»; accept / decline — лише коли випала пропозиція; close — «Ще подумаю» / «Закрити»
  function setButtons(back, o) {
    const b = s => back.querySelector(s);
    b('.cff-ragain').hidden = !o.spin;
    if (o.spin) b('.cff-ragain').innerHTML = o.spin;
    b('.cff-ragain').disabled = Boolean(o.spinOff);
    b('.cff-raccept').hidden = !o.accept;
    if (o.accept) b('.cff-raccept').innerHTML = o.accept;
    b('.cff-rdecline').hidden = !o.decline;
    if (o.decline) b('.cff-rdecline').innerHTML = o.decline;
    b('.cff-rclose').textContent = o.close || 'Закрити';
  }
  // стан місій у вікні рулетки
  function renderMission(back, st, justAccepted) {
    back.mst = st;
    const box = back.querySelector('.cff-rmission');
    const done = (st.recent || []).filter(m => m.status === 'done').slice(-1)[0];
    const doneHtml = done && Date.now() - new Date(done.flight?.close || 0).getTime() < 36 * 3600e3
      ? `<div class="cff-rmdone">✅ Місію виконано: ${esc(done.offer.dep)} → ${esc(done.offer.arr)} · ${done.pies || done.settled ? `+${pies(done.reward)}` : 'пиріжки нараховуються…'}</div>` : '';
    if (st.offered) {
      const o = st.offered, next = {1: 4, 2: 3}[o.attempt];
      showMissionCard(back, o, '🎉 Вам випало:');
      box.innerHTML = `${doneHtml}<div class="cff-rmtitle">🎯 Місія на <b>${pies(o.reward)}</b> · спроба ${o.attempt} з 3</div>
        <div class="cff-rmrules">Почати рейс треба протягом 6 год (до <b>${utc(Date.now() + 6 * 3600e3)}</b>)<br>
        Завершити — протягом 24 год після прийняття.<br>
        ${next ? `Якщо відмовитесь, наступна прокрутка дасть нагороду макс. ${pies(next)}.` : 'Це остання прокрутка на сьогодні — якщо відмовитесь, нова місія завтра.'}</div>`;
      setButtons(back, {accept: `✅ Прийняти місію<small>на ${pies(o.reward)}</small>`,
        decline: `Відмовитись<small>${next ? `(наступна макс. ${pies(next)})` : '(нова місія завтра)'}</small>`, close: 'Ще подумаю'});
      back.querySelector('.cff-raccept').onclick = () => decide(back, o.id, true);
      back.querySelector('.cff-rdecline').onclick = () => decide(back, o.id, false);
      return;
    }
    if (st.active) {
      const a = st.active;
      showMissionCard(back, a, '🎯 Ваша місія:');
      box.innerHTML = `${doneHtml}<div class="cff-rmok">${justAccepted ? '✅ Місію прийнято! Вона офіційно закріплена за вами.' : '🎯 У вас активна місія.'}</div>
        <div class="cff-rmtitle">Нагорода: <b>${pies(a.reward)}</b> · ${esc(a.offer.dep)} → ${esc(a.offer.arr)}</div>
        <div class="cff-rmrules">Почати рейс до <b>${utc(a.startBy)}</b><br>Завершити до <b>${utc(a.finishBy)}</b><br>
        Нову місію можна взяти після виконання (або коли мине час).</div>`;
      setButtons(back, {close: 'Закрити'});
      return;
    }
    if (!st.canSpin) {   // місій на сьогодні нема — можна крутити просто так
      box.innerHTML = `${doneHtml}<div class="cff-rmrules">${esc(st.reason)}<br>Можна покрутити рулетку без місії — просто підібрати рейс і політати.</div>`;
      setButtons(back, {spin: back.spunFree ? '🎲 Ще раз <small>(без місії)</small>' : '🎲 Підібрати <small>(без місії)</small>', close: 'Закрити'});
      return;
    }
    box.innerHTML = `${doneHtml}<div class="cff-rmtitle">🎯 Місія на <b>${pies(st.nextReward)}</b> · спроба ${st.attempt} з 3</div>
      <div class="cff-rmrules">Підберіть рейс — і вирішите, чи брати місію.</div>`;
    setButtons(back, {spin: '🎲 Підібрати', close: 'Ще подумаю'});
  }
  async function loadMission(back) {
    const box = back.querySelector('.cff-rmission');
    const free = () => setButtons(back, {spin: back.spunFree ? '🎲 Ще раз <small>(без місії)</small>' : '🎲 Підібрати <small>(без місії)</small>', close: 'Закрити'});
    if (!loggedIn()) {
      back.mst = null;
      box.innerHTML = `<div class="cff-rmrules">Увійдіть (форма вгорі справа), щоб брати місії за пиріжки ${PIE}.<br>Без входу можна просто покрутити рулетку.</div>`;
      return free();
    }
    box.innerHTML = '<div class="cff-rmrules">Завантаження місії…</div>';
    const res = await mapi('/missions/state');
    if (!res.ok) { back.mst = null; box.innerHTML = res.status === 404 ? '' : `<div class="cff-rmerr">⚠ ${esc(res.error)}</div>`; return free(); }
    renderMission(back, res.data);
  }
  async function decide(back, id, accept) {
    const btns = back.querySelectorAll('.cff-rbtns button');
    btns.forEach(b => { b.disabled = true; });
    const res = await mapi(accept ? '/missions/accept' : '/missions/decline', {id});
    btns.forEach(b => { b.disabled = false; });
    if (!res.ok) { back.querySelector('.cff-rmission').insertAdjacentHTML('beforeend', `<div class="cff-rmerr">⚠ ${esc(res.error)}</div>`); return; }
    if (!accept) back.querySelector('.cff-rres').innerHTML = '';
    renderMission(back, res.data.state, accept);
    loadActiveMissions(true);
    loadMissionFlights(true);
    window.dispatchEvent(new Event('ucaa-missions-updated'));
  }
  function pickRandom() {
    const view = document.getElementById('companyView');
    if (!view || rouletteBusy) return;
    document.querySelector('.cff-roul')?.remove();
    const back = document.createElement('div');
    back.className = 'cff-roul';
    back.innerHTML = `<div class="cff-rpanel"><div class="cff-rhead"><span>🎯 МІСІЯ / Випадковий рейс</span><button type="button" class="cff-rx" title="Закрити">✕</button></div>
      <div class="cff-rnote"></div><div class="cff-rstage"><div class="cff-rptr"></div><div class="cff-rtape"></div></div><div class="cff-rres"></div>
      <div class="cff-rmission"></div>
      <div class="cff-rbtns"><button type="button" class="cff-ragain">🎲 Підібрати</button><button type="button" class="cff-raccept" hidden></button><button type="button" class="cff-rdecline" hidden></button>
        <button type="button" class="cff-rclose">Ще подумаю</button></div></div>`;
    view.appendChild(back);   // усередині #companyView — копія картки має ті самі стилі, що й на сторінці
    const close = () => { if (!rouletteBusy) back.remove(); };
    back.querySelector('.cff-rx').onclick = close;
    back.querySelector('.cff-rclose').onclick = close;
    back.addEventListener('click', e => { if (e.target === back) close(); });
    back.querySelector('.cff-ragain').onclick = () => spin(back);
    prepare(back);   // рулетка не крутиться сама — спершу вікно з кнопкою «🎲 Підібрати»
    loadMission(back);
  }
  // стартовий вигляд: з чого підбираємо + нерухома стрічка з кількох рейсів
  function prepare(back) {
    const {list, note} = flightPool();
    back.querySelector('.cff-rnote').textContent = list.length ? `Підбір ${note} · ${list.length} ${list.length === 1 ? 'рейс' : list.length < 5 ? 'рейси' : 'рейсів'}` : '';
    const tape = back.querySelector('.cff-rtape');
    tape.style.transition = 'none';
    tape.style.transform = 'translateX(0)';
    if (!list.length) {
      tape.innerHTML = '';
      back.querySelector('.cff-rres').innerHTML = '<div class="cff-rempty">Немає рейсів для вибору — змініть фільтр.</div>';
      back.querySelector('.cff-ragain').disabled = true;
      return;
    }
    tape.innerHTML = Array.from({length: 8}, () => tileHtml(list[Math.floor(Math.random() * list.length)])).join('');
  }
  function spin(back) {
    const st = back.mst;
    if (st && (st.offered || st.active)) { renderMission(back, st); return; }   // спершу рішення по місії
    const mission = Boolean(st && st.canSpin);
    const {list, note} = flightPool();
    const res = back.querySelector('.cff-rres'), tape = back.querySelector('.cff-rtape');
    back.querySelector('.cff-rnote').textContent = list.length ? `Підбір ${note} · ${list.length} ${list.length === 1 ? 'рейс' : list.length < 5 ? 'рейси' : 'рейсів'}` : '';
    res.innerHTML = '';
    if (!list.length) { tape.innerHTML = ''; res.innerHTML = '<div class="cff-rempty">Немає рейсів для вибору — змініть фільтр.</div>'; return; }
    const prev = back.dataset.last;
    let win = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && win.card.dataset.aircraftId && win.card.dataset.aircraftId === prev) win = list.find(x => x !== win);   // не той самий двічі поспіль
    back.dataset.last = win.card.dataset.aircraftId || '';
    // стрічка: випадкові картки, переможець — на 36-й позиції, під стрілкою
    const W = 132, N = 42, WIN = 36;
    const items = Array.from({length: N}, (_, k) => k === WIN ? win : list[Math.floor(Math.random() * list.length)]);
    tape.style.transition = 'none';
    tape.style.transform = 'translateX(0)';
    tape.innerHTML = items.map(tileHtml).join('');
    const stageW = back.querySelector('.cff-rstage').clientWidth;
    const target = WIN * W + W / 2 - stageW / 2 + (Math.random() - 0.5) * (W * 0.6);
    rouletteBusy = true;
    back.querySelectorAll('.cff-rbtns button').forEach(b => { b.disabled = true; });
    void tape.offsetWidth;
    tape.style.transition = 'transform 4.2s cubic-bezier(.12,.75,.15,1)';
    tape.style.transform = `translateX(${-target}px)`;
    // місія: сервер записує пропозицію одразу (поки крутиться) — результат покажемо після зупинки
    const missionReq = mission ? mapi('/missions/spin', {offer: offerOf(win)}) : null;
    setTimeout(async () => {
      rouletteBusy = false;
      back.querySelectorAll('.cff-rbtns button').forEach(b => { b.disabled = false; });
      tape.children[WIN]?.classList.add('win');
      if (missionReq) {
        const r = await missionReq;
        if (r.ok) { renderMission(back, r.data.state); return; }
        back.querySelector('.cff-rmission').insertAdjacentHTML('beforeend', `<div class="cff-rmerr">⚠ ${esc(r.error)}</div>`);
        if (r.data?.state) { renderMission(back, r.data.state); return; }
      }
      back.spunFree = true;
      res.innerHTML = '<div class="cff-rwin">🎉 Ваш рейс:</div>';
      res.appendChild(cardCopy(win.card));
      if (back.mst) renderMission(back, back.mst);
      else setButtons(back, {spin: '🎲 Ще раз <small>(без місії)</small>', close: 'Закрити'});
    }, 4300);
  }
  // ---------- ON MISSION: на LIVE-картці, якщо пілот летить свою місію — золота рамка і «ON MISSION N 🥧» ----------
  let activeMissions = [], activeAt = 0;
  async function loadActiveMissions(force) {
    if (!force && Date.now() - activeAt < 60000) return;
    if (!force && !document.getElementById('companyView')?.offsetParent) return;   // сторінка «Флот і рейси» не відкрита — не питаємо сервер
    activeAt = Date.now();
    const r = await mapi('/missions/active');
    activeMissions = r.ok && Array.isArray(r.data.missions) ? r.data.missions : [];
    markMissions();
  }
  function markMissions() {
    document.querySelectorAll('#companyView .company-livery-card').forEach(card => {
      const badge = card.querySelector('.company-livery-live-badge');
      const pilot = badge?.querySelector('.company-livery-live-pilot')?.textContent.trim().toLowerCase() || '';
      const m = card.classList.contains('company-livery-live') && pilot && activeMissions.find(x => x.offer?.aircraftId === card.dataset.aircraftId
        && String(x.pilotName || '').trim().toLowerCase() === pilot);
      card.classList.toggle('cff-onmission', Boolean(m));
      if (!badge) return;
      let tag = badge.querySelector('.cff-mtag');
      if (m) {
        if (!tag) { tag = document.createElement('strong'); tag.className = 'cff-mtag'; badge.prepend(tag); }
        if (tag.dataset.r !== String(m.reward)) { tag.dataset.r = String(m.reward); tag.innerHTML = `🎯 ON MISSION ${pies(m.reward)}`; }
        badge.classList.add('cff-mbadge');
      } else if (tag) { tag.remove(); badge.classList.remove('cff-mbadge'); }
    });
  }
  // ---------- рейси-місії для інших частин сайту: значки в таблицях рейсів, «за виконану місію», Logbook пиріжків ----------
  let missionFlights = {done: [], active: []}, flightsAt = 0;
  async function loadMissionFlights(force) {
    if (!force && Date.now() - flightsAt < 120000) return;
    flightsAt = Date.now();
    const r = await mapi('/missions/flights');
    if (r.ok && r.data && Array.isArray(r.data.done)) missionFlights = r.data;
  }
  const fid = f => String(f?.id || f?._id || f?.flightId || '').trim();
  const fpilot = f => String(f?.pilot?.id || f?.pilot?._id || f?.pilotId || '').trim();
  const facft = f => String(f?.aircraft?.id || f?.aircraft?._id || f?.aircraftId || '').trim();
  function missionFor(flight) {
    loadMissionFlights();
    const id = fid(flight);
    const done = id && missionFlights.done.find(m => m.flightId === id);
    if (done) return done;
    if (flight?.status === 'completed') return null;
    // LIVE: той самий пілот і літак, що в активній місії
    const p = fpilot(flight), a = facft(flight);
    return (p && a && missionFlights.active.find(m => m.pilotId === p && m.offer?.aircraftId === a)) || null;
  }
  function missionIconsHtml(flight, withMoney) {
    const m = missionFor(flight);
    if (!m) return '';
    const piesTitle = m.status === 'done' ? (m.pies || m.settled ? `Місія: +${m.reward} пиріжки за виконаний рейс` : 'Місія: пиріжки нараховуються') : `Місія на ${m.reward} пиріжки — рейс у польоті`;
    return (withMoney ? '<span class="guaranteed-bonus-icon" title="Запропонований рейс">\u{1F4B0}</span>' : '')
      + `<span class="flight-pies-icon cff-mission-pie" title="${esc(piesTitle)}"><img src="assets/icons/pyrih.png" alt="пиріжки"></span>`
      + '<span class="flight-source-icon cff-mission-icon" title="Місія (рулетка «МІСІЯ / Випадковий рейс»)">🎯</span>';   // 🎡 — тільки для колеса фортуни
  }
  // віртуальні записи для Logbook пиріжків: рейс-місія — один рядок з повною нагородою 5/4/3
  function ledgerEntries(pilotId) {
    loadMissionFlights();
    return missionFlights.done.filter(m => m.pilotId === String(pilotId) && (m.pies || m.settled)).map(m => ({
      id: `mission:${m.flightId}`, kind: 'earn', category: 'mission', mission: true, pilotId: m.pilotId, flightId: m.flightId,
      delta: m.reward, completedAt: m.flight?.close, poolKey: ''}));
  }
  window.UCAAMissions = {open: () => pickRandom(), missionFor, iconsHtml: missionIconsHtml, ledgerEntries, wheelSvg: WHEEL_SVG,
    isMissionFlight: flight => Boolean(missionFor(flight)), missionFlightIds: () => new Set(missionFlights.done.map(m => m.flightId))};
  loadMissionFlights(true);
  // «Показати на сторінці»: розгорнути розділ, якщо згорнутий, прокрутити й обвести картку
  let pickedTimer = null;
  function showOnPage(card) {
    const sec = card.closest('.company-section');
    const tog = sec?.querySelector(':scope > .company-heading .company-livery-collapse');
    if (tog && !card.offsetParent && /\+/.test(tog.textContent)) tog.click();
    document.querySelectorAll('.cff-picked').forEach(c => c.classList.remove('cff-picked'));
    card.classList.add('cff-picked');
    card.scrollIntoView({behavior: 'smooth', block: 'center'});
    clearTimeout(pickedTimer);
    pickedTimer = setTimeout(() => card.classList.remove('cff-picked'), 6000);
  }
  function field(k, label, ph) {
    return `<div class="cff-field" data-k="${k}"><span class="cff-lbl">${label}</span><div class="cff-row">
      <input type="text" autocomplete="off" spellcheck="false" placeholder="${ph}"${k === 'dep' || k === 'arr' ? ' maxlength="4"' : ''}>
      <button type="button" class="cff-pick" title="Вибрати зі списку">▾</button><button type="button" class="cff-clear" title="Очистити">✕</button></div></div>`;
  }
  function syncOpen() {
    panel.querySelector('.cff-body').hidden = !state.open;
    const t = panel.querySelector('.cff-tog');
    t.textContent = state.open ? '−' : '+';
    t.title = state.open ? 'Згорнути фільтр' : 'Розгорнути фільтр';
    if (!state.open) closePop();
  }

  // ---------- випадні списки ----------
  let pop = null;
  function closePop() { pop?.remove(); pop = null; }
  function openPop(key) {
    closePop();
    const f = panel.querySelector(`.cff-field[data-k="${key}"]`);
    pop = document.createElement('div');
    pop.className = `cff-pop cff-pop-${key}`;
    pop.dataset.k = key;
    const list = infos().filter(i => i.section !== 'liveair');   // LIVE — копії карток з інших розділів, не рахуємо двічі
    if (key === 'type') renderTypePop(list.filter(i => airlineOk(i) && depOk(i) && arrOk(i)));
    else if (key === 'airline') renderAirlinePop(list.filter(i => typeOk(i) && depOk(i) && arrOk(i)));
    else renderIcaoPop(key, list.filter(i => typeOk(i) && airlineOk(i) && (key === 'dep' ? arrOk(i) : depOk(i))));
    f.appendChild(pop);
  }
  function countBy(list, fn) { const m = new Map(); list.forEach(i => { const k = fn(i); if (k) m.set(k, (m.get(k) || 0) + 1); }); return m; }
  function renderTypePop(list) {
    const mfrs = [...countBy(list, i => i.mfr)].sort(byCount);
    let cur = state.type.kind === 'mfr' ? state.type.value : state.type.kind === 'model' ? state.type.mfr : '';
    const draw = () => {
      const models = [...countBy(list.filter(i => !cur || i.mfr === cur), i => `${i.mfr}\u0001${i.model}`)].sort(byCount);
      pop.innerHTML = `<div class="cff-cols"><div class="cff-col"><div class="cff-ch">Виробник</div>
          <button type="button" class="cff-opt${!cur ? ' on' : ''}" data-m="">Усі <small>${list.length}</small></button>
          ${mfrs.map(([m, n]) => `<button type="button" class="cff-opt${cur === m ? ' on' : ''}" data-m="${esc(m)}">${esc(m)} <small>${n}</small></button>`).join('')}</div>
        <div class="cff-col"><div class="cff-ch">Модель${cur ? ` · ${esc(cur)}` : ''}</div>
          ${cur ? `<button type="button" class="cff-opt cff-all" data-pickm="${esc(cur)}">✓ Усі ${esc(cur)}</button>` : ''}
          ${models.map(([k, n]) => { const [m, model] = k.split('\u0001'); const on = state.type.kind === 'model' && state.type.value === model && state.type.mfr === m;
            return `<button type="button" class="cff-opt${on ? ' on' : ''}" data-mm="${esc(m)}" data-model="${esc(model)}">${esc(model)} <small>${n}</small></button>`; }).join('') || '<div class="cff-empty">—</div>'}</div></div>`;
      pop.querySelectorAll('[data-m]').forEach(b => { b.onclick = e => { e.stopPropagation(); cur = b.dataset.m; if (!cur) setType({kind: 'text', value: ''}, ''); draw(); }; });
      pop.querySelector('[data-pickm]')?.addEventListener('click', e => { e.stopPropagation(); setType({kind: 'mfr', value: cur}, cur); closePop(); });
      pop.querySelectorAll('[data-model]').forEach(b => { b.onclick = e => { e.stopPropagation(); setType({kind: 'model', value: b.dataset.model, mfr: b.dataset.mm}, `${b.dataset.mm === 'Інші' ? '' : b.dataset.mm + ' '}${b.dataset.model}`); closePop(); }; });
    };
    draw();
  }
  function setType(v, text) { state.type = v; panel.querySelector('.cff-field[data-k="type"] input').value = text; apply(); }
  function renderAirlinePop(list) {
    const by = countBy(list, i => i.airline);
    const special = ['UCAA'].filter(a => by.has(a));   // UCAA (WET LEASE) завжди першою, далі — за кількістю пропозицій
    const rest = [...by].filter(([a]) => !special.includes(a)).sort(byCount).map(([a]) => a);
    const q = state.airline.kind === 'text' ? norm(state.airline.value) : '';
    const names = [...special, ...rest].filter(a => !q || norm(a).includes(q));
    const label = a => a === 'UCAA' ? 'UCAA <small class="cff-note">WET LEASE</small>' : esc(a);
    pop.innerHTML = `<div class="cff-col cff-one">${names.map(a => `<button type="button" class="cff-opt${state.airline.kind === 'pick' && state.airline.value === a ? ' on' : ''}" data-a="${esc(a)}">${label(a)} <small>${by.get(a)}</small></button>`).join('') || '<div class="cff-empty">нічого не знайдено</div>'}</div>`;
    pop.querySelectorAll('[data-a]').forEach(b => { b.onclick = e => {
      e.stopPropagation();
      const a = b.dataset.a;
      state.airline = {kind: 'pick', value: a};
      panel.querySelector('.cff-field[data-k="airline"] input').value = a;
      closePop(); apply();
    }; });
  }
  function renderIcaoPop(key, list) {
    const by = countBy(list.filter(i => i[key]), i => i[key]);
    const cur = state[key];
    const codes = [...by].filter(([c]) => !cur || c.startsWith(cur)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    pop.innerHTML = `<div class="cff-col cff-one cff-icaos">${codes.map(([c, n]) => `<button type="button" class="cff-opt${cur === c ? ' on' : ''}" data-c="${c}"><span class="cff-ic">${c}${flagImg(c)}</span><small>${n}</small></button>`).join('') || '<div class="cff-empty">немає рейсів</div>'}</div>`;
    pop.querySelectorAll('[data-c]').forEach(b => { b.onclick = e => {
      e.stopPropagation();
      state[key] = b.dataset.c;
      panel.querySelector(`.cff-field[data-k="${key}"] input`).value = b.dataset.c;
      closePop(); apply();
    }; });
  }

  // ---------- застосувати ----------
  let applying = false;
  function apply() {
    if (!ensurePanel()) return;
    applying = true;
    const on = active();
    let shown = 0;
    const list = infos();
    list.forEach(i => {
      if (i.section === 'liveair') { i.card.classList.remove('cff-hide'); return; }   // LIVE NOW і вкладки — завжди як є, фільтр їх не чіпає
      const ok = !on || (typeOk(i) && airlineOk(i) && depOk(i) && arrOk(i));
      i.card.classList.toggle('cff-hide', !ok);
      if (ok) shown++;
    });
    // секції, де після фільтру нічого не лишилось, — ховаємо (поки фільтр увімкнено); LIVE NOW — ніколи
    SECTIONS.forEach(s => {
      const sec = document.querySelector(`#companyView .${s}-section`);
      if (!sec || s === 'liveair') { sec?.classList.remove('cff-hide-sec'); return; }
      const any = !OUT.includes(s) && [...sec.querySelectorAll('.company-livery-card')].some(c => !c.classList.contains('cff-hide'));
      sec.classList.toggle('cff-hide-sec', on && !any);
    });
    const total = list.filter(i => i.section !== 'liveair').length;
    panel.querySelector('.cff-count').textContent = on ? `знайдено ${shown} з ${total}` : '';
    panel.querySelector('.cff-reset').hidden = !on;
    panel.classList.toggle('cff-active', on);
    markMissions();
    loadActiveMissions();
    setTimeout(() => { applying = false; }, 0);
  }

  // ---------- стилі ----------
  const st = document.createElement('style');
  st.textContent = `
    #companyView .company-livery-card.cff-hide,#companyView .company-section.cff-hide-sec{display:none!important}
    /* вигляд заголовка (−/+, назва, «Підібрати випадковий рейс») — у pilot-cabinet.html, тут лише стан і «Скинути» */
    .cff-panel.cff-active .cff-head{background:linear-gradient(90deg,#ffe9a8 0%,#fff9e6 60%)}
    .cff-panel .cff-reset{height:24.75px;box-sizing:border-box;padding:2px 9px;border:1px solid #c0392b;background:#fdecea;color:#c0392b;font:bold 12px Arial,sans-serif;cursor:pointer}
    .cff-panel .cff-reset:hover{background:#c0392b;color:#fff}
    .cff-panel .cff-body{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:8px 10px 10px}
    .cff-panel .cff-body[hidden]{display:none}
    .cff-field{position:relative;min-width:0}
    .cff-lbl{display:block;margin-bottom:3px;font:bold 11px Arial,sans-serif;color:#555;text-transform:uppercase}
    .cff-row{display:flex;gap:3px}
    .cff-row input{flex:1;min-width:0;box-sizing:border-box;padding:5px 8px;border:1px solid #999;background:#fff;font:14px Arial,sans-serif}
    .cff-field[data-k="dep"] input,.cff-field[data-k="arr"] input{font:bold 15px Consolas,"Courier New",monospace;letter-spacing:2px;text-transform:uppercase}
    .cff-row input::placeholder{font:13px Arial,sans-serif;letter-spacing:0;text-transform:none;color:#999}
    .cff-row input:focus{outline:none;background:#fffbe0;border-color:#b08b26}
    .cff-row button{flex:none;width:28px;padding:0;border:1px solid #999;background:#fff;color:#555;font:14px Arial;cursor:pointer}
    .cff-row button:hover{background:#fff6c8}
    .cff-row .cff-clear{color:#aaa}
    .cff-row .cff-clear:hover{color:#a33;background:#fff0f0}
    .cff-pop{position:absolute;left:0;top:100%;z-index:700;margin-top:3px;min-width:100%;max-height:360px;overflow:auto;background:#fff;border:1px solid #777;box-shadow:0 4px 14px rgba(0,0,0,.2);font:13px Arial,sans-serif}
    .cff-pop-type{width:420px;max-width:92vw}
    .cff-cols{display:grid;grid-template-columns:170px 1fr}
    .cff-col{display:flex;flex-direction:column;padding:4px;min-width:0}
    .cff-cols .cff-col + .cff-col{border-left:1px solid #ddd}
    .cff-col.cff-icaos{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:2px}
    .cff-ch{padding:2px 6px 4px;font:bold 11px Arial,sans-serif;color:#777;text-transform:uppercase}
    .cff-opt{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;border:0;background:none;text-align:left;font:13px Arial,sans-serif;cursor:pointer;white-space:nowrap}
    .cff-opt:hover{background:#fff6c8}
    .cff-opt.on{background:#ffee8c;font-weight:bold}
    .cff-opt small{color:#888;font-weight:normal}
    .cff-opt .cff-note{color:#2f7d32;font-size:11px}
    .cff-opt.cff-all{color:#2459d3;font-weight:bold}
    .cff-icaos .cff-opt{font-family:Consolas,"Courier New",monospace;font-weight:bold}
    .cff-icaos .cff-ic{display:inline-flex;align-items:center;gap:5px}
    .cff-flag{width:18px;height:12px;object-fit:cover;border:1px solid #ccc;vertical-align:middle}
    .cff-col.cff-icaos{grid-template-columns:repeat(auto-fill,minmax(104px,1fr))}
    .cff-pop-dep,.cff-pop-arr{min-width:236px}
    .cff-empty{padding:6px 8px;color:#999}
    .cff-roul{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}
    .cff-rpanel{width:min(880px,96vw);max-height:94vh;overflow:auto;background:#fff;border:1px solid #555;box-shadow:0 6px 24px rgba(0,0,0,.35);font:13px Arial,sans-serif;color:#222}
    .cff-rhead{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:linear-gradient(90deg,#d6e6f5 0%,#f4f8fc 60%);border-bottom:1px solid #8f8f8f;font:bold 15px Arial,sans-serif}
    .cff-rx{border:1px solid #9c9c9c;background:#fff;font:bold 14px/1 Arial;padding:3px 8px;cursor:pointer}
    .cff-rnote{padding:6px 12px 0;color:#555;font-size:12px;text-align:center}
    .cff-rstage{position:relative;height:150px;margin:10px 12px;overflow:hidden;border:1px solid #bbb;background:linear-gradient(90deg,#eef2f6,#fff 20%,#fff 80%,#eef2f6)}
    .cff-rptr{position:absolute;left:50%;top:0;bottom:0;z-index:2;width:0;border-left:3px solid #e03131;transform:translateX(-1.5px);pointer-events:none}
    .cff-rptr::before{content:'';position:absolute;left:-10px;top:-1px;border-left:8.5px solid transparent;border-right:8.5px solid transparent;border-top:12px solid #e03131}
    .cff-rtape{display:flex;height:100%;will-change:transform}
    .cff-tile{flex:none;width:124px;margin:6px 4px;padding:6px;box-sizing:border-box;border:1px solid #ccc;border-radius:6px;background:#fff;text-align:center;overflow:hidden;white-space:nowrap}
    .cff-tile{padding:4px 5px 6px}
    .cff-tile .t0{display:block;width:100%;height:58px;margin-bottom:4px;border-radius:4px;object-fit:cover;background:#eef2f6}
    .cff-tile .t1{font:bold 14px Arial,sans-serif}
    .cff-tile .t2{font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis}
    .cff-tile .t3{margin-top:4px;font:12px Consolas,"Courier New",monospace}
    .cff-tile .t3 .cff-flag{width:14px;height:10px;margin:0 2px}
    .cff-tile.win{border:2px solid #f29f05;background:#fff6d6}
    .cff-rres{display:flex;flex-direction:column;align-items:center;padding:0 12px}
    .cff-rres .company-livery-card{width:min(330px,100%);margin:6px auto 0}
    .cff-rwin{font:bold 15px Arial,sans-serif;color:#2b5a24}
    .cff-rempty{padding:14px;color:#a33}
    .cff-rbtns{display:flex;justify-content:center;gap:8px;padding:12px}
    .cff-rbtns button{padding:5px 14px;border:1px solid #9c9c9c;background:linear-gradient(#fff 0%,#f1f1f1 100%);font:bold 13px Arial,sans-serif;cursor:pointer}
    .cff-rbtns .cff-ragain{background:#ffee8c;border-color:#b08b26}
    .cff-rbtns button:disabled{opacity:.5;cursor:wait}
    .cff-rmission{margin:10px 14px 0;padding:8px 12px;border:1px solid #e3d29a;border-radius:6px;background:#fffbea;text-align:center}
    .cff-rmission:empty{display:none}
    .cff-rmtitle{font:15px Arial,sans-serif}
    .cff-rmrules{margin-top:5px;color:#444;font-size:13px;line-height:1.55}
    .cff-rmdone{margin-bottom:6px;padding:5px 8px;border:1px solid #9cc794;background:#eaf6e6;color:#2b5a24;font-weight:bold}
    .cff-rmok{margin-bottom:6px;padding:6px 8px;border:1px solid #5f9e55;background:#d7f2da;color:#1f5f2b;font:bold 14px Arial,sans-serif}
    .cff-rmerr{margin-top:6px;color:#a33;font-weight:bold}
    .cff-rmtxt{margin:8px 0;font-size:14px;text-align:center}
    .cff-pie{width:17px;height:17px;object-fit:contain;vertical-align:-3px}
    .cff-rhead .cff-wheel{width:18px;height:18px;vertical-align:-4px;margin-left:4px}
    .cff-rbtns button{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;min-width:150px;min-height:44px;padding:5px 16px;line-height:1.25}
    .cff-rbtns button small{display:block;font-weight:normal;font-size:12px;margin-top:2px}
    .cff-rbtns button[hidden]{display:none}
    .cff-rbtns .cff-raccept{background:#d7f2da;border-color:#5f9e55;color:#1f5f2b}
    .cff-rbtns .cff-raccept:hover{background:#c2e9c7}
    .cff-rbtns .cff-rdecline{color:#a33}
    .cff-rbtns .cff-rclose{color:#555}
    .flight-reward-icons .cff-mission-icon{margin-left:5px}
    .flight-reward-icons .cff-mission-pie img{position:relative;top:2px}
    #companyView .company-livery-card.cff-onmission{outline:3px solid #d4a017;outline-offset:1px;box-shadow:0 0 0 5px rgba(212,160,23,.28),0 0 16px rgba(212,160,23,.55)}
    #companyView .company-livery-live-badge.cff-mbadge{display:inline-flex;flex-wrap:nowrap;align-items:center;gap:4px;white-space:nowrap;max-width:none;background:linear-gradient(90deg,#fff3c4,#ffd966);border-color:#b8860b}
    #companyView .company-livery-live-badge.cff-mbadge > strong:not(.cff-mtag){display:none}
    #companyView .company-livery-live-badge .cff-mtag{display:inline-flex;align-items:center;gap:3px;color:#7a4f00;white-space:nowrap}
    #companyView .company-livery-live-badge .cff-mtag img.cff-pie{width:15px;height:15px;margin:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;object-fit:contain;vertical-align:middle}
    body.mobile-cabinet .cff-panel .cff-body{grid-template-columns:1fr 1fr}
    @media (max-width:560px){.cff-panel .cff-body{grid-template-columns:1fr}.cff-pop-type{width:auto}.cff-cols{grid-template-columns:130px 1fr}}`;
  document.head.appendChild(st);

  // ---------- запуск і повтор після перемальовування сторінки ----------
  let t = null;
  const schedule = () => { if (applying) return; clearTimeout(t); t = setTimeout(apply, 150); };
  new MutationObserver(muts => {
    if (muts.every(m => (panel && panel.contains(m.target)) || m.target.closest?.('.cff-roul') || m.target.classList?.contains('cff-roul'))) return;   // зміни в самій панелі й рулетці не рахуються
    schedule();
  }).observe(document.body, {childList: true, subtree: true});
  setInterval(() => { if (document.getElementById('companyView') && (!panel || !panel.isConnected)) apply(); }, 1500);
  apply();
})();
