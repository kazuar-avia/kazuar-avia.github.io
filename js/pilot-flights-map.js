// Карта виконаних рейсів пілота (профіль → «ТАБЛИЦЯ РЕЙСІВ ЗА ВИБРАНИЙ ПЕРІОД» → «🗺 ПОКАЗАТИ НА КАРТІ»).
// Вікно і стиль — як «Карта маршрутів» у «Флот і рейси» (ті самі класи company-route-*).
// Виклик: window.UCAAPilotFlightsMap.open(flights, title), flights — нормалізовані рейси (departure/arrival.location).
// Фільтри: країна (клік по прапору; потім ВСІ / ВИЛІТ / ПРИБУТТЯ) і типи літаків (можна кілька).
(function () {
  const TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}{r}.png?key=cb1_3ru0_1_a901fffcbed84bfbb252eede';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const icaoOf = a => String(a?.icao || '').trim().toUpperCase();
  const typeOf = f => String(f.aircraft?.icao || '').trim().toUpperCase() || '?';
  // Pax / Cargo і Free / Schedule / Charter — як у таблиці рейсів сайту
  const loadOf = f => {
    const ui = window.UCAADashboardFlightUI || {};
    if (ui.flightPayloadKind) return ui.flightPayloadKind(f).label === 'Cargo' ? 'cargo' : 'pax';
    return (String(f.flightType).toLowerCase() === 'cargo' || (!f.operations?.passengers && f.operations?.cargo)) ? 'cargo' : 'pax';
  };
  const opOf = f => {
    const ui = window.UCAADashboardFlightUI || {};
    if (ui.flightOperation) return ui.flightOperation(f).key;
    return f.operations?.charter ? 'charter' : f.operations?.scheduled ? 'schedule' : 'free';
  };
  const LOADS = [['pax', '👨‍💼 Pax'], ['cargo', '📦 Cargo']];
  const OPS = [['free', 'Free'], ['schedule', 'Schedule'], ['charter', 'Charter']];
  const pointOf = a => {
    const lat = Number(a?.location?.lat), lon = Number(a?.location?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? {lat, lon} : null;
  };
  const flightDate = f => new Date(f.times?.actualArrival || f.times?.closed || f.times?.takeoff || f.times?.scheduledDeparture);
  const dateShort = d => isNaN(d) ? '—' : `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const flightsWord = n => (n % 10 === 1 && n % 100 !== 11) ? 'рейс' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'рейси' : 'рейсів';
  const airportHtml = a => {
    const ui = window.UCAADashboardFlightUI || {};
    return ui.airportWithFlag ? ui.airportWithFlag(a) : `<span>${esc(icaoOf(a))}</span>`;
  };
  // країна аеропорту — з того самого прапора, що й у таблицях сайту
  const countryCache = new Map();
  const countryOf = a => {
    const icao = icaoOf(a);
    if (countryCache.has(icao)) return countryCache.get(icao);
    const html = airportHtml(a);
    const m = html.match(/flagcdn\.com\/w20\/([a-z-]+)\.png"[^>]*title="([^"]*)"/i);
    const res = m ? {cc: m[1].toLowerCase(), name: m[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&')} : null;
    countryCache.set(icao, res);
    return res;
  };

  // дуга великого кола (як летять літаки), 48 точок
  function arc(a, b) {
    const rad = Math.PI / 180, toV = p => [Math.cos(p.lat * rad) * Math.cos(p.lon * rad), Math.cos(p.lat * rad) * Math.sin(p.lon * rad), Math.sin(p.lat * rad)];
    const va = toV(a), vb = toV(b);
    const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    const w = Math.acos(dot);
    if (w < 1e-6) return [[a.lat, a.lon], [b.lat, b.lon]];
    const pts = [];
    let prevLon = null;
    for (let k = 0; k <= 48; k++) {
      const t = k / 48, s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
      const x = s1 * va[0] + s2 * vb[0], y = s1 * va[1] + s2 * vb[1], z = s1 * va[2] + s2 * vb[2];
      let lon = Math.atan2(y, x) / rad;
      if (prevLon !== null) while (lon - prevLon > 180) lon -= 360;
      if (prevLon !== null) while (lon - prevLon < -180) lon += 360;
      prevLon = lon;
      pts.push([Math.atan2(z, Math.hypot(x, y)) / rad, lon]);
    }
    return pts;
  }
  const km = (a, b) => {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  };

  let dialog = null;
  let map = null;

  // стилі потрібні одразу (кнопка «Показати на карті» на сторінці), а не лише при першому відкритті карти
  function ensureStyle() {
    if (!document.getElementById('pilotFlightsMapStyle')) {
      const st = document.createElement('style');
      st.id = 'pilotFlightsMapStyle';
      st.textContent = `
        #pilotFlightsMapDialog.company-route-map-dialog{width:min(97vw,1600px)!important;max-width:97vw!important}
        #pilotFlightsMapDialog .company-route-map-shell,#pilotFlightsMapDialog .company-route-map{height:calc(100vh - 162px);min-height:400px}
        #pilotFlightsMapDialog .pfm-periods{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:0 0 6px;padding:5px 7px;border:1px solid #777;background:#f6effa}
        #pilotFlightsMapDialog .pfm-periods:empty{display:none}
        #pilotFlightsMapDialog .pfm-periods .ic{font-size:15px;margin-right:4px}
        #pilotFlightsMapDialog .pfm-periods button{padding:3px 8px;border:1px solid #777;border-radius:0;background:#fff;color:#111;font:13px Arial,sans-serif;cursor:pointer}
        #pilotFlightsMapDialog .pfm-periods button:hover{background:#fff6c8}
        #pilotFlightsMapDialog .pfm-periods button.active{background:#d9f5e0;border:2px solid #2f9e57;padding:2px 7px;font-weight:bold}
        #pilotFlightsMapDialog .pfm-periods .cal{display:inline-flex;align-items:center;gap:4px;margin-left:6px;padding:2px 6px;border:1px solid #777;background:#fff;font:13px Arial,sans-serif}
        #pilotFlightsMapDialog .pfm-periods .cal.active{background:#d9f5e0;border:2px solid #2f9e57;padding:1px 5px}
        #pilotFlightsMapDialog .pfm-periods .cal input{font:12px Arial,sans-serif;padding:1px 3px;border:1px solid #aaa;border-radius:0}
        #pilotFlightsMapDialog .company-route-map-list{top:8px;max-height:calc(100% - 30px);width:200px;display:flex;flex-direction:column}
        #pilotFlightsMapDialog .company-route-flight-list{max-height:none;flex:1;min-height:0}
        #pilotFlightsMapDialog .company-route-flight-list button .d{color:#666;font-weight:normal;margin-right:3px}
        #pilotFlightsMapDialog .company-route-flight-list button.active{background:#ffe9b8;border-color:#f29f05}
        #pilotFlightsMapDialog .company-route-map-list-head{display:flex;align-items:center;gap:4px;margin-bottom:3px;font-weight:bold}
        #pilotFlightsMapDialog .company-route-map-list-head .all{margin-left:auto;font:11px Arial;padding:1px 5px;cursor:pointer}
        #pilotFlightsMapDialog .pfm-side{position:absolute;z-index:510;left:56px;top:8px;max-width:min(640px,calc(100% - 290px));display:flex;flex-direction:column;gap:6px;font:12px/1.35 Arial,sans-serif;color:#222}
        #pilotFlightsMapDialog .pfm-side .company-route-map-panel{position:static}
        #pilotFlightsMapDialog .pfm-stats b{font-size:13px}
        #pilotFlightsMapDialog .pfm-row{display:flex;flex-wrap:wrap;align-items:center;gap:3px}
        #pilotFlightsMapDialog .pfm-row + .pfm-row{margin-top:5px}
        #pilotFlightsMapDialog .pfm-lbl{font-weight:bold;font-size:11px;color:#555;text-transform:uppercase;margin-right:3px;min-width:52px}
        #pilotFlightsMapDialog .pfm-flag{display:inline-flex;align-items:center;padding:2px;border:1px solid #bbb;background:#fff;cursor:pointer;line-height:0}
        #pilotFlightsMapDialog .pfm-flag img{width:22px;height:15px;object-fit:cover;display:block}
        #pilotFlightsMapDialog .pfm-flag:hover{border-color:#555}
        #pilotFlightsMapDialog .pfm-flag.active{border:2px solid #f29f05;padding:1px;background:#ffe9b8}
        #pilotFlightsMapDialog .pfm-flags.has-sel .pfm-flag:not(.active) img{opacity:.45}
        #pilotFlightsMapDialog .pfm-dir,#pilotFlightsMapDialog .pfm-type,#pilotFlightsMapDialog .pfm-reset{padding:2px 7px;border:1px solid #777;border-radius:0;background:#fff;color:#111;font:bold 11px Arial,sans-serif;cursor:pointer}
        #pilotFlightsMapDialog .pfm-dir:hover,#pilotFlightsMapDialog .pfm-type:hover{background:#fff6c8}
        #pilotFlightsMapDialog .pfm-dir.active,#pilotFlightsMapDialog .pfm-type.active{background:#ffee8c;border-color:#b08b26}
        #pilotFlightsMapDialog .pfm-dir:disabled{opacity:.45;cursor:default}
        #pilotFlightsMapDialog .pfm-type small,#pilotFlightsMapDialog .pfm-opt small{font-weight:normal;color:#666;margin-left:3px}
        #pilotFlightsMapDialog .pfm-opt{display:inline-flex;align-items:center;padding:2px 6px;border:1px solid #777;border-radius:0;background:#fff;color:#111;font:bold 11px Arial,sans-serif;cursor:pointer}
        #pilotFlightsMapDialog .pfm-opt .flight-number-link{font-size:10px;padding:0 4px}
        #pilotFlightsMapDialog .pfm-opt:hover{background:#fff6c8}
        #pilotFlightsMapDialog .pfm-opt.active{background:#ffee8c;border-color:#b08b26}
        #pilotFlightsMapDialog .pfm-opt:disabled{opacity:.4;cursor:default}
        #pilotFlightsMapDialog .pfm-row{position:relative;padding-left:70px;row-gap:4px}
        #pilotFlightsMapDialog .pfm-row > .pfm-lbl{position:absolute;left:0;top:4px;margin:0;min-width:0}
        #pilotFlightsMapDialog .pfm-sep{width:1px;height:16px;background:#bbb;margin:0 4px}
        #pilotFlightsMapDialog .pfm-cname{font-weight:bold;margin:0 4px 0 2px}
        #pilotFlightsMapDialog .pfm-stats{display:flex;align-items:center;gap:10px}
        #pilotFlightsMapDialog .pfm-stats .pfm-stxt{flex:1}
        #pilotFlightsMapDialog .pfm-reset{flex:none;margin-left:auto;padding:4px 10px;border:2px solid #c0392b;background:#fdecea;color:#c0392b;font:bold 12px Arial,sans-serif}
        #pilotFlightsMapDialog .pfm-reset:hover{background:#c0392b;color:#fff}
        #pilotFlightsMapDialog .company-route-airport-label{cursor:pointer}
        #pilotFlightsMapDialog .leaflet-interactive:focus,#pilotFlightsMapDialog .leaflet-interactive:focus-visible{outline:none}
        #pilotFlightsMapDialog path.pfm-hit{cursor:pointer}
        #pilotFlightsMapDialog .pfm-fhead{display:flex;align-items:center;gap:6px;margin-bottom:5px;font:bold 12px Arial,sans-serif}
        #pilotFlightsMapDialog .pfm-fbox.collapsed{align-self:flex-start}
        #pilotFlightsMapDialog .pfm-fbox.collapsed .pfm-fhead{margin-bottom:0}
        #pilotFlightsMapDialog .pfm-fbox.collapsed .pfm-filters{display:none}
        #pilotFlightsMapDialog .pfm-table{position:absolute;z-index:520;left:8px;bottom:22px;width:min(900px,calc(100% - 232px));max-height:45%;display:flex;flex-direction:column;background:#fff;border:1px solid #777;box-shadow:0 2px 10px #0003}
        #pilotFlightsMapDialog .pfm-table[hidden]{display:none}
        #pilotFlightsMapDialog .pfm-table-head{display:flex;align-items:center;gap:8px;padding:4px 8px;background:#c7eef2;border-bottom:1px solid #777;font:bold 13px Arial,sans-serif}
        #pilotFlightsMapDialog .pfm-table-title{flex:1}
        #pilotFlightsMapDialog .pfm-table-close{border:1px solid #777;background:#fff;font:bold 14px/1 Arial;padding:1px 6px;cursor:pointer}
        #pilotFlightsMapDialog .pfm-table-close:hover{background:#fdecea}
        #pilotFlightsMapDialog .pfm-table-body{overflow:auto;flex:1;min-height:0}
        #pilotFlightsMapDialog .pfm-table-body table{width:100%;margin:0;border-collapse:collapse}
        .profile-v2 .profile-flights-title{display:flex;align-items:center;justify-content:center;gap:40px}
        .profile-v2 .profile-flights-map-button{padding:1px 8px;border:1px solid #777;border-radius:0;background:#ffee8c;color:#111;font:bold 11px/16px Arial,sans-serif;cursor:pointer}
        .profile-v2 .profile-flights-map-button:hover{background:#f7df5a}
        .profile-v2 .profile-flights-map-button:disabled{opacity:.5;cursor:default}`;
      document.head.appendChild(st);
    }
  }
  ensureStyle();

  function ensureDialog() {
    if (dialog) return dialog;
    ensureStyle();
    dialog = document.createElement('dialog');
    dialog.id = 'pilotFlightsMapDialog';
    dialog.className = 'flight-info-dialog company-livery-modal company-route-map-dialog';
    dialog.innerHTML = `<div class="modal-head"><h2 class="pfm-title">Карта польотів</h2><button type="button" class="close" aria-label="Закрити">×</button></div>
      <div class="flight-info-body"><div class="pfm-periods"></div><div class="company-route-map-shell"><div class="company-route-map pfm-map"></div>
        <div class="pfm-side"><div class="company-route-map-panel pfm-stats"></div><div class="company-route-map-panel pfm-fbox"><div class="pfm-fhead"><button type="button" class="company-route-list-toggle pfm-ftog" title="Згорнути фільтр">−</button><span>ФІЛЬТР</span></div><div class="pfm-filters"></div></div></div>
        <div class="pfm-table profile-v2" hidden><div class="pfm-table-head"><span class="pfm-table-title"></span><button type="button" class="pfm-table-close" title="Закрити табличку">×</button></div><div class="pfm-table-body profile-flight-window"></div></div>
        <div class="company-route-map-panel company-route-map-list">
          <div class="company-route-map-list-head"><button type="button" class="company-route-list-toggle" title="Згорнути список">−</button><span class="company-route-map-list-title"></span><button type="button" class="all" hidden>усі</button></div>
          <div class="company-route-flight-list"></div>
        </div></div></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.close').onclick = () => dialog.close();
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    const fbox = dialog.querySelector('.pfm-fbox'), ftog = dialog.querySelector('.pfm-ftog');
    ftog.onclick = () => {
      const c = fbox.classList.toggle('collapsed');
      ftog.textContent = c ? '+' : '−';
      ftog.title = c ? 'Розгорнути фільтр' : 'Згорнути фільтр';
    };
    const panel = dialog.querySelector('.company-route-map-list'), tog = dialog.querySelector('.company-route-map-list .company-route-list-toggle');
    tog.onclick = () => {
      const c = panel.classList.toggle('company-route-map-list-collapsed');
      tog.textContent = c ? '+' : '−';
      tog.title = c ? 'Розгорнути список' : 'Згорнути список';
    };
    return dialog;
  }

  let lastSig = '', lastFilt = null;

  // панель періоду — та сама, що на сторінці пілота; клік міняє період і на сторінці (period.set → профіль перемальовується і сам оновлює карту)
  function renderPeriods(dlg, period) {
    const box = dlg.querySelector('.pfm-periods');
    if (!period?.periods || !period.set) { box.innerHTML = ''; return; }
    const custom = period.period === 'customDate' || period.period === 'customRange';
    box.innerHTML = `<span class="ic" title="Період">⏱️</span>${period.periods.map(([key, label]) =>
      `<button type="button" data-p="${esc(key)}" class="${period.period === key ? 'active' : ''}">${esc(label)}</button>`).join('')}
      <span class="cal ${custom ? 'active' : ''}" title="Своя дата або період (друге поле можна лишити порожнім)">📅 <input type="date" class="d1" value="${esc(period.customDate || '')}"> — <input type="date" class="d2" value="${esc(period.period === 'customRange' ? period.customEndDate || '' : '')}"></span>`;
    box.onclick = e => {
      const b = e.target.closest('button[data-p]');
      if (b && b.dataset.p !== period.period) period.set({period: b.dataset.p});
    };
    const d1 = box.querySelector('.d1'), d2 = box.querySelector('.d2');
    box.onchange = () => {
      let a = d1.value, b = d2.value;
      if (!a && b) { a = b; b = ''; }
      if (!a) return;
      if (b && b < a) [a, b] = [b, a];
      if (b && b !== a) period.set({period: 'customRange', customDate: a, customEndDate: b});
      else period.set({period: 'customDate', customDate: a});
    };
  }

  function open(flights, title, period) {
    const dlg = ensureDialog();
    const refresh = dlg.open;
    dlg.querySelector('.pfm-title').textContent = `Карта польотів${title ? ` - ${title}` : ''}`;
    renderPeriods(dlg, period);
    // сторінка перемалювалась без змін у рейсах — карту не чіпаємо
    const sig = `${title}|${(flights || []).map(f => f.id).join(',')}`;
    if (refresh && sig === lastSig) return;
    lastSig = sig;
    if (!dlg.open) dlg.showModal();
    const mapEl = dlg.querySelector('.pfm-map');
    if (typeof L === 'undefined') { mapEl.innerHTML = '<div class="company-route-empty">Карта не завантажилась: Leaflet недоступний.</div>'; return; }
    if (map) { map.remove(); map = null; }
    map = L.map(mapEl, {scrollWheelZoom: true, worldCopyJump: true});
    L.tileLayer(TILES, {attribution: '&copy; OpenStreetMap contributors &copy; CARTO'}).addTo(map);

    const all = (flights || []).filter(f => pointOf(f.departure) && pointOf(f.arrival));
    const missing = (flights || []).length - all.length;

    // типи літаків — верхній фільтр, рахуються з усіх рейсів вікна
    const types = new Map();       // ICAO → {n, name}
    all.forEach(f => { const t = typeOf(f); const r = types.get(t) || {n: 0, name: f.aircraft?.name || t}; r.n++; types.set(t, r); });
    const typeList = [...types.entries()].sort((x, y) => y[1].n - x[1].n || x[0].localeCompare(y[0]));
    const countryNames = new Map();
    all.forEach(f => [countryOf(f.departure), countryOf(f.arrival)].forEach(c => { if (c) countryNames.set(c.cc, c.name); }));

    // нове відкриття — фільтри з нуля; зміна періоду у відкритому вікні — фільтри лишаються (без того, чого в нових рейсах нема)
    const filt = refresh && lastFilt ? lastFilt : {cc: '', dir: 'all', ap: '', types: new Set(), loads: new Set(), ops: new Set()};
    lastFilt = filt;
    if (refresh) {
      [...filt.types].forEach(t => { if (!types.has(t)) filt.types.delete(t); });
      if (filt.cc && !countryNames.has(filt.cc)) { filt.cc = ''; filt.dir = 'all'; filt.ap = ''; }
      if (filt.ap && !all.some(f => icaoOf(f.departure) === filt.ap || icaoOf(f.arrival) === filt.ap)) filt.ap = '';
    }
    const anyFilter = () => filt.cc || filt.types.size || filt.loads.size || filt.ops.size;
    const typeOk = f => !filt.types.size || filt.types.has(typeOf(f));
    const loadOk = f => !filt.loads.size || filt.loads.has(loadOf(f));
    const opOk = f => !filt.ops.size || filt.ops.has(opOf(f));
    // лічильники «Рейс» — з урахуванням літака (і другої половини рядка)
    const sum = m => [...m.values()].reduce((s, v) => s + v, 0);
    const countBy = (fn, ok) => { const m = new Map(); all.filter(ok).forEach(f => m.set(fn(f), (m.get(fn(f)) || 0) + 1)); return m; };
    // країни — з урахуванням літака і «Рейс»; вибрана лишається в списку навіть з 0
    const countryStats = () => {
      const m = new Map();
      all.filter(f => typeOk(f) && loadOk(f) && opOk(f)).forEach(f => {
        const d = countryOf(f.departure), a = countryOf(f.arrival);
        if (d) { const c = m.get(d.cc) || {...d, dep: 0, arr: 0}; c.dep++; m.set(d.cc, c); }
        if (a) { const c = m.get(a.cc) || {...a, dep: 0, arr: 0}; c.arr++; m.set(a.cc, c); }
      });
      if (filt.cc && !m.has(filt.cc)) m.set(filt.cc, {cc: filt.cc, name: countryNames.get(filt.cc) || filt.cc, dep: 0, arr: 0});
      return m;
    };
    const sideOk = (d, a) => filt.dir === 'dep' ? d : filt.dir === 'arr' ? a : (d || a);
    const passesNoAp = f => {
      if (!typeOk(f) || !loadOk(f) || !opOk(f)) return false;
      if (!filt.cc) return true;
      return sideOk(countryOf(f.departure)?.cc === filt.cc, countryOf(f.arrival)?.cc === filt.cc);
    };
    const passes = f => passesNoAp(f) && (!filt.ap || sideOk(icaoOf(f.departure) === filt.ap, icaoOf(f.arrival) === filt.ap));
    // аеропорти вибраної країни (з урахуванням напряму і типу літака) → {icao: n}
    const countryAirports = () => {
      const m = new Map();
      all.filter(passesNoAp).forEach(f => {
        const add = a => { if (countryOf(a)?.cc === filt.cc) m.set(icaoOf(a), (m.get(icaoOf(a)) || 0) + 1); };
        if (filt.dir !== 'arr') add(f.departure);
        if (filt.dir !== 'dep') add(f.arrival);
      });
      return [...m.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    };

    const base = L.layerGroup().addTo(map), labels = L.layerGroup().addTo(map), hi = L.layerGroup().addTo(map);
    const listEl = dlg.querySelector('.company-route-flight-list'), allBtn = dlg.querySelector('.company-route-map-list-head .all');
    const filtersEl = dlg.querySelector('.pfm-filters');
    let list = [], bounds = [], sel = -1, selKey = '';
    const routeLines = new Map();   // ключ маршруту → {vis, rt}
    const hits = L.layerGroup().addTo(map);
    const PAD = {paddingTopLeft: [60, 150], paddingBottomRight: [230, 30], maxZoom: 7};

    const home = () => {
      if (!bounds.length) map.setView([49, 31], 5);
      else if (bounds.length === 1) map.setView(bounds[0], 6);
      else map.fitBounds(bounds, PAD);
    };

    function renderFilters() {
      const countries = countryStats();
      const countryList = [...countries.values()].sort((x, y) => (y.dep + y.arr) - (x.dep + x.arr) || x.name.localeCompare(y.name));
      const loadCount = countBy(loadOf, f => typeOk(f) && opOk(f));
      const opCount = countBy(opOf, f => typeOk(f) && loadOk(f));
      const c = filt.cc ? countries.get(filt.cc) : null;
      const aps = c ? countryAirports() : [];
      filtersEl.innerHTML = `
        <div class="pfm-row"><span class="pfm-lbl">Літак</span><button type="button" class="pfm-type pfm-alltypes ${filt.types.size ? '' : 'active'}" title="Показати всі типи літаків">ВСІ ТИПИ<small>${all.length}</small></button>${typeList.map(([t, r]) =>
          `<button type="button" class="pfm-type ${filt.types.has(t) ? 'active' : ''}" data-type="${esc(t)}" title="${esc(r.name)}">${esc(t)}<small>${r.n}</small></button>`).join('')}</div>
        <div class="pfm-row"><span class="pfm-lbl">Рейс</span><button type="button" class="pfm-opt pfm-all ${filt.loads.size ? '' : 'active'}" data-all="loads">ВСІ<small>${sum(loadCount)}</small></button>${LOADS.map(([k, label]) =>
          `<button type="button" class="pfm-opt ${filt.loads.has(k) ? 'active' : ''}" data-load="${k}" ${loadCount.get(k) || filt.loads.has(k) ? '' : 'disabled'}>${label}<small>${loadCount.get(k) || 0}</small></button>`).join('')}</div>
        <div class="pfm-row"><span class="pfm-lbl">Тип</span><button type="button" class="pfm-opt pfm-all ${filt.ops.size ? '' : 'active'}" data-all="ops">ВСІ<small>${sum(opCount)}</small></button>${OPS.map(([k, label]) =>
          `<button type="button" class="pfm-opt ${filt.ops.has(k) ? 'active' : ''}" data-op="${k}" ${opCount.get(k) || filt.ops.has(k) ? '' : 'disabled'}><span class="flight-number-link flight-number-${k}">${label}</span><small>${opCount.get(k) || 0}</small></button>`).join('')}</div>
        <div class="pfm-row pfm-flags ${filt.cc ? 'has-sel' : ''}"><span class="pfm-lbl">Країна</span><button type="button" class="pfm-opt pfm-all ${filt.cc ? '' : 'active'}" data-all="cc" title="Усі країни">ВСІ</button>${countryList.map(k =>
          `<button type="button" class="pfm-flag ${k.cc === filt.cc ? 'active' : ''}" data-cc="${esc(k.cc)}" title="${esc(k.name)}: вильотів ${k.dep}, прибуттів ${k.arr}"><img src="https://flagcdn.com/w40/${esc(k.cc)}.png" alt="${esc(k.name)}"></button>`).join('')}</div>
        ${c ? `<div class="pfm-row"><span class="pfm-lbl">Напрям</span><span class="pfm-cname">${esc(c.name)}:</span>
          <button type="button" class="pfm-dir ${filt.dir === 'all' ? 'active' : ''}" data-dir="all">ВСІ</button>
          <button type="button" class="pfm-dir ${filt.dir === 'dep' ? 'active' : ''}" data-dir="dep" ${c.dep ? '' : 'disabled'}>ВИЛІТ (${c.dep})</button>
          <button type="button" class="pfm-dir ${filt.dir === 'arr' ? 'active' : ''}" data-dir="arr" ${c.arr ? '' : 'disabled'}>ПРИБУТТЯ (${c.arr})</button></div>
        <div class="pfm-row"><span class="pfm-lbl">Аеропорт</span>${aps.length ? `<button type="button" class="pfm-opt pfm-all ${filt.ap ? '' : 'active'}" data-all="ap">ВСІ</button>` : ''}${aps.length ? aps.map(([icao, n]) =>
          `<button type="button" class="pfm-type pfm-ap ${icao === filt.ap ? 'active' : ''}" data-ap="${esc(icao)}">${esc(icao)}<small>${n}</small></button>`).join('') : '<span class="muted">немає</span>'}</div>` : ''}`;
    }

    function draw(fit = true) {
      base.clearLayers(); labels.clearLayers(); hi.clearLayers(); sel = -1;
      list = all.filter(passes);
      const airports = new Map(), routes = new Map();
      list.forEach(f => {
        [f.departure, f.arrival].forEach(a => {
          const k = icaoOf(a) || `${pointOf(a).lat},${pointOf(a).lon}`;
          const rec = airports.get(k) || {airport: a, point: pointOf(a), n: 0};
          rec.n++;
          airports.set(k, rec);
        });
        const d = icaoOf(f.departure), r = icaoOf(f.arrival);
        const key = [d, r].sort().join('|');
        const rec = routes.get(key) || {a: pointOf(f.departure), b: pointOf(f.arrival), dep: d, arr: r, flights: []};
        rec.flights.push(f);
        routes.set(key, rec);
      });
      routeLines.clear(); hits.clearLayers(); selKey = ''; tableEl.hidden = true;
      routes.forEach((rt, key) => {
        const n = rt.flights.length, pts = arc(rt.a, rt.b);
        const vis = L.polyline(pts, {color: '#2468b2', weight: Math.min(2 + (n - 1) * 0.8, 7), opacity: 0.6, interactive: false}).addTo(base);
        vis._pfmW = vis.options.weight;
        routeLines.set(key, {vis, rt});
        // широка невидима смуга поверх лінії — щоб легко навести і клікнути
        L.polyline(pts, {color: '#000', weight: 18, opacity: 0, className: 'pfm-hit'}).addTo(hits)
          .bindTooltip(`${esc(rt.dep)} ↔ ${esc(rt.arr)} · ${n} ${flightsWord(n)} · ${Math.round(km(rt.a, rt.b))} км<br><small>клік — показати ${n === 1 ? 'рейс' : 'рейси'} у списку</small>`, {sticky: true, opacity: 0.95})
          .on('mouseover', () => { if (key !== selKey) vis.setStyle({color: '#f29f05', weight: 5, opacity: 0.95}).bringToFront(); })
          .on('mouseout', () => { if (key !== selKey) restyle(vis); })
          .on('click', () => selectRoute(key === selKey ? '' : key));
      });
      airports.forEach(rec => {
        const name = [rec.airport.name, rec.airport.city].filter(Boolean).join(', ') || icaoOf(rec.airport);
        const country = countryOf(rec.airport);
        L.marker([rec.point.lat, rec.point.lon], {
          icon: L.divIcon({className: 'company-route-airport-label', html: airportHtml(rec.airport), iconSize: null, iconAnchor: [18, 0]}),
          zIndexOffset: 600
        }).bindTooltip(`${esc(name)} · ${rec.n} ${rec.n === 1 ? 'виліт/посадка' : 'вильотів/посадок'}${country ? `<br><small>клік — фільтр «${esc(icaoOf(rec.airport))}»</small>` : ''}`, {direction: 'top', offset: [0, -8], opacity: 0.95})
          .on('click', () => {
            if (!country) return;
            const icao = icaoOf(rec.airport);
            if (filt.cc === country.cc && filt.ap === icao) { filt.ap = ''; draw(); return; }
            if (filt.cc !== country.cc) { filt.cc = country.cc; filt.dir = 'all'; }
            filt.ap = icao;
            if (!countryAirports().some(([i]) => i === icao)) filt.dir = 'all';
            draw();
          })
          .addTo(labels);
      });
      bounds = [...airports.values()].map(r => [r.point.lat, r.point.lon]);

      const totalKm = list.reduce((s, f) => s + km(pointOf(f.departure), pointOf(f.arrival)), 0);
      const totalMin = Math.round(list.reduce((s, f) => s + (Number(f.times?.durationMinutes) || 0), 0));
      const hoursHtml = `<b>${Math.floor(totalMin / 60).toLocaleString('uk-UA')}</b> год <b>${String(totalMin % 60).padStart(2, '0')}</b> хв`;
      const statsEl = dlg.querySelector('.pfm-stats');
      statsEl.innerHTML = `<div class="pfm-stxt"><b>${list.length}</b> ${flightsWord(list.length)}${list.length !== all.length ? ` з ${all.length}` : ''} · <b>${routes.size}</b> маршр. · <b>${airports.size}</b> аероп. · ≈ <b>${Math.round(totalKm).toLocaleString('uk-UA')}</b> км по прямій · ${hoursHtml}`
        + (missing > 0 ? `<br><span style="color:#a33">${missing} без координат — не показано</span>` : '') + '</div>'
        + (anyFilter() ? '<button type="button" class="pfm-reset" title="Поставити «ВСІ» в усіх фільтрах">✕ СКИНУТИ ФІЛЬТР</button>' : '');
      const rb = statsEl.querySelector('.pfm-reset');
      if (rb) rb.onclick = () => { filt.cc = ''; filt.dir = 'all'; filt.ap = ''; filt.types.clear(); filt.loads.clear(); filt.ops.clear(); draw(); };
      dlg.querySelector('.company-route-map-list-title').textContent = `${list.length} ${flightsWord(list.length).toUpperCase()}:`;
      allBtn.hidden = true;
      listEl.innerHTML = list.length ? list.map((f, i) => `<button type="button" data-i="${i}" title="${esc(f.aircraft?.name || '')}"><span class="d">${dateShort(flightDate(f))}</span><span class="flight-number-link flight-number-${opOf(f)}">${esc(f.flightNumber || '—')}</span> ${esc(icaoOf(f.departure))}→${esc(icaoOf(f.arrival))}</button>`).join('')
        : '<span class="muted">Немає рейсів для цього фільтра</span>';
      renderFilters();
      if (fit) home();
    }

    function setCountry(cc) {
      if (filt.cc === cc) { filt.cc = ''; filt.dir = 'all'; }
      else { filt.cc = cc; filt.dir = 'all'; }
      filt.ap = '';
      draw();
    }
    // аеропорт зник з вибору (змінили напрям / тип літака) — знімаємо
    const fixAp = () => { if (filt.ap && !countryAirports().some(([i]) => i === filt.ap)) filt.ap = ''; };

    // табличка вибраних рейсів зліва знизу — рядки з профілю (period.rowHtml), кліки — ті самі вікна деталей
    const tableEl = dlg.querySelector('.pfm-table');
    const showTable = (fl, caption) => {
      if (!fl.length || !period?.rowHtml) { tableEl.hidden = true; return; }
      tableEl.querySelector('.pfm-table-title').textContent = caption;
      tableEl.querySelector('.pfm-table-body').innerHTML = `<table class="profile-flight-table dashboard-flight-table"><colgroup><col style="width:13%"><col style="width:17%"><col style="width:22%"><col style="width:9%"><col style="width:14%"><col style="width:14%"><col style="width:11%"></colgroup>
        <thead><tr><th>Дата /<br>Рейс</th><th>Маршрут /<br>Тривалість</th><th>Літак</th><th>Пейлоад</th><th>Рейтинг /<br>посадка</th><th>Прибуток<br>авіакомпанії</th><th>Зарплата<br>пілота</th></tr></thead>
        <tbody>${fl.map(f => period.rowHtml(f)).join('')}</tbody></table>`;
      tableEl.hidden = false;
      // видно шапку + 2 рейси, решта — прокруткою
      const body = tableEl.querySelector('.pfm-table-body'), rowsEl = body.querySelectorAll('tbody tr');
      body.style.maxHeight = '';
      if (rowsEl.length > 2) body.style.maxHeight = `${Math.ceil(rowsEl[2].offsetTop) + 1}px`;
      body.scrollTop = 0;
    };
    tableEl.querySelector('.pfm-table-close').onclick = () => { tableEl.hidden = true; };
    tableEl.querySelector('.pfm-table-body').onclick = e => {
      const cell = e.target.closest('[data-flight-id]');
      if (!cell || !period?.openFlightInfo) return;
      const type = cell.classList.contains('profile-rating-detail') ? 'rating'
        : cell.classList.contains('profile-company-profit-detail') ? 'finance'
        : cell.classList.contains('profile-pilot-salary-detail') ? 'salary' : '';
      if (type) period.openFlightInfo(cell.dataset.flightId, type);
    };
    tableEl.querySelector('.pfm-table-body').onkeydown = e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-flight-id]')) { e.preventDefault(); e.target.click(); }
    };
    L.DomEvent.disableClickPropagation(tableEl);
    L.DomEvent.disableScrollPropagation(tableEl);
    tableEl.hidden = true;

    const dimmed = () => sel >= 0 || Boolean(selKey);
    const restyle = vis => vis.setStyle({color: '#2468b2', weight: vis._pfmW, opacity: dimmed() ? 0.25 : 0.6});
    // клік по маршруту на карті: маршрут оранжевий, його рейси підсвічені у списку справа
    function selectRoute(key) {
      // маршрут з одним рейсом — одразу вибираємо цей рейс (з табличкою)
      const one = key ? routeLines.get(key) : null;
      if (one && one.rt.flights.length === 1) { const i = list.indexOf(one.rt.flights[0]); if (i >= 0) { select(i); return; } }
      sel = -1; selKey = key;
      hi.clearLayers();
      routeLines.forEach(({vis}) => restyle(vis));
      const r = key ? routeLines.get(key) : null;
      const idx = r ? list.map((f, i) => r.rt.flights.includes(f) ? i : -1).filter(i => i >= 0) : [];
      listEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', idx.includes(Number(b.dataset.i))));
      allBtn.hidden = !r;
      if (!r) { tableEl.hidden = true; home(); return; }
      // кілька рейсів маршрутом — табличка з усіма (прокрутка, заголовок таблиці стоїть на місці)
      const rf = idx.map(i => list[i]);
      showTable(rf, `${r.rt.dep} ↔ ${r.rt.arr} · ${rf.length} ${flightsWord(rf.length)}`);
      r.vis.setStyle({color: '#f29f05', weight: 5, opacity: 0.95}).bringToFront();
      listEl.querySelector(`button[data-i="${idx[0]}"]`)?.scrollIntoView({block: 'nearest'});
      map.fitBounds(r.vis.getBounds(), PAD);
    }
    const select = i => {
      sel = i; selKey = '';
      hi.clearLayers();
      listEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', Number(b.dataset.i) === i));
      allBtn.hidden = i < 0;
      routeLines.forEach(({vis}) => restyle(vis));
      if (i < 0) { tableEl.hidden = true; home(); return; }
      showTable([list[i]], `Рейс ${list[i].flightNumber || ''} · ${icaoOf(list[i].departure)} → ${icaoOf(list[i].arrival)}`);
      const f = list[i], a = pointOf(f.departure), b = pointOf(f.arrival);
      const line = L.polyline(arc(a, b), {color: '#f29f05', weight: 5, opacity: 0.95}).addTo(hi);
      line.bindTooltip(`${esc(f.flightNumber || '')} ${esc(icaoOf(f.departure))} → ${esc(icaoOf(f.arrival))} · ${Math.round(km(a, b))} км`, {sticky: true});
      map.fitBounds(line.getBounds(), PAD);
    };
    listEl.onclick = e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const i = Number(b.dataset.i);
      select(i === sel ? -1 : i);
    };
    allBtn.onclick = () => select(-1);
    filtersEl.onclick = e => {
      const flag = e.target.closest('.pfm-flag');
      if (flag) { setCountry(flag.dataset.cc); return; }
      const dir = e.target.closest('.pfm-dir');
      if (dir && !dir.disabled) { filt.dir = dir.dataset.dir; fixAp(); draw(); return; }
      const allB = e.target.closest('.pfm-all');
      if (allB) {
        const w = allB.dataset.all;
        if (w === 'loads') filt.loads.clear();
        else if (w === 'ops') filt.ops.clear();
        else if (w === 'cc') { filt.cc = ''; filt.dir = 'all'; filt.ap = ''; }
        else if (w === 'ap') filt.ap = '';
        if (filt.cc) fixAp();
        draw();
        return;
      }
      const opt = e.target.closest('.pfm-opt');
      if (opt && !opt.disabled) {
        const [set, k] = opt.dataset.load ? [filt.loads, opt.dataset.load] : [filt.ops, opt.dataset.op];
        set.has(k) ? set.delete(k) : set.add(k);
        if (filt.cc) fixAp();
        draw();
        return;
      }
      const ap = e.target.closest('.pfm-ap');
      if (ap) { filt.ap = filt.ap === ap.dataset.ap ? '' : ap.dataset.ap; draw(); return; }
      if (e.target.closest('.pfm-alltypes')) { filt.types.clear(); if (filt.cc) fixAp(); draw(); return; }
      const type = e.target.closest('.pfm-type');
      if (type) { const t = type.dataset.type; filt.types.has(t) ? filt.types.delete(t) : filt.types.add(t); if (filt.cc) fixAp(); draw(); return; }    };
    L.DomEvent.disableClickPropagation(dlg.querySelector('.pfm-side'));
    L.DomEvent.disableScrollPropagation(dlg.querySelector('.pfm-side'));

    const Home = L.Control.extend({
      options: {position: 'topleft'},
      onAdd() {
        const a = L.DomUtil.create('a', 'company-route-home-control');
        a.href = '#';
        a.title = 'Показати всі маршрути';
        a.innerHTML = '<span aria-hidden="true">⌂</span>';
        L.DomEvent.disableClickPropagation(a);
        L.DomEvent.on(a, 'click', ev => { L.DomEvent.preventDefault(ev); select(-1); });
        return a;
      }
    });
    map.addControl(new Home());
    draw(false);
    setTimeout(() => { map.invalidateSize(); home(); }, 50);
  }

  window.UCAAPilotFlightsMap = {open, isOpen: () => Boolean(dialog?.open)};
})();
