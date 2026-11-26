// Ізометричний кабінет пілота (сайт kazuar.in.ua і локальна pilot-cabinet-dev.html — той самий файл):
// зліва «Офіс» (кімната зі стінами), справа «Дім» (ділянка). Речі з ISOMETRIC/catalog.json ставляться в клітинки сітки.
// Дані кабінетів і вхід — сервер на Railway (const API). Тестове (тестові пілоти, запис overrides у файл, devCabinetReset)
// працює ТІЛЬКИ на localhost (LOCAL).
(function () {
  const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

  const GAP = 8;
  const STAGE_W = 451;
  const ZONE_W = STAGE_W + 2 * 6 + 2;
  const TITLE_H = 34;
  const TOOLS_H = 62;                  // смужка інструментів під заголовком панелі (тільки під час редагування)
  const AUTH_KEY = 'devCabinetAuth';
  const BASE_DPR_KEY = 'devCabinetBaseDpr';
  const SAVE_KEY = id => `devIsoCabinet1:${id}`;
  const TW = 64, TH = 32;   // ромб клітинки в пікселях картинок

  const ZONE_CFG = {
    office: {title: 'Офіс', button: '🛠 Облаштувати', menuTitle: 'Облаштування офісу',
      W: 7, D: 7, walls: true, wallH: 128, topPad: 150, tile: ['#d9cdb8', '#cfc2aa'], wallL: '#efe9df', wallR: '#e2dacb'},
    // Дім: велике поле 60×60, видно ту частину, що влазить у прямокутник панелі (центр поля — по центру панелі)
    home: {title: 'Дім', button: '🏡 Облаштувати', menuTitle: 'Облаштування дому',
      W: 60, D: 60, walls: false, topPad: 0, tile: ['#8fcf72', '#84c468'], big: true}
  };
  const ZONES = Object.keys(ZONE_CFG);
  const HOME_N = 60, HOME_SHIFT = 26;   // старі речі (поле 8×8) переносимо в центр: +26 по обох осях
  const HOME_ZOOM = 0.9;                // масштаб ділянки «Дім» — фіксований 90% (кнопки 🔍 прибрано 06.11)
  const HOME_K = 0.68;                 // розмір клітинки дому (0.57 → +20% за проханням 05.11)
  // Покриття землі (пензлем по клітинках), ціна за клітинку
  const COVERS = [
    {id: 'grass', name: 'Трава', price: 0, tiles: ['#8fcf72', '#84c468']},
    {id: 'road', name: 'Дорога', price: 15, tiles: ['#62666b', '#5c6065'], deco: 'road'},
    {id: 'water', name: 'Вода', price: 50, tiles: ['#4dabf7', '#46a2ee'], deco: 'water'},
    {id: 'field', name: 'Пшеничне поле', price: 5, tiles: ['#e2c26a', '#d9b85e'], deco: 'field'},
    {id: 'soil', name: 'Ґрунт', price: 5, tiles: ['#8d6e4a', '#856746'], deco: 'soil'},
    {id: 'pebbles', name: 'Морська галька', price: 20, tiles: ['#cfc8bd', '#c4bcb0'], deco: 'pebbles'},
    {id: 'sand', name: 'Пісок', price: 10, tiles: ['#f1dca7', '#ebd49b']},
    {id: 'paving', name: 'Бруківка', price: 25, tiles: ['#b9a999', '#ae9e8e'], deco: 'paving'},
    {id: 'flowers', name: 'Квіткова галявина', price: 15, tiles: ['#7ccf6c', '#74c564'], deco: 'flowers'},
    {id: 'snow', name: 'Сніг', price: 5, tiles: ['#f4f6f8', '#e9edf1']}
  ];
  const coverOf = id => COVERS.find(c => c.id === id) || COVERS[0];
  // Ділянка дому — ромб усередині великого поля; розширення «вгору» = додати ряд з обох задніх боків
  const PLOT_BASE = {x0: 24, y0: 24, n: 12};
  // як в офісі: 5 розширень, ті самі ціни ($15 000 → $90 000); рівнів ділянки 1–6
  const PLOT_PRICES = [15000, 25000, 40000, 60000, 90000];
  const PLOT_MAX = PLOT_BASE.n + PLOT_PRICES.length;
  const plotUpgradePrice = n => PLOT_PRICES[n - PLOT_BASE.n] ?? 0;   // ціна переходу n → n+1 ($)
  const plotCost = (from, to) => { let s = 0; for (let n = from; n < to; n++) s += plotUpgradePrice(n); return s; };
  const plotOf = () => (state.editing === 'home' ? state.plot.draft : state.plot.owned);
  // ділянка = усе нижче горизонтальної лінії через верхній кут ромба (i+j ≥ x0+y0) і до дороги спереду
  // ділянка: зверху — зигзаг по краях клітинок уздовж пологої лінії (піднімається вправо вдвічі положистіше за край ромба),
  // знизу — дорога вздовж передніх країв. Лінія проходить через верхній кут ромба, тож «Розширити вгору» піднімає її.
  const TOP_SLOPE = 0.25;
  const TOP_EXTRA = 2;   // межа на 2 ряди вище верхнього кута ромба (1 ряд = 16 px)
  const belowTop = (pl, i, j) => {
    const cfg = ZONE_CFG.home, A = tileTop(cfg, pl.x0, pl.y0), c = tileTop(cfg, i + 0.5, j + 0.5);
    return c.y >= A.y - TOP_EXTRA * TH / 2 - (c.x - A.x) * TOP_SLOPE + 4;
  };
  const ROAD_W = 2;   // ширина дороги вздовж передніх країв ділянки (клітинок)
  const inPlot = (pl, i, j) => i < pl.x0 + pl.n && j < pl.y0 + pl.n && belowTop(pl, i, j);
  // крайні верхні клітинки: сусід зверху-ліворуч (i-1, j) чи зверху-праворуч (i, j-1) вже не ділянка — там паркан
  const fenceEdges = (pl, i, j) => !inPlot(pl, i, j) ? [] :
    [!belowTop(pl, i - 1, j) ? 'L' : null, !belowTop(pl, i, j - 1) ? 'R' : null].filter(Boolean);
  const isFence = (pl, i, j) => fenceEdges(pl, i, j).length > 0;

  // ---------- паркани гравця: ставляться на межі між клітинками, нічого не блокують ----------
  // Межа = «i,j,L» (край клітинки до сусіда i-1) або «i,j,R» (до сусіда j-1)
  const FENCES = [
    {id: 'wood', name: 'Простий дерев\'яний', price: 20, open: true},
    {id: 'mesh', name: 'Сітка-рабиця', price: 15, open: true},
    {id: 'iron', name: 'Кований', price: 80, open: true},
    {id: 'picket', name: 'Штахетник', price: 30},
    {id: 'solid', name: 'Глухий дощатий', price: 40},
    {id: 'hedge', name: 'Живопліт', price: 25}
  ];
  const fenceOf = id => FENCES.find(f => f.id === id) || FENCES[0];
  const edgePts = (cfg, key) => {
    const [i, j, d] = key.split(',');
    const a = tileTop(cfg, +i, +j);
    return [a, d === 'L' ? tileTop(cfg, +i, +j + 1) : tileTop(cfg, +i + 1, +j)];
  };
  // Малюнок одного відрізка паркану між точками a і b (координати сцени, «вгору» = −y)
  function fenceSvg(style, a, b) {
    const up = (q, h) => `${q.x},${q.y - h}`;
    const lerp = (t, h = 0) => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - h});
    const post = (q, h, col, edge) => `<rect x="${q.x - 2.5}" y="${q.y - h}" width="5" height="${h + 1}" rx="1.5" fill="${col}" stroke="${edge}" stroke-width="1"/>`;
    const line = (h, col, w) => `<line x1="${a.x}" y1="${a.y - h}" x2="${b.x}" y2="${b.y - h}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
    if (style === 'wood') return line(6, '#8b5a2b', 3) + line(15, '#8b5a2b', 3) + post(a, 21, '#a0692f', '#6b4419') + post(b, 21, '#a0692f', '#6b4419');
    if (style === 'mesh') {
      let s = '';
      for (let t = 0; t < 1; t += 0.125) { const p1 = lerp(t), p2 = lerp(t + 0.125, 18), p3 = lerp(t, 18), p4 = lerp(t + 0.125);
        s += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#adb5bd" stroke-width=".8"/><line x1="${p3.x}" y1="${p3.y}" x2="${p4.x}" y2="${p4.y}" stroke="#adb5bd" stroke-width=".8"/>`; }
      return s + line(18, '#868e96', 1.5) + post(a, 20, '#868e96', '#495057') + post(b, 20, '#868e96', '#495057');
    }
    if (style === 'iron') {
      let s = '';
      for (let t = 0.1; t < 1; t += 0.13) { const q = lerp(t); s += `<line x1="${q.x}" y1="${q.y}" x2="${q.x}" y2="${q.y - 20}" stroke="#212529" stroke-width="1.4"/><path d="M${q.x - 2} ${q.y - 20} L${q.x} ${q.y - 25} L${q.x + 2} ${q.y - 20}Z" fill="#c69c3f"/>`; }
      return s + line(4, '#212529', 1.8) + line(16, '#212529', 1.8) + post(a, 24, '#343a40', '#000') + post(b, 24, '#343a40', '#000');
    }
    if (style === 'picket') {
      let s = '';
      for (let t = 0.06; t < 1; t += 0.12) { const q = lerp(t); s += `<path d="M${q.x - 2} ${q.y} V${q.y - 17} L${q.x} ${q.y - 20} L${q.x + 2} ${q.y - 17} V${q.y}Z" fill="#f8f1e3" stroke="#c9b89a" stroke-width=".8"/>`; }
      return line(5, '#c9b89a', 2) + s + line(13, '#d8c8aa', 2) + post(a, 21, '#e9dcc3', '#a89577') + post(b, 21, '#e9dcc3', '#a89577');
    }
    if (style === 'solid') {
      let s = `<polygon points="${a.x},${a.y} ${b.x},${b.y} ${up(b, 20)} ${up(a, 20)}" fill="#9c6a3c" stroke="#5e3b1c" stroke-width="1"/>`;
      for (let t = 0.125; t < 1; t += 0.125) { const q = lerp(t); s += `<line x1="${q.x}" y1="${q.y}" x2="${q.x}" y2="${q.y - 20}" stroke="#7a4f2a" stroke-width="1"/>`; }
      return s + post(a, 22, '#7a4f2a', '#4a2f15') + post(b, 22, '#7a4f2a', '#4a2f15');
    }
    if (style === 'hedge') {
      const m = lerp(0.5, 22);
      return `<path d="M${a.x} ${a.y} L${a.x} ${a.y - 14} Q${a.x} ${a.y - 22} ${lerp(.25, 20).x} ${lerp(.25, 20).y} Q${m.x} ${m.y - 4} ${lerp(.75, 20).x} ${lerp(.75, 20).y} Q${b.x} ${b.y - 22} ${b.x} ${b.y - 14} L${b.x} ${b.y}Z" fill="#2f9e44" stroke="#1f6e2e" stroke-width="1"/>`
        + [.2, .45, .7].map(t => { const q = lerp(t, 12); return `<circle cx="${q.x}" cy="${q.y}" r="3" fill="#40c057"/>`; }).join('');
    }
    return '';
  }
  // Вид над ділянкою (фон зверху)
  const HOME_VIEWS = [
    {id: 'sky', name: 'Село (стандартний)', price: 0},
    {id: 'fields', name: 'Поля і пагорби', price: 4000},
    {id: 'forest', name: 'Ліс', price: 6000},
    {id: 'mountains', name: 'Гори', price: 8000},
    {id: 'sea', name: 'Море', price: 10000},
    {id: 'city', name: 'Місто', price: 12000},
    {id: 'airport', name: 'Аеродром', price: 15000}
  ];
  const viewOf = id => HOME_VIEWS.find(v => v.id === id) || HOME_VIEWS[0];
  // Малюнок виду за ділянкою. Земля ділянки зверху йде під кутом (TOP_SLOPE, піднімається вправо), а горизонт — рівний.
  // Тому між ними: 1) перехідна смуга вздовж краю ділянки (пляж, галявина зі стежкою, тротуар…), її низ — під тим самим
  // кутом; 2) «клин» до рівного горизонту (море, поле, долина…), ширший зліва; 3) на горизонті — далекі речі (ліс, гори, місто).
  // pivotX / edgeY0 — точка краю ділянки на екрані (верхній кут ромба); без них (мініатюри в меню) край рівний.
  function viewSvg(id, w, h, horizon, pivotX, edgeY0, iso) {
    const S = pivotX == null ? 0 : TOP_SLOPE;
    const px = pivotX ?? w / 2, e0 = edgeY0 ?? horizon;
    const E = x => e0 - (x - px) * S;            // край землі ділянки (під кутом)
    const B = 26;                                 // висота перехідної смуги
    const T = x => E(x) - B;                      // верх смуги («берег»)
    const H = Math.round(E(w) - 64);              // рівний горизонт: вище за найвищу точку краю
    const n = (a, b) => `${a.toFixed(1)},${b.toFixed(1)}`;
    const band = (c, extra = '') => `<polygon points="${n(0, E(0) + 60)} ${n(w, E(w) + 60)} ${n(w, T(w))} ${n(0, T(0))}" fill="${c}"/>${extra}`;
    const wedge = (fill) => `<polygon points="${n(0, T(0) + 1)} ${n(w, T(w) + 1)} ${n(w, H)} ${n(0, H)}" fill="${fill}"/>`;
    // точка «на глибині» t (0 — біля смуги, 1 — горизонт) над x
    const at = (x, t) => T(x) + (H - T(x)) * t;
    // лінія вздовж смуги на висоті dy над краєм (для стежок, піни, огорожі)
    const along = (dy, attrs) => `<path d="M${n(0, E(0) - dy)} L${n(w, E(w) - dy)}" ${attrs}/>`;
    const grad = (gid, a, b) => `<linearGradient id="${gid}" x1="0" y1="${H}" x2="0" y2="${T(0)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
    let defs = `<linearGradient id="vsky" x1="0" y1="0" x2="0" y2="${H}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8ccbff"/><stop offset="1" stop-color="#e7f5ff"/></linearGradient>`;
    let s = `<rect width="${w}" height="${Math.max(H + 2, 0)}" fill="url(#vsky)"/>`;
    // далекий ряд дерев на горизонті (для полів, неба)
    const treeLine = (col, hgt) => Array.from({length: 30}, (_, k) => { const x = k * w / 29, t = hgt * (0.6 + (k * 37 % 10) / 25);
      return `<ellipse cx="${x.toFixed(1)}" cy="${H - t / 2 + 2}" rx="${(w / 29 * 0.75).toFixed(1)}" ry="${(t / 2).toFixed(1)}" fill="${col}"/>`; }).join('');
    // ---- помічники для об'ємних видів ----
    const rnd = k => { const v = Math.sin(k * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };   // стабільний «випадковий» 0..1
    const hx = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    const mix = (a, b, t) => { const A = hx(a), Bc = hx(b); return '#' + A.map((v, i) => Math.round(v + (Bc[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
    const HAZE = '#eaf4ff';
    const haze = (c, t) => mix(c, HAZE, Math.min(0.85, t * 0.8));          // чим далі (t → 1), тим блідіше — серпанок
    // ізометричний «коробок» (будинок): передній нижній кут (x, y), ширина вправо / вліво, висота; вікна смужками
    const box = (x, y, wr, wl, hg, col, t, win = true) => {
      const R = [x + wr, y - wr / 2], L = [x - wl, y - wl / 2], P = [x, y];
      const up = ([a, b]) => [a, b - hg];
      const q = pts => pts.map(([a, b]) => n(a, b)).join(' ');
      const right = haze(col, t), left = haze(mix(col, '#000000', 0.22), t), top = haze(mix(col, '#ffffff', 0.25), t);
      let o = `<polygon points="${q([P, R, up(R), up(P)])}" fill="${right}"/><polygon points="${q([P, L, up(L), up(P)])}" fill="${left}"/>`
        + `<polygon points="${q([up(P), up(R), [R[0] - wl, R[1] - wl / 2 - hg], up(L)])}" fill="${top}"/>`;
      if (win && hg > 14) {
        const wc = haze('#ffe8a3', t), wc2 = haze('#9ec5e8', t), step = Math.max(5, 9 * (1 - t * 0.5));
        for (let f = step; f < hg - 4; f += step) {
          o += `<path d="M${n(x + 2, y - f)} L${n(R[0] - 2, R[1] - f)}" stroke="${f % (step * 3) < step ? wc : wc2}" stroke-width="${(step * 0.45).toFixed(1)}" stroke-dasharray="3 2"/>`
            + `<path d="M${n(x - 2, y - f)} L${n(L[0] + 2, L[1] - f)}" stroke="${haze('#6f86a3', t)}" stroke-width="${(step * 0.45).toFixed(1)}" stroke-dasharray="3 2"/>`;
        }
      }
      return o;
    };
    // ялинка «в об'ємі»: ліва половина темніша; base — низ, sz — висота
    const fir = (x, base, sz, col, t) => {
      const wd = sz * 0.34, a = haze(col, t), d = haze(mix(col, '#000000', 0.25), t);
      return `<path d="M${n(x - wd, base)} L${n(x, base - sz)} L${n(x, base + wd * 0.18)}Z" fill="${d}"/><path d="M${n(x, base - sz)} L${n(x + wd, base)} L${n(x, base + wd * 0.18)}Z" fill="${a}"/>`
        + (t < 0.5 ? `<rect x="${(x - sz * 0.03).toFixed(1)}" y="${base.toFixed(1)}" width="${(sz * 0.06).toFixed(1)}" height="${(sz * 0.1).toFixed(1)}" fill="${haze('#6b4a2b', t)}"/>` : '');
    };
    // листяне дерево (кругла крона)
    const oak = (x, base, sz, col, t) => `<rect x="${(x - sz * 0.05).toFixed(1)}" y="${(base - sz * 0.35).toFixed(1)}" width="${(sz * 0.1).toFixed(1)}" height="${(sz * 0.36).toFixed(1)}" fill="${haze('#6b4a2b', t)}"/>`
      + `<circle cx="${x.toFixed(1)}" cy="${(base - sz * 0.6).toFixed(1)}" r="${(sz * 0.34).toFixed(1)}" fill="${haze(mix(col, '#000000', 0.18), t)}"/>`
      + `<circle cx="${(x + sz * 0.08).toFixed(1)}" cy="${(base - sz * 0.66).toFixed(1)}" r="${(sz * 0.26).toFixed(1)}" fill="${haze(col, t)}"/>`;
    // ізометрична «вид зверху» група: (u, v) — по сітці; s — масштаб
    const isoG = (x, y, s, inner) => `<g transform="translate(${n(x, y)}) matrix(${s} ${s / 2} ${-s} ${s / 2} 0 0)">${inner}</g>`;
    // літак зверху (вздовж осі u, ніс у +u)
    const jet = (col = '#f8f9fa', tail = '#4a77c9') => `<path d="M-26 -2.2 L22 -2.2 Q28 0 22 2.2 L-26 2.2Z" fill="${col}" stroke="#adb5bd" stroke-width=".6"/>
      <path d="M2 -2 L-8 -24 L-12 -24 L-6 -2Z M2 2 L-8 24 L-12 24 L-6 2Z" fill="${col}" stroke="#adb5bd" stroke-width=".6"/>
      <path d="M-20 -2 L-26 -10 L-28 -10 L-25 -2Z M-20 2 L-26 10 L-28 10 L-25 2Z" fill="${tail}"/>`;
    // ---- Місто й аеродром «по-ізометричному»: усе стоїть на тій самій сітці клітинок, що й ділянка (за нею),
    // вулиці / смуги йдуть уздовж країв ромба; горизонту нема — вдалині все тоне в серпанку (туман згори) ----
    if (iso && (id === 'city' || id === 'airport' || id === 'sky')) {
      const {S, k, pl} = iso;
      const P = (i, j) => S(i, j);
      const tile = (i, j, a = 1, b = 1) => [P(i, j), P(i + a, j), P(i + a, j + b), P(i, j + b)].map(p => n(p.x, p.y)).join(' ');
      const isBack = (i, j) => !belowTop(pl, i, j);                          // клітинка за ділянкою (не на ній)
      const onScr = (i, j) => { const c = P(i + .5, j + .5); return c.x > -90 && c.x < w + 90 && c.y > -120 && c.y < E(c.x) + 30; };
      const fogY = Math.max(30, H - 90);                                     // туман: від верху до fogY
      const tOf = y => Math.max(0, Math.min(0.92, (E(w / 2) - y) / (E(w / 2) - fogY + 120)));   // серпанок за висотою на екрані
      // коробка на клітинках: (i, j) — задній кут, fw по i, fd по j, hg — висота в px екрана
      const boxG = (i, j, fw, fd, hg, col, glass) => {
        const F = P(i + fw, j + fd), R = P(i + fw, j), L = P(i, j + fd), t = tOf(F.y);
        let o = box(F.x, F.y, R.x - F.x, F.x - L.x, hg, col, t, !glass);
        if (glass) o += `<polygon points="${n(F.x + 1, F.y - 3)} ${n(R.x - 1, R.y - 3)} ${n(R.x - 1, R.y - hg + 4)} ${n(F.x + 1, F.y - hg + 4)}" fill="${haze('#4dabf7', t)}" opacity=".9"/>`
          + `<path d="M${n(F.x + 1, F.y - hg / 2)} L${n(R.x - 1, R.y - hg / 2)}" stroke="${haze('#d0ebff', t)}" stroke-width="1"/>`;
        return o;
      };
      // 2 ряди біля паркану ділянки — тротуар / бруківка (буфер), там нічого не будуємо
      const nearPlot = (i, j) => { for (let a = 0; a <= 2; a++) for (let b = 0; b <= 2; b++) if (!isBack(i + a, j + b)) return true; return false; };
      const lotOk = (i, j, fw, fd) => { for (let a = 0; a < fw; a++) for (let b = 0; b < fd; b++) if (!isBack(i + a, j + b) || !onScr(i + a, j + b) || nearPlot(i + a, j + b)) return false; return true; };
      const pave = (i, j) => { const t = tOf(P(i + .5, j + .5).y); return `<polygon points="${tile(i, j)}" fill="${haze((i + j) % 2 ? '#d6cfc4' : '#c9c0b3', t)}" stroke="${haze('#b5ab9c', t)}" stroke-width=".6"/>`; };
      const I0 = pl.x0 - 46, I1 = pl.x0 + pl.n + 6, J0 = pl.y0 - 46, J1 = pl.y0 + pl.n + 6;
      let g = '', objs = [];   // objs: [глибина (i+j), svg] — малюємо від дальніх до ближніх
      if (id === 'city') {
        // кварта ли 5×5 між вулицями (вулиця — кожна 6-та лінія клітинок по i і по j)
        const road = v => ((v % 6) + 6) % 6 === 0;
        for (let i = I0; i < I1; i++) for (let j = J0; j < J1; j++) {
          if (!isBack(i, j) || !onScr(i, j)) continue;
          if (nearPlot(i, j)) { g += pave(i, j); continue; }   // тротуар уздовж паркану
          const r = road(i) || road(j), t = tOf(P(i + .5, j + .5).y);
          g += `<polygon points="${tile(i, j)}" fill="${haze(r ? '#5c636a' : '#d5d9dd', t)}"/>`;
          if (road(i) && !road(j)) g += `<path d="M${n(P(i + .5, j + .15).x, P(i + .5, j + .15).y)} L${n(P(i + .5, j + .85).x, P(i + .5, j + .85).y)}" stroke="${haze('#f1f3f5', t)}" stroke-width="${(1.2 * k / .6).toFixed(1)}"/>`;
          if (road(j) && !road(i)) g += `<path d="M${n(P(i + .15, j + .5).x, P(i + .15, j + .5).y)} L${n(P(i + .85, j + .5).x, P(i + .85, j + .5).y)}" stroke="${haze('#f1f3f5', t)}" stroke-width="${(1.2 * k / .6).toFixed(1)}"/>`;
        }
        const pal = ['#8ea3bd', '#a3b3c7', '#7f96b2', '#c2b8a8', '#b1a28f', '#9aa9b8', '#d1c7b7', '#a8b8a0'];
        for (let bi = Math.floor(I0 / 6) * 6; bi < I1; bi += 6) for (let bj = Math.floor(J0 / 6) * 6; bj < J1; bj += 6) {
          // у кварталі 4 ділянки 2×2 + дерева по краю
          [[1, 1], [1, 3], [3, 1], [3, 3]].forEach(([a, b], q) => {
            const i = bi + a, j = bj + b, key = i * 131 + j * 7;
            if (!lotOk(i, j, 2, 2)) return;
            const F = P(i + 2, j + 2), far = tOf(F.y);
            const tall = rnd(key) < 0.18 ? 2.6 : 1;   // інколи — хмарочос
            const hg = (28 + rnd(key + 1) * 70) * tall * k / 0.6 * (1 - far * 0.15);
            objs.push([i + j + 4, boxG(i, j, 2, 2, hg, pal[Math.floor(rnd(key + 2) * pal.length)], false)]);
          });
          for (let s2 = 1; s2 <= 5; s2 += 2) {
            const i = bi + 5, j = bj + s2;
            if (lotOk(i, j, 1, 1)) { const c = P(i + .5, j + .5); objs.push([i + j + 1, oak(c.x, c.y + 3 * k, 22 * k / 0.6, '#51a33a', tOf(c.y))]); }
          }
        }
        // пам'ятка: телевежа на дальній ділянці (найвища на екрані з видимих)
        const far = [];
        for (let i = I0; i < I1; i += 6) for (let j = J0; j < J1; j += 6) if (lotOk(i + 1, j + 1, 2, 2)) far.push([P(i + 2, j + 2).y, i + 1, j + 1]);
        far.sort((a, b) => a[0] - b[0]);
        const tw = far[Math.floor(far.length * 0.15)];
        if (tw) { const c = P(tw[1] + 1, tw[2] + 1), t = tOf(c.y), col = haze('#8a99ad', t), hh = 190 * k / 0.6;
          objs.push([tw[1] + tw[2] + 4.5, `<path d="M${n(c.x - 6, c.y)} L${n(c.x - 1.5, c.y - hh)} L${n(c.x + 1.5, c.y - hh)} L${n(c.x + 6, c.y)}Z" fill="${col}"/><ellipse cx="${c.x.toFixed(1)}" cy="${(c.y - hh * .78).toFixed(1)}" rx="9" ry="4" fill="${col}"/><path d="M${n(c.x, c.y - hh)} V${(c.y - hh - 30).toFixed(1)}" stroke="${col}" stroke-width="1.5"/>`]); }
      }
      if (id === 'sky') {
        // стандартний сільський вид: біля паркану трава з квітами і ґрунтова дорога, далі клаптики полів 7×7
        // (пшениця, зелені грядки, зорана земля, луг) зі стежками й живоплотами між ними, дерева, копиці, клуня
        const near = (i, j, r) => { for (let a = 0; a <= r; a++) for (let b = 0; b <= r; b++) if (!isBack(i + a, j + b)) return true; return false; };
        const FIELDS = [['#e6c35c', '#c9a23c'], ['#8fcf6a', '#6fae4c'], ['#a47c55', '#8a6542'], ['#a6d97a', '#a6d97a'], ['#e6c35c', '#c9a23c']];
        const md = v => ((v % 7) + 7) % 7;
        for (let i = I0; i < I1; i++) for (let j = J0; j < J1; j++) {
          if (!isBack(i, j) || !onScr(i, j)) continue;
          const t = tOf(P(i + .5, j + .5).y);
          if (near(i, j, 1)) {   // узбіччя біля паркану: трава з квітами
            g += `<polygon points="${tile(i, j)}" fill="${haze('#9bd56d', t)}"/>`;
            if (rnd(i * 31 + j) < .35) { const c = P(i + .5, j + .5); g += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="1.6" fill="${['#f06595', '#ffd43b', '#fff', '#cc5de8'][Math.floor(rnd(i + j * 7) * 4)]}"/>`; }
            continue;
          }
          if (near(i, j, 3)) {   // сільська ґрунтова дорога вздовж ділянки (з колією)
            g += `<polygon points="${tile(i, j)}" fill="${haze((i + j) % 2 ? '#c9a46c' : '#c29b62', t)}"/>`;
            continue;
          }
          const fi = Math.floor(i / 7), fj = Math.floor(j / 7);
          if (md(i) === 0 || md(j) === 0) {   // межі полів: стежка або трав'яна смужка
            const path = (md(i) === 0 && ((fi % 2) + 2) % 2 === 0) || (md(j) === 0 && ((fj % 3) + 3) % 3 === 0);
            g += `<polygon points="${tile(i, j)}" fill="${haze(path ? '#d2b07a' : '#8cc95a', t)}"/>`;
            if (!path && rnd(i * 17 + j * 3) < .22 && lotOk(i, j, 1, 1)) { const c = P(i + .5, j + .5); objs.push([i + j + 1, oak(c.x, c.y + 2, 20 * k / .6, '#4f9e3a', t)]); }
            continue;
          }
          const [c1, c2] = FIELDS[Math.floor(rnd(fi * 13 + fj * 7) * FIELDS.length)];
          g += `<polygon points="${tile(i, j)}" fill="${haze(c1, t)}"/>`;
          if (c1 !== c2) {   // рядки посівів уздовж сітки
            const along = ((fi + fj) % 2 + 2) % 2 === 0;
            for (const f of [.3, .7]) { const a = along ? P(i + f, j) : P(i, j + f), b = along ? P(i + f, j + 1) : P(i + 1, j + f);
              g += `<path d="M${n(a.x, a.y)} L${n(b.x, b.y)}" stroke="${haze(c2, t)}" stroke-width="1.2"/>`; }
          }
          if (c1 === '#e6c35c' && rnd(i * 7 + j * 29) < .05 && lotOk(i, j, 1, 1)) {   // копиця сіна
            const c = P(i + .5, j + .5); objs.push([i + j + 1, `<ellipse cx="${c.x.toFixed(1)}" cy="${(c.y - 5).toFixed(1)}" rx="${(8 * k / .6).toFixed(1)}" ry="${(7 * k / .6).toFixed(1)}" fill="${haze('#d9b24f', t)}"/><path d="M${n(c.x - 8 * k / .6, c.y - 4)} Q${n(c.x, c.y + 2)} ${n(c.x + 8 * k / .6, c.y - 4)}" stroke="${haze('#b08a2e', t)}" fill="none"/>`]);
          }
        }
        // хатинка (білі стіни, двосхилий дах) і маленький трактор
        const hut = (i, j) => {
          const fw = 1.6, fd = 1.2, hg = 11 * k / .6, rh = 9 * k / .6;
          const F = P(i + fw, j + fd), R = P(i + fw, j), L = P(i, j + fd), Bk = P(i, j), t = tOf(F.y);
          const up = (p, d) => `${p.x.toFixed(1)},${(p.y - d).toFixed(1)}`;
          const r1 = P(i, j + fd / 2), r2 = P(i + fw, j + fd / 2);
          return box(F.x, F.y, R.x - F.x, F.x - L.x, hg, '#f3ead8', t, false)
            + `<polygon points="${up(Bk, hg)} ${up(R, hg)} ${up(r2, hg + rh)} ${up(r1, hg + rh)}" fill="${haze('#7a4a2a', t)}"/>`
            + `<polygon points="${up(F, hg)} ${up(R, hg)} ${up(r2, hg + rh)}" fill="${haze('#e9dcc2', t)}"/>`
            + `<polygon points="${up(L, hg)} ${up(F, hg)} ${up(r2, hg + rh)} ${up(r1, hg + rh)}" fill="${haze('#9a5f36', t)}"/>`
            + `<polygon points="${up(P(i + .5, j + fd), 2)} ${up(P(i + .9, j + fd), 2)} ${up(P(i + .9, j + fd), hg - 3)} ${up(P(i + .5, j + fd), hg - 3)}" fill="${haze('#74c0fc', t)}"/>`;
        };
        const tractor = (i, j) => {
          const t = tOf(P(i + 1, j + .6).y), wl = c => `<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="${(3.2 * k / .6).toFixed(1)}" ry="${(3.6 * k / .6).toFixed(1)}" fill="${haze('#212529', t)}"/>`;
          return boxG(i, j, 1, .6, 6 * k / .6, '#e03131', false) + boxG(i, j, .45, .6, 13 * k / .6, '#c92a2a', false)
            + wl(P(i + .2, j + .62)) + wl(P(i + .85, j + .62));
        };
        // поля-луки (зелені плями) і ріллі/пшениця поблизу центру екрана
        const blocks = { meadow: [], crop: [] };
        for (let fi = Math.floor(I0 / 7); fi * 7 < I1; fi++) for (let fj = Math.floor(J0 / 7); fj * 7 < J1; fj++) {
          const c1 = FIELDS[Math.floor(rnd(fi * 13 + fj * 7) * FIELDS.length)][0], i = fi * 7 + 2, j = fj * 7 + 2;
          if (!lotOk(i, j, 3, 3)) continue;
          const c = P(i + 1.5, j + 1.5);
          if (c1 === '#a6d97a') blocks.meadow.push([Math.hypot(c.x - w / 2, c.y - (E(w / 2) - 120)), i, j]);
          else blocks.crop.push([Math.hypot(c.x - w * .3, c.y - (E(w * .3) - 60)), i, j]);   // трактор — на ближчому полі ліворуч
        }
        blocks.meadow.sort((a, b) => a[0] - b[0]); blocks.crop.sort((a, b) => a[0] - b[0]);
        const hm = blocks.meadow[0];
        if (hm) { objs.push([hm[1] + hm[2] + 3, hut(hm[1], hm[2])]); const c = P(hm[1] + 2.4, hm[2] + .4); objs.push([hm[1] + hm[2] + 3.2, oak(c.x, c.y, 24 * k / .6, '#4f9e3a', tOf(c.y))]); }
        const tc = blocks.crop[0];
        if (tc) objs.push([tc[1] + tc[2] + 2, tractor(tc[1] + 1, tc[2] + 1)]);
      }
      if (id === 'airport') {
        // трава навколо; злітна смуга вздовж j (паралельно лівому краю ділянки), руліжка, перон з літаками, термінал, вежа, ангар
        const x0 = pl.x0;
        const strip = (i0, i1, j0, j1, fill, extra = '') => `<polygon points="${[P(i0, j0), P(i1, j0), P(i1, j1), P(i0, j1)].map(p => n(p.x, p.y)).join(' ')}" fill="${fill}" ${extra}/>`;
        const line = (i0, j0, i1, j1, attrs) => { const a = P(i0, j0), b = P(i1, j1); return `<path d="M${n(a.x, a.y)} L${n(b.x, b.y)}" ${attrs}/>`; };
        const JA = J0, JB = J1;
        const ri = x0 - 8;                                    // злітна смуга: i ∈ [ri, ri+2]
        g += strip(ri - .3, ri + 2.3, JA, JB, haze('#8fbf6c', .2));
        g += strip(ri, ri + 2, JA, JB, '#3d4349');
        g += line(ri + .12, JA, ri + .12, JB, 'stroke="#f1f3f5" stroke-width="1.2"') + line(ri + 1.88, JA, ri + 1.88, JB, 'stroke="#f1f3f5" stroke-width="1.2"');
        g += line(ri + 1, JA, ri + 1, JB, `stroke="#fff" stroke-width="${(2 * k / .6).toFixed(1)}" stroke-dasharray="${(18 * k / .6).toFixed(0)} ${(14 * k / .6).toFixed(0)}"`);
        // поріг смуги («зебра») і знаки приземлення — там, де смуга виходить з-за ділянки ліворуч
        let jt = null; for (let j = JB; j > JA; j--) { const c = P(ri + 1, j); if (c.x > 20 && c.y < E(c.x) - 10) { jt = j; break; } }
        if (jt != null) { for (let q = 0; q < 6; q++) { const ii = ri + 0.25 + q * 0.3; g += line(ii, jt - 1.4, ii, jt - .2, 'stroke="#fff" stroke-width="2"'); }
          [4, 7].forEach(d => { g += line(ri + .45, jt - d - 1, ri + .45, jt - d, 'stroke="#fff" stroke-width="3"') + line(ri + 1.55, jt - d - 1, ri + 1.55, jt - d, 'stroke="#fff" stroke-width="3"'); }); }
        for (let j = JA; j < JB; j += 2) { const a = P(ri, j), b = P(ri + 2, j); g += `<circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="1" fill="#ffe066"/><circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="1" fill="#ffe066"/>`; }
        // руліжна доріжка + з'єднання зі смугою
        const ti = x0 - 10;
        g += strip(ti, ti + 1.3, JA, JB, '#6c757d') + line(ti + .65, JA, ti + .65, JB, 'stroke="#ffd43b" stroke-width="1.2"');
        for (let j = Math.ceil(JA / 9) * 9; j < JB; j += 9) g += strip(ti + 1.3, ri, j, j + 1.2, '#6c757d') + line(ti + .65, j + .6, ri, j + .6, 'stroke="#ffd43b" stroke-width="1.2"');
        // перон і літаки (носом до термінала)
        const ai0 = x0 - 16, ai1 = x0 - 10;
        g += strip(ai0, ai1, JA, JB, '#a2a9b0');
        for (let j = Math.ceil(JA / 5) * 5; j < JB; j += 5) g += line(ai0, j, ai1 - .2, j, 'stroke="#ffd43b" stroke-width=".8" opacity=".8"');
        const tails = ['#4a77c9', '#e03131', '#f59f00', '#2f9e44', '#7048e8'];
        for (let j = Math.ceil(JA / 5) * 5 + 2.5, q = 0; j < JB; j += 5, q++) {
          const c = P(ai0 + 3.2, j);
          if (!isBack(Math.floor(ai0 + 3), Math.floor(j)) || !onScr(Math.floor(ai0 + 3), Math.floor(j))) continue;
          objs.push([ai0 + 3 + j, isoG(c.x, c.y, 1.15 * k / .6, `<g transform="rotate(180)">${jet('#ffffff', tails[q % tails.length])}</g>`)]);
          if (lotOk(ai0 - 2, Math.floor(j), 2, 1)) objs.push([ai0 + j, boxG(ai0 - .6, j - .2, 1.6, .4, 7 * k / .6, '#adb5bd', false)]);   // телетрап
        }
        // термінал (модулі зі склом до перону), вежа, ангар
        const tI = x0 - 20;
        for (let j = Math.floor(JA / 4) * 4; j < JB; j += 4) {
          if (!lotOk(tI, j, 4, 4)) continue;
          const big = ((j / 4) % 3 + 3) % 3 === 1;
          objs.push([tI + j + 8, boxG(tI, j, 4, 4, (big ? 40 : 28) * k / .6, '#e9ecef', true)]);
        }
        const cand = []; for (let j = JA; j < JB; j++) if (lotOk(x0 - 23, j, 2, 2)) cand.push(j);
        if (cand.length) { const j = cand[Math.floor(cand.length * 0.75)], F = P(x0 - 23 + 1.4, j + 1.4), t = tOf(F.y), hh = 120 * k / .6;
          objs.push([x0 - 23 + j + 4, boxG(x0 - 23, j, 1.4, 1.4, hh, '#ced4da', false)
            + `<polygon points="${n(F.x - 16, F.y - hh)} ${n(F.x + 16, F.y - hh)} ${n(F.x + 12, F.y - hh - 16)} ${n(F.x - 12, F.y - hh - 16)}" fill="${haze('#339af0', t)}"/><rect x="${(F.x - 17).toFixed(1)}" y="${(F.y - hh - 21).toFixed(1)}" width="34" height="6" fill="${haze('#495057', t)}"/>`]); }
        const candH = []; for (let j = JA; j < JB; j++) if (lotOk(x0 - 22, j, 5, 6)) candH.push(j);
        if (candH.length) { const j = candH[Math.floor(candH.length * 0.2)];
          objs.push([x0 - 22 + j + 11, boxG(x0 - 22, j, 5, 6, 34 * k / .6, '#c7ccd1', false)]); }
        // буфер уздовж паркану: 2 ряди бруківки (поверх смуг, щоб смуга не «починалась в городі»)
        for (let i = I0; i < I1; i++) for (let j = J0; j < J1; j++) if (isBack(i, j) && onScr(i, j) && nearPlot(i, j)) g += pave(i, j);
      }
      objs.sort((a, b) => a[0] - b[0]);
      const base = id === 'city' ? '#d5d9dd' : id === 'sky' ? '#a6d97a' : '#9cc47a';
      defs += `<linearGradient id="vfog" x1="0" y1="0" x2="0" y2="${fogY}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#e7f5ff" stop-opacity="1"/><stop offset=".55" stop-color="#e7f5ff" stop-opacity=".75"/><stop offset="1" stop-color="#e7f5ff" stop-opacity="0"/></linearGradient>`;
      const ground = `<polygon points="${n(0, E(0) + 60)} ${n(w, E(w) + 60)} ${n(w, -20)} ${n(0, -20)}" fill="${haze(base, .3)}"/>`;
      const sky2 = s;   // небо (+ літак)
      return `<defs>${defs}</defs>` + `<rect width="${w}" height="${h}" fill="url(#vsky)"/>` + ground + g + objs.map(o => o[1]).join('') + `<rect width="${w}" height="${fogY}" fill="url(#vfog)"/>` + sky2.replace(/^<rect[^>]*\/>/, '');
    }
    if (id === 'sky') {
      defs += grad('vg', '#b2e08a', '#82c45a');
      s += wedge('url(#vg)') + band('#94d36b', along(B - 3, 'stroke="#7bbf52" stroke-width="2"'));
    }
    if (id === 'fields') {
      // далекі пагорби з посадкою, далі смуги полів, ближче — ґрунтова дорога
      s += `<path d="M0 ${H} Q${w * .2} ${H - 26} ${w * .45} ${H - 8} T${w} ${H - 14} V${H + 2} H0Z" fill="#9bcf6e"/>` + treeLine('#5a9a3c', 12);
      const cols = ['#e7c766', '#a9d97f', '#d9b24f', '#8fcf6a', '#efd27e', '#9fd474'];
      for (let k = 0; k < 6; k++) { const t0 = Math.pow(k / 6, 0.75), t1 = Math.pow((k + 1) / 6, 0.75);
        s += `<polygon points="${n(0, at(0, 1 - t0))} ${n(w, at(w, 1 - t0))} ${n(w, at(w, 1 - t1))} ${n(0, at(0, 1 - t1))}" fill="${cols[k]}"/>`; }
      s += band('#a8d878', `<polygon points="${n(0, E(0) - 8)} ${n(w, E(w) - 8)} ${n(w, E(w) - 18)} ${n(0, E(0) - 18)}" fill="#c9a46c"/>`
        + along(13, 'stroke="#b08a55" stroke-width="1" stroke-dasharray="6 8"'));
    }
    if (id === 'forest') {
      // галявина зі стежкою біля ділянки, далі ліс рядами вглиб: ближчі дерева більші й яскравіші, дальні — дрібніші в серпанку
      defs += grad('vg', '#7fae5a', '#86c95a');
      s += wedge('url(#vg)');
      s += `<path d="M0 ${H} Q${w * .3} ${H - 18} ${w * .6} ${H - 6} T${w} ${H - 12} V${H + 2} H0Z" fill="${haze('#3f7d3a', .95)}"/>`;
      for (let r = 0; r < 9; r++) {
        const t = 1 - r / 9 - 0.04, sz = 14 + (1 - t) * 46, gap = sz * 0.55;
        for (let x = w + 20 - rnd(r) * gap; x > -20; x -= gap * (0.8 + rnd(x + r) * 0.5)) {
          const k = r * 100 + Math.round(x);
          if (r >= 6 && x > w * 0.42 && x < w * 0.62) continue;   // прогалина ближче до ділянки
          const base = at(x, t) + rnd(k) * 6, kind = rnd(k + 7);
          s += kind < 0.72 ? fir(x, base, sz * (0.85 + rnd(k + 3) * 0.35), rnd(k + 5) < .5 ? '#2f8a3e' : '#276f33', t)
            : oak(x, base, sz * 0.8, '#4f9e3a', t);
        }
      }
      s += band('#9bd56d', `<polygon points="${n(0, E(0) - 9)} ${n(w, E(w) - 9)} ${n(w, E(w) - 17)} ${n(0, E(0) - 17)}" fill="#d2b07a"/>`
        + [0.12, 0.34, 0.58, 0.83].map(f => { const x = f * w, y = E(x) - 22; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#4f9e3a"/><circle cx="${(x + 6).toFixed(1)}" cy="${(y + 1).toFixed(1)}" r="4" fill="#5fb045"/>`; }).join(''));
    }
    if (id === 'mountains') {
      // гори нижчі, в долині широкий струмок з деревами по берегах
      const m = 0.62;
      s += `<path d="M0 ${H} L${w * .14} ${H - 120 * m} L${w * .3} ${H - 55 * m} L${w * .5} ${H - 160 * m} L${w * .68} ${H - 70 * m} L${w * .84} ${H - 135 * m} L${w} ${H - 40 * m} V${H + 2} H0Z" fill="${haze('#7d8597', .45)}"/>
        <path d="M${w * .44} ${H - 128 * m} L${w * .5} ${H - 160 * m} L${w * .56} ${H - 132 * m} L${w * .52} ${H - 124 * m}Z M${w * .1} ${H - 98 * m} L${w * .14} ${H - 120 * m} L${w * .18} ${H - 100 * m}Z M${w * .8} ${H - 112 * m} L${w * .84} ${H - 135 * m} L${w * .88} ${H - 114 * m}Z" fill="#fff"/>
        <path d="M0 ${H} L${w * .22} ${H - 45 * m} L${w * .4} ${H - 18 * m} L${w * .62} ${H - 52 * m} L${w * .8} ${H - 20 * m} L${w} ${H - 35 * m} V${H + 2} H0Z" fill="${haze('#5f6b7d', .3)}"/>`;
      defs += grad('vg', '#6c9a3a', '#8cc95a');
      s += wedge('url(#vg)');
      // струмок: від підніжжя гір до смуги біля ділянки, ширшає ближче
      const P0 = [w * .58, H], P1 = [w * .5, at(w * .5, .55)], P2 = [w * .32, at(w * .32, .32)], P3 = [w * .18, T(w * .18) + 2];
      const bez = (tt) => [0, 1].map(i => (1 - tt) ** 3 * P0[i] + 3 * (1 - tt) ** 2 * tt * P1[i] + 3 * (1 - tt) * tt ** 2 * P2[i] + tt ** 3 * P3[i]);
      let L = [], R = [];
      for (let k = 0; k <= 24; k++) { const tt = k / 24, [x, y] = bez(tt), wd = 2 + tt * 11; L.push([x - wd, y]); R.push([x + wd, y]); }
      s += `<polygon points="${[...L, ...R.reverse()].map(([a, b]) => n(a, b)).join(' ')}" fill="#4dabf7"/>`;
      s += `<path d="M${n(...bez(0))} C${n(...P1)} ${n(...P2)} ${n(...P3)}" stroke="#a5d8ff" stroke-width="2" fill="none" opacity=".8"/>`;
      // дерева по берегах і в долині (від дальніх до ближніх)
      const trees = [];
      for (let k = 0; k < 26; k++) { const tt = rnd(k * 3 + 1), [x, y] = bez(tt), side = rnd(k * 5) < .5 ? -1 : 1, off = (8 + tt * 14) + rnd(k * 7) * 18;
        trees.push([x + side * off, y + rnd(k) * 4, 1 - tt]); }
      for (let k = 0; k < 18; k++) { const x = rnd(k * 11 + 2) * w, d = 0.15 + rnd(k * 13) * 0.75; trees.push([x, at(x, d), d]); }
      trees.sort((a, b) => a[1] - b[1]).forEach(([x, y, d], k) => {
        const sz = 12 + (1 - d) * 22;
        s += rnd(k + 40) < .65 ? fir(x, y, sz, '#2f8a3e', d * 0.7) : oak(x, y, sz * 0.85, '#4f9e3a', d * 0.7); });
      s += band('#9bd56d', along(B - 4, 'stroke="#86c25a" stroke-width="2"'));
    }
    if (id === 'sea') {
      // пляж уздовж ділянки, піна на березі, море до рівного горизонту з корабликом
      defs += grad('vg', '#74c0fc', '#1c7ed6');
      s += wedge('url(#vg)') + `<path d="M0 ${H} H${w}" stroke="#e7f5ff" stroke-width="2"/>`;
      for (let k = 0; k < 14; k++) { const t = 0.12 + (k * 0.37 % 0.8), x = ((k * 97) % 100) / 100 * w, y = at(x, 1 - t), sc = 0.4 + (1 - t) * 1.2;
        s += `<path d="M${(x - 9 * sc).toFixed(1)} ${y.toFixed(1)} q${(9 * sc).toFixed(1)} ${(-4 * sc).toFixed(1)} ${(18 * sc).toFixed(1)} 0" stroke="#d0ebff" stroke-width="${(1 + sc).toFixed(1)}" fill="none"/>`; }
      s += `<path d="M${w * .7} ${H - 2} l26 0 l-5 7 l-16 0z M${w * .715} ${H - 3} V${H - 28} L${w * .715 + 16} ${H - 5}Z" fill="#fff"/>`;
      s += band('#f3dfa8', along(B - 1, 'stroke="#fff" stroke-width="3"') + along(B - 5, 'stroke="#dcc38a" stroke-width="3"')
        + [0.2, 0.62].map(f => { const x = f * w, y = E(x) - 12; return `<path d="M${(x - 9).toFixed(1)} ${(y - 12).toFixed(1)} q9 -8 18 0z" fill="${f < .5 ? '#ff6b6b' : '#ffd43b'}"/><path d="M${x.toFixed(1)} ${(y - 12).toFixed(1)} V${y.toFixed(1)}" stroke="#868e96" stroke-width="1.5"/>`; }).join(''));
    }
    if (id === 'city') {
      // місто: вздовж дороги — ряди ізометричних будинків, кожен наступний ряд далі, вищий і в серпанку; на горизонті — пам'ятки
      defs += grad('vg', '#c9d1d9', '#dee2e6');
      s += wedge('url(#vg)');
      // далекий силует з пам'ятками: телевежа, собор з банею, хмарочоси
      const far = haze('#7c8fa6', .9);
      s += Array.from({length: 22}, (_, k) => { const x = k * w / 21, bh = 18 + rnd(k + 90) * 40; return `<rect x="${(x - 9).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="18" height="${(bh + 2).toFixed(1)}" fill="${far}"/>`; }).join('');
      const tv = w * 0.78;
      s += `<path d="M${tv - 5} ${H} L${tv - 1.2} ${H - 120} L${tv + 1.2} ${H - 120} L${tv + 5} ${H}Z" fill="${haze('#8a99ad', .75)}"/><rect x="${tv - 6}" y="${H - 96}" width="12" height="6" rx="2" fill="${haze('#8a99ad', .75)}"/>`
        + `<path d="M${tv} ${H - 120} V${H - 150}" stroke="${haze('#8a99ad', .75)}" stroke-width="1.5"/>`;
      const ch = w * 0.24;
      s += `<rect x="${ch - 14}" y="${H - 34}" width="28" height="36" fill="${haze('#b8a99a', .7)}"/><path d="M${ch - 11} ${H - 34} Q${ch} ${H - 62} ${ch + 11} ${H - 34}Z" fill="${haze('#d4b25a', .6)}"/><path d="M${ch} ${H - 58} V${H - 70} M${ch - 4} ${H - 65} H${ch + 4}" stroke="${haze('#d4b25a', .6)}" stroke-width="1.5"/>`;
      const sky1 = w * 0.55;
      s += `<path d="M${sky1 - 10} ${H} V${H - 95} L${sky1} ${H - 112} L${sky1 + 10} ${H - 95} V${H}Z" fill="${haze('#6f87a5', .7)}"/>`;
      // ряди будинків (дальній → ближній), у ряду справа наліво (праві вищі на екрані → далі)
      const pal = ['#8ea3bd', '#a3b3c7', '#7f96b2', '#c2b8a8', '#b1a28f', '#9aa9b8', '#d1c7b7'];
      for (let r = 0; r < 5; r++) {
        const t = 0.86 - r * 0.19, sc = 0.45 + (1 - t) * 0.75;
        for (let x = w + 40, k = 0; x > -50; k++) {
          const id2 = r * 50 + k, wr = (16 + rnd(id2) * 14) * sc, wl = (14 + rnd(id2 + 1) * 12) * sc;
          const hg = (r === 4 ? 30 + rnd(id2 + 2) * 45 : 40 + rnd(id2 + 2) * 95) * sc;
          s += box(x, at(x, t) + 4, wr, wl, hg, pal[Math.floor(rnd(id2 + 3) * pal.length)], t * 0.9);
          x -= (wr + wl) * 0.62 + 4 * sc;
        }
      }
      // ближній край: тротуар з деревцями і дорога вздовж ділянки
      s += band('#ced4da', `<polygon points="${n(0, E(0) - 4)} ${n(w, E(w) - 4)} ${n(w, E(w) - 20)} ${n(0, E(0) - 20)}" fill="#495057"/>`
        + along(12, 'stroke="#fff" stroke-width="1.5" stroke-dasharray="10 8"')
        + [0.08, 0.3, 0.52, 0.74, 0.95].map(f => { const x = f * w, y = E(x) - 22; return oak(x, y, 16, '#51a33a', 0); }).join(''));
    }
    if (id === 'airport') {
      // аеродром: біля ділянки — трава з огорожею; злітна смуга з розміткою; руліжна доріжка; перон з літаками;
      // термінал зі скляним фасадом і телетрапами, диспетчерська вежа, ангар; на горизонті — серпанок і літак, що злітає
      defs += grad('vg', '#9cc47a', '#a6d37f');
      s += wedge('url(#vg)');
      s += `<path d="M0 ${H} Q${w * .5} ${H - 10} ${w} ${H - 4} V${H + 2} H0Z" fill="${haze('#7aa15e', .9)}"/>`;
      // ангар (ліворуч) і термінал з вежею (дальня частина)
      const tA = 0.78;
      const hx0 = w * 0.12, hy0 = at(hx0, tA);
      s += box(hx0 + 10, hy0, 46, 34, 22, '#c7ccd1', tA * 0.6, false)
        + `<path d="M${n(hx0 + 10, hy0 - 22)} Q${n(hx0 + 33, hy0 - 52)} ${n(hx0 + 56, hy0 - 45)}" stroke="${haze('#adb5bd', .5)}" stroke-width="2" fill="none"/>`
        + `<polygon points="${n(hx0 + 14, hy0 - 2)} ${n(hx0 + 50, hy0 - 20)} ${n(hx0 + 50, hy0 - 38)} ${n(hx0 + 14, hy0 - 20)}" fill="${haze('#868e96', .5)}"/>`;
      // термінал — кілька модулів уздовж перону (справа наліво — дальні першими), скляний фасад на правій грані
      for (let k = 0, x = w * 0.84; k < 6; k++, x -= 44) {
        const y = at(x, tA), hg = k === 2 ? 34 : 22;
        s += box(x, y, 34, 20, hg, '#e9ecef', tA * 0.45, false);
        s += `<polygon points="${n(x + 2, y - 3)} ${n(x + 32, y - 18)} ${n(x + 32, y - 17 - hg + 6)} ${n(x + 2, y - hg + 3)}" fill="${haze('#4dabf7', .4)}" opacity=".9"/>`
          + `<path d="M${n(x + 2, y - hg / 2)} L${n(x + 32, y - 17 - hg / 2)}" stroke="${haze('#e7f5ff', .3)}" stroke-width="1"/>`;
      }
      const cx = w * 0.9, cy = at(cx, tA + 0.02);
      s += `<rect x="${cx - 4}" y="${cy - 74}" width="8" height="74" fill="${haze('#ced4da', .5)}"/><polygon points="${cx - 12},${cy - 74} ${cx + 12},${cy - 74} ${cx + 9},${cy - 90} ${cx - 9},${cy - 90}" fill="${haze('#339af0', .4)}"/><rect x="${cx - 13}" y="${cy - 94}" width="26" height="5" fill="${haze('#495057', .4)}"/>`;
      // перон і літаки біля термінала (ізометрично, вигляд зверху)
      const ap = at(0, 0.62), ap2 = at(w, 0.62);
      s += `<polygon points="${n(0, at(0, .72))} ${n(w, at(w, .72))} ${n(w, at(w, .5))} ${n(0, at(0, .5))}" fill="${haze('#9aa1a8', .35)}"/>`;
      // літаки на пероні носом до термінала (вгору-ліворуч), різні кольори хвостів
      [[0.26, 0.6, '#4a77c9'], [0.5, 0.6, '#e03131'], [0.73, 0.6, '#f59f00']].forEach(([f, d, c]) => { const x = f * w;
        s += isoG(x, at(x, d), 1.05, `<g transform="rotate(180)">${jet('#ffffff', c)}</g>`); });
      // руліжна доріжка з жовтою осьовою
      s += `<polygon points="${n(0, at(0, .5))} ${n(w, at(w, .5))} ${n(w, at(w, .42))} ${n(0, at(0, .42))}" fill="#6c757d"/>`
        + `<path d="M${n(0, at(0, .46))} L${n(w, at(w, .46))}" stroke="#ffd43b" stroke-width="1.2"/>`;
      // злітна смуга: бічні білі лінії, пунктир по осі, «зебра» порогу, знаки точки приземлення, вогні по краю
      const r0 = 0.12, r1 = 0.34;
      s += `<polygon points="${n(0, at(0, r0))} ${n(w, at(w, r0))} ${n(w, at(w, r1))} ${n(0, at(0, r1))}" fill="#3d4349"/>`
        + `<path d="M${n(0, at(0, r0) - 1.5)} L${n(w, at(w, r0) - 1.5)} M${n(0, at(0, r1) + 1.5)} L${n(w, at(w, r1) + 1.5)}" stroke="#f1f3f5" stroke-width="1.2"/>`
        + `<path d="M${n(0, at(0, (r0 + r1) / 2))} L${n(w, at(w, (r0 + r1) / 2))}" stroke="#fff" stroke-width="2" stroke-dasharray="16 12"/>`;
      for (let k = 0; k < 8; k++) { const d = r0 + (r1 - r0) * (k + 0.5) / 8; s += `<path d="M${n(14, at(14, d))} L${n(34, at(34, d))}" stroke="#fff" stroke-width="1.6"/>`; }
      [0.3, 0.42].forEach(f => { const x = f * w; s += `<path d="M${n(x, at(x, r0 + .05))} L${n(x + 24, at(x + 24, r0 + .05))} M${n(x, at(x, r1 - .05))} L${n(x + 24, at(x + 24, r1 - .05))}" stroke="#fff" stroke-width="2.5"/>`; });
      for (let k = 0; k < 24; k++) { const x = k * w / 23; s += `<circle cx="${x.toFixed(1)}" cy="${(at(x, r0) - 3).toFixed(1)}" r=".9" fill="#ffe066"/>`; }
      // літак, що злітає (у небі)
      s += `<g transform="translate(${w * .2} ${H - 70}) rotate(-14) scale(.9)"><path d="M0 0 h46 q8 0 8 4 t-8 4 h-46z" fill="#fff" stroke="#adb5bd"/><path d="M22 4 l-10 16 h6 l14 -16z M20 4 l-8 -12 h5 l11 12z M2 4 l-5 -9 h4 l6 9z" fill="#4a77c9"/></g>`;
      // трава з огорожею біля ділянки
      s += band('#9ac67a', along(B - 6, 'stroke="#868e96" stroke-width="1.5"')
        + Array.from({length: 20}, (_, k) => { const x = k * w / 19, y = E(x) - (B - 6); return `<path d="M${x.toFixed(1)} ${y.toFixed(1)} V${(y - 9).toFixed(1)}" stroke="#868e96" stroke-width="1.5"/>`; }).join('')
        + along(B - 14, 'stroke="#adb5bd" stroke-width="1"'));
    }
    return `<defs>${defs}</defs>` + s;
  }
  // Розширення офісу: передній кут притиснутий до низу, кімната росте вгору і в боки, масштаб не змінюється (краї обрізаються)
  // масштаб рахується від 7×7 (ZONE_CFG), базова кімната 9×9 — на 2 ряди вища
  const ROOM_UPGRADES = {10: 15000, 11: 25000, 12: 40000, 13: 60000, 14: 90000};   // розмір → ціна ($, як докупити площу офісу)
  const ROOM_BASE = 9, ROOM_MAX = 14;
  const roomSize = zone => zone !== 'office' ? null : (state.editing === 'office' ? state.size.draft : state.size.owned);
  const cfgOf = zone => {
    const n = roomSize(zone);
    return n ? {...ZONE_CFG[zone], W: n, D: n} : ZONE_CFG[zone];
  };
  // Оздоблення офісу: кольори і текстури стін та підлоги (перший варіант — безкоштовний)
  // two: [верх, низ], split — частка висоти знизу, line — смужка між ними (як «по плече» в під'їзді)
  const WALL_FINISHES = [
    {id: 'w-soviet', name: 'Совкова синя «по плече»', price: 0, color: '#5b8fb9', two: ['#f1ede4', '#5b8fb9'], split: 0.5, line: '#33536f'},
    {id: 'w-soviet-green', name: 'Совкова зелена «по плече»', price: 50, color: '#7fae8a', two: ['#f1ede4', '#7fae8a'], split: 0.5, line: '#4a7356'},
    {id: 'w-white', name: 'Біла фарба', price: 100, color: '#efe9df'},
    {id: 'w-beige', name: 'Бежева фарба', price: 150, color: '#e8d6b3'},
    {id: 'w-gray', name: 'Сіра фарба', price: 150, color: '#c9ced6'},
    {id: 'w-sky', name: 'Небесно-блакитна', price: 200, color: '#bcd7f0'},
    {id: 'w-olive', name: 'Оливкова', price: 200, color: '#c3c99c'},
    {id: 'w-mint', name: 'М\'ятна', price: 200, color: '#c3ebd8'},
    {id: 'w-navy', name: 'Темно-синя', price: 250, color: '#41527a'},
    {id: 'w-peach', name: 'Персикова', price: 200, color: '#f4c7a6'},
    {id: 'w-lavender', name: 'Лавандова', price: 200, color: '#d6c9ee'},
    {id: 'w-sun', name: 'Сонячна жовта', price: 200, color: '#f7dc8a'},
    {id: 'w-terracotta', name: 'Теракотова', price: 250, color: '#c8714f'},
    {id: 'w-graphite', name: 'Графітова', price: 300, color: '#4a4f57'},
    {id: 'w-brick', name: 'Цегла', price: 800, pattern: 'brick', color: '#b5583a'},
    {id: 'w-wood', name: 'Дерев\'яні панелі', price: 1000, pattern: 'wood', color: '#a06c3c'},
    {id: 'w-stripes', name: 'Шпалери в смужку', price: 400, pattern: 'stripes', color: '#f1e6d0'},
    {id: 'w-ukraine', name: 'Синьо-жовта', price: 300, color: '#4a77c9', two: ['#4a77c9', '#ffd43b'], split: 0.5}
  ];
  const FLOOR_FINISHES = [
    {id: 'f-tile', name: 'Світла плитка', price: 300, tiles: ['#d9cdb8', '#cfc2aa']},
    {id: 'f-concrete', name: 'Бетон', price: 0, tiles: ['#a9a9a4', '#a1a19c']},
    {id: 'f-parquet', name: 'Паркет «ялинка»', price: 1000, tiles: ['#e2c595', '#e2c595'], herring: ['#e8cc9e', '#dbbb88', '#b8935f']},
    {id: 'f-dark', name: 'Темна плитка', price: 800, tiles: ['#4a4f57', '#40454d']},
    {id: 'f-blue', name: 'Синій ковролін', price: 500, tiles: ['#4c6ef5', '#4867ea']},
    {id: 'f-red', name: 'Бордовий ковролін', price: 500, tiles: ['#8f2d3a', '#872a36']},
    {id: 'f-checker', name: 'Шахова чорно-біла', price: 900, tiles: ['#f8f9fa', '#343a40']},
    {id: 'f-marble', name: 'Мармур', price: 3000, tiles: ['#f1f1ef', '#e3e3df'], lines: '#c9c9c4'},
    {id: 'f-linoleum', name: 'Лінолеум совковий', price: 0, tiles: ['#a86a3e', '#a86a3e'], lino: ['#c58a58', '#8c5430', '#93603a']},
    {id: 'f-laminate', name: 'Світлий ламінат', price: 1000, tiles: ['#dcc29a', '#d2b78e'], lines: '#b89a70'},
    {id: 'f-green', name: 'Зелений ковролін', price: 500, tiles: ['#3f8f4f', '#3a8749']},
    {id: 'f-gray', name: 'Сірий ковролін', price: 450, tiles: ['#8d939b', '#878d95']},
    {id: 'f-terrazzo', name: 'Терацо', price: 2000, tiles: ['#e9e3d8', '#ddd5c6'], lines: '#c2b8a6'},
    {id: 'f-granite', name: 'Граніт як у метро', price: 5000, tiles: ['#8f8580', '#a39892'], lines: '#6f6661', speck: ['#d8cfc8', '#4a4340', '#b9aca3']},
    {id: 'f-venzel', name: 'Плитка «Вензель»', price: 2500, tiles: ['#f1e4d4', '#eadbc8'], lines: '#d9c4ab', motif: ['#b56a78', '#c98f96']}
  ];
  const finishOf = (list, id) => list.find(f => f.id === id) || list[0];
  const finishSource = () => (state.editing === 'office' ? state.finish.draft : state.finish.owned);
  const shade = (hex, k) => '#' + hex.slice(1).match(/../g).map(h => Math.max(0, Math.min(255, Math.round(parseInt(h, 16) * k))).toString(16).padStart(2, '0')).join('');
  // візерунок стіни: skewY повертає його вздовж ізометричної стіни
  function wallPattern(f, id, skew) {
    const tr = `patternTransform="skewY(${skew})"`;
    if (f.pattern === 'brick') return `<pattern id="${id}" width="24" height="12" patternUnits="userSpaceOnUse" ${tr}><rect width="24" height="12" fill="${f.color}"/><path d="M0 12H24M0 6H24M12 0V6M0 6V12M24 6V12" stroke="#7a3a24" stroke-width="1.2"/></pattern>`;
    if (f.pattern === 'wood') return `<pattern id="${id}" width="14" height="40" patternUnits="userSpaceOnUse" ${tr}><rect width="14" height="40" fill="${f.color}"/><path d="M0 0V40" stroke="#6e4422" stroke-width="1.5"/><path d="M7 10v6" stroke="#7c4f2a" stroke-width="1"/></pattern>`;
    if (f.pattern === 'stripes') return `<pattern id="${id}" width="16" height="10" patternUnits="userSpaceOnUse" ${tr}><rect width="16" height="10" fill="${f.color}"/><rect width="5" height="10" fill="#d9c7a3"/></pattern>`;
    if (f.pattern === 'ua') return `<pattern id="${id}" width="10" height="128" patternUnits="userSpaceOnUse" ${tr}><rect width="10" height="64" fill="#4a77c9"/><rect y="64" width="10" height="64" fill="#ffd43b"/></pattern>`;
    return '';
  }
  const roomUpgradeCost = (from, to) => { let s = 0; for (let n = from + 1; n <= to; n++) s += ROOM_UPGRADES[n] || 0; return s; };

  // ---------- каталог ----------
  let CATALOG = [];
  const byId = new Map();
  // Дві сторони однієї моделі (колишні «… А» / «… Б»): у меню — одна картка (сторона А, ціна А), над поставленою річчю
  // «↕» міняє сторону, «↔» — дзеркало; разом 4 положення. Поставлена річ зберігає id своєї сторони (uid той самий — не покупка).
  const SIDE_PAIRS = [
    ['desk-m-workplace-man-suit-laptop', 'desk-m-workplace-man-gray-laptop'],                    // Адвокат
    ['desk-m-workplace-woman-blue-laptop', 'desk-m-workplace-woman-laptop'],                     // Бухгалтер
    ['office-m-desk-woman-headset', 'office-m-desk-woman-laptop'],                               // Подруга з Дніпра (кол-центр)
    ['desk-l-executive-with-drawers', 'desk-l-executive-front-panel'],                           // Стіл з шухлядой на замку
    ['desk-l-executive-front-panel-and-boss-chair', 'desk-l-executive-with-drawers-and-chair'],  // …і кріслом Боса
    ['desk-s-simple-chair-behind', 'desk-s-simple-chair-front'],                                 // Стіл зі стулом
    ['desk-l-corner-l', 'desk-l-reception-curved'],                                              // Стіл кутовий з шухлядами
    ['desk-l-corner-l-with-chair', 'desk-l-reception-curved-with-chair'],                        // …і кріслом
    ['desk-l-corner-l-metal-beige', 'desk-l-corner-l-metal-beige-mirrored'],                     // Стіл кутовий металевий
    ['person-military-desert-lying-wounded', 'person-military-desert-crawling'],                // Військовий відпочиває
    ['vehicle-military-sam-xl-tubes-raised', 'vehicle-military-sam-xl-tubes-lowered'],          // С-300 пускова: А — труби підняті ($15 млн), Б — опущені
    // перед / «(спиною)» (-front / -back) — об'єднано 26.11.2026
    ['chair-cantilever-orange-front', 'chair-cantilever-orange-back'],
    ['chair-office-green-front', 'chair-office-green-back'],
    ['chair-executive-beige-front', 'chair-executive-beige-back'],
    ['sofa-l-gray-cushions-front', 'sofa-l-gray-back'],
    ['sofa-l-red-front', 'sofa-l-red-back'],
    ['armchair-s-red-front', 'armchair-s-red-back'],
    ['sofa-module-s-red-corner-front', 'sofa-module-s-red-corner-back'],
    ['armchair-s-white-front', 'armchair-s-white-back'],
    ['sofa-l-white-front', 'sofa-l-white-back'],
    ['person-stewardess-blue-front', 'person-stewardess-blue-back'],
    ['person-stewardess-red-skirt-front', 'person-stewardess-red-skirt-back'],
    ['person-stewardess-red-trousers-front', 'person-stewardess-red-trousers-back'],
    ['person-captain-navy-front', 'person-captain-navy-back'],
    ['person-stewardess-blouse-front', 'person-stewardess-blouse-back'],
    ['person-ground-staff-red-jacket-front', 'person-ground-staff-red-jacket-back'],
    ['person-ground-staff-red-shirt-front', 'person-ground-staff-red-shirt-back'],
    ['person-technician-red-front', 'person-technician-red-back'],
    ['person-ramp-worker-front', 'person-ramp-worker-back'],
    ['person-biz-woman-red-jacket-front', 'person-biz-woman-red-jacket-back'],
    ['person-biz-man-gray-suit-front', 'person-biz-man-gray-suit-back-gesture'],
    ['person-biz-man-gray-suit-phone-front', 'person-biz-man-gray-suit-back-phone'],
    ['person-biz-woman-white-blouse-phone-front', 'person-biz-woman-white-blouse-phone-back'],
    ['person-biz-woman-red-jacket-gesture-front', 'person-biz-woman-red-jacket-gesture-back'],
    ['person-biz-woman-gray-suit-front', 'person-biz-woman-gray-suit-back'],
    ['person-biz-woman-gray-suit-headset-front', 'person-biz-woman-gray-suit-headset-back'],
    ['person-casual-man-vr-headset-front', 'person-casual-man-vr-headset-back'],
    ['person-casual-woman-vr-headset-front', 'person-casual-woman-vr-headset-back'],
    ['person-home-woman-towel-front', 'person-home-woman-towel-back'],
    ['person-home-man-towel-front', 'person-home-man-towel-back'],
    ['person-maid-front', 'person-maid-back'],
    ['person-window-cleaner-front', 'person-window-cleaner-back'],
    ['person-police-woman-front', 'person-police-woman-back'],
    ['person-police-man-front', 'person-police-man-back'],
    ['person-firefighter-man-front', 'person-firefighter-man-back'],
    ['person-firefighter-woman-front', 'person-firefighter-woman-back'],
    ['person-officer-pilot-front', 'person-officer-pilot-back'],
    ['person-steward-shirt-front', 'person-steward-shirt-back'],
    ['person-steward-vest-front', 'person-steward-vest-back'],
    ['person-first-officer-front', 'person-first-officer-back'],
    ['person-senior-captain-white-front', 'person-senior-captain-white-back'],
    ['person-trad-woman-red-qipao-front', 'person-trad-woman-red-qipao-back'],
    ['person-trad-woman-purple-dress-front', 'person-trad-woman-purple-dress-back'],
    ['person-trad-man-red-jacket-front', 'person-trad-man-red-jacket-back'],
    ['person-trad-man-purple-suit-front', 'person-trad-man-purple-suit-back'],
    ['person-trad-woman-kimono-front', 'person-trad-woman-kimono-back'],
    ['person-trad-woman-yellow-dress-front', 'person-trad-woman-yellow-dress-back'],
    ['person-trad-man-teal-jacket-front', 'person-trad-man-teal-jacket-back'],
    ['person-trad-woman-blue-skirt-front', 'person-trad-woman-blue-skirt-back'],
    ['person-trad-woman-black-top-long-skirt-front', 'person-trad-woman-black-top-long-skirt-back'],
    ['person-trad-man-white-shirt-jeans-front', 'person-trad-man-white-shirt-jeans-back'],
    ['person-trad-man-gray-coat-beard-front', 'person-trad-man-gray-coat-beard-back'],
    ['person-trad-man-white-robe-front', 'person-trad-man-white-robe-back'],
    ['person-trad-woman-folk-red-belt-front', 'person-trad-woman-folk-red-belt-back'],
    ['person-trad-man-folk-red-scarf-front', 'person-trad-man-folk-red-scarf-back'],
    ['person-trad-man-white-robe-walking-front', 'person-trad-man-white-robe-walking-back'],
    ['person-trad-woman-gray-gown-front', 'person-trad-woman-gray-gown-back'],
    ['person-trad-man-bowler-coat-front', 'person-trad-man-bowler-coat-back'],
    ['person-elderly-man-walker-front', 'person-elderly-man-walker-back'],
    ['person-military-desert-man-front', 'person-military-desert-man-back'],
    ['person-soldier-camo-man-front', 'person-soldier-camo-man-back'],
    ['person-military-desert-woman-front', 'person-military-desert-woman-back'],
    ['person-soldier-camo-woman-front', 'person-soldier-camo-woman-back'],
    ['person-soldier-camo-heavy-front', 'person-soldier-camo-heavy-back'],
    ['person-military-desert-armor-front', 'person-military-desert-armor-back']
  ];
  const SIDE_OF = new Map(SIDE_PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]));
  const SIDE_B = new Set(SIDE_PAIRS.map(([, b]) => b));
  const sideA = id => (SIDE_B.has(id) ? SIDE_OF.get(id) : id);        // «головна» сторона (для 🎒-лічильника)
  // інша сторона, якщо вона є і не видалена з каталогу
  const otherSide = id => { const o = SIDE_OF.get(id); const it = o && byId.get(o); return it && !it.hidden ? it : null; };
  // назва без «А»/«Б» в кінці; ціна сторони Б = ціна сторони А
  function syncSides(item) {
    if (!SIDE_OF.has(item.id)) return;
    item.name = item.name.replace(/\s+[АБAB]$/, '').replace(/\s*\(спиною\)$/, '');
    const [a, b] = SIDE_B.has(item.id) ? [byId.get(SIDE_OF.get(item.id)), item] : [item, byId.get(SIDE_OF.get(item.id))];
    if (a?.cost && b?.cost) Object.assign(b, {cur: a.cur, price: a.price, plusPies: a.plusPies, pricePies: a.pricePies, free: a.free, cost: {...a.cost}});
  }
  // видалені в тест-режимі речі не показуються в меню (крім «показати видалені»); сторона Б — тільки в тест-режимі (перевіряти розміри)
  const itemsFor = zone => CATALOG.filter(c => (c.zone === zone || c.zone === 'both') && (!c.hidden || (state.testMode && state.showHidden)) && (!SIDE_B.has(c.id) || state.testMode));
  const allGroups = () => [...new Set(CATALOG.map(c => c._base?.group || c.group))];
  const groupsFor = zone => [...new Set(itemsFor(zone).map(c => c.group))];
  // «Всі категорії» — головна сторінка меню «Облаштувати»: картки категорій (у тому ж стилі, що й речі)
  const ALL_CATS = 'Всі категорії';
  const MINI_W = 156, MINI_H = 120;   // прев'ю на картках меню (5 карток у ряд; було 122×96 при 6 у ряд)
  function catCardsHtml(zone, list, FIN_G, finSw) {
    const card = (g, preview, sub) => `<div class="isocard catcard" data-cat="${esc(g)}" title="Відкрити «${esc(g)}»">${preview}<div class="n"><b>${esc(g)}</b></div><div class="p">${sub}</div></div>`;
    return list.map(g => {
      const fk = FIN_G[g];
      if (fk === 'wall' || fk === 'floor') {
        const L = fk === 'wall' ? WALL_FINISHES : FLOOR_FINISHES;
        return card(g, `<div class="finprev" style="background:${finSw(finishOf(L, state.finish.draft[fk]))}"></div>`, `${L.length} варіантів`);
      }
      if (fk === 'view') {
        const prev = `url('data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="72" viewBox="0 120 451 270" preserveAspectRatio="xMidYMid slice">${viewSvg(state.view.draft, 451, 340, 300).replace(/#/g, '%23')}</svg>`).replace(/%2523/g, '%23')}') center/cover`;
        return card(g, `<div class="finprev" style="background:${prev}"></div>`, `${HOME_VIEWS.length} варіантів`);
      }
      if (fk === 'fence') {
        const f = FENCES[FENCES.length - 1];
        const prev = `#f1f3f5 url('data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="44" viewBox="0 0 40 30">${fenceSvg(f.id, {x: 4, y: 26}, {x: 36, y: 18})}</svg>`)}') center/contain no-repeat`;
        return card(g, `<div class="finprev" style="background:${prev}"></div>`, `${FENCES.length} видів`);
      }
      const its = itemsFor(zone).filter(c => c.group === g && !SIDE_B.has(c.id)).sort((a, b) => (a.cost.usd + a.cost.pies * 4000) - (b.cost.usd + b.cost.pies * 4000));
      if (!its.length) return '';
      const rep = its[Math.floor(its.length * 0.6)];        // «обличчя» категорії — річ трохи дорожча за середню
      return card(g, miniHtml(rep, MINI_W, MINI_H), `${its.length} шт.`);
    }).join('');
  }
  // Ручні виправлення розмірів (режим «Тест розмірів»): ISOMETRIC/overrides.json + ще не збережені в localStorage
  const OVR_KEY = 'isoOverrides';
  let overrides = {};
  function applyOverride(item) {
    item._base ||= {fw: item.fw, fd: item.fd, ax: item.ax, ay: item.ay, name: item.name, price: item.price, group: item.group};
    // категорія, змінена в «🛠 Редагувати каталог» (override group)
    item.group = overrides[item.id]?.group || item._base.group;
    const o = overrides[item.id] || {};
    // назва і ціна, змінені в тест-режимі
    item.name = o.name || item._base.name;
    // «на підставці»: під річчю малюється проста тумбочка, сама річ піднімається на її висоту
    item.stand = Boolean(o.stand) && item.place !== 'wall';
    item.fw = o.fw ?? item._base.fw;
    item.fd = o.fd ?? item._base.fd;
    // масштаб моделі (×): картинка і її кут збільшуються разом; зсув dx/dy — уже в пікселях на екрані
    item.scale = o.scale || 1;
    item.dw = item.w * item.scale;
    item.dh = item.h * item.scale;
    item.ax = (item._base.ax ?? item.w / 2) * item.scale + (o.dx || 0);
    item.ay = (item._base.ay ?? item.h) * item.scale + (o.dy || 0);
    item.ok = Boolean(o.ok);
    item.hidden = Boolean(o.hidden);
    // вирізані клітинки (форма «Г» тощо): тільки ті, що в межах fw×fd
    item.holes = (o.holes || []).filter(c => { const [a, b] = c.split(",").map(Number); return a < item.fw && b < item.fd; });
    // ціна: за замовчуванням $ (реалістична, з каталогу); з галочкою «за пиріжки» — 🥧 (ставиться вручну)
    item.cur = o.pies ? 'pies' : 'usd';
    item.price = o.price ?? (o.pies ? item._base.price : defaultUsd(item));
    // «+ пиріжки»: платити і $, і 🥧; «За рахунок профсоюза UCAA»: безкоштовно (ціни зберігаються на потім)
    item.plusPies = !o.pies && Boolean(o.plusPies);
    item.pricePies = item.plusPies ? (o.pricePies ?? item._base.price) : 0;
    item.free = Boolean(o.free);
    item.cost = item.free ? {usd: 0, pies: 0} : item.cur === 'pies' ? {usd: 0, pies: item.price} : {usd: item.price, pies: item.pricePies};
    syncSides(item);
  }
  // стартова ціна в $: будинки — ціна за клітинку × реальна площа (більший будинок дорожчий), решта — фіксована
  const STAND_USD = 60;   // проста тумбочка-підставка
  function defaultUsd(item) {
    const cells = Math.max(1, item.fw * Math.max(1, item.fd) - (item.holes || []).length);
    const base = item.usdCell ? Math.round(item.usdCell * cells / 100) * 100 : item.usd ?? item._base.price * 100;
    return base + (item.standOf ? STAND_USD : 0);
  }
  // Варіанти «на підставці»: окрема річ <id>--stand одразу після оригіналу; існує, поки є overrides[<id>--stand]
  const STAND_SUFFIX = '--stand';
  function buildStandVariants() {
    CATALOG.filter(c => c.standOf).forEach(c => byId.delete(c.id));
    CATALOG = CATALOG.filter(c => !c.standOf);
    const out = [];
    CATALOG.forEach(c => {
      out.push(c);
      const vid = c.id + STAND_SUFFIX;
      if (c.place === 'wall' || !overrides[vid]) return;
      const v = {...c, ...c._base, id: vid, standOf: c.id, name: `${c.name} на підставці`};
      delete v._base;
      byId.set(vid, v); applyOverride(v);
      out.push(v);
    });
    CATALOG = out;
  }
  // нові моделі від адмінів (сервер, «➕ Додати модель») → у формат каталогу.
  // Картинка: з сайту (ISOMETRIC/custom/<id>.webp), якщо її вже завантажили на GitHub (gh), інакше — з сервера
  const CUSTOM_DIR = 'ISOMETRIC/custom/';
  const SITE_URL = 'https://kazuar.in.ua/';
  const customSrc = (ci, suf = '') => ci.gh ? `${LOCAL ? SITE_URL : ''}${CUSTOM_DIR}${ci.id}${suf}.webp?v=${ci.v || 1}` : `${API}/item-img/${ci.id}${suf}?v=${ci.v || 1}`;
  // нова модель на стіну з нахилом: окрема картинка для правої стіни <id>--r (замість дзеркала — текст читається)
  const R_SUFFIX = '--r';
  const customToCatalog = ci => ({id: ci.id, folder: 'custom', group: ci.group, zone: ci.zone, name: ci.name, src: customSrc(ci), srcR: ci.r ? customSrc(ci, R_SUFFIX) : null,
    w: ci.w, h: ci.h, place: ci.place, fw: ci.fw, fd: ci.fd, ax: ci.ax, ay: ci.ay, usd: ci.usd, usdCell: null,
    size: 'm', price: 25, door: false, flat: Boolean(ci.flat), custom: ci});
  let customItems = [];
  Promise.all([
    fetch('ISOMETRIC/catalog.json', {cache: 'no-store'}).then(r => r.json()),
    fetch('ISOMETRIC/overrides.json', {cache: 'no-store'}).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    // правки каталогу і нові моделі на сервері (Promise.resolve — щоб API вже було оголошене)
    Promise.resolve().then(() => fetch(`${API}/catalog-extra`, {cache: 'no-store'})).then(r => r.ok ? r.json() : null).catch(() => null)
  ]).then(([list, fileOvr, extra]) => {
    // головне — сервер (бачать усі, правлять адміни); файл overrides.json — стара база (до 26.11.2026);
    // у браузері лежать лише правки, які ще не дописались (DIRTY_KEY)
    localStorage.removeItem(OVR_KEY);   // стара повна копія (до 05.11) — вже у файлі
    const dirty = JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}');
    const srvOvr = extra?.overrides || {};
    state.ovrServer = Boolean(extra);
    overrides = {...fileOvr, ...srvOvr};
    customItems = extra?.items || [];
    list = list.concat(customItems.filter(ci => !list.some(c => c.id === ci.id)).map(customToCatalog));
    // перший раз: на сервері правок ще нема — адмін переносить туди весь overrides.json
    if (extra && !Object.keys(srvOvr).length && Object.keys(fileOvr).length && isAdmin()) {
      api('/catalog-overrides', {set: fileOvr}).then(r => toast(r.ok ? `✓ Правки каталогу (${Object.keys(fileOvr).length}) перенесено на сервер` : `⚠ ${r.error}`));
    }
    Object.entries(dirty).forEach(([id, o]) => { if (o) overrides[id] = o; else delete overrides[id]; });
    // стара галочка «на підставці» прямо на оригіналі → окрема річ <id>--stand, оригінал без підставки
    const moved = [];
    Object.keys(overrides).forEach(id => {
      const o = overrides[id];
      if (id.endsWith(STAND_SUFFIX) || !o?.stand) return;
      delete o.stand;
      if (!overrides[id + STAND_SUFFIX]) { const copy = {...o}; delete copy.name; delete copy.hidden; overrides[id + STAND_SUFFIX] = {...copy, stand: true}; }
      moved.push(id, id + STAND_SUFFIX);
    });
    CATALOG = list;
    list.forEach(c => { byId.set(c.id, c); applyOverride(c); });
    buildStandVariants();
    render();
    if (moved.length) saveOverrides(moved);
    Object.keys(dirty).forEach(id => unsaved.add(id));   // правки, які не встигли зберегти, — показуємо «💾 Зберегти»
  });
  // збереження у файл через локальний приймач (D:\KAZUAR IN UA website\dev_saver.py, порт 8001)
  let saveTimer = null;
  const pending = new Set();   // які речі змінено і ще не дописано у файл
  const DIRTY_KEY = 'isoOverridesDirty';
  // правки на картках «🛠 Редагувати каталог» — спершу тільки тут (і в браузері, щоб не загубились), на сервер — кнопкою «💾 Зберегти»
  const unsaved = new Set();
  function markUnsaved(ids) {
    const dirty = JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}');
    ids.forEach(id => { unsaved.add(id); const o = overrides[id]; dirty[id] = o && Object.keys(o).length ? o : null; });
    localStorage.setItem(DIRTY_KEY, JSON.stringify(dirty));
  }
  function saveOverrides(ids) {
    (ids || []).forEach(id => unsaved.delete(id));
    const dirty = JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}');
    (ids || []).forEach(id => {
      pending.add(id);
      const o = overrides[id];
      dirty[id] = o && Object.keys(o).length ? o : null;
    });
    localStorage.setItem(DIRTY_KEY, JSON.stringify(dirty));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const set = {};
      pending.forEach(id => { const o = overrides[id]; set[id] = o && Object.keys(o).length ? o : null; });
      pending.clear();
      // головне — сервер (адміни сайту, бачать усі); на локальній копії ще й у файл ISOMETRIC/overrides.json (резервна копія)
      const toServer = isAdmin() ? api('/catalog-overrides', {set}) : Promise.resolve({ok: false});
      const toFile = LOCAL ? fetch('http://127.0.0.1:8001/overrides', {method: 'POST', body: JSON.stringify({set})}).catch(() => ({ok: false})) : Promise.resolve({ok: false});
      Promise.all([toServer, toFile])
        .then(([srv, file]) => {
          state.ovrSaved = srv.ok ? 'server' : file.ok ? 'file' : 'local';
          if (srv.ok || file.ok) {   // дописано — з браузера прибираємо
            const d = JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}');
            Object.keys(set).forEach(id => { if (JSON.stringify(d[id]) === JSON.stringify(set[id])) delete d[id]; });
            localStorage.setItem(DIRTY_KEY, JSON.stringify(d));
          }
          renderMenuSafe();
        })
        .catch(() => { state.ovrSaved = 'local'; renderMenuSafe(); });
    }, 600);
  }
  const renderMenuSafe = () => { if (state.editing) renderMenu(); };

  // ---------- стан ----------
  const state = {
    auth: (localStorage.getItem('kazuarCabToken') && localStorage.getItem(AUTH_KEY)) || null,   // вхід через сервер, пам'ятається між сесіями
    editing: null, preview: false,
    owned: {office: [], home: []},     // [{uid,id,i,j,flip,wall,k}]
    draft: {office: [], home: []},
    spent: 0, spentUsd: 0, loadedFor: null,
    sortDesc: localStorage.getItem('devIsoSortDesc') === '1',   // сортування в меню: від дорогих (інакше від дешевих)
    size: {owned: ROOM_BASE, draft: ROOM_BASE},   // розмір офісу (клітинок по кожній стороні)
    finish: {owned: {wall: 'w-soviet', floor: 'f-linoleum'}, draft: {wall: 'w-soviet', floor: 'f-linoleum'}},   // оздоблення офісу
    zoom: {owned: 1, draft: 1},                   // масштаб ділянки «Дім»
    cover: {owned: {}, draft: {}},                // покриття землі дому: {"i,j": id}
    fence: {owned: {}, draft: {}},                // паркани гравця: {"i,j,L|R": styleId}
    brush: null, painting: false,   // brush: id покриття або 'eraser' (гумка для речей)
    plot: {owned: {...PLOT_BASE}, draft: {...PLOT_BASE}},
    view: {owned: 'sky', draft: 'sky'},
    bin: [],                        // прибрані під час редагування речі (можна повернути)
    group: {office: null, home: null},
    placing: null,       // id речі, яку ставимо
    selected: null,      // uid обраної речі
    hover: null,         // {i,j} або {wall,k}
    changedThisSession: sessionStorage.getItem('devCabinetChanged') === '1'
  };
  const clone = v => JSON.parse(JSON.stringify(v));
  const uid = () => Math.random().toString(36).slice(2, 9);

  if (!localStorage.getItem(BASE_DPR_KEY)) localStorage.setItem(BASE_DPR_KEY, String(window.devicePixelRatio || 1));
  const browserZoom = () => (window.devicePixelRatio || 1) / (Number(localStorage.getItem(BASE_DPR_KEY)) || 1);

  // ---------- стилі ----------
  const css = document.createElement('style');
  css.textContent = `
  .devcab-open{margin-left:6px;padding:0;border:0;background:none;cursor:pointer;font:inherit;font-weight:normal;text-transform:none;color:#888}
  .devcab-open:hover{color:#2459d3;text-decoration:underline}
  header.topline{position:relative;text-align:left;padding-left:0;padding-right:275px;min-height:98px;box-sizing:border-box;
    display:flex;flex-direction:column;justify-content:space-evenly;padding-top:4px;padding-bottom:6px}
  body:not(.mobile-cabinet) header.topline h1{font-size:25px;letter-spacing:.3px}
  body:not(.mobile-cabinet) header.topline p{margin:0;font-size:15.5px;line-height:1.55}
  body:not(.mobile-cabinet) header.topline .rank-subtitle-extra{font-size:14.5px}
  .devlogin{position:absolute;top:4px;right:0;display:flex;align-items:stretch;gap:8px;font-size:13px;padding:5px 6px;border:1px solid var(--line,#555);
    background:#fafafa;box-shadow:2px 2px 0 rgba(0,0,0,.12);box-sizing:border-box;width:260px;height:90px}
  .devlogin form,.devlogin .me{flex:1;min-width:0;width:auto!important;justify-content:space-between}
  .devlogin .ava{order:-1;align-self:stretch;flex:none;margin:0;width:62px!important;height:auto!important;object-fit:cover;object-position:center}
  .devlogin .me .nm{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .devlogin .cap{font-size:13px!important;letter-spacing:0!important;white-space:nowrap}
  .devlogin .me .cap .adm{font-size:13px}
  .devlogin .me{overflow:hidden}
  .devlogin .me .nm{max-width:none}
  .devlogin form{display:flex;flex-direction:column;gap:4px;align-items:stretch;width:220px;margin:0}
  .devlogin form input{flex:1;min-width:0}
  .devlogin .cap{font-size:11px;font-weight:bold;color:#0b6f7a;text-transform:uppercase;letter-spacing:.4px}
  .devlogin .cap .adm{color:#888;font-weight:normal;text-transform:none;letter-spacing:0;text-decoration:none}
  .devlogin .fwheel{display:inline-flex;align-items:center;vertical-align:-3px;margin:0 3px 0 4px;padding:0;border:0;background:none;cursor:pointer;font-size:15px;line-height:1}
  .devlogin .fwheel:hover{filter:drop-shadow(0 0 3px #f59f00);transform:scale(1.15)}
  .devlogin .fwheel img.pieic{width:16px;height:16px}
  .devlogin .ava{cursor:pointer}
  .devlogin .ava:hover{filter:brightness(1.08);outline:2px solid #f2c200;outline-offset:1px}
  .devlogin .cap .adm:hover{color:#0b6f7a;text-decoration:underline}
  .devlogin input{padding:3px 6px;border:1px solid var(--line,#555);border-radius:0;background:#fff;color:#111;font:inherit}
  .devlogin input:focus{outline:none;background:#fffbe0}
  .devlogin .row{display:flex;gap:6px;align-items:center}
  .devlogin button{white-space:nowrap;padding:3px 10px;border:1px solid var(--line,#555);border-radius:0;background:var(--cyan,#caeef2);color:#111;font:inherit;font-weight:bold;cursor:pointer}
  .devlogin button:hover{background:var(--yellow,#ffee8c)}
  .devlogin button.yel{background:var(--yellow,#ffee8c)}
  .devlogin button.yel:hover{background:#f7df5a}
  .devlogin button:disabled{opacity:.6;cursor:wait}
  .devlogin .me{display:flex;flex-direction:column;justify-content:space-between;gap:3px;min-width:150px}
  .devlogin .nm{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}
  .devlogin .me .row button{flex:1}
  .devlogin .ava{width:64px;height:64px;border:1px solid var(--line,#555);background:#eef8fa;object-fit:cover}
  .devlogin form{position:relative}
  .devlogin .err{position:absolute;top:calc(100% + 4px);right:0;z-index:200;width:260px;padding:8px 10px;border:1px solid #a33;background:#fdf1f1;box-shadow:2px 2px 0 rgba(0,0,0,.12);color:#a33;font-size:13px;line-height:1.4;text-align:left}
  .devlogin .err[hidden]{display:none}
  .devlogin .help{position:relative;flex:none;width:24px;height:24px;border:1px solid rgba(85,85,85,.35);border-radius:0;background:rgba(120,120,120,.15);color:#555;font-weight:bold;line-height:22px;text-align:center;cursor:help;user-select:none}
  .devlogin .help:hover,.devlogin .help.open{background:rgba(120,120,120,.28)}
  .devlogin .tip{display:none;position:absolute;top:28px;right:-1px;z-index:200;width:260px;padding:8px 10px;border:1px solid var(--line,#555);border-radius:0;background:#fafafa;box-shadow:2px 2px 0 rgba(0,0,0,.12);color:#222;font-weight:normal;line-height:1.4;text-align:left;cursor:default}
  .devlogin .help:hover .tip,.devlogin .help.open .tip{display:block}
  body.mobile-cabinet header.topline{padding-right:12px;text-align:center;min-height:0;display:block}
  body.mobile-cabinet .devlogin{position:static;justify-content:center;margin:4px 0}

  /* Compact signed-in header card; leave the signed-out form unchanged. */
  .devlogin[data-mode^="in:"]{background:#f5fafb;border-color:#9bbac1;border-radius:4px;padding:5px 7px;box-shadow:0 1px 3px #00000012;max-width:100%}
  .devlogin[data-mode^="in:"] .me{display:flex;flex-direction:column;justify-content:space-between;gap:4px;min-width:0;overflow:visible}
  .devlogin[data-mode^="in:"] .devlogin-identity{display:flex;align-items:center;gap:8px;min-width:0}
  .devlogin[data-mode^="in:"] .devlogin-person{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
  .devlogin[data-mode^="in:"] .ava{box-sizing:border-box;width:42px!important;height:42px!important;align-self:center;flex:0 0 42px;border:1px solid #9bbac1;border-radius:4px}
  .devlogin[data-mode^="in:"] .nm{font-size:16px;line-height:19px;color:#18272d}
  .devlogin[data-mode^="in:"] .cap{display:flex;align-items:center;gap:4px;min-width:0;font-size:11px!important;line-height:16px;text-transform:none}
  .devlogin[data-mode^="in:"] .capt{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}
  .devlogin[data-mode^="in:"] .me .cap .adm{display:inline-flex;align-items:center;gap:3px;font-size:11px;margin-left:auto;color:#626b70}
  .devlogin[data-mode^="in:"] .fwheel{flex:none;margin:0;padding:0;border:0;background:none}
  .devlogin[data-mode^="in:"] .fwheel:hover{background:none}
  .devlogin[data-mode^="in:"] .row{gap:6px;border-top:1px solid #d0e2e6;padding-top:4px}
  .devlogin[data-mode^="in:"] .row button{display:inline-flex;align-items:center;justify-content:center;gap:5px;box-sizing:border-box;min-height:24px;padding:2px 7px;border-radius:3px;font-size:12px;line-height:18px}
  .devlogin[data-mode^="in:"] .row .prof{flex:1;background:#caeef2;border-color:#9bbac1;color:#164f59}
  .devlogin[data-mode^="in:"] .row .prof:hover{background:#b6e3e9}
  .devlogin[data-mode^="in:"] .row .out{flex:0 0 auto;background:#fff;border-color:#c8d6da;color:#a33b3b}
  .devlogin[data-mode^="in:"] .row .out:hover{background:#fff0f0;border-color:#d5a0a0}
  .devlogin[data-mode^="in:"] svg{display:block;width:12px;height:12px;flex:none;pointer-events:none}
  .devlogin[data-mode^="in:"] .row button svg{width:14px;height:14px}
  .devlogin[data-mode^="in:"] button:focus-visible,.devlogin[data-mode^="in:"] a:focus-visible{outline:2px solid #0b6f7a;outline-offset:2px}
  .wheelover .wpanel{width:min(940px,96vw);max-height:96vh;overflow:auto;padding:16px 24px 20px;border:1px solid #555;background:#fff;box-shadow:3px 3px 0 rgba(0,0,0,.2);font:13px Arial,sans-serif;color:#222;box-sizing:border-box}
  .wheelover h3{margin:0 0 8px;font-size:17px;text-align:center}
  .wheelover .wstage{display:flex;flex-direction:column;align-items:center;justify-content:center}
  .wheelover .wwrap{position:relative;flex:none}
  .wheelover .wrot{width:100%;height:100%;filter:drop-shadow(3px 3px 0 rgba(0,0,0,.15));border-radius:50%;pointer-events:none}   /* повернутий квадрат кутами налазив на кнопки і «з'їдав» клік */
  .wheelover .wctrl{position:relative;z-index:3}
  .wheelover .wptr{position:absolute;left:50%;top:-8px;z-index:2;width:0;height:0;transform:translateX(-50%);border-left:14px solid transparent;border-right:14px solid transparent;border-top:26px solid #c92a2a;filter:drop-shadow(0 2px 0 #fff)}
  .wheelover .wctrl{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 14px;margin-top:14px;padding-bottom:4px}
  .wheelover .wctrl button{white-space:nowrap}
  .wheelover .wspin{padding:7px 22px;border:1px solid #555;background:#ffee8c;font:inherit;font-size:15px;font-weight:bold;cursor:pointer}
  .wheelover .wspin:hover{background:#f7df5a}
  .modeled input:not([type=checkbox]):not([type=file]),.modeled select{padding:3px 6px;border:1px solid #888;border-radius:0;font:inherit;background:#fff;min-width:0}
  .tst button.tsave{font-weight:bold}
  .tst button.tsave.on{background:#ffe066!important;border-color:#e0a800!important;color:#5c3c00!important;box-shadow:0 0 0 2px rgba(224,168,0,.35)}
  .pweye-wrap{position:relative;display:block}
  .pweye-wrap input{width:100%;box-sizing:border-box;padding-right:36px!important}
  .pweye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:28px;height:26px;padding:0;border:0;background:transparent;font-size:16px;line-height:1;cursor:pointer;opacity:.45}
  .pweye:hover,.pweye.on{opacity:1}
  .modeled .note{line-height:1.45}
  .modeled .mdlbox{margin-top:4px;padding:6px 8px;border:1px solid #2f9e44;background:#ebfbee;line-height:1.8}
  .modeled .mdlink{display:inline-block;margin-right:8px;padding:2px 8px;border:1px solid #2f9e44;background:#fff;color:#1b5e20;font-weight:bold;text-decoration:none}
  .modeled .mdlink:hover{background:#d3f9d8}
  .modeled .mplaces{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-width:440px}
  .modeled .mpl{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px;border:1px solid #bbb;background:#efe9dd;cursor:pointer;min-height:150px}
  .modeled .mpl img{max-width:100%;max-height:150px}
  .modeled .mpl small{font-size:12px;line-height:1.15;color:#444;text-align:center}
  .modeled .mpl.on{border:2px solid #e0a800;padding:2px;background:#fff9db}
  .modeled .mpl-none{background:#fff}
  .modeled .mwalls{display:flex;gap:10px;margin-top:8px}
  .modeled .mwalls div{display:flex;flex-direction:column;align-items:center;gap:3px;width:150px;padding:4px;border:1px solid #ccc;background:#efe9dd}
  .modeled .mwalls img{max-width:140px;max-height:120px}
  .modeled .mwalls small{font-size:10px;color:#555;text-align:center}
  .modeled .mwalls .mdlink{display:block;margin:4px 0 0;padding:3px 6px;text-align:center;font-size:12px;line-height:1.2}
  .modeled .mwalls .mdlink small{font-size:10px;font-weight:normal;color:#2b6a35}
  .modeled .mframes{display:flex;flex-wrap:wrap;gap:5px;align-items:flex-start}
  .modeled .mfr{display:flex;flex-direction:column;align-items:center;gap:2px;width:76px;padding:3px;border:1px solid #bbb;background:#fff;cursor:pointer}
  .modeled .mfr img{width:66px;height:52px;object-fit:contain;background:repeating-conic-gradient(#f1f3f5 0 25%,#fff 0 50%) 0 0/10px 10px}
  .modeled .mfr small{font-size:10px;line-height:1.1;text-align:center;color:#444}
  .modeled .mfr.on{border:2px solid #e0a800;padding:2px;background:#fff9db}
  .modeled .mfcolw{display:inline-flex;align-items:center;gap:4px;font-size:12px}
  .modeled .mcells{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
  .modeled .mcells .mc{min-width:28px;padding:3px 8px}
  .modeled .mcells .mcv{display:inline-block;min-width:18px;text-align:center}
  .modeled .wctrl button:disabled{cursor:default}
  .wheelover .wspin.wfree{background:#d3f9d8;border-color:#2f9e44;color:#1b5e20}
  .wheelover .wspin.wfree:hover{background:#b2f2bb}
  .wheelover .wspin.wfree:disabled{cursor:default;opacity:.55}
  .wheelover .wclose{padding:6px 14px;border:1px solid #555;background:#caeef2;font:inherit;cursor:pointer}
  .wheelover button:disabled{opacity:.5;cursor:wait}
  .wheelover .wleft{font-size:12px;color:#555}
  .wheelover .wodds{font-size:12px;color:#0b6f7a}
  .wheelover .wcat{margin-bottom:8px;font-size:15px;font-weight:bold}
  .wheelover .wview{position:relative;overflow:hidden;width:100%;height:170px;border:1px solid #555;background:#f1f3f5}
  .wheelover .wmark{position:absolute;left:50%;top:0;bottom:0;z-index:2;width:3px;margin-left:-1px;background:#c92a2a;box-shadow:0 0 6px rgba(201,42,42,.6)}
  .wheelover .wtrack{display:flex;height:100%;will-change:transform}
  .wheelover .wcard{flex:0 0 120px;width:120px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px;border-right:1px solid #ced4da;background:#fff}
  .wheelover .wcard img{max-width:106px;width:106px;height:112px;object-fit:contain}
  .wheelover .wcard span{font-size:11px;line-height:1.15;text-align:center;max-height:26px;overflow:hidden}
  .wheelover .wcard.win{background:#fff3bf;outline:3px solid #f59f00;outline-offset:-3px}
  .wheelover .wprize{display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px 0;text-align:center}
  .wheelover .wbig{font-size:22px;font-weight:bold}
  .wheelover .wprize img{max-width:300px;max-height:260px;object-fit:contain}
  .wheelover .wprize b{font-size:18px}
  .wwongrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px;max-height:62vh;overflow:auto;margin-top:6px}
  .wwon{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px;border:1px solid #e0a800;background:#fffbe6;text-align:center;font-size:11px}
  .wwon img{width:100px;height:90px;object-fit:contain}
  .wwon b{font-size:11px;line-height:1.2}
  .wwon i{color:#777;font-style:normal;font-size:10px}
  .wwon.gone{opacity:.45;border-color:#ccc;background:#f5f5f5}
  .isozone-title .wonlink{margin-left:8px;padding:2px 8px;border:1px solid #e0a800;background:#fff3bf;font:bold 12px Arial,sans-serif;cursor:pointer}
  .isomenu .sw.wbtn{padding:7px 18px;white-space:nowrap;font-weight:bold;font-size:16px;line-height:1.2;background:#ffe066;border:2px solid #e0a800;box-shadow:2px 2px 0 rgba(0,0,0,.12)}
  .isomenu .sw.wbtn:hover{background:#ffd43b}
  .isomenu .sw.wbtn img.pieic{width:1.35em;height:1.35em}  .isozone{position:fixed;z-index:60;display:none}
  .isozone.show{display:block}
  .isozone-inner{width:${ZONE_W}px;background:#fff;border:1px solid #999;box-sizing:border-box;font-family:Arial,sans-serif}
  .isozone.plain .isozone-title{visibility:hidden}
  .isozone.plain .isozone-inner{background:transparent;border-color:transparent}
  .isozone-title{display:flex;align-items:center;justify-content:center;gap:10px;height:${TITLE_H}px;box-sizing:border-box;background:#FFEE8C;border-bottom:1px solid #555;font-weight:bold;font-size:15px;padding:5px 6px}
  .isozone-btn{padding:3px 10px;border:0;border-radius:5px;cursor:pointer;font-weight:bold;font-size:13px;color:#fff;background:linear-gradient(135deg,#3b5bdb,#7048e8)}
  .isozone-stage{position:relative;width:${STAGE_W}px;margin:6px;overflow:hidden;background:#fff}
  .isozone-stage::before{content:'';position:absolute;left:0;right:0;top:0;height:90px;z-index:9000;pointer-events:none;background:linear-gradient(#fff 0%,rgba(255,255,255,.85) 30%,rgba(255,255,255,0) 100%)}
  .isoscene{position:absolute;left:0;bottom:0;transform-origin:left bottom}
  .isoback{position:absolute;inset:0;pointer-events:none}
  .isoback svg{display:block}
  .isoscene svg{position:absolute;left:0;top:0;overflow:visible}
  .isoscene img.it{position:absolute;pointer-events:none;user-select:none}
  .isoscene img.it.flip{transform:scaleX(-1)}
  .isohovertip{position:fixed;z-index:10000;pointer-events:none;background:rgba(33,37,41,.92);color:#fff;font:12px/1.35 Arial,sans-serif;padding:5px 8px;border-radius:5px;box-shadow:0 2px 8px rgba(0,0,0,.25);white-space:nowrap}
  .isohovertip[hidden]{display:none}
  .isoscene img.it.sel{filter:drop-shadow(0 0 4px #3b5bdb) drop-shadow(0 0 2px #3b5bdb)}
  .isoscene img.ghost,.isoscene svg.stand.ghost{opacity:.6}
  .isoscene .hit{fill:transparent;cursor:pointer}
  .isoscene.editing .gridline{stroke:rgba(0,0,0,.18);stroke-width:1;fill:none}
  .isoscene .hl-ok{fill:rgba(64,192,87,.45)} .isoscene .hl-bad{fill:rgba(250,82,82,.45)}
  .isodim{position:fixed;inset:0;z-index:55;background:rgba(60,60,60,.55)}
  .isomenu{position:fixed;z-index:61;display:flex;flex-direction:column;background:#fff;border:1px solid #777;border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.3);font:13px Arial,sans-serif;overflow:hidden}
  .isomenu h4{margin:0;padding:8px;background:#FFEE8C;border-bottom:1px solid #555;text-align:center;font-size:15px}
  .isomenu .bar{display:flex;gap:6px;align-items:center;padding:6px;border-bottom:1px solid #eee}
  .isomenu select{flex:1;padding:6px;border:1px solid #ccc;border-radius:5px}
  .isomenu .hint{padding:6px 8px;background:#f1f3f5;color:#444;font-size:12px}
  .isomenu .sel{padding:6px 8px;background:#edf2ff;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
  .isomenu .sel button,.isomenu .foot button{padding:6px 10px;border-radius:5px;border:1px solid #bbb;background:#fff;cursor:pointer;font-weight:bold}
  .isogrid{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;align-content:start}
  .isocard{border:1px solid #e2e2e2;border-radius:6px;padding:4px;text-align:center;cursor:pointer;background:#fff}
  .isocard:hover{border-color:#3b5bdb}
  .receipt .binwarn{border:2px solid #e03131;border-radius:8px;background:#fff5f5;color:#c92a2a;padding:6px 8px}
  .receipt .binwarn button{margin-left:4px;padding:3px 8px;border:1px solid #e03131;border-radius:5px;background:#fff;color:#c92a2a;cursor:pointer;font-weight:bold}
  .receipt .binr{align-items:center;padding:3px 0;border-bottom:1px solid #eee}
  .receipt .binr img{width:28px;height:28px;object-fit:contain;vertical-align:middle;margin-right:6px;float:left}
  .receipt .binr small{color:#666;font-weight:normal}
  .receipt .binr .acts{display:flex;gap:3px;font-weight:normal!important}
  .receipt .binr .acts button{padding:3px 6px;border:1px solid #bbb;border-radius:5px;background:#fff;cursor:pointer;font-size:11px;white-space:nowrap}
  .receipt .binr .acts button.sell{border-color:#e03131;color:#c92a2a}
  .devauth.receipt.wide{width:560px}
  .isogrid.test .isocard .mini{background:#343a40;border-radius:4px}   /* тест розмірів: темний фон і підлога — видно білі краї й дірки */
  .fencehint{position:absolute;z-index:9400;left:6px;right:6px;top:6px;padding:6px 9px;border:2px solid #a0692f;border-radius:7px;background:rgba(255,249,219,.96);color:#5c3a12;font:12px/1.35 Arial,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.18);pointer-events:none}
  .backrow{display:flex;align-items:center;gap:12px;padding:7px 10px;border-bottom:1px solid #e9ecef;background:#fff;font-size:15px}
  .backrow button{padding:6px 16px;border:1px solid #555;background:#caeef2;font:bold 15px Arial,sans-serif;cursor:pointer}
  .backrow button:hover{background:#ffee8c}
  .catcard{cursor:pointer}
  .catcard .n b{font-size:12px}
  .catcard:hover{border-color:#e0a800;background:#fffbe6}
  .catcard .finprev{height:120px;border-radius:5px;border:1px solid #ced4da;margin-bottom:4px}
  .fincard .finprev{height:96px;border-radius:5px;border:1px solid #ced4da;margin-bottom:4px}
  .fincard.on .finprev{border:2px solid #3b5bdb}
  #profileView .profile-pies-balance{display:none!important}   /* пиріжки під аватаркою сховано — баланс тепер у таблиці «Загальна інформація» */
  #profileView [data-pies-balance-cell]{cursor:pointer}
  img.pieic{width:1.2em;height:1.2em;object-fit:contain;vertical-align:-.25em;display:inline-block}
  .sellx{display:inline-block;margin-left:3px;padding:0 3px;border:1px solid #e03131;border-radius:4px;background:#fff5f5;cursor:pointer;font-size:10px;line-height:14px}
  .sellx:hover{background:#ffe3e3}
  .isocard .sellstock{margin-top:4px;width:100%;padding:3px 4px;border:1px solid #e03131;border-radius:5px;background:#fff5f5;color:#c92a2a;cursor:pointer;font-size:11px;line-height:1.25}
  .isocard .sellstock:hover{background:#ffe3e3}
  .isocard.placed{background:#e9ecef;border-color:#ced4da;cursor:default;filter:grayscale(.6);opacity:.85}
  .isocard.placed:hover{border-color:#ced4da}
  .isocard.placed .p{color:#495057;font-weight:bold}
  .placedhead{grid-column:1/-1;margin-top:8px;padding:4px 6px;border-top:2px solid #ced4da;color:#495057;font-weight:bold;font-size:13px}
  .isocard.on{border-color:#3b5bdb;box-shadow:0 0 0 2px rgba(59,91,219,.3);background:#f3f6ff}
  .isocard .mini{position:relative;overflow:hidden;margin-bottom:3px}
  .isocard .mini-in{position:absolute;bottom:0;transform-origin:left bottom}
  .isocard .mini-in svg{position:absolute;left:0;top:0}
  .isocard .mini-in img{position:absolute}
  .isogrid{grid-template-columns:repeat(5,minmax(0,1fr))!important}
  .isogrid.test{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))!important}
  .isocard.ok{border-color:#2b8a3e;background:#f4fff5}
  /* панелька вгорі панелі «Офіс» (стіни, підлога) і «Дім» (ділянка, вид, масштаб, покриття, паркани) — центр лишається для речей */
  .isofinwrap{position:fixed;z-index:62;pointer-events:none;display:flex;flex-direction:column;justify-content:flex-end}
  .isofinbox{position:relative;pointer-events:auto;overflow:auto;background:rgba(255,255,255,.95);border:1px solid #ddd;border-radius:6px;padding:3px;font-family:Arial,sans-serif;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,.12)}
  .isofinbox[hidden]{display:none}
  .isofinbox .bar{display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:2px 3px;border-radius:4px}
  .isofinbox .bar+.bar{border-top:1px solid #eee}
  .isofinbox .bar.finish{align-items:flex-start;flex-wrap:nowrap}
  .isofinbox .bar.flash{outline:3px solid #ffd43b;outline-offset:-3px}
  .isofinbox .bar.finish>b{width:46px;flex:none;padding-top:3px;font-size:10px;white-space:normal!important}
  .isofinbox .bar button[data-act]{font-size:11px;padding:2px 7px!important}
  .isofinbox .zb{width:24px;height:22px;border:1px solid #bbb;border-radius:4px;background:#fff;cursor:pointer}
  .isofinbox .swatches{display:flex;flex-wrap:wrap;gap:2px}
  .isofinbox .sw{display:flex;flex-direction:column;align-items:center;width:52px;padding:2px 1px;overflow:hidden;border:1px solid #ccc;border-radius:5px;background:#fff;cursor:pointer;font-size:9px;line-height:1.1;text-align:center;font-family:inherit}
  .isofinbox .sw i{display:block;width:22px!important;height:16px;border-radius:4px;border:1px solid rgba(0,0,0,.2);margin-bottom:2px}
  .isofinbox .sw small{display:block;color:#777}
  .isofinbox .sw.on{border-color:#3b5bdb;box-shadow:0 0 0 2px rgba(59,91,219,.35)}
  .isofinbox .sw span{display:block;width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}font-size:10px;color:#555;padding:2px 4px}
  .isomenu .bar.finish{align-items:flex-start}
  .isomenu .bar.flash{outline:3px solid #ffd43b;outline-offset:-3px}
  .isomenu .swatches{display:flex;flex-wrap:wrap;gap:5px}
  .isomenu .sw{display:flex;align-items:center;gap:5px;padding:3px 6px 3px 3px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;line-height:1.15;text-align:left}
  .isomenu .sw i{display:block;width:26px;height:26px;border-radius:4px;border:1px solid rgba(0,0,0,.2)}
  .isomenu .sw.on{border-color:#3b5bdb;box-shadow:0 0 0 2px rgba(59,91,219,.35)}
  .isotool{position:absolute;z-index:9500;display:flex;gap:3px;align-items:center;padding:3px;background:rgba(33,37,41,.92);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.35);font:12px Arial,sans-serif;color:#fff;white-space:nowrap}
  .isotool button{width:30px;height:30px;border:0;border-radius:6px;background:#fff;color:#222;cursor:pointer;font-size:16px;line-height:1}
  .isotool button:hover{background:#ffe066}
  .isotool button.del{background:#ffe3e3;color:#c92a2a}
  .isotool button.off,.isotool button.off:hover{background:#6c727a;color:#a3a9b0;cursor:default}
  .sides4{display:inline-block;padding:0 3px;border:1px solid #9aa3ad;border-radius:3px;background:#f1f3f5;color:#495057;font-size:10px;line-height:13px;vertical-align:1px}
  .isotool span{padding:0 6px}
  .isomenu .binit{display:inline-flex;align-items:center;gap:4px;border:1px solid #f3c4d6;border-radius:6px;padding:2px 4px;background:#fff;font-size:11px}
  .isomenu .binit img{width:26px;height:26px;object-fit:contain}
  .isomenu .binit button{width:24px;height:24px;border:1px solid #bbb;border-radius:4px;background:#fff;cursor:pointer}
  .isomenu .zb{width:30px;height:28px;border:1px solid #bbb;border-radius:5px;background:#fff;cursor:pointer;font-size:15px}
  .isocard.gone{opacity:.45;border-style:dashed;border-color:#e03131}
  .isocard .tst{display:grid;grid-template-columns:52px auto;gap:5px 6px;align-items:center;justify-content:center;font-size:12px;margin-top:6px}
  .isocard .tst > span:nth-child(odd){text-align:right;color:#555}
  .isocard .tst > span:empty{display:none}
  /* кнопки і число мають фіксовану ширину — нічого не стрибає навіть на «-12» */
  .isocard .tst button{width:32px;height:28px;padding:0;border:1px solid #bbb;border-radius:5px;background:#fff;cursor:pointer;font-size:14px}
  .isocard .tst button:hover{border-color:#3b5bdb;background:#f3f6ff}
  .isocard .tst .v{display:inline-block;width:3.6em;text-align:center;font-weight:bold;font-variant-numeric:tabular-nums}
  .isocard .tst .full{flex-wrap:wrap;gap:5px}
  .isocard .tst .full button{width:auto;height:34px;padding:0 10px;font-size:12px;line-height:1.1;white-space:nowrap}
  .isocard .mini-in img,.isocard .mini-in svg.top{pointer-events:none}
  .isogrid.test .mini-in polygon[data-cell]{cursor:pointer}
  .isogrid.test .mini-in polygon[data-cell]:hover{stroke:#1c3faa;stroke-width:2}
  .isocard .tst .full{grid-column:1/-1;display:flex;gap:4px;justify-content:center}
  .isomenu .testbar{padding:5px 8px;background:#fff3bf;font-size:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .isocard .n{font-size:11px;line-height:1.15;height:26px;overflow:hidden}
  .isocard .p{font-weight:bold;font-size:12px;color:#1c3faa}
  .isocard .c{font-size:10px;color:#888}
  .isomenu .foot .money{line-height:1.45}
  .isomenu .foot .spent{color:#c92a2a}
  .isomenu .foot .spent.plus{color:#2b8a3e}
  .isomenu .foot .spent small{color:#555;font-size:12px}
  .devauth.receipt{width:460px}
  .receipt .sec{font-weight:bold;margin-top:4px;color:#333}
  .receipt .rows{display:flex;flex-direction:column;gap:3px;max-height:260px;overflow:auto;border:1px solid #eee;border-radius:6px;padding:6px 8px;background:#fafafa}
  .receipt .r{display:flex;justify-content:space-between;gap:12px}
  .receipt .r span:last-child{white-space:nowrap;font-weight:bold}
  .receipt .r.plus span:last-child{color:#2b8a3e}
  .receipt .sum{border:2px solid #2b8a3e;border-radius:8px;padding:8px 10px;background:#ebfbee;display:grid;grid-template-columns:auto 1fr;gap:3px 14px;font-size:14px}
  .receipt .sum b{text-align:right}
  .receipt .sum .neg{color:#c92a2a}
  .receipt .sum .pos{color:#2b8a3e}
  .isomenu .foot{border:2px solid #2b8a3e;border-radius:8px;margin:6px 8px;padding:6px 10px;background:#ebfbee;font-size:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
  .isozone-tools{display:flex;flex-direction:column;justify-content:center;gap:4px;height:${TOOLS_H}px;box-sizing:border-box;padding:0 6px;background:#fff9db;border-bottom:1px solid #e9d8a6;font-size:12px;overflow:hidden}
  .isozone-tools .ln{display:flex;gap:5px;align-items:center;flex-wrap:nowrap}
  .isozone-tools:empty{display:none}
  .isozone-tools .ln.tight{gap:3px}
  .isozone-tools .ln.tight button{padding:3px 5px;font-size:11px}
  .isozone-tools b{white-space:nowrap}
  .isozone-tools button{padding:3px 7px;border:1px solid #868e96;border-radius:5px;background:#fff;cursor:pointer;font-size:12px;font-weight:bold;white-space:nowrap}
  .isozone-tools button.on{background:#ffe066;border-color:#f08c00}
  .isozone-tools button.buy{border-color:#f08c00;color:#a84f00}
  .isozone-tools button.sell{border-color:#e03131;color:#c92a2a}
  .isomenu .foot .save{background:#2b8a3e;border-color:#2b8a3e;color:#fff}
  .isomenu .foot .save:disabled{background:#aaa;border-color:#aaa}
  .isomenu .foot [data-act="undo"]:disabled{opacity:.45;cursor:default}
  .isomenu .foot .warn{color:#c92a2a;width:100%}
  .isopreview{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:62;display:flex;flex-direction:column;gap:12px;align-items:center;background:rgba(33,37,41,.92);color:#fff;padding:18px 26px;border-radius:10px;font:15px Arial,sans-serif;text-align:center}
  .isopreview button{padding:10px 18px;border:0;border-radius:6px;background:#FFEE8C;font-weight:bold;font-size:15px;cursor:pointer}
  .isopreview[hidden],.isomenu[hidden],.isodim[hidden]{display:none!important}
  .devauth-back{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center}
  .devauth{background:#fff;border-radius:8px;width:340px;max-width:calc(100% - 30px);box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:Arial,sans-serif;overflow:hidden}
  .devauth h3{margin:0;padding:10px 12px;background:#FFEE8C;border-bottom:1px solid #555;font-size:15px;text-align:center}
  .devauth .body{padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px}
  .devauth label{display:flex;flex-direction:column;gap:3px;color:#444}
  .devauth input{padding:7px;border:1px solid #bbb;border-radius:5px;font-size:14px}
  .devauth input[readonly]{background:#f1f1f1;color:#555}
  .devauth .err{color:#c92a2a;min-height:16px}
  .devauth .note{color:#888;font-size:12px}
  .devauth .row{display:flex;gap:8px;justify-content:flex-end}
  .devauth .row button{padding:7px 14px;border-radius:5px;border:1px solid #bbb;background:#fff;cursor:pointer}
  .devauth .row .ok{background:#3b5bdb;border-color:#3b5bdb;color:#fff;font-weight:bold}
  .devtoast{position:fixed;z-index:10001;white-space:nowrap;background:#2b8a3e;color:#fff;padding:9px 16px;border-radius:6px;font:bold 14px Arial,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25)}
  `;
  document.head.appendChild(css);

  // ---------- допоміжне ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const profilePilotId = () => (location.hash.match(/^#profile\/([^/?#]+)/) || [])[1] || null;
  const profileView = () => document.querySelector('#profileView');
  const profileName = () => {
    const el = document.querySelector('#profileView .profile-title-name')?.cloneNode(true);
    el?.querySelectorAll('.flight-streak-badge').forEach(b => b.remove());
    return el?.textContent.replace(/\s+/g, ' ').trim() || 'Пілот';
  };
  const isMine = () => Boolean(state.auth) && state.auth === profilePilotId();
  const FREE_RESET_IDS = ['dec0de000000000000000001', '6957b3673dc76275ba7e053e'];   // «Містер Кеш» і Kazuar Avia: клік по «✈ Пілот UCAA» = скинути безкоштовну прокрутку (сервер пускає тільки їх)
  // є безкоштовна прокрутка сьогодні (дані /wheel ще могли не завантажитись — тоді ні)
  const freeSpinNow = () => { try { return Boolean(state.auth) && (wheel.data?.limits?.free?.spinsLeft || 0) > 0; } catch { return false; } };
  const pieStrong = () => document.querySelector('#profileView .profile-pies-balance strong');
  function basePies() {
    const s = pieStrong();
    if (!s) return 0;
    // сайт міг перемалювати число (оновлення даних) — тоді в ньому знову «зароблено», а не наш баланс
    if (!s.dataset.devOrig || s.textContent.trim() !== s.dataset.devShown) s.dataset.devOrig = s.textContent.trim();
    return Number(s.dataset.devOrig) || 0;
  }
  // Дві окремі валюти, без курсу: усе коштує $ (із зарплати пілота), а речі з галочкою «за пиріжки» (тест-режим) — 🥧
  const testPilot = () => (LOCAL && window.UCAADevTestPilots || []).find(t => t.id === profilePilotId());   // тестові пілоти — тільки локально
  function baseUsd() {
    if (testPilot()?.testUsd) return testPilot().testUsd;   // тестовий баланс (dev-test-pilots.js)
    const th = [...document.querySelectorAll('#profileView th')].find(t => t.textContent.trim() === 'Зарплата пілота');
    const m = th?.nextElementSibling?.textContent.match(/\$\s*([\d\s ]+)/);
    return m ? Number(m[1].replace(/\D/g, '')) || 0 : 0;
  }
  const fmtUsd = n => '$' + Math.round(n).toLocaleString('uk-UA').replace(/\u00a0/g, ' ');
  const fmtPies = n => `${n} 🥧`;
  const fmtCur = (n, cur) => cur === 'pies' ? fmtPies(n) : fmtUsd(n);
  const money = fmtUsd;                                                // фіксовані ціни: кімната, оздоблення, ділянка, вид, покриття, паркани
  // ціна речі: $, 🥧, $ + 🥧 або безкоштовно (UCAA); half — за скільки продається (півціни в кожній валюті)
  function costText(it, half) {
    if (!it) return '';
    if (it.free) return half ? '0' : '🎁 Профсоюзне $0';
    const f = n => half ? sellPrice(n) : n;
    return [it.cur === 'usd' ? fmtUsd(f(it.cost.usd)) : '', it.cost.pies ? fmtPies(f(it.cost.pies)) : ''].filter(Boolean).join(' + ');
  }
  const balUsd = () => baseUsd() - state.spentUsd;
  const balPies = () => basePies() - state.spent;
  // суми по двох валютах {usd, pies}: показуємо тільки ненульові
  const both = (o, sign = '') => [o.usd ? sign + fmtUsd(o.usd) : '', o.pies ? sign + fmtPies(o.pies) : ''].filter(Boolean).join(' + ') || '0';
  const signedBoth = o => [o.usd > 0 ? fmtUsd(o.usd) : o.usd < 0 ? '+' + fmtUsd(-o.usd) : '', o.pies > 0 ? fmtPies(o.pies) : o.pies < 0 ? '+' + fmtPies(-o.pies) : ''].filter(Boolean).join(' · ') || '0';
  const sellPrice = p => Math.ceil((Number(p) || 0) / 2);   // продаж за 50% з округленням ВГОРУ (1 🥧 → 1 🥧, 15 → 8)
  // «Витрачено»: −$23 000 · −10 🥧 (повернення — з плюсом)
  const spentText = o => [o.usd ? (o.usd > 0 ? '−' : '+') + fmtUsd(Math.abs(o.usd)) : '', o.pies ? (o.pies > 0 ? '−' : '+') + fmtPies(Math.abs(o.pies)) : ''].filter(Boolean).join(' · ') || '0';

  // ---------- «база» рахунків: CABINET-DB/accounts.json (головне джерело; пише dev_saver.py, порт 8001) ----------
  // запис пілота: зарплата за весь час, зароблені пиріжки, витрачено ($ і 🥧) на офіс/дім, залишки, історія покупок, стан офісу й дому
  // Файл пілота CABINET-DB/pilots/<id>.json (схема v1, опис — CABINET-DB/API.md) — так само працюватиме сервер на Railway:
  // GET  /cabinet/<id> → цей документ;  POST /cabinet/<id> → новий документ (сервер перевіряє ціни й баланс сам).
  // З 26.11.2026 — сервер на Railway (код: D:\KAZUAR IN UA website\kazuar-cabinet-api): кабінети + вхід з паролем.
  const API = 'https://kazuar-cabinet-api-production.up.railway.app';
  const TOKEN_KEY = 'kazuarCabToken';
  // запит до сервера → {ok, status, error, data}; status 0 — сервер недоступний
  async function api(path, body) {
    const tok = localStorage.getItem(TOKEN_KEY);
    try {
      const r = await fetch(API + path, {method: body ? 'POST' : 'GET', cache: 'no-store',
        headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: `Bearer ${tok}`} : {})}, body: body ? JSON.stringify(body) : undefined});
      const data = await r.json().catch(() => ({}));
      return {ok: r.ok, status: r.status, data, error: r.ok ? null : (data.error || `Помилка сервера (${r.status})`)};
    } catch (e) {
      return {ok: false, status: 0, data: {}, error: 'Сервер кабінету недоступний — спробуйте за хвилину.'};
    }
  }
  const ACC = {data: {}, pending: {}};   // data[id] = документ пілота або null (нема); pending — запит іде
  // сервер не відповів — даних нема (id не в ACC.data): нічого не показуємо і редагувати не даємо, пробуємо знову раз на хвилину
  function ensureFile(id) {
    if (!id || id in ACC.data || ACC.pending[id]) return;
    ACC.pending[id] = true;
    api(`/cabinet/${encodeURIComponent(id)}`).then(res => {
      delete ACC.pending[id];
      if (res.ok) ACC.data[id] = res.data?.schema === 1 ? res.data : null;
      else if (res.status === 404) ACC.data[id] = null;
      else { console.warn('[cabinet]', res.error); return; }
      if (profilePilotId() === id && !state.editing) { state.loadedFor = undefined; render(); }
    });
  }
  // хтось інший змінив оформлення (або сам пілот з іншого браузера) — відкрита сторінка підхоплює зміни раз на хвилину
  setInterval(() => {
    const id = profilePilotId();
    if (!id || document.hidden || state.editing || ACC.pending[id]) return;
    if (!(id in ACC.data)) { ensureFile(id); return; }   // минулого разу сервер не відповів — ще раз
    api(`/cabinet/${encodeURIComponent(id)}`).then(res => {
      if ((!res.ok && res.status !== 404) || state.editing || profilePilotId() !== id) return;
      const doc = res.ok ? res.data : null;
      const cur = ACC.data[id];
      if ((doc?.updated || null) === (cur?.updated || null)) return;   // нічого не змінилось
      ACC.data[id] = doc && doc.schema === 1 ? doc : null;
      state.loadedFor = undefined; render();
    });
  }, 60e3);
  // документ ⇄ внутрішній стан кабінету
  const fromDoc = d => ({owned: {office: d.office.items || [], home: d.home.items || [], stock: d.stock || []},
    spent: d.money.spentPies || 0, spentUsd: d.money.spentUsd || 0, officeSize: d.office.size, officeFinish: d.office.finish,
    homeCovers: d.home.covers || {}, homeFences: d.home.fences || {}, homePlot: d.home.plot, homeView: d.home.view, lib: d.library, homeGrid: 2, homeZoom: HOME_ZOOM, topUp: d.topUp});
  function saveObj() {
    return {owned: state.owned, spent: state.spent, spentUsd: state.spentUsd, officeSize: state.size.owned, officeFinish: state.finish.owned, homeZoom: state.zoom.owned,
      homeCovers: state.cover.owned, homeGrid: 2, homePlot: state.plot.owned, homeView: state.view.owned, homeFences: state.fence.owned, lib: state.lib.owned, topUp: testPilot()?.topUp, savedAt: new Date().toISOString()};
  }
  function toDoc(id, prev, note) {
    const now = new Date().toISOString();
    return {schema: 1, pilotId: id, name: profileName(), updated: now, topUp: testPilot()?.topUp,
      money: {salaryUsd: baseUsd(), piesEarned: basePies(), spentUsd: state.spentUsd, spentPies: state.spent, balanceUsd: balUsd(), balancePies: balPies()},
      office: {size: state.size.owned, finish: {...state.finish.owned}, items: clone(state.owned.office)},
      home: {plot: {...state.plot.owned}, view: state.view.owned, covers: {...state.cover.owned}, fences: {...state.fence.owned}, items: clone(state.owned.home)},
      stock: clone(state.owned.stock), library: clone(state.lib.owned),
      history: [...(prev?.history || []), ...(note ? [{t: now, ...note}] : [])].slice(-300)};
  }
  // запис на сервер (тільки свій кабінет, з токеном входу) → {ok, error}
  async function pushAccount(id, note) {
    if (!id || id !== state.auth || !localStorage.getItem(TOKEN_KEY)) return {ok: false, error: 'Потрібно увійти.'};
    const prev = ACC.data[id];
    const doc = toDoc(id, prev, note);
    const res = await api(`/cabinet/${encodeURIComponent(id)}`, {doc, baseUpdated: prev?.updated || null});
    if (!res.ok) {
      if (res.status === 401) { logout(); return {ok: false, error: 'Вхід застарів — увійдіть знову.'}; }
      return {ok: false, error: res.error};
    }
    doc.updated = res.data.updated;
    ACC.data[id] = doc;
    return {ok: true};
  }
  function loadSaved() {
    const id = profilePilotId();
    if (state.loadedFor === id) return;
    state.loadedFor = id;
    // файл пілота — єдине джерело того, що бачать інші. Старе збереження в браузері (localStorage) — тільки для себе
    // (увійшли й це ваш профіль, а файлу ще нема): воно запишеться у файл при «Зберегти».
    ensureFile(id);
    const local = id && isMine() && ACC.data[id] === null ? JSON.parse(localStorage.getItem(SAVE_KEY(id)) || 'null') : null;
    const saved = (id && ACC.data[id] ? fromDoc(ACC.data[id]) : null) || local;
    state.owned = saved?.owned || {office: [], home: []};
    state.owned.stock = state.owned.stock || [];   // «🎒 Куплене»: придбані речі, які зараз не стоять ні в офісі, ні вдома [{uid, id}]
    state.spent = saved?.spent || 0;
    state.spentUsd = saved?.spentUsd || 0;
    // тестове поповнення: один раз обнуляємо витрачене (речі лишаються) — номер у dev-test-pilots.js (topUp)
    const tp = testPilot();
    if (saved && tp?.topUp && saved.topUp !== tp.topUp) {
      state.spent = 0; state.spentUsd = 0;
      Object.assign(saved, {spent: 0, spentUsd: 0, topUp: tp.topUp});
      localStorage.setItem(SAVE_KEY(id), JSON.stringify(saved));
      if (id in ACC.data) setTimeout(() => { if (profilePilotId() === id && isMine()) pushAccount(id, {zone: '-', usd: 0, pies: 0, what: 'тестове поповнення (витрачене обнулено)'}); }, 1500);
    }
    const room = Math.max(ROOM_BASE, saved?.officeSize || 0);   // старі збереження 7 / 8 → щонайменше базові 9
    state.size = {owned: room, draft: room};
    const fin = saved?.officeFinish || {wall: 'w-soviet', floor: 'f-linoleum'};   // старт — совкова «по плече»
    state.finish = {owned: {...fin}, draft: {...fin}};
    state.zoom = {owned: HOME_ZOOM, draft: HOME_ZOOM};   // масштаб ділянки зафіксовано (старе homeZoom ігноруємо)
    state.cover = {owned: {...(saved?.homeCovers || {})}, draft: {...(saved?.homeCovers || {})}};
    state.fence = {owned: {...(saved?.homeFences || {})}, draft: {...(saved?.homeFences || {})}};
    let plot = saved?.homePlot || PLOT_BASE;
    if (plot.n > PLOT_MAX) { const d = PLOT_MAX - PLOT_BASE.n; plot = {x0: PLOT_BASE.x0 - d, y0: PLOT_BASE.y0 - d, n: PLOT_MAX}; }   // старі збереження з більшою ділянкою
    state.plot = {owned: {...plot}, draft: {...plot}};
    state.view = {owned: saved?.homeView || 'sky', draft: saved?.homeView || 'sky'};
    // «бібліотека» придбаного: стіни, підлоги, види — назавжди ваші (повертатись безкоштовно);
    // паркани й покриття, прибрані з поля, — на складі (ставляться знову без оплати). Продаж — тільки вручну.
    const lib0 = saved?.lib || {};
    const libO = {wall: [...new Set([...(lib0.wall || []), state.finish.owned.wall])], floor: [...new Set([...(lib0.floor || []), state.finish.owned.floor])],
      view: [...new Set([...(lib0.view || []), state.view.owned])], fence: {...(lib0.fence || {})}, cover: {...(lib0.cover || {})}};
    state.lib = {owned: libO, draft: libDraft(libO)};
    state.bin = [];
    // збереження зі старим полем 8×8 — переносимо речі в центр великого поля
    if (saved && saved.homeGrid !== 2) (state.owned.home || []).forEach(p => { if (!p.wall) { p.i += HOME_SHIFT; p.j += HOME_SHIFT; } });
    state.draft = clone(state.owned);
    state.editing = null;
  }
  // є що показати іншим (до входу): запис у файл-базі або старе збереження в браузері
  const hasSaved = () => { const id = profilePilotId(); return Boolean(id && ACC.data[id]); };   // тільки файл пілота (однаково для всіх)

  // ---------- геометрія ----------
  const sceneSize = cfg => ({w: (cfg.W + cfg.D) * TW / 2, h: cfg.topPad + (cfg.W + cfg.D) * TH / 2});
  const tileTop = (cfg, i, j) => ({x: cfg.D * TW / 2 + (i - j) * TW / 2, y: cfg.topPad + (i + j) * TH / 2});
  const dims = (item, flip) => flip ? [item.fd, item.fw] : [item.fw, item.fd];
  // клітинки, які річ реально займає (прямокутник fw×fd мінус вирізані); у дзеркалі осі міняються місцями
  const cellsOf = (item, flip) => {
    const holes = new Set(item.holes || []), out = [];
    for (let a = 0; a < item.fw; a++) for (let b = 0; b < item.fd; b++)
      if (!holes.has(`${a},${b}`)) out.push(flip ? [b, a] : [a, b]);
    return out;
  };

  function occupied(zone, list, exceptUid) {
    const cfg = cfgOf(zone);
    const floor = new Set(), wallL = new Set(), wallR = new Set();
    list.forEach(p => {
      if (p.uid === exceptUid) return;
      const item = byId.get(p.id);
      if (!item || item.flat) return;   // на килим можна ставити інші речі
      if (p.wall) {
        for (let n = 0; n < item.fw; n++) (p.wall === 'L' ? wallL : wallR).add(p.k + n);
      } else {
        cellsOf(item, p.flip).forEach(([a, b]) => floor.add(`${p.i + a},${p.j + b}`));
      }
    });
    return {floor, wallL, wallR, cfg};
  }

  function fits(zone, item, pos, flip, exceptUid) {
    const occ = occupied(zone, state.draft[zone], exceptUid);
    const cfg = occ.cfg;
    if (item.place === 'wall') {
      if (!cfg.walls || !pos.wall) return false;
      const len = pos.wall === 'L' ? cfg.D : cfg.W;
      if (pos.k < 0 || pos.k + item.fw > len) return false;
      for (let n = 0; n < item.fw; n++) if ((pos.wall === 'L' ? occ.wallL : occ.wallR).has(pos.k + n)) return false;
      return true;
    }
    if (pos.wall) return false;
    const [fw, fd] = dims(item, flip);
    if (pos.i < 0 || pos.j < 0 || pos.i + fw > cfg.W || pos.j + fd > cfg.D) return false;
    // дім: тільки в межах ділянки і не на клітинках з парканом
    if (cfg.big) { const pl = plotOf(); if (cellsOf(item, flip).some(([a, b]) => !inPlot(pl, pos.i + a, pos.j + b))) return false; }   // паркан між клітинками нічого не блокує
    // дім: усі клітинки речі мають бути видно в панелі (не можна «всадити» шматок будинку за край)
    if (cfg.big) { const v = homeView(zone); if (cellsOf(item, flip).some(([a, b]) => !cellInPanel(zone, v, pos.i + a, pos.j + b))) return false; }
    if (item.flat) {   // килими не накладаються один на один, але під меблі — можна
      const rugs = state.draft[zone].filter(p => p.uid !== exceptUid && byId.get(p.id)?.flat && !p.wall);
      return !rugs.some(p => { const [w2, d2] = dims(byId.get(p.id), p.flip);
        return pos.i < p.i + w2 && p.i < pos.i + fw && pos.j < p.j + d2 && p.j < pos.j + fd; });
    }
    return !cellsOf(item, flip).some(([a, b]) => occ.floor.has(`${pos.i + a},${pos.j + b}`));
  }

  // Де малювати картинку: низ по центру = передній кут площі (для стіни — центр відрізка стіни)
  // на ділянці «Дім» люди вдвічі менші, в офісі — на 20% менші (тварини не чіпаємо)
  const HOME_PEOPLE_SCALE = 0.5, OFFICE_PEOPLE_SCALE = 0.8;
  const isPerson = item => /^person-/.test(item.id);
  function viewItem(zone, item) {
    if (!isPerson(item)) return item;
    const k = zone === 'home' ? HOME_PEOPLE_SCALE : OFFICE_PEOPLE_SCALE;
    return {...item, dw: item.dw * k, dh: item.dh * k, ax: item.ax * k, ay: item.ay * k};
  }
  function spritePos(zone, item, p) {
    const v = viewItem(zone, item);
    return {...spriteAt(cfgOf(zone), v, p), w: v.dw, h: v.dh};
  }
  function spriteAt(cfg, item, p) {
    if (p.wall) {
      const a = p.wall === 'L' ? tileTop(cfg, 0, p.k) : tileTop(cfg, p.k, 0);
      const b = p.wall === 'L' ? tileTop(cfg, 0, p.k + item.fw) : tileTop(cfg, p.k + item.fw, 0);
      const lift = item.door ? 0 : 22;
      const flipW = (p.wall === 'R') !== Boolean(p.flip);
      // центр відрізка стіни = точка (ax, ay) на картинці; зсув у тест-режимі рухає річ по стіні і вгору/вниз
      // є окрема картинка для правої стіни (нові моделі з нахилом) — беремо її і НЕ дзеркалимо (текст не перевертається)
      const useR = flipW && Boolean(item.srcR);
      return {x: (a.x + b.x) / 2 - (flipW ? item.dw - item.ax : item.ax), y: (a.y + b.y) / 2 - item.ay - lift, z: 1 + p.k, flip: flipW && !useR, src: useR ? item.srcR : null};
    }
    const [fw, fd] = dims(item, p.flip);
    // передній кут площі = передній кут на картинці (ax, ay з каталогу); у дзеркалі кут теж дзеркалиться
    const f = tileTop(cfg, p.i + fw, p.j + fd);
    const ax = item.ax ?? item.dw / 2, ay = item.ay ?? item.dh;
    const z = item.flat ? 50 + p.i + p.j : 100 + (p.i + fw + p.j + fd) * 20 + p.i;
    // нова модель «на підлогу» з другою картинкою: після ↔ — вона, без дзеркала
    const useR = Boolean(p.flip) && Boolean(item.srcR);
    return {x: f.x - (p.flip ? item.dw - ax : ax), y: f.y - ay - (item.stand ? STAND_H : 0), z, flip: Boolean(p.flip) && !useR, src: useR ? item.srcR : null};
  }
  // Глибина з урахуванням вирізаних клітинок: річ B малюється перед A, якщо якась клітинка B стоїть
  // попереду (i і j не менші) якоїсь клітинки A, а навпаки — ні. Інакше лишається звичайна глибина.
  // Так людина у вирізі перед маєтком не ховається за ним. Повертає Map uid → z (тільки підняті).
  function depthFix(zone, list) {
    const nodes = [];
    list.forEach(p => {
      const item = byId.get(p.id);
      if (!item || p.wall || item.flat) return;
      const cells = cellsOf(item, p.flip).map(([a, b]) => [p.i + a, p.j + b]);
      if (!cells.length) return;
      const i0 = Math.min(...cells.map(c => c[0])), i1 = Math.max(...cells.map(c => c[0]));
      // minJ[k] = найменше j серед клітинок з i ≤ i0+k
      const minJ = [];
      for (let k = 0; k <= i1 - i0; k++) {
        const m = Math.min(Infinity, ...cells.filter(c => c[0] === i0 + k).map(c => c[1]));
        minJ.push(Math.min(m, k ? minJ[k - 1] : Infinity));
      }
      nodes.push({uid: p.uid, cells, i0, i1, minJ, z: spritePos(zone, item, p).z, out: [], deg: 0});
    });
    // чи є клітинка B попереду якоїсь клітинки A
    const ahead = (A, B) => B.cells.some(([i, j]) => i >= A.i0 && A.minJ[Math.min(i, A.i1) - A.i0] <= j);
    for (let x = 0; x < nodes.length; x++) for (let y = x + 1; y < nodes.length; y++) {
      const A = nodes[x], B = nodes[y];
      const ab = ahead(A, B), ba = ahead(B, A);
      if (ab && !ba) { A.out.push(B); B.deg++; }
      else if (ba && !ab) { B.out.push(A); A.deg++; }
    }
    // топологічний порядок; z тільки піднімаємо, щоб бути над усім, що позаду
    const fix = new Map(), queue = nodes.filter(n => !n.deg);
    while (queue.length) {
      queue.sort((a, b) => a.z - b.z);
      const n = queue.shift();
      for (const m of n.out) {
        if (m.z <= n.z) { m.z = n.z + 1; fix.set(m.uid, m.z); }
        if (!--m.deg) queue.push(m);
      }
    }
    return fix;
  }
  // проста підставка-тумбочка під річчю (на всю її площу; для чайника тощо — одна клітинка)
  const STAND_H = 30, STAND_K = 0.75;
  function standHtml(cfg, item, p, z, cls = '') {
    if (!item.stand || p.wall) return '';
    const [fw, fd] = dims(item, p.flip);
    // площа тумбочки — 75% клітинок речі, по центру (висота та сама)
    const C = tileTop(cfg, p.i + fw / 2, p.j + fd / 2);
    const sh = q => ({x: C.x + (q.x - C.x) * STAND_K, y: C.y + (q.y - C.y) * STAND_K});
    const B = sh(tileTop(cfg, p.i, p.j)), R = sh(tileTop(cfg, p.i + fw, p.j)), F = sh(tileTop(cfg, p.i + fw, p.j + fd)), L = sh(tileTop(cfg, p.i, p.j + fd));
    const x0 = L.x, y0 = B.y - STAND_H, h = STAND_H;
    const q = pts => pts.map(([x, y]) => `${x - x0},${y - y0}`).join(' ');
    const mid = (a, b, t) => [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
    const [lx1, ly1] = mid(L, F, 0.2), [lx2, ly2] = mid(L, F, 0.8);
    return `<svg class="stand${cls}" width="${R.x - L.x}" height="${F.y - B.y + h}" style="position:absolute;left:${x0}px;top:${y0}px;z-index:${z};pointer-events:none;overflow:visible">
      <polygon points="${q([[L.x, L.y - h], [F.x, F.y - h], [F.x, F.y], [L.x, L.y]])}" fill="#a47c55" stroke="#6e4f33" stroke-width="1"/>
      <polygon points="${q([[F.x, F.y - h], [R.x, R.y - h], [R.x, R.y], [F.x, F.y]])}" fill="#8a6542" stroke="#6e4f33" stroke-width="1"/>
      <polygon points="${q([[B.x, B.y - h], [R.x, R.y - h], [F.x, F.y - h], [L.x, L.y - h]])}" fill="#c9a47c" stroke="#6e4f33" stroke-width="1"/>
      <polygon points="${q([[lx1, ly1 - h + 7], [lx2, ly2 - h + 7], [lx2, ly2 - h + 16], [lx1, ly1 - h + 16]])}" fill="none" stroke="#6e4f33" stroke-width="1"/>
      <circle cx="${(lx1 + lx2) / 2 - x0}" cy="${(ly1 + ly2) / 2 - h + 11.5 - y0}" r="1.6" fill="#4a3522"/></svg>`;
  }

  // Міні-підлога для картки в меню: клітинки навколо, зелені — ті, що річ займає
  // trim (тест-режим): порожнє місце над картинкою — вдвічі менше
  const miniH = (boxH, contentH, trim) => trim ? Math.round(contentH + (boxH - contentH) / 2) : boxH;
  function miniHtml(item, boxW, boxH, trim) {
    if (item.place === 'wall') {
      const n = item.fw;
      const cfg = {W: 1, D: n + 2, topPad: item.dh + 30};
      const size = sceneSize(cfg);
      const k = Math.min(1, boxW / size.w, boxH / size.h);
      const t = (i, j) => tileTop(cfg, i, j);
      let svg = `<polygon points="${t(0, 0).x},${t(0, 0).y} ${t(0, n + 2).x},${t(0, n + 2).y} ${t(0, n + 2).x},${t(0, n + 2).y - 128} ${t(0, 0).x},${t(0, 0).y - 128}" fill="${trim ? '#495057' : '#efe9df'}"/>`;
      const a = t(0, 1), b = t(0, n + 1);
      svg += `<polygon points="${a.x},${a.y} ${b.x},${b.y} ${b.x},${b.y - 128} ${a.x},${a.y - 128}" fill="rgba(64,192,87,.35)" stroke="#2b8a3e"/>`;
      const s = spriteAt(cfg, item, {wall: 'L', k: 1});
      return `<div class="mini" style="height:${miniH(boxH, size.h * k, trim)}px"><div class="mini-in" style="width:${size.w}px;height:${size.h}px;transform:scale(${k});left:${(boxW - size.w * k) / 2}px">
        <svg width="${size.w}" height="${size.h}">${svg}</svg>
        <img src="${item.src}" alt="" loading="lazy" style="left:${s.x}px;top:${s.y}px;width:${item.dw}px;height:${item.dh}px"></div></div>`;
    }
    const cfg = {W: item.fw + 2, D: item.fd + 2, topPad: item.dh + 4 + (item.stand ? STAND_H : 0)};
    const size = sceneSize(cfg);
    const k = Math.min(1.2, boxW / size.w, boxH / size.h);
    const pt = (i, j) => { const v = tileTop(cfg, i, j); return `${v.x},${v.y}`; };
    let svg = '';
    const holes = new Set(item.holes || []);
    for (let i = 0; i < cfg.W; i++) for (let j = 0; j < cfg.D; j++) {
      const inRect = i >= 1 && i <= item.fw && j >= 1 && j <= item.fd;
      const key = `${i - 1},${j - 1}`;
      const on = inRect && !holes.has(key);
      const hole = inRect && holes.has(key);
      // у межах fw×fd клітинку можна клацнути: зелена ↔ вирізана
      svg += `<polygon ${inRect ? `data-cell="${key}"` : ''} points="${pt(i, j)} ${pt(i + 1, j)} ${pt(i + 1, j + 1)} ${pt(i, j + 1)}"
        fill="${on ? 'rgba(64,192,87,.55)' : hole ? 'rgba(255,135,135,.25)' : trim ? '#495057' : '#e9ecef'}" stroke="${on ? '#2b8a3e' : hole ? '#e03131' : trim ? '#5c636a' : '#ced4da'}"
        stroke-width="1" ${hole ? 'stroke-dasharray="4 3"' : ''}/>`;
    }
    const s = spriteAt(cfg, item, {i: 1, j: 1, flip: false});
    const f = tileTop(cfg, 1 + item.fw, 1 + item.fd);
    const top = Math.max(0, Math.min(s.y, cfg.topPad));   // де починається намальоване (картинка або підлога)
    return `<div class="mini" style="height:${miniH(boxH, (size.h - top) * k, trim)}px"><div class="mini-in" style="width:${size.w}px;height:${size.h}px;transform:scale(${k});left:${(boxW - size.w * k) / 2}px">
      <svg width="${size.w}" height="${size.h}">${svg}</svg>
      ${standHtml(cfg, item, {i: 1, j: 1, flip: false}, 1)}<img src="${item.src}" alt="" loading="lazy" style="left:${s.x}px;top:${s.y}px;width:${item.dw}px;height:${item.dh}px;z-index:1">
      <svg class="top" width="${size.w}" height="${size.h}" style="z-index:2"><circle cx="${f.x}" cy="${f.y}" r="3" fill="#e03131"/></svg></div></div>`;
  }

  // ---------- DOM ----------
  const zones = {}, finboxes = {};
  ZONES.forEach(zone => {
    const outer = document.createElement('aside');
    outer.className = 'isozone';
    outer.innerHTML = `<div class="isozone-inner"><div class="isozone-title"></div><div class="isozone-tools"></div><div class="isozone-stage"><div class="isoback"></div><div class="isoscene"></div></div></div>`;
    document.body.appendChild(outer);
    zones[zone] = outer;
    // панелька оздоблення / ділянки — окремо, над боковою панеллю (не поверх сцени)
    const wrap = Object.assign(document.createElement('div'), {className: 'isofinwrap'});
    wrap.innerHTML = '<div class="isofinbox" hidden></div>';
    document.body.appendChild(wrap);
    finboxes[zone] = wrap.firstChild;
  });
  const dim = Object.assign(document.createElement('div'), {className: 'isodim', hidden: true});
  const menu = Object.assign(document.createElement('div'), {className: 'isomenu', hidden: true});
  const previewBar = Object.assign(document.createElement('div'), {className: 'isopreview', hidden: true});
  previewBar.innerHTML = '<span>👁 Попередній перегляд — так ваш кабінет побачать інші</span><button type="button">Повернутись до редагування</button>';
  previewBar.querySelector('button').onclick = () => { state.preview = false; render(); };
  document.body.append(dim, menu, previewBar);

  // Перегляд офісу і дому (не редагування): при наведенні на річ — назва і ціна біля мишки.
  // Річ під курсором шукаємо за непрозорими пікселями картинки (прозорі краї не рахуються), зверху — та, що ближче.
  const hoverTip = Object.assign(document.createElement('div'), {className: 'isohovertip', hidden: true});
  document.body.appendChild(hoverTip);
  const alphaCache = new Map();   // src → {w, h, data} або null, поки вантажиться
  function alphaOf(img) {
    if (alphaCache.has(img.src)) return alphaCache.get(img.src);
    if (!img.complete || !img.naturalWidth) return null;
    try {
      const c = Object.assign(document.createElement('canvas'), {width: img.naturalWidth, height: img.naturalHeight});
      const g = c.getContext('2d', {willReadFrequently: true});
      g.drawImage(img, 0, 0);
      const a = {w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data};
      alphaCache.set(img.src, a);
      return a;
    } catch (e) { alphaCache.set(img.src, null); return null; }
  }
  function itemAtPoint(stage, x, y) {
    const imgs = [...stage.querySelectorAll('.isoscene img.it[data-uid]')].sort((a, b) => (Number(b.style.zIndex) || 0) - (Number(a.style.zIndex) || 0));
    for (const img of imgs) {
      const r = img.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const a = alphaOf(img);
      if (!a) return img;   // ще не прочитали пікселі — беремо рамку
      let fx = (x - r.left) / r.width;
      if (img.classList.contains('flip')) fx = 1 - fx;
      const px = Math.min(a.w - 1, Math.floor(fx * a.w)), py = Math.min(a.h - 1, Math.floor((y - r.top) / r.height * a.h));
      if (a.data[(py * a.w + px) * 4 + 3] > 40) return img;
    }
    return null;
  }
  ZONES.forEach(zone => {
  const stage = zones[zone].querySelector('.isozone-stage');
  stage.addEventListener('mousemove', e => {
    if (state.editing && !state.preview) { hoverTip.hidden = true; return; }
    const img = itemAtPoint(stage, e.clientX, e.clientY);
    const p = img && (state.editing === zone ? state.draft : state.owned)[zone].find(q => q.uid === img.dataset.uid);   // у перегляді «👁» — чернетка
    const item = p && byId.get(p.id);
    if (!item) { hoverTip.hidden = true; return; }
    hoverTip.innerHTML = `<b>${esc(item.name)}</b><br>${costText(item)}${wonUids().has(p.uid) ? '<br>🎡 Виграш у колесі удачі' : ''}`;
    hoverTip.hidden = false;
    const tw = hoverTip.offsetWidth, th = hoverTip.offsetHeight;
    hoverTip.style.left = `${Math.min(innerWidth - tw - 4, e.clientX + 14)}px`;
    hoverTip.style.top = `${Math.max(4, e.clientY - th - 10)}px`;
  });
  stage.addEventListener('mouseleave', () => { hoverTip.hidden = true; });
  });
  addEventListener('wheel', e => {
    if (!state.editing) return;
    e.preventDefault();
    const grid = menu.querySelector('.isogrid');
    if (grid && menu.contains(e.target)) grid.scrollTop += e.deltaY || e.deltaX;
  }, {passive: false});
  addEventListener('keydown', e => {
    if (!state.editing || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') { state.placing = null; cancelMove(); state.selected = null; render(); }
    if ([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) e.preventDefault();
  });

  const infoTitle = () => [...(profileView()?.querySelectorAll('.profile-section-title') || [])].find(el => /загальна інформація/i.test(el.textContent));
  function ensureOpenButton() {
    const title = infoTitle();
    if (!title || !profilePilotId()) return;
    let btn = title.querySelector('.devcab-open');
    if (!btn) {
      btn = Object.assign(document.createElement('button'), {type: 'button', className: 'devcab-open'});
      btn.onclick = () => (isMine() ? logout() : login());
      title.appendChild(btn);
    }
    btn.textContent = !isMine() ? '(увійти)' : state.changedThisSession ? '(зміни внесено, вийти)' : '(вийти)';
    btn.hidden = Boolean(state.auth) && !isMine();   // увійшли — на чужих профілях нічого (ні «увійти», ні «вийти»); «(вийти)» тільки на своєму
    const s = pieStrong();
    if (s) { const v = String(balPies()); s.textContent = v; s.dataset.devShown = v; }
    moneyRow();
  }
  // Рядок у «Загальна інформація про пілота»: баланс пиріжків · на рахунку у банку · витрачено на Офіс/Дім (станом на зараз)
  function moneyRow() {
    const th = [...document.querySelectorAll('#profileView th')].find(t => t.textContent.trim() === 'Зарплата пілота');
    const tbody = th?.closest('table')?.tBodies[0] || th?.closest('tbody');
    if (!tbody) return;
    let tr = tbody.querySelector('tr.devcab-money');
    if (!tr) { tr = document.createElement('tr'); tr.className = 'devcab-money'; tbody.appendChild(tr); }
    const thCls = th.className, tdCls = th.nextElementSibling?.className || '';
    const html = `<th class="${thCls}">Баланс пиріжків</th><td class="${tdCls}" data-pies-balance-cell role="button" tabindex="0" aria-label="Відкрити Logbook пиріжків"><b>${balPies()}</b> 🥧</td>`
      + `<th class="${thCls}">Витрачено на Офіс/Дім</th><td class="${tdCls}">${fmtUsd(state.spentUsd || 0)} | ${state.spent || 0} 🥧</td>`
      + `<th class="${thCls}">Залишок на рахунку</th><td class="${tdCls}"><b>${fmtUsd(balUsd())}</b></td>`;
    if (tr.dataset.h !== html) { tr.dataset.h = html; tr.innerHTML = html; pieify(tr); }
    const piesCell = tr.querySelector('[data-pies-balance-cell]');
    if (piesCell) {
      piesCell.onclick = () => document.querySelector('#profileView .profile-pies-balance')?.click();
      piesCell.onkeydown = event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        piesCell.click();
      };
    }
    if (tr !== tbody.lastElementChild) tbody.appendChild(tr);   // завжди останнім рядком таблиці
    syncMoney();
  }
  // Файл пілота завжди з актуальною зарплатою й пиріжками: новий політ → зарплата/пиріжки змінились → оновлюємо файл (з записом в історії)
  const moneySyncAt = {};
  function syncMoney() {
    const id = profilePilotId(), doc = id && ACC.data[id];
    if (!doc || !isMine() || state.editing || state.loadedFor !== id || !pieStrong() || !baseUsd()) return;   // переписати може тільки сам пілот
    const m = doc.money || {}, sal = baseUsd(), pies = basePies();
    if (m.salaryUsd === sal && m.piesEarned === pies) return;
    if (Date.now() - (moneySyncAt[id] || 0) < 20000) return;
    moneySyncAt[id] = Date.now();
    pushAccount(id, {zone: '-', usd: 0, pies: 0, what: `оновлено з польотів: зарплата ${fmtUsd(m.salaryUsd || 0)} → ${fmtUsd(sal)}, пиріжки ${m.piesEarned || 0} → ${pies}`});
  }
  // Свіжі польоти: раз на 5 хв (вкладка відкрита, не редагуємо) — та сама кнопка 🔄, що на сайті (перечитує тижневі файли й журнал пиріжків)
  let lastFlightsRefresh = Date.now();
  setInterval(() => {
    if (document.hidden || state.editing || Date.now() - lastFlightsRefresh < 5 * 60e3) return;
    const b = document.querySelector('#manualRefreshButton');
    if (b && !b.disabled) { lastFlightsRefresh = Date.now(); b.click(); }
  }, 30e3);
  // 🥧 → картинка пиріжка (як під аватаркою) у всьому інтерфейсі кабінету
  const PIE_IMG = 'assets/icons/pyrih.png';
  // 🎡 → кольорове колесо з 5 секторами (замість тьмяного емодзі)
  const WHEEL_ICON = (() => {
    const cols = ['#ffd43b', '#4dabf7', '#ff6b6b', '#51cf66', '#9775fa'];
    const pt = a => [16 + 14 * Math.sin(a * Math.PI / 180), 16 - 14 * Math.cos(a * Math.PI / 180)].map(v => v.toFixed(2)).join(' ');
    const sec = cols.map((c, n) => `<path d="M16 16L${pt(n * 72)}A14 14 0 0 1 ${pt(n * 72 + 72)}Z" fill="${c}" stroke="#fff" stroke-width="1"/>`).join('');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#fff" stroke="#444" stroke-width="2"/>${sec}<circle cx="16" cy="16" r="3.2" fill="#fff" stroke="#444" stroke-width="1.5"/></svg>`);
  })();
  const ICONS = {'🥧': [PIE_IMG, 'pieic'], '🎡': [WHEEL_ICON, 'pieic wheelic']};
  function pieify(root) {
    if (!root || !root.ownerDocument) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {acceptNode: nd => /🥧|🎡/.test(nd.nodeValue) && !nd.parentElement?.closest('input,textarea,select,option,svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT});
    const list = []; while (w.nextNode()) list.push(w.currentNode);
    list.forEach(t => {
      const frag = document.createDocumentFragment();
      t.nodeValue.split(/(🥧|🎡)/).forEach(part => {
        if (ICONS[part]) { const im = document.createElement('img'); [im.src, im.className] = ICONS[part]; im.alt = part; frag.appendChild(im); }
        else if (part) frag.appendChild(document.createTextNode(part));
      });
      t.replaceWith(frag);
    });
  }
  const PIE_SCOPE = '.isomenu,.isofinwrap,.isozone,.devauth-back,.devtoast,.isohovertip,tr.devcab-money';
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(nd => {
    const el = nd.nodeType === 1 ? nd : nd.parentElement;
    if (el && (el.matches?.(PIE_SCOPE) || el.closest?.(PIE_SCOPE))) pieify(el);
  }))).observe(document.body, {childList: true, subtree: true, characterData: false});

  // ---------- розкладка ----------
  function layout() {
    const pv = profileView();
    const info = infoTitle();
    const visible = Boolean(profilePilotId() && pv && info && CATALOG.length && (isMine() || hasSaved()));
    const zoom = browserZoom();
    const center = pv?.getBoundingClientRect();
    let fit = 0;
    if (visible) fit = Math.min(1, Math.min(center.left - 2 * GAP, document.documentElement.clientWidth - center.right - 2 * GAP) * zoom / ZONE_W);
    const show = visible && fit >= 0.55;
    const s = fit / zoom;
    const widthCss = ZONE_W * s;
    const infoTopDoc = show ? info.getBoundingClientRect().top + scrollY : 0;
    const maxStage = (innerHeight - 2 * GAP) / (s || 1) - (TITLE_H + 14);
    const stageH = Math.round(Math.max(300, Math.min(maxStage, (innerHeight - GAP - 7 * s - infoTopDoc) / (s || 1))));
    ZONES.forEach(zone => {
      const outer = zones[zone];
      outer.classList.toggle('show', show);
      const wrap = finboxes[zone].parentElement;
      wrap.style.display = show ? '' : 'none';
      if (!show) return;
      outer.querySelector('.isozone-inner').style.zoom = String(s);
      // під час редагування над сценою — смужка інструментів, сцена на стільки ж нижча (панель не росте)
      const toolsOn = state.editing === zone && !state.preview;
      outer.querySelector('.isozone-stage').style.height = `${stageH - (toolsOn ? TOOLS_H : 0)}px`;
      // масштаб — за базовим розміром кімнати; більша кімната не зменшується, а виходить за краї (по центру)
      const scene = outer.querySelector('.isoscene');
      if (ZONE_CFG[zone].big) {
        const v = homeView(zone);
        Object.assign(scene.style, {transformOrigin: '0 0', transform: `scale(${v.k})`, left: `${v.left}px`, top: `${v.top}px`, bottom: 'auto'});
        if (state.lastHomeView !== JSON.stringify(v)) { state.lastHomeView = JSON.stringify(v); renderScene(zone); }
      } else {
        const base = sceneSize(ZONE_CFG[zone]);
        const size = sceneSize(cfgOf(zone));
        const k = STAGE_W / base.w;
        scene.style.transform = `scale(${k})`;
        scene.style.left = `${(STAGE_W - size.w * k) / 2}px`;
      }
      outer.style.bottom = `${GAP}px`;
      outer.style.width = `${widthCss}px`;
      outer.style.left = `${zone === 'office' ? center.left - GAP - widthCss : center.right + GAP}px`;
      // панелька над панеллю: від верху вікна до заголовка панелі, притиснута донизу
      const top = outer.getBoundingClientRect().top;
      Object.assign(wrap.style, {left: outer.style.left, width: `${widthCss}px`, top: `${GAP}px`, height: `${Math.max(0, top - 2 * GAP)}px`});
      finboxes[zone].style.zoom = String(s);
      finboxes[zone].style.maxHeight = `${Math.max(0, top - 2 * GAP) / (s || 1)}px`;
    });
    if (state.editing && show) {
      // меню займає всю середню частину між панелями, на всю висоту вікна
      const left = zones.office.getBoundingClientRect().right + GAP;
      const right = zones.home.getBoundingClientRect().left - GAP;
      Object.assign(menu.style, {top: `${GAP}px`, height: `${innerHeight - 2 * GAP}px`, width: `${right - left}px`, left: `${left}px`});
    }
    // панелі тимчасово не влазять (вузьке вікно / сайт перемальовує профіль) — НЕ виходимо з редагування, просто ховаємо меню
    const hideEdit = Boolean(state.editing && !show);
    menu.style.visibility = hideEdit ? 'hidden' : '';
    dim.style.visibility = hideEdit ? 'hidden' : '';
  }

  // Велике поле дому: як воно лягає в панель (масштаб, зсув) і які клітинки видно
  function homeView(zone) {
    const stage = zones[zone].querySelector('.isozone-stage');
    const stageH = parseFloat(stage.style.height) || 660;
    const cfg = ZONE_CFG[zone];
    const k = Math.round(HOME_K * (state.editing === zone ? state.zoom.draft : state.zoom.owned) * 1000) / 1000;
    // передній (нижній) кут ділянки — по центру внизу панелі, під ним ще дорога
    const pl = plotOf();
    const f = tileTop(cfg, pl.x0 + pl.n, pl.y0 + pl.n);
    const left = Math.round(STAGE_W / 2 - f.x * k), top = Math.round(stageH - 46 - f.y * k);
    const peak = tileTop(cfg, pl.x0, pl.y0);                    // верхній кут ромба = лінія горизонту для «виду»
    return {k, left, top, stageH, horizon: Math.round(top + peak.y * k), horizonScene: peak.y};
  }
  // клітинку видно в панелі: центр не ближче EDGE_K ширини клітинки до бокового краю
  // (0.2 — можна ставити на клітинку, сховану за краєм менш ніж на 30%; на напівсховану — ні). Однаково зліва і справа.
  const EDGE_K = 0.2;
  function cellInPanel(zone, v, i, j) {
    const t = tileTop(ZONE_CFG[zone], i + 0.5, j + 0.5);
    const x = v.left + t.x * v.k, y = v.top + t.y * v.k, m = TW * v.k * EDGE_K;
    return x > m && x < STAGE_W - m && y > 0 && y < v.stageH;
  }
  function tileVisible(zone, v, i, j) {
    const cfg = ZONE_CFG[zone];
    const t = tileTop(cfg, i + 0.5, j + 0.5);
    const x = v.left + t.x * v.k, y = v.top + t.y * v.k, m = TW * v.k;
    return x > -m && x < STAGE_W + m && y > -m / 2 && y < v.stageH + m / 2;
  }
  // Покриття клітинки: колір + маленька деталь (галька, квіти, хвилі…)
  function coverTileSvg(cov, pts, i, j, c) {
    let s = `<polygon points="${pts}" fill="${cov.tiles[(i + j) % 2]}"/>`;
    const d = cov.deco;
    if (d === 'water') s += `<path d="M${c.x - 14} ${c.y} q7 -4 14 0 t14 0" stroke="#a5d8ff" stroke-width="2" fill="none"/>`;
    if (d === 'pebbles') s += [[-12, -2], [4, 3], [10, -4], [-3, -6]].map(([dx, dy]) => `<ellipse cx="${c.x + dx}" cy="${c.y + dy}" rx="3.2" ry="2" fill="#f1ede6" stroke="#9c958a" stroke-width=".6"/>`).join('');
    if (d === 'flowers') s += [[-10, -2, '#f06595'], [6, 3, '#ffd43b'], [9, -5, '#cc5de8'], [-2, -7, '#fff']].map(([dx, dy, col]) => `<circle cx="${c.x + dx}" cy="${c.y + dy}" r="2.4" fill="${col}"/>`).join('');
    if (d === 'field') s += `<path d="M${c.x - 14} ${c.y + 2} l14 -7 M${c.x - 6} ${c.y + 6} l14 -7 M${c.x - 2} ${c.y - 6} l14 -7" stroke="#b8932f" stroke-width="1.2"/>`;
    if (d === 'soil') s += `<path d="M${c.x - 12} ${c.y} l10 5 M${c.x} ${c.y - 6} l10 5" stroke="#6b4f32" stroke-width="1.4"/>`;
    if (d === 'paving') s += `<polygon points="${pts}" fill="none" stroke="#8f7f70" stroke-width="1"/><path d="M${c.x - 16} ${c.y} H${c.x + 16} M${c.x} ${c.y - 8} V${c.y + 8}" stroke="#8f7f70" stroke-width=".8"/>`;
    if (d === 'road') s += `<path d="M${c.x - 6} ${c.y - 3} l12 6" stroke="#f1f3f5" stroke-width="1.6" stroke-dasharray="3 3"/>`;
    return s;
  }

  // ---------- малювання сцени ----------
  function renderScene(zone) {
    const cfg = cfgOf(zone);
    const scene = zones[zone].querySelector('.isoscene');
    const size = sceneSize(cfg);
    const editing = state.editing === zone && !state.preview;
    const list = editing || state.editing === zone ? state.draft[zone] : state.owned[zone];
    scene.classList.toggle('editing', editing);
    scene.style.width = `${size.w}px`;
    scene.style.height = `${size.h}px`;
    const pt = (i, j) => { const t = tileTop(cfg, i, j); return `${t.x},${t.y}`; };
    let svg = `<svg width="${size.w}" height="${size.h}" viewBox="0 0 ${size.w} ${size.h}">`;
    if (cfg.walls) {
      const h = cfg.wallH;
      const top = tileTop(cfg, 0, 0), left = tileTop(cfg, 0, cfg.D), right = tileTop(cfg, cfg.W, 0);
      const wf = finishOf(WALL_FINISHES, finishSource().wall);
      const fillL = wf.pattern ? 'url(#patL)' : shade(wf.color, 0.94), fillR = wf.pattern ? 'url(#patR)' : wf.color;
      // ліва стіна йде від заднього кута вліво-вниз (нахил −0.5), права — вправо-вниз (+0.5): skewY відповідно −/+ 26.565°
      svg += `<defs>${wallPattern(wf, 'patL', -26.565)}${wallPattern(wf, 'patR', 26.565)}</defs>`;
      if (wf.two) {
        // дві смуги по висоті: низ (до split) і верх, між ними тонка лінія — межа завжди рівно по стіні
        const hs = h * wf.split;
        [[left, 0.94], [right, 1]].forEach(([c, k2]) => {
          svg += `<polygon points="${top.x},${top.y} ${c.x},${c.y} ${c.x},${c.y - hs} ${top.x},${top.y - hs}" fill="${shade(wf.two[1], k2)}"/>`
            + `<polygon points="${top.x},${top.y - hs} ${c.x},${c.y - hs} ${c.x},${c.y - h} ${top.x},${top.y - h}" fill="${shade(wf.two[0], k2)}"/>`
            + (wf.line ? `<line x1="${top.x}" y1="${top.y - hs}" x2="${c.x}" y2="${c.y - hs}" stroke="${wf.line}" stroke-width="3"/>` : '');
        });
      } else {
        svg += `<polygon points="${top.x},${top.y} ${left.x},${left.y} ${left.x},${left.y - h} ${top.x},${top.y - h}" fill="${fillL}"/>`;
        if (wf.pattern) svg += `<polygon points="${top.x},${top.y} ${left.x},${left.y} ${left.x},${left.y - h} ${top.x},${top.y - h}" fill="rgba(0,0,0,.07)"/>`;
        svg += `<polygon points="${top.x},${top.y} ${right.x},${right.y} ${right.x},${right.y - h} ${top.x},${top.y - h}" fill="${fillR}"/>`;
      }
      svg += `<line x1="${top.x}" y1="${top.y}" x2="${top.x}" y2="${top.y - h}" stroke="rgba(0,0,0,.12)"/>`;
    }
    const view = cfg.big ? homeView(zone) : null;
    const visible = (i, j) => !view || tileVisible(zone, view, i, j);
    // фон «вид» над ділянкою (у координатах панелі)
    const back = zones[zone].querySelector('.isoback');
    if (view) {
      const vid = state.editing === zone ? state.view.draft : state.view.owned;
      // вид видно лише над похилою лінією зверху і над лівою дорогою (під дорогою — біле)
      const pl0 = plotOf(), cfgH = ZONE_CFG[zone];
      const S = (i, j) => { const t = tileTop(cfgH, i, j); return {x: view.left + t.x * view.k, y: view.top + t.y * view.k}; };
      // вид — позаду землі (земля його перекриває), обрізаємо тільки під дорогами (там біле)
      const B = S(pl0.x0 + pl0.n + ROAD_W, pl0.y0 + pl0.n + ROAD_W);   // зовнішній край доріг (нижній кут)
      const clip = `0,0 ${STAGE_W},0 ${STAGE_W},${B.y - (STAGE_W - B.x) * 0.5} ${B.x},${B.y} 0,${B.y - B.x * 0.5}`;
      back.innerHTML = `<svg width="${STAGE_W}" height="${view.stageH}"><defs><clipPath id="viewClip"><polygon points="${clip}"/></clipPath></defs>
        <g clip-path="url(#viewClip)">${viewSvg(vid, STAGE_W, view.stageH, view.horizon, S(pl0.x0, pl0.y0).x, view.horizon - TOP_EXTRA * TH / 2 * view.k, {S, k: view.k, pl: pl0})}</g></svg>`;
    } else back.innerHTML = '';
    const pl = cfg.big ? plotOf() : null;
    let decoHtml = '';
    const fenceSegs = [];
    if (cfg.big) {
      const covers = state.editing === zone ? state.cover.draft : state.cover.owned;
      const road = coverOf('road'), outside = {tiles: ['#7bb662', '#74ad5c']};
      for (let i = 0; i < cfg.W; i++) for (let j = 0; j < cfg.D; j++) {
        if (!visible(i, j)) continue;
        if (!belowTop(pl, i, j)) continue;                          // вище зигзагу — там «вид»
        // під лівою дорогою — тротуар з плитки (3 ряди) для зупинки; під правою — порожньо (біле)
        if (j >= pl.y0 + pl.n + ROAD_W && j < pl.y0 + pl.n + ROAD_W + 3 && i < pl.x0 + pl.n) {
          const ptsW = `${pt(i, j)} ${pt(i + 1, j)} ${pt(i + 1, j + 1)} ${pt(i, j + 1)}`;
          svg += `<polygon points="${ptsW}" fill="${(i + j) % 2 ? '#d5d0c8' : '#cdc7be'}" stroke="#b5aea3" stroke-width="1"/>`;
          continue;
        }
        if (i >= pl.x0 + pl.n + ROAD_W || j >= pl.y0 + pl.n + ROAD_W) continue;
        const pts = `${pt(i, j)} ${pt(i + 1, j)} ${pt(i + 1, j + 1)} ${pt(i, j + 1)}`;
        const c = tileTop(cfg, i + 0.5, j + 0.5);
        if (inPlot(pl, i, j)) {
          svg += coverTileSvg(coverOf(covers[`${i},${j}`]), pts, i, j, c);
          if (editing) svg += `<polygon class="gridline" points="${pts}"/>`;
          fenceEdges(pl, i, j).forEach(e => fenceSegs.push([tileTop(cfg, i, j), e === 'L' ? tileTop(cfg, i, j + 1) : tileTop(cfg, i + 1, j)]));
        } else {
          // дорога вздовж передніх країв ділянки (до боків панелі)
          svg += coverTileSvg(road, pts, i, j, c);
        }
      }
      // дерев'яний паркан по крайніх верхніх клітинках: дві жердини і стовпчики
      const rail = (a, b, h) => `<line x1="${a.x}" y1="${a.y - h}" x2="${b.x}" y2="${b.y - h}" stroke="#8b5a2b" stroke-width="3" stroke-linecap="round"/>`;
      fenceSegs.forEach(([a, b]) => { svg += rail(a, b, 6) + rail(a, b, 15); });
      const posts = new Map();
      fenceSegs.forEach(([a, b]) => [a, b].forEach(q => posts.set(`${q.x},${q.y}`, q)));
      posts.forEach(q => { svg += `<rect x="${q.x - 2.5}" y="${q.y - 21}" width="5" height="22" rx="1.5" fill="#a0692f" stroke="#6b4419" stroke-width="1"/>`; });
      // зупинка на тротуарі під лівою дорогою (декорація, як на картинці — без дзеркала)
      const bs = tileTop(cfg, pl.x0 + pl.n - 4, pl.y0 + pl.n + ROAD_W + 2);
      decoHtml = `<img class="it" src="ISOMETRIC/outside/busstop1.png" alt="" title="Зупинка" style="left:${bs.x - 100}px;top:${bs.y - 150}px;width:200px;height:171px;z-index:60">`;
    }
    if (!cfg.big) for (let i = 0; i < cfg.W; i++) for (let j = 0; j < cfg.D; j++) {
      const ff = cfg.walls ? finishOf(FLOOR_FINISHES, finishSource().floor) : null;
      const tiles = ff ? ff.tiles : cfg.tile;
      svg += `<polygon points="${pt(i, j)} ${pt(i + 1, j)} ${pt(i + 1, j + 1)} ${pt(i, j + 1)}" fill="${tiles[(i + j) % 2]}"${ff?.lines ? ` stroke="${ff.lines}" stroke-width=".6"` : ''}/>`;
      if (ff?.speck) {   // граніт: дрібні вкраплення (стабільно по клітинці)
        for (let q = 0; q < 9; q++) { const a = ((i * 7 + j * 13 + q * 29) % 97) / 97, b = ((i * 11 + j * 5 + q * 41) % 89) / 89, c = tileTop(cfg, i + .1 + a * .8, j + .1 + b * .8);
          svg += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${q % 3 ? 1 : 1.6}" fill="${ff.speck[q % ff.speck.length]}"/>`; }
      }
      if (ff?.herring) {   // паркет «ялинка»: планки 2×1 під 90°, безшовно (у кожній клітинці 4×4 одиниці планки), обрізані по клітинці
        const U = 4, [cH, cV, cL] = ff.herring, q = (u, v) => { const p = tileTop(cfg, i + u / U, j + v / U); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; };
        const rect = (u0, u1, v0, v1, c) => { u0 = Math.max(0, u0); v0 = Math.max(0, v0); u1 = Math.min(U, u1); v1 = Math.min(U, v1);
          return u1 > u0 && v1 > v0 ? `<polygon points="${q(u0, v0)} ${q(u1, v0)} ${q(u1, v1)} ${q(u0, v1)}" fill="${c}" stroke="${cL}" stroke-width=".6"/>` : ''; };
        for (let t = -6; t <= 5; t++) for (let s = -3; s <= 2; s++) {
          const y = t + 4 * s;
          svg += rect(t, t + 2, y, y + 1, cH) + rect(t, t + 1, y + 1, y + 3, cV);
        }
      }
      if (ff?.lino) {   // совковий лінолеум: квадрат у квадраті + ромбик (геометрія під плитку)
        const [c1, c2, c3] = ff.lino, m = (u, v) => { const p = tileTop(cfg, i + u, j + v); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; };
        svg += `<polygon points="${m(.12, .12)} ${m(.88, .12)} ${m(.88, .88)} ${m(.12, .88)}" fill="${c1}" stroke="${c3}" stroke-width=".7"/>`
          + `<polygon points="${m(.5, .22)} ${m(.78, .5)} ${m(.5, .78)} ${m(.22, .5)}" fill="${c2}"/>`
          + `<polygon points="${m(.5, .4)} ${m(.6, .5)} ${m(.5, .6)} ${m(.4, .5)}" fill="${c1}"/>`;
      }
      if (ff?.motif) {   // безшовний візерунок: ромбик-квітка в центрі кожної плитки + тонка рамка
        const C = tileTop(cfg, i + .5, j + .5), m = (di, dj) => { const p = tileTop(cfg, i + .5 + di, j + .5 + dj); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; };
        svg += `<polygon points="${m(-.32, -.32)} ${m(.32, -.32)} ${m(.32, .32)} ${m(-.32, .32)}" fill="none" stroke="${ff.motif[1]}" stroke-width=".8"/>`
          + `<polygon points="${m(0, -.16)} ${m(.16, 0)} ${m(0, .16)} ${m(-.16, 0)}" fill="${ff.motif[0]}"/><circle cx="${C.x.toFixed(1)}" cy="${C.y.toFixed(1)}" r="1.4" fill="${ff.motif[1]}"/>`;
      }
    }
    if (editing && !cfg.big) {
      for (let i = 0; i <= cfg.W; i++) svg += `<line class="gridline" x1="${tileTop(cfg, i, 0).x}" y1="${tileTop(cfg, i, 0).y}" x2="${tileTop(cfg, i, cfg.D).x}" y2="${tileTop(cfg, i, cfg.D).y}"/>`;
      for (let j = 0; j <= cfg.D; j++) svg += `<line class="gridline" x1="${tileTop(cfg, 0, j).x}" y1="${tileTop(cfg, 0, j).y}" x2="${tileTop(cfg, cfg.W, j).x}" y2="${tileTop(cfg, cfg.W, j).y}"/>`;
    }
    // підсвітка, куди стане річ
    // що зараз «висить» на курсорі: нова річ (ставимо / дублюємо) або річ, яку переміщаємо
    const movingP = editing && state.moving ? state.draft[zone].find(p => p.uid === state.moving) : null;
    const placingItem = editing ? (state.placing ? byId.get(state.placing) : movingP ? byId.get(movingP.id) : null) : null;
    const placingFlip = state.placing ? Boolean(state.placingFlip) : Boolean(movingP?.flip);
    const exceptUid = movingP?.uid;
    if (placingItem && state.hover) {
      const ok = fits(zone, placingItem, state.hover, placingFlip, exceptUid);
      if (placingItem.place === 'wall' && state.hover.wall) {
        const k = state.hover.k, n = placingItem.fw, h = 70;
        const a = state.hover.wall === 'L' ? tileTop(cfg, 0, k) : tileTop(cfg, k, 0);
        const b = state.hover.wall === 'L' ? tileTop(cfg, 0, k + n) : tileTop(cfg, k + n, 0);
        svg += `<polygon class="${ok ? 'hl-ok' : 'hl-bad'}" points="${a.x},${a.y - 10} ${b.x},${b.y - 10} ${b.x},${b.y - 10 - h} ${a.x},${a.y - 10 - h}"/>`;
      } else if (placingItem.place === 'floor' && !state.hover.wall) {
        const {i, j} = state.hover;
        cellsOf(placingItem, placingFlip).forEach(([a, b]) => {
          svg += `<polygon class="${ok ? 'hl-ok' : 'hl-bad'}" points="${pt(i + a, j + b)} ${pt(i + a + 1, j + b)} ${pt(i + a + 1, j + b + 1)} ${pt(i + a, j + b + 1)}"/>`;
        });
      }
    }
    // клік-зони: клітинки підлоги і відрізки стін
    if (editing) {
      // клікати можна лише клітинки, центр яких у межах панелі (щоб речі не ставали за краєм)
      const inside = (i, j) => !view || cellInPanel(zone, view, i, j);
      const fenceMode = pl && String(state.brush || '').startsWith('fence:');
      if (fenceMode) {
        // режим парканів: клікабельні межі між клітинками (тонкі смужки вздовж ліній сітки)
        for (let i = 0; i < cfg.W; i++) for (let j = 0; j < cfg.D; j++) {
          if (!visible(i, j) || !inside(i, j)) continue;
          const here = inPlot(pl, i, j);
          [['L', here || inPlot(pl, i - 1, j)], ['R', here || inPlot(pl, i, j - 1)]].forEach(([d, ok]) => {
            if (!ok) return;
            const key = `${i},${j},${d}`, [a, b] = edgePts(cfg, key);
            svg += `<polygon class="hit" data-e="${key}" points="${a.x},${a.y - 6} ${b.x},${b.y - 6} ${b.x},${b.y + 6} ${a.x},${a.y + 6}"/>`;
          });
        }
      } else
      for (let i = 0; i < cfg.W; i++) for (let j = 0; j < cfg.D; j++) if (visible(i, j) && inside(i, j) && (!pl || inPlot(pl, i, j)))
        svg += `<polygon class="hit" data-i="${i}" data-j="${j}" points="${pt(i, j)} ${pt(i + 1, j)} ${pt(i + 1, j + 1)} ${pt(i, j + 1)}"/>`;
      if (cfg.walls) {
        const h = cfg.wallH;
        for (let k = 0; k < cfg.D; k++) { const a = tileTop(cfg, 0, k), b = tileTop(cfg, 0, k + 1);
          svg += `<polygon class="hit" data-wall="L" data-k="${k}" points="${a.x},${a.y} ${b.x},${b.y} ${b.x},${b.y - h} ${a.x},${a.y - h}"/>`; }
        for (let k = 0; k < cfg.W; k++) { const a = tileTop(cfg, k, 0), b = tileTop(cfg, k + 1, 0);
          svg += `<polygon class="hit" data-wall="R" data-k="${k}" points="${a.x},${a.y} ${b.x},${b.y} ${b.x},${b.y - h} ${a.x},${a.y - h}"/>`; }
      }
    }
    svg += '</svg>';
    // речі
    const zfix = depthFix(zone, list);
    const imgs = list.map(p => {
      const item = byId.get(p.id);
      if (!item) return '';
      const s = spritePos(zone, item, p);
      if (zfix.has(p.uid)) s.z = zfix.get(p.uid);
      return standHtml(cfg, item, p, s.z, movingP?.uid === p.uid ? ' ghost' : '') + `<img class="it${s.flip ? ' flip' : ''}${editing && state.selected === p.uid ? ' sel' : ''}${movingP?.uid === p.uid ? ' ghost' : ''}" data-uid="${p.uid}" src="${s.src || item.src}" alt="" title="${esc(item.name)}"
        style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;z-index:${s.z}">`;
    }).join('');
    let ghost = '';
    if (placingItem && state.hover && ((placingItem.place === 'wall') === Boolean(state.hover.wall))) {
      const s = spritePos(zone, placingItem, {...state.hover, flip: placingFlip});
      ghost = standHtml(cfg, placingItem, {...state.hover, flip: placingFlip}, 7999, ' ghost') + `<img class="it ghost${s.flip ? ' flip' : ''}" src="${s.src || placingItem.src}" alt="" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;z-index:8000">`;
    }
    // паркани гравця: кожен відрізок — окремий шар із глибиною, як у речей (річ позаду ховається за парканом)
    let fenceHtml = '';
    if (cfg.big) {
      const fences = state.editing === zone ? state.fence.draft : state.fence.owned;
      Object.entries(fences).forEach(([key, style]) => {
        const [a, b] = edgePts(cfg, key), [fi, fj] = key.split(',').map(Number);
        const x0 = Math.min(a.x, b.x) - 6, y0 = Math.min(a.y, b.y) - 30, w = Math.abs(a.x - b.x) + 12, h = Math.abs(a.y - b.y) + 34;
        fenceHtml += `<svg class="fence" style="position:absolute;left:${x0}px;top:${y0}px;width:${w}px;height:${h}px;z-index:${100 + (fi + fj) * 20 + 10};overflow:visible;pointer-events:none"><g transform="translate(${-x0} ${-y0})">${fenceSvg(style, a, b)}</g></svg>`;
      });
    }
    // клік-зони мають бути над речами
    scene.innerHTML = svg.replace(/<polygon class="hit"[\s\S]*?<\/svg>/, '</svg>') + decoHtml + fenceHtml + imgs + ghost +
      (editing ? `<svg width="${size.w}" height="${size.h}" style="z-index:8500" viewBox="0 0 ${size.w} ${size.h}">${(svg.match(/<polygon class="hit"[^>]*\/>/g) || []).join('')}</svg>` : '');
    if (!editing) { renderToolbar(zone); return; }   // у перегляді панелька над річчю ховається
    scene.querySelectorAll('.hit').forEach(h => {
      if (h.dataset.e) {   // межа між клітинками (режим парканів)
        h.onmousedown = e => { e.preventDefault(); state.painting = true; state.fenceDrag = null; paintFence(zone, h.dataset.e); };
        h.onmouseenter = () => { if (state.painting) paintFence(zone, h.dataset.e); };
        return;
      }
      const pos = h.dataset.wall ? {wall: h.dataset.wall, k: Number(h.dataset.k)} : {i: Number(h.dataset.i), j: Number(h.dataset.j)};
      h.onmouseenter = () => {
        if (state.brush && state.painting) { paintCell(zone, pos); return; }
        if (JSON.stringify(state.hover) === JSON.stringify(pos)) return;
        state.hover = pos;
        if (state.placing || state.moving) renderScene(zone);
      };
      h.onmousedown = e => { if (state.brush) { e.preventDefault(); state.painting = true; paintCell(zone, pos); } };
      h.onclick = () => { if (!state.brush) clickCell(zone, pos); };
    });
    renderToolbar(zone);
  }

  // Відобразити: якщо в дзеркалі тут не влазить — все одно віддзеркалюємо і пропонуємо перемістити в інше місце
  function flipItem(zone, p) {
    const item = byId.get(p.id);
    const ok = p.wall || fits(zone, item, p, !p.flip, p.uid);
    p.flip = !p.flip;
    if (!ok) {
      state.moving = p.uid; state.hover = null;
      state.moveUndoFlip = p.uid;   // ✕ поверне як було
      toast('У дзеркалі тут не влазить — оберіть нове місце', zone);
    }
  }
  // Інша сторона (↕): та сама річ (uid), але картинка/розмір іншої сторони; не влазить — пропонуємо перемістити
  function sideItem(zone, p) {
    const other = otherSide(p.id);
    if (!other) return;
    const ok = p.wall || fits(zone, other, p, p.flip, p.uid);
    const oldId = p.id;
    p.id = other.id;
    if (!ok) {
      state.moving = p.uid; state.hover = null;
      state.moveUndoSide = {uid: p.uid, id: oldId};   // ✕ поверне як було
      toast('Іншою стороною тут не влазить — оберіть нове місце', zone);
    }
  }
  function cancelMove() {
    if (state.moveUndoFlip) {
      for (const z of ZONES) { const p = state.draft[z].find(x => x.uid === state.moveUndoFlip); if (p) p.flip = !p.flip; }
    }
    if (state.moveUndoSide) {
      for (const z of ZONES) { const p = state.draft[z].find(x => x.uid === state.moveUndoSide.uid); if (p) p.id = state.moveUndoSide.id; }
    }
    state.moving = null; state.moveUndoFlip = null; state.moveUndoSide = null;
  }

  // Панелька над виділеною річчю: ✓ готово · ↔ відобразити · ✥ перемістити · ⧉ дублювати · ✕ видалити
  function renderToolbar(zone) {
    const stage = zones[zone].querySelector('.isozone-stage');
    stage.querySelector('.isotool')?.remove();
    if (state.editing !== zone || state.preview || state.placing || state.brush) return;
    const uidSel = state.moving || state.selected;
    const p = uidSel && state.draft[zone].find(x => x.uid === uidSel);
    const img = p && stage.querySelector(`img.it[data-uid="${p.uid}"]`);
    if (!img) return;
    const item = byId.get(p.id);
    const sr = stage.getBoundingClientRect(), ir = img.getBoundingClientRect();
    const z = sr.width / STAGE_W || 1;
    const tool = document.createElement('div');
    tool.className = 'isotool';
    tool.innerHTML = state.moving
      ? `<span>Клацніть нове місце</span><button type="button" data-tb="cancelmove" title="Скасувати переміщення">✕</button>`
      : `<button type="button" data-tb="done" title="Готово">✓</button><button type="button" data-tb="flip" title="Відобразити дзеркально">↔</button>
         ${otherSide(p.id) ? '<button type="button" data-tb="side" title="Інша сторона моделі">↕</button>' : '<button type="button" class="off" disabled title="У цієї моделі нема іншої сторони">↕</button>'}
         <button type="button" data-tb="move" title="Перемістити">✥</button><button type="button" data-tb="dup" title="Дублювати">⧉</button>
         <button type="button" data-tb="stock" title="Прибрати в «🎒 Куплене» (не продавати — потім можна поставити знову)">🎒</button>
         <button type="button" data-tb="del" title="Прибрати в 🗑 кошик (звідти — повернути, у «Куплене» або продати)" class="del">🗑</button>`;
    stage.appendChild(tool);
    const x = (ir.left + ir.width / 2 - sr.left) / z, y = (ir.top - sr.top) / z;
    tool.style.left = `${Math.max(4, Math.min(STAGE_W - tool.offsetWidth - 4, x - tool.offsetWidth / 2))}px`;
    tool.style.top = `${Math.max(4, y - tool.offsetHeight - 6)}px`;
    tool.onclick = e => {
      const act = e.target.closest('[data-tb]')?.dataset.tb;
      if (!act) return;
      if (act === 'done') state.selected = null;
      if (act === 'cancelmove') cancelMove();
      if (act === 'move') { state.moving = p.uid; state.hover = null; }
      if (act === 'flip') {
        flipItem(zone, p);
      }
      if (act === 'side') sideItem(zone, p);
      if (act === 'dup') { state.placingUid = null; state.placing = p.id; state.placingFlip = Boolean(p.flip); state.selected = null; state.hover = null; }
      if (act === 'del') toBin(zone, p);
      if (act === 'stock') { toStock(zone, p); toast(`«${item?.name || ''}» — у 🎒 Куплене`, zone); }
      renderScene(zone); renderMenu(); layout();
    };
  }

  // Пензель покриття: фарбує клітинку (трава = прибрати покриття)
  let menuTimer = null;
  // хто займає клітинку (меблі важливіші за килим)
  function itemAt(zone, pos) {
    return [...state.draft[zone]].reverse().sort((a, b) => Number(Boolean(byId.get(a.id)?.flat)) - Number(Boolean(byId.get(b.id)?.flat))).find(p => {
      const item = byId.get(p.id);
      if (!item) return false;
      if (pos.wall) return p.wall === pos.wall && pos.k >= p.k && pos.k < p.k + item.fw;
      if (p.wall) return false;
      return cellsOf(item, p.flip).some(([a, b]) => pos.i === p.i + a && pos.j === p.j + b);
    });
  }
  // прибрати річ у кошик (звідти можна повернути або продати)
  function toBin(zone, p) {
    // виграш у колесі не продається — замість кошика одразу в «🎒 Куплене»
    if (wonUids().has(p.uid)) { toStock(zone, p); toast(`🎡 «${byId.get(p.id)?.name || ''}» — виграш не продається, прибрано в 🎒 Куплене`, zone); return; }
    state.draft[zone] = state.draft[zone].filter(x => x.uid !== p.uid);
    state.bin.push(p);
    if (state.selected === p.uid) state.selected = null;
  }
  // прибрати річ у «Куплене» — не продається, лишається вашою
  function toStock(zone, p) {
    state.draft[zone] = state.draft[zone].filter(x => x.uid !== p.uid);
    state.draft.stock.push({uid: p.uid, id: p.id, ...(wonUids().has(p.uid) ? {from: 'wheel'} : {})});
    if (state.selected === p.uid) state.selected = null;
  }
  function paintCell(zone, pos) {
    if (state.brush === 'eraser') {
      const hit = itemAt(zone, pos);
      if (!hit) return;
      toBin(zone, hit);
      renderScene(zone);
      clearTimeout(menuTimer);
      menuTimer = setTimeout(renderMenu, 150);
      return;
    }
    if (zone !== 'home' || pos.wall || !state.brush) return;
    const key = `${pos.i},${pos.j}`;
    if (state.brush === 'wipe') {   // гумка паркан/покриття: трава + прибрати паркани на 4 краях клітинки
      const {i, j} = pos;
      const edges = [`${i},${j},L`, `${i},${j},R`, `${i + 1},${j},L`, `${i},${j + 1},R`].filter(k => state.fence.draft[k]);
      if (!state.cover.draft[key] && !edges.length) return;
      delete state.cover.draft[key];
      edges.forEach(k => delete state.fence.draft[k]);
      renderScene(zone);
      clearTimeout(menuTimer);
      menuTimer = setTimeout(renderMenu, 150);
      return;
    }
    const cur = state.cover.draft[key] || 'grass';
    if (cur === state.brush) return;
    if (state.brush === 'grass') delete state.cover.draft[key]; else state.cover.draft[key] = state.brush;
    renderScene(zone);
    clearTimeout(menuTimer);
    menuTimer = setTimeout(renderMenu, 150);
  }
  // Паркан на межі: перший клік вирішує режим протягування — ставити чи прибирати
  function paintFence(zone, key) {
    const style = String(state.brush).slice(6);   // 'fence:<id>' або 'fence:erase'
    const cur = state.fence.draft[key];
    if (!state.fenceDrag) state.fenceDrag = style === 'erase' || cur === style ? 'erase' : 'set';
    if (state.fenceDrag === 'erase') { if (!cur) return; delete state.fence.draft[key]; }
    else { if (cur === style) return; state.fence.draft[key] = style; }
    renderScene(zone);
    clearTimeout(menuTimer);
    menuTimer = setTimeout(renderMenu, 150);
  }
  addEventListener('mouseup', () => { state.painting = false; state.fenceDrag = null; });

  // Клік по клітинці: поставити обрану річ або вибрати річ, що там стоїть
  function clickCell(zone, pos) {
    // переміщення: клік ставить річ на нове місце
    if (state.moving) {
      const mp = state.draft[zone].find(x => x.uid === state.moving);
      const item = mp && byId.get(mp.id);
      if (!item) { state.moving = null; return; }
      const p = item.place === 'wall' ? {wall: pos.wall, k: pos.k} : {i: pos.i, j: pos.j};
      if (!fits(zone, item, p, mp.flip, mp.uid)) return;
      delete mp.wall; delete mp.k; delete mp.i; delete mp.j;
      Object.assign(mp, p);
      state.moving = null; state.moveUndoFlip = null; state.moveUndoSide = null;
      renderScene(zone); renderMenu();
      return;
    }
    const placing = state.placing ? byId.get(state.placing) : null;
    if (placing) {
      const p = placing.place === 'wall' ? {wall: pos.wall, k: pos.k} : {i: pos.i, j: pos.j};
      const flip = Boolean(state.placingFlip);
      if (!fits(zone, placing, p, flip)) return;
      // з «Куплене» — та сама річ (той самий uid), тож не купується вдруге
      const fromStock = state.placingUid && state.draft.stock.find(s => s.uid === state.placingUid && s.id === placing.id);
      if (fromStock) state.draft.stock = state.draft.stock.filter(s => s !== fromStock);
      state.placingUid = null;
      const nu = fromStock ? fromStock.uid : uid();
      state.draft[zone].push({uid: nu, id: placing.id, flip, ...p});
      // поставили — готово: виходимо з режиму ставлення і виділяємо нову річ (над нею з'явиться панелька)
      state.placing = null; state.placingFlip = false; state.selected = nu; state.hover = null;
      renderScene(zone); renderMenu(); layout();
      return;
    }
    // хто стоїть у цій клітинці?
    // спершу меблі, а килим — якщо на клітинці більше нічого
    const hit = [...state.draft[zone]].reverse().sort((a, b) => Number(Boolean(byId.get(a.id)?.flat)) - Number(Boolean(byId.get(b.id)?.flat))).find(p => {
      const item = byId.get(p.id);
      if (!item) return false;
      if (pos.wall) return p.wall === pos.wall && pos.k >= p.k && pos.k < p.k + item.fw;
      if (p.wall) return false;
      return cellsOf(item, p.flip).some(([a, b]) => pos.i === p.i + a && pos.j === p.j + b);
    });
    state.selected = hit ? hit.uid : null;
    // клік по порожній стіні / підлозі офісу — показати вибір кольорів і текстур
    state.finishFocus = !hit && zone === 'office' ? (pos.wall ? 'wall' : 'floor') : null;
    if (state.finishFocus) { state.group.office = state.finishFocus === 'wall' ? '🎨 Стіни' : '🟫 Підлога'; state.showStock = false; }   // клік по порожній стіні / підлозі — відкрити їх у списку
    renderScene(zone); renderMenu();
  }

  // ---------- кошик ----------
  const libDraft = o => JSON.parse(JSON.stringify({...o, sellFence: {}, sellCover: {}}));
  // склад парканів / покриття: що з поля прибрано — на склад, що поставлено — спершу зі складу, решта купується
  function invCalc(kind) {
    const src = kind === 'fence' ? state.fence : state.cover, of = kind === 'fence' ? fenceOf : coverOf;
    const cnt = o => { const m = {}; Object.values(o).forEach(s => { if (s && s !== 'grass') m[s] = (m[s] || 0) + 1; }); return m; };
    const a = cnt(src.owned), b = cnt(src.draft), inv0 = state.lib.owned[kind] || {}, sell = state.lib.draft[kind === 'fence' ? 'sellFence' : 'sellCover'] || {};
    const res = {}; let buy = 0, refund = 0, fromInv = 0, toInv = 0, sold = 0;
    new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(inv0)]).forEach(s => {
      const d = (b[s] || 0) - (a[s] || 0), have = inv0[s] || 0;
      let inv = have, buyN = 0;
      if (d > 0) { const use = Math.min(d, have); inv = have - use; buyN = d - use; fromInv += use; } else if (d < 0) { inv = have - d; toInv += -d; }
      const sl = Math.min(sell[s] || 0, inv); inv -= sl; sold += sl;
      const price = of(s).price; buy += buyN * price; refund += sl * sellPrice(price);
      res[s] = {inv, buyN, sold: sl, price};
    });
    return {res, buy, refund, fromInv, toInv, sold};
  }
  function cart(zone) {
    // «Куплене» (stock) — теж власність: річ звідти не купується вдруге, а прибрана туди — не продається
    const ownedIds = new Set([...state.owned.office, ...state.owned.home, ...state.owned.stock].map(p => p.uid));
    const mineNow = [...state.draft[zone], ...state.draft.stock];
    const draftIds = new Set(mineNow.map(p => p.uid));
    const bought = mineNow.filter(p => !ownedIds.has(p.uid)).map(p => byId.get(p.id)).filter(Boolean);
    const sold = [...state.owned[zone], ...state.owned.stock].filter(p => !draftIds.has(p.uid)).map(p => byId.get(p.id)).filter(Boolean);
    let room = zone === 'office' ? roomUpgradeCost(state.size.owned, state.size.draft) : 0;
    // оздоблення офісу: купуються лише нові (яких нема в «бібліотеці»), продаються — тільки вручну прибрані з неї
    const finishes = [], finSold = [];
    if (zone === 'office') [['wall', WALL_FINISHES, 'Стіни'], ['floor', FLOOR_FINISHES, 'Підлога']].forEach(([key, list, label]) => {
      const O = new Set(state.lib.owned[key]), D = new Set(state.lib.draft[key]);
      D.forEach(id => { if (!O.has(id)) { const f = finishOf(list, id); finishes.push({label, name: f.name, price: f.price, refund: 0}); } });
      O.forEach(id => { if (!D.has(id)) { const f = finishOf(list, id); finSold.push({label, name: f.name, refund: sellPrice(f.price)}); } });
    });
    // покриття землі й паркани дому: склад (прибране — на склад, поставлене — спершу зі складу)
    const ci = zone === 'home' ? invCalc('cover') : null, fi = zone === 'home' ? invCalc('fence') : null;
    const changed = (a, b, dflt) => new Set([...Object.keys(a), ...Object.keys(b)]).size && [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => (a[k] || dflt) !== (b[k] || dflt)).length;
    const covers = {cells: zone === 'home' ? changed(state.cover.owned, state.cover.draft, 'grass') : 0, buy: ci?.buy || 0, refund: ci?.refund || 0, fromInv: ci?.fromInv || 0, toInv: ci?.toInv || 0, sold: ci?.sold || 0};
    const fences = {segs: zone === 'home' ? changed(state.fence.owned, state.fence.draft, '') : 0, buy: fi?.buy || 0, refund: fi?.refund || 0, fromInv: fi?.fromInv || 0, toInv: fi?.toInv || 0, sold: fi?.sold || 0};
    // ділянка і вид (тільки дім)
    const plot = zone === 'home' ? plotCost(state.plot.owned.n, state.plot.draft.n) : 0;
    // продані ряди ділянки — за півціни (кожен ряд окремо, як при купівлі)
    let plotRefund = 0, roomRefund = 0;
    if (zone === 'office') for (let n = state.size.draft + 1; n <= state.size.owned; n++) roomRefund += sellPrice(ROOM_UPGRADES[n] || 0);
    if (zone === 'home') for (let n = state.plot.draft.n; n < state.plot.owned.n; n++) plotRefund += sellPrice(plotUpgradePrice(n));
    // види дому — як оздоблення: куплений лишається вашим
    let view = null, viewSold = [];
    if (zone === 'home') {
      const O = new Set(state.lib.owned.view), D = new Set(state.lib.draft.view);
      const nb = [...D].filter(id => !O.has(id)).map(viewOf);
      if (nb.length) view = {name: nb.map(v => v.name).join(', '), price: nb.reduce((s, v) => s + v.price, 0), refund: 0};
      viewSold = [...O].filter(id => !D.has(id)).map(id => ({name: viewOf(id).name, refund: sellPrice(viewOf(id).price)}));
    }
    const buy = {usd: room + finishes.reduce((s, f) => s + f.price, 0) + covers.buy + plot + (view?.price || 0) + fences.buy, pies: 0};
    const refund = {usd: finSold.reduce((s, f) => s + f.refund, 0) + viewSold.reduce((s, v) => s + v.refund, 0) + covers.refund + fences.refund + plotRefund + roomRefund, pies: 0};
    bought.forEach(i => { buy.usd += i.cost.usd; buy.pies += i.cost.pies; });
    sold.forEach(i => { refund.usd += sellPrice(i.cost.usd); refund.pies += sellPrice(i.cost.pies); });
    return {bought, sold, room, roomRefund, finishes, finSold, covers, plot, plotRefund, view, viewSold, fences, buy, refund, net: {usd: buy.usd - refund.usd, pies: buy.pies - refund.pies}};
  }

  // ---------- меню ----------
  function renderMenu() {
    const zone = state.editing;
    if (!isAdmin()) { state.testMode = false; state.showHidden = false; }   // «🛠 Редагувати каталог» — тільки для адмінів сайту
    dim.hidden = !zone || state.preview;
    menu.hidden = !zone || state.preview;
    previewBar.hidden = !(zone && state.preview);
    ZONES.forEach(z => { if (z !== zone || state.preview) { const b = finboxes[z]; b.hidden = true; b.innerHTML = '';
      const t = zones[z].querySelector('.isozone-tools'); if (t) t.innerHTML = ''; } });
    ZONES.forEach(z => zones[z].querySelector('.fencehint')?.remove());
    if (!zone) { menu.innerHTML = ''; return; }
    undoTick();   // запам'ятати стан після останньої дії (для «↶ Відмінити дію»)
    const keep = menu.querySelector('.isogrid')?.scrollTop || 0;
    // в офісі перші пункти списку — «Стіни» і «Підлога» (оздоблення кімнати)
    // у домі перший пункт — «🏞 Пейзаж за вікном» (вид за ділянкою; куплений лишається вашим, не продається)
    const FIN_G = {'🎨 Стіни': 'wall', '🟫 Підлога': 'floor', '🏞 Пейзаж за вікном': 'view', '🪵 Паркани': 'fence'};
    // перший пункт — «Всі категорії»: головна сторінка меню (картки категорій); з категорії — «← Назад»
    const groups = [ALL_CATS, ...(zone === 'office' ? ['🎨 Стіни', '🟫 Підлога'] : ['🏞 Пейзаж за вікном', '🪵 Паркани']), ...groupsFor(zone)];
    const group = state.group[zone] && groups.includes(state.group[zone]) ? state.group[zone] : groups[0];   // за замовчуванням — «Всі категорії»
    const allCats = group === ALL_CATS && !state.showStock;
    const finKey = !state.showStock ? FIN_G[group] || null : null;
    state.group[zone] = group;
    // сортування за ціною: за замовчуванням від дешевих; спершу речі за $, потім за 🥧 (валюти не змішуємо)
    const dir = state.sortDesc ? -1 : 1;
    const byPrice = (a, b) => ((a.cur === 'pies') - (b.cur === 'pies')) || dir * ((a.cost.usd || a.cost.pies) - (b.cost.usd || b.cost.pies));
    // «🎒 Куплене»: ваші речі, що зараз ніде не стоять (по одній картці на модель, з кількістю) + безкоштовні від профсоюзу
    const zoneOk = it => it && !it.hidden && (it.zone === zone || it.zone === 'both');
    const stockBy = new Map();
    state.draft.stock.forEach(s => { const it = byId.get(s.id); if (zoneOk(it)) { if (!stockBy.has(s.id)) stockBy.set(s.id, []); stockBy.get(s.id).push(s.uid); } });
    const stockCount = state.draft.stock.length;
    // скільки таких речей уже є (поставлені в офісі й удома + «Куплене») — значок 🎒 перед назвою в каталозі
    // у «Куплене» в самому низу — сірим те, що вже стоїть в офісі / вдома (куплене за гроші; лише для інформації)
    const placedBy = new Map();   // id → {office: n, home: n}
    ZONES.forEach(z => state.draft[z].forEach(p => { const it = byId.get(p.id); if (!it || it.free) return;
      const o = placedBy.get(p.id) || {office: 0, home: 0}; o[z]++; placedBy.set(p.id, o); }));
    const placedHtml = !state.showStock ? '' : [...placedBy.keys()].map(id => byId.get(id)).filter(Boolean).sort(byPrice).map(it => {
      const o = placedBy.get(it.id), where = [o.office ? `в офісі${o.office > 1 ? ` × ${o.office}` : ''}` : '', o.home ? `вдома${o.home > 1 ? ` × ${o.home}` : ''}` : ''].filter(Boolean).join(', ');
      return `<div class="isocard placed" title="Уже стоїть ${where}. Щоб переставити — виділіть на сцені і натисніть 🎒">${miniHtml(it, MINI_W, MINI_H)}<div class="n">${esc(it.name)}</div><div class="p">✓ стоїть ${where}</div><div class="c">${it.place === 'wall' ? `стіна · ${it.fw} кл.` : `${it.fw}×${it.fd} кл.`}</div></div>`;
    }).join('');
    const wonSet = wonUids();   // виграні в колесі — не продаються
    const haveN = new Map();
    [...state.draft.office, ...state.draft.home, ...state.draft.stock].forEach(p => haveN.set(sideA(p.id), (haveN.get(sideA(p.id)) || 0) + 1));
    const items = state.showStock
      ? [...[...stockBy.keys()].map(id => byId.get(id)).sort(byPrice), ...itemsFor(zone).filter(c => c.free && !stockBy.has(c.id)).sort(byPrice)]
      : itemsFor(zone).filter(c => c.group === group).sort(byPrice);
    const c = cart(zone);
    const sel = state.selected && state.draft[zone].find(p => p.uid === state.selected);
    const selItem = sel && byId.get(sel.id);
    const selOwned = sel && state.owned[zone].some(p => p.uid === sel.uid);
    const net = c.net, short = {usd: net.usd > balUsd(), pies: net.pies > balPies()};
    // оздоблення офісу / налаштування ділянки — у панельці вгорі своєї панелі (згортається)
    // склад парканів / покриття (скільки лежить після поточних змін) і «💰» для ручного продажу
    const fInv = zone === 'home' ? invCalc('fence').res : {}, cInv = zone === 'home' ? invCalc('cover').res : {};
    const sellBtn = (attr, amount) => `<span class="sellx" ${attr} title="Продати за 50% (+${money(amount)})">💰</span>`;
    // офіс: стіни й підлога — у випадному списку категорій (картки в сітці), панелька зверху для офісу не потрібна
    const finSw = f => f.tiles ? (f.motif ? `radial-gradient(circle,${f.motif[0]} 0 18%,transparent 19%),linear-gradient(135deg,${f.tiles[0]} 50%,${f.tiles[1]} 50%)`
        : f.speck ? `radial-gradient(circle at 30% 30%,${f.speck[0]} 0 6%,transparent 7%),radial-gradient(circle at 70% 60%,${f.speck[1]} 0 6%,transparent 7%),linear-gradient(135deg,${f.tiles[0]} 50%,${f.tiles[1]} 50%)`
        : `linear-gradient(135deg,${f.tiles[0]} 50%,${f.tiles[1]} 50%)`)
      : f.two ? `linear-gradient(${f.two[0]} ${Math.round((1 - f.split) * 100)}%,${f.line || f.two[1]} ${Math.round((1 - f.split) * 100)}% ${Math.round((1 - f.split) * 100) + (f.line ? 6 : 0)}%,${f.two[1]} ${Math.round((1 - f.split) * 100) + (f.line ? 6 : 0)}%)`
      : f.pattern === 'brick' ? `repeating-linear-gradient(0deg,${f.color} 0 6px,#7a3a24 6px 7px)` : f.pattern === 'wood' ? `repeating-linear-gradient(90deg,${f.color} 0 8px,#6e4422 8px 9px)`
      : f.pattern === 'stripes' ? `repeating-linear-gradient(90deg,${f.color} 0 6px,#d9c7a3 6px 9px)` : f.color;
    const boxHtml = zone === 'office' ? '' : `
        <!-- «Вид зверху» переїхав у список категорій: «🏞 Пейзаж за вікном» -->
        <div class="bar finish"><b style="white-space:nowrap">🖌 Покриття:</b><div class="swatches">${COVERS.map(cv => `<button type="button" class="sw cov${state.brush === cv.id ? ' on' : ''}" data-cov="${cv.id}" title="${esc(cv.name)} — ${cv.price ? money(cv.price) + ' за клітинку' : 'безкоштовно'}">
            <i style="background:linear-gradient(135deg,${cv.tiles[0]} 50%,${cv.tiles[1]} 50%)"></i><span>${esc(cv.name)}<br><b>${cv.price ? money(cv.price) + '/кл.' : '0'}</b>${cInv[cv.id]?.inv ? `<br><small title="На складі — ставиться без оплати (покриття не продається)">🎒 ${cInv[cv.id].inv} кл.</small>` : ''}</span></button>`).join('')}
          ${state.brush ? '<button type="button" data-act="nobrush" class="sw" style="border-color:#e03131;color:#e03131">✕ Сховати пензель</button>' : ''}</div></div>
        <!-- «Паркани» переїхали у список категорій (другий пункт), підказка — окремим віконцем на сцені під «Ділянка» -->
        ${state.brush === 'wipe' ? '<div class="hint">🌱 Гумка паркан/покриття: клацніть або ведіть мишкою по клітинках — повертається трава, паркани по краях клітинки зникають.</div>' : ''}
        ${state.brush && state.brush !== 'eraser' && state.brush !== 'wipe' && !String(state.brush).startsWith('fence:') ? `<div class="hint">🖌 Пензель «${esc(coverOf(state.brush).name)}»: клацніть або ведіть мишкою з натиснутою кнопкою по клітинках. «Трава» — стерти покриття.</div>` : ''}`;
    // гумка, очистити поле, ділянка (купити / продати ряд) — у жовтому заголовку панелі, поруч з назвою
    const pl = state.plot.draft;
    const plotSellGet = pl.n > state.plot.owned.n ? plotUpgradePrice(pl.n - 1) : sellPrice(plotUpgradePrice(pl.n - 1));
    const rs = state.size.draft;
    const roomSellGet = rs > state.size.owned ? ROOM_UPGRADES[rs] : sellPrice(ROOM_UPGRADES[rs]);
    const toolsHtml = `<div class="ln${zone === 'home' ? ' tight' : ''}"><button type="button" data-act="eraser" class="${state.brush === 'eraser' ? 'on' : ''}" title="Ведіть мишкою з натиснутою кнопкою — речі під курсором йдуть у кошик">🧽 Гумка для речей</button>
      <button type="button" data-act="clear" title="Прибрати всі речі з поля в 🗑 кошик (спершу спитає підтвердження)">🗑 Все в кошик</button>
      ${zone === 'home' ? `<button type="button" data-act="wipe" class="${state.brush === 'wipe' ? 'on' : ''}" title="Ведіть мишкою по клітинках — повертається зелена трава і зникають паркани по краях клітинки">🌱 Гумка паркан/покриття</button>` : ''}</div><div class="ln">
      ${zone === 'home' ? `<b title="Рівень ділянки (максимум ${PLOT_MAX - PLOT_BASE.n + 1})">📐 Ділянка: ${pl.n - PLOT_BASE.n + 1} рівень</b>
        ${pl.n < PLOT_MAX ? `<button type="button" data-act="plotgrow" class="buy" title="Купити ще один ряд ділянки вгору">⬆ Розширити ${money(plotUpgradePrice(pl.n))}</button>` : '<span style="color:#888">максимум</span>'}
        ${pl.n > PLOT_BASE.n ? `<button type="button" data-act="plotshrink" class="sell" title="${pl.n > state.plot.owned.n ? 'Скасувати розширення' : 'Продати верхній ряд ділянки за півціни'}">⬇ ${pl.n > state.plot.owned.n ? 'Скасувати' : 'Продати'} +${money(plotSellGet)}</button>` : ''}`
      : `<b title="Розмір кімнати (максимум ${ROOM_MAX}×${ROOM_MAX})">📐 Офіс: ${rs}×${rs}</b>
        ${rs < ROOM_MAX ? `<button type="button" data-act="grow" class="buy" title="Розширити кімнату до ${rs + 1}×${rs + 1}">⬆ Розширити ${money(ROOM_UPGRADES[rs + 1])}</button>` : '<span style="color:#888">максимум</span>'}
        ${rs > ROOM_BASE ? `<button type="button" data-act="shrink" class="sell" title="${rs > state.size.owned ? 'Скасувати розширення' : `Продати частину офісу (до ${rs - 1}×${rs - 1}) за півціни`}">⬇ ${rs > state.size.owned ? 'Скасувати' : 'Продати'} +${money(roomSellGet)}</button>` : ''}`}</div>`;
    // зверху — ваш баланс (сталий), нижче — скільки витрачено цими змінами і який баланс буде після
    const foot = `<div class="foot"><span class="money">Баланс: <b>${fmtUsd(balUsd())}</b> · <b>${fmtPies(balPies())}</b>
        <br><span class="spent${net.usd < 0 || net.pies < 0 ? ' plus' : ''}">${net.usd <= 0 && net.pies <= 0 && (net.usd || net.pies) ? 'Повернеться' : 'Витрачено'}: <b>${spentText(net)}</b>${net.usd || net.pies ? ` <small>(баланс після: ${fmtUsd(balUsd() - net.usd)} · ${fmtPies(balPies() - net.pies)})</small>` : ''}</span></span>
        <span><button type="button" data-act="undo" ${UNDO.stack.length ? '' : 'disabled'} title="Відмінити останню дію (Ctrl+Z)">↶ Відмінити дію</button> <button type="button" data-act="cancel">Скасувати</button> <button type="button" data-act="preview">👁 Переглянути</button>
        <button type="button" class="save" ${short.usd || short.pies ? 'disabled' : ''}>💾 Зберегти</button></span>
        ${short.usd || short.pies ? `<span class="warn">Не вистачає ${[short.usd ? 'доларів' : '', short.pies ? 'пиріжків' : ''].filter(Boolean).join(' і ')}</span>` : ''}</div>`;
    menu.innerHTML = `<h4>${esc(ZONE_CFG[zone].menuTitle)}</h4>
      ${foot}
      ${state.brush === 'eraser' ? '<div class="hint">🧽 Гумка: ведіть мишкою з натиснутою кнопкою — речі під курсором йдуть у кошик. Вимкнути — ще раз «🧽 Гумка» біля назви панелі.</div>' : ''}
      <div class="bar"><button type="button" data-wheel="${wheel.last || 'pies'}" class="sw wbtn" title="Колесо фортуни: спроба за 1 пиріжок або за ${fmtUsd(PIE_USD)} (вибір — у вікні колеса)">🎡 Колесо фортуни за 1 🥧 / $${PIE_USD / 1000}к</button>
        <button type="button" data-act="won" class="sw" style="padding:5px 9px;white-space:nowrap;font-weight:bold" title="Усе, що ви виграли в колесі удачі (зручно для скріншота)">🎡 Виграш (${wonList().length})</button>
        <button type="button" data-act="bin" class="sw" style="padding:5px 10px;white-space:nowrap;font-weight:bold${state.bin.length ? ';border-color:#e03131;color:#c92a2a;background:#fff5f5' : ''}" title="Прибране з екрана: повернути на місце, у «Куплене» або продати">🗑 Кошик (${state.bin.length})</button>
        <button type="button" data-act="stock" class="sw${state.showStock ? ' on' : ''}" style="padding:5px 10px;white-space:nowrap;font-weight:bold" title="Ваші придбані речі, які зараз не виставлені, і безкоштовні від профсоюзу">🎒 Куплене (${stockCount})</button>
        <select${state.showStock ? ' disabled' : ''}>${groups.map(g => `<option${g === group ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select>
        <button type="button" data-act="sort" class="sw" style="padding:5px 10px;white-space:nowrap" title="Змінити порядок">${state.sortDesc ? '↓ Від дорогих' : '↑ Від дешевих'}</button></div>
      ${selItem ? `<div class="sel">Обрано: <b>${esc(selItem.name)}</b>
          <button type="button" data-act="flip">↔ Дзеркально</button>
          <button type="button" data-act="remove">${wonSet.has(state.selected) ? '🎒 Прибрати (🎡 виграш не продається)' : `🗑 ${selOwned ? `Продати (+${costText(selItem, true)})` : 'Прибрати'}`}</button></div>`
        : `<div class="hint">${state.placing ? `Клацніть на ${byId.get(state.placing)?.place === 'wall' ? 'стіну' : 'вільну клітинку'}, щоб поставити «${esc(byId.get(state.placing)?.name || '')}». <button type="button" data-act="stop" style="padding:2px 8px;border:1px solid #bbb;border-radius:4px;background:#fff;cursor:pointer">✕ Досить ставити</button>` : 'Оберіть річ нижче, потім клацніть клітинку в кімнаті. Клік по речі в кімнаті — вибрати її.'}</div>`}
      <div class="testbar"${isAdmin() ? '' : ' hidden'}>
        <label style="cursor:pointer"><input type="checkbox" data-act="test" ${state.testMode ? 'checked' : ''}> 🛠 Редагувати каталог</label>
        <button type="button" data-act="prizepool" class="sw" style="padding:3px 8px" title="Надіслати на сервер поточний каталог (ціни, видалені моделі) — з нього колесо удачі бере призи">🎡 Оновити призи колеса</button>
        <button type="button" data-act="addmodel" class="sw" style="padding:3px 8px;font-weight:bold" title="Додати в каталог нову модель: картинка з комп'ютера (PNG / WebP) → категорія, розмір, ціна">➕ Додати модель</button>        ${state.testMode ? `<span style="width:100%;color:#555">Клік по клітинці під річчю — вирізати її або повернути (форма «Г»). Щоб додати клітинку з краю — спершу «+», потім вирізати зайві.</span>
          <span>Перевірено в групі: <b>${items.filter(i => i.ok && !i.hidden).length} з ${items.filter(i => !i.hidden).length}</b></span>
          <label style="cursor:pointer"><input type="checkbox" data-act="showhidden" ${state.showHidden ? 'checked' : ''}> показати видалені (${CATALOG.filter(i => i.hidden && i.group === group).length})</label>
          ${unsaved.size ? `<span style="color:#c92a2a;font-weight:bold" title="Речі з незбереженими змінами — натисніть «💾 Зберегти» на їхніх картках">● не збережено: ${unsaved.size}</span>` : ''}
          <span style="color:${state.ovrSaved === 'server' || state.ovrSaved === 'file' ? '#2b8a3e' : '#e67700'}">${state.ovrSaved === 'server' ? '✓ збережено на сервері — бачать усі' : state.ovrSaved === 'file' ? '✓ збережено у файл (сервер не відповів)' : state.ovrSaved === 'local' ? '⚠ сервер не відповів — правки поки тільки в цьому браузері' : ''}</span>` : ''}
      </div>
      ${state.showStock ? `<div class="hint">🎒 Ваші речі, які зараз ніде не стоять, — ставляться без оплати. Прибрати річ сюди: виділіть її і натисніть 🎒 над нею. ${items.length || placedHtml ? '' : '<b>Поки порожньо.</b>'}</div>` : ''}
      ${!allCats ? `<div class="backrow"><button type="button" data-act="allcats" title="Повернутись до всіх категорій">← Назад до категорій</button><b>${esc(state.showStock ? '🎒 Куплене' : group)}</b></div>` : ''}
      <div class="isogrid${state.testMode && !finKey && !allCats ? ' test' : ''}">${allCats ? catCardsHtml(zone, groups.slice(1), FIN_G, finSw) :finKey === 'fence' ?[...[...FENCES].sort((a, b) => dir * (a.price - b.price)), {id: 'erase', name: '🧽 Прибрати паркан', price: 0}].map(f => {
          // паркани: клік — пензель цього паркану (ще раз — сховати); на складі — «🎒 N шт.» і продаж за 50%
          const on = state.brush === 'fence:' + f.id, inv = fInv[f.id]?.inv || 0;
          const prev = f.id === 'erase' ? 'repeating-linear-gradient(45deg,#fff5f5 0 8px,#ffe3e3 8px 16px)'
            : `#f1f3f5 url('data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="44" viewBox="0 0 40 30">${fenceSvg(f.id, {x: 4, y: 26}, {x: 36, y: 18})}</svg>`)}') center/contain no-repeat`;
          return `<div class="isocard fincard${on ? ' on' : ''}" data-fin="${f.id}" data-fkey="fence" title="${esc(f.name)}">
            <div class="finprev" style="background:${prev}"></div><div class="n">${esc(f.name)}</div>
            <div class="p">${f.id === 'erase' ? 'на склад' : `${money(f.price)} / відрізок`}</div>${f.id !== 'erase' ? `<div class="c">${f.open ? 'відкритий' : 'закритий'}</div>` : ''}
            ${inv ? `<div class="c">🎒 на складі: ${inv} шт.</div><button type="button" class="sellstock" data-sellinv="fence:${f.id}">💰 Продати запас<br><b>+${money(sellPrice(f.price) * inv)}</b></button>` : ''}</div>`;
        }).join('') : finKey ? [...(finKey === 'wall' ? WALL_FINISHES : finKey === 'floor' ? FLOOR_FINISHES : HOME_VIEWS)].sort((a, b) => dir * (a.price - b.price)).map(f => {
          const cur = (finKey === 'view' ? state.view.draft : state.finish.draft[finKey]) === f.id, own = state.lib.draft[finKey].includes(f.id);
          const prev = finKey === 'view' ? `url('data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="72" viewBox="0 120 451 270" preserveAspectRatio="xMidYMid slice">${viewSvg(f.id, 451, 340, 300).replace(/#/g, '%23')}</svg>`).replace(/%2523/g, '%23')}') center/cover` : finSw(f);
          return `<div class="isocard fincard${cur ? ' on' : ''}" data-fin="${f.id}" data-fkey="${finKey}" title="${esc(f.name)}">
            <div class="finprev" style="background:${prev}"></div><div class="n">${esc(f.name)}</div>
            <div class="p">${cur && own ? '✓ зараз' : own ? '🎒 ваше' : f.price ? money(f.price) : '🎁 Профсоюзне $0'}</div>
</div>`;   // фарбування / підлога не продаються — куплене просто лишається вашим
        }).join('') : items.map(it => { const su = state.showStock ? stockBy.get(it.id) : null;
        return `<div class="isocard${state.placing === it.id && (state.placingUid || null) === (su ? su[0] : null) ? ' on' : ''}${state.testMode && it.ok ? ' ok' : ''}${it.hidden ? ' gone' : ''}" data-id="${esc(it.id)}"${su ? ` data-stock="${esc(su[0])}"` : ''}>
          ${state.testMode ? miniHtml(it, 230, 200, true) : miniHtml(it, MINI_W, MINI_H)}<div class="n">${!su && !it.free && haveN.get(it.id) ? `<span title="Уже є у вас: ${haveN.get(it.id)} шт. (можна купити ще)">🎒${haveN.get(it.id) > 1 ? `×${haveN.get(it.id)}` : ''}</span> ` : ''}${otherSide(it.id) ? '<span class="sides4" title="4 положення: ↔ дзеркально, ↕ інша сторона (кнопки над поставленою річчю)">↔↕</span> ' : ''}${esc(it.name)}${state.testMode && SIDE_B.has(it.id) ? ' <i style="color:#c92a2a">(сторона Б)</i>' : ''}</div>
          <div class="p">${su ? `${state.draft.stock.some(s => s.id === it.id && s.from === 'wheel') ? '<span title="Виграно в колесі удачі">🎡</span> ' : ''}🎒 ваше${su.length > 1 ? ` × ${su.length}` : ''}` : costText(it)}</div>
          ${su ? (su.find(u => !wonSet.has(u))
            ? `<button type="button" class="sellstock" data-sellstock="${esc(su.find(u => !wonSet.has(u)))}" title="Продати одну за півціни (гроші — при «Зберегти»)">💰 Продати за 50%<br><b>+${costText(it, true)}</b></button>`
            : `<div class="c" style="color:#b07d00" title="Виграні в колесі речі не продаються">🎡 виграш · не продається<br>вартість ${costText(it)}</div>`) : ''}<div class="c">${it.place === 'wall' ? `стіна · ${it.fw} кл.` : `${it.fw}×${it.fd} кл.`}</div>
          ${state.testMode ? `<div class="tst">
            <div class="full"><input data-tin="name" value="${esc(it.name)}" title="Назва (Enter — зберегти)" style="width:100%;box-sizing:border-box;padding:3px 5px;border:1px solid #bbb;border-radius:4px;font:inherit"></div>
            <div class="full"><select data-tin="group" title="Перенести в іншу категорію" style="width:100%;box-sizing:border-box;padding:3px 5px;border:1px solid #bbb;border-radius:4px;font:inherit">${allGroups().map(g => `<option${g === it.group ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select></div>
            ${it.cur === 'pies' ? '' : `<span>ціна $</span><span><input data-tin="price" type="number" min="0" step="1" value="${it.price}" style="width:5.5em;padding:2px 4px;border:1px solid #bbb;border-radius:4px;font:inherit"></span>`}
            ${it.cur === 'pies' || it.plusPies ? `<span>ціна 🥧</span><span><input data-tin="${it.cur === 'pies' ? 'price' : 'pricePies'}" type="number" min="0" step="1" value="${it.cur === 'pies' ? it.price : it.pricePies}" style="width:5.5em;padding:2px 4px;border:1px solid #bbb;border-radius:4px;font:inherit"></span>` : ''}
            <div class="full"><label style="cursor:pointer" title="Тільки пиріжки (без галочок — тільки долари)"><input type="checkbox" data-tin="pies" ${it.cur === 'pies' ? 'checked' : ''}> 🥧 за пиріжки</label></div>
            <div class="full"><label style="cursor:pointer" title="І долари, і пиріжки"><input type="checkbox" data-tin="plusPies" ${it.plusPies ? 'checked' : ''}> ➕ пиріжки (і $, і 🥧)</label></div>
            <div class="full"><label style="cursor:pointer" title="Безкоштовно для всіх"><input type="checkbox" data-tin="free" ${it.free ? 'checked' : ''}> 🎁 За рахунок профсоюза UCAA</label></div>
            ${it.place === 'wall' ? '' : it.standOf ? '<div class="full" style="color:#8a6542">🗄 варіант на підставці (прибрати — зняти галочку в оригіналі)</div>'
              : `<div class="full"><label style="cursor:pointer" title="Додає в список окрему річ «… на підставці»"><input type="checkbox" data-tin="stand" ${overrides[it.id + STAND_SUFFIX] ? 'checked' : ''}> 🗄 на підставці</label></div>`}
            ${it.place === 'wall' ? `<span>ширина</span><span><button data-t="fw" data-d="-1">−</button><span class="v">${it.fw}</span><button data-t="fw" data-d="1">+</button></span>`
              : `<span>↘ fw</span><span><button data-t="fw" data-d="-1">−</button><span class="v">${it.fw}</span><button data-t="fw" data-d="1">+</button></span>
                 <span>↙ fd</span><span><button data-t="fd" data-d="-1">−</button><span class="v">${it.fd}</span><button data-t="fd" data-d="1">+</button></span>`}
            <span>зсув ↔</span><span><button data-t="dx" data-d="4">◀</button><span class="v">${-(overrides[it.id]?.dx || 0)}</span><button data-t="dx" data-d="-4">▶</button></span>
            <span>зсув ↕</span><span><button data-t="dy" data-d="-4">▼</button><span class="v">${overrides[it.id]?.dy || 0}</span><button data-t="dy" data-d="4">▲</button></span>
            <span>масштаб</span><span><button data-t="scale" data-d="-0.1">−</button><span class="v">×${(it.scale || 1).toFixed(1)}</span><button data-t="scale" data-d="0.1">+</button></span>
            <div class="full">${unsaved.has(it.id) || unsaved.has(it.id + STAND_SUFFIX) ? '<button data-t="save" class="tsave on" title="Записати зміни цієї речі на сервер — побачать усі">💾 Зберегти</button>' : `<button data-t="save" class="tsave" title="Записати на сервер (і позначити як перевірену)">${it.ok ? '✓ Збережено' : '💾 Зберегти'}</button>`}<button data-t="reset">↺ Скинути</button><button data-t="place">Поставити</button></div>
            ${it.custom ? `<div class="full"><button data-t="editmodel" title="Нова модель (додана на сайті): змінити картинку, категорію, клітинки, ціну; перевірити на GitHub">✏ Змінити модель${it.custom.gh ? '' : ' · картинка з сервера'}</button></div>` : ''}
            <div class="full">${it.hidden
              ? '<button data-t="hide" style="border-color:#2b8a3e;color:#2b8a3e">↩ Повернути в каталог</button>'
              : '<button data-t="hide" style="border-color:#e03131;color:#e03131">✕ Видалити модель</button>'}</div>
          </div>` : ''}</div>`; }).join('')}${!finKey && placedHtml ? `<div class="placedhead">✓ Уже стоять на екрані</div>${placedHtml}` : ''}</div>`;
    const box = finboxes[zone];
    box.hidden = Boolean(state.preview) || !boxHtml;
    box.innerHTML = boxHtml;
    const tools = zones[zone].querySelector('.isozone-tools');
    tools.innerHTML = state.preview ? '' : toolsHtml;
    // підказка для парканів — окреме віконце вгорі сцени, під «📐 Ділянка: N рівень» (старе прибирається на початку renderMenu)
    if (zone === 'home' && !state.preview && String(state.brush || '').startsWith('fence:')) {
      const fh = document.createElement('div'); fh.className = 'fencehint';
      fh.textContent = state.brush === 'fence:erase' ? '🧽 Ведіть мишкою по парканах — вони прибираються на склад.'
        : `🪵 «${fenceOf(state.brush.slice(6)).name}»: клацніть або ведіть мишкою вздовж ліній між клітинками. Клік по такому самому паркану — прибрати. Паркан нічого не блокує. Вимкнути — ще раз клік по картці паркану.`;
      zones.home.querySelector('.isozone-stage').appendChild(fh);
    }
    const parts = [menu, box, tools];
    const ui = {querySelector: q => parts.map(p => p.querySelector(q)).find(Boolean) || null, querySelectorAll: q => parts.flatMap(p => [...p.querySelectorAll(q)])};

    ui.querySelector('.isogrid').scrollTop = keep;
    ui.querySelectorAll('[data-wheel]').forEach(b => { b.onclick = () => openWheel(b.dataset.wheel); });
    ui.querySelector('[data-act="won"]').onclick = wonModal;
    ui.querySelector('[data-act="bin"]').onclick = () => {
      if (!state.bin.length) { toast('Кошик порожній — прибрані з екрана речі (✕ або гумка) з\'являться тут', zone); return; }
      binModal(zone);
    };
    ui.querySelector('[data-act="stock"]').onclick = () => {
      state.showStock = !state.showStock; state.placing = null; state.placingUid = null;
      renderMenu(); ui.querySelector('.isogrid').scrollTop = 0;
    };
    ui.querySelector('[data-act="sort"]').onclick = () => {
      state.sortDesc = !state.sortDesc;
      localStorage.setItem('devIsoSortDesc', state.sortDesc ? '1' : '');
      renderMenu(); ui.querySelector('.isogrid').scrollTop = 0;
    };
    ui.querySelector('.bar select').onchange =e => { state.group[zone] = e.target.value; state.placing = null; renderMenu(); ui.querySelector('.isogrid').scrollTop = 0; };
    // «💰 Продати за 50%» у «Куплене»: прибираємо одну таку річ зі складу — кошик рахує її як продану
    ui.querySelectorAll('[data-sellstock]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const s = state.draft.stock.find(x => x.uid === b.dataset.sellstock);
      if (!s) return;
      state.draft.stock = state.draft.stock.filter(x => x !== s);
      if (state.placingUid === s.uid) { state.placing = null; state.placingUid = null; }
      toast(`«${byId.get(s.id)?.name || ''}» буде продано при збереженні`, zone);
      renderMenu();
    });
    // «Всі категорії»: клік по картці — відкрити категорію; «← Назад» — повернутись (і з «Куплене» теж)
    ui.querySelectorAll('[data-cat]').forEach(card => card.onclick = () => {
      state.group[zone] = card.dataset.cat; state.placing = null; state.showStock = false;
      renderMenu(); ui.querySelector('.isogrid').scrollTop = 0;
    });
    ui.querySelector('[data-act="allcats"]')?.addEventListener('click', () => {
      state.group[zone] = ALL_CATS; state.placing = null; state.showStock = false; state.brush = state.brush?.startsWith('fence:') ? null : state.brush;
      renderMenu(); ui.querySelector('.isogrid').scrollTop = 0;
    });
    ui.querySelectorAll('.isocard:not(.placed):not(.fincard):not(.catcard)').forEach(card => card.onclick = event => {
      // клік по клітинці міні-підлоги: вирізати / повернути клітинку (форма «Г»)
      const cell = state.testMode && event.target.closest('[data-cell]')?.getAttribute('data-cell');
      if (cell) {
        const id = card.dataset.id, item = byId.get(id);
        const o = overrides[id] ||= {};
        const holes = new Set(o.holes || []);
        if (holes.has(cell)) holes.delete(cell);
        else if (item.fw * item.fd - (item.holes || []).length > 1) holes.add(cell);   // хоч одна клітинка лишається
        o.holes = [...holes];
        if (!o.holes.length) delete o.holes;
        applyOverride(item);
        markUnsaved([id]);
        renderMenu(); renderScene(zone);
        return;
      }
      const t = event.target.closest('[data-t]')?.dataset.t;
      if (state.testMode && t) {
        const id = card.dataset.id, item = byId.get(id), d = Number(event.target.dataset.d || 0);
        if (t === 'editmodel') { if (item?.custom) modelEditor(item.custom); return; }
        const o = overrides[id] ||= {};
        if (t === 'fw') o.fw = Math.max(1, Math.min(9, item.fw + d));
        if (t === 'fd') o.fd = Math.max(1, Math.min(9, item.fd + d));
        if (t === 'dx') o.dx = (o.dx || 0) + d;
        if (t === 'dy') o.dy = (o.dy || 0) + d;
        if (t === 'scale') {
          const v = Math.round(Math.max(0.3, Math.min(4, (item.scale || 1) + d)) * 10) / 10;
          if (v === 1) delete o.scale; else o.scale = v;
        }
        if (t === 'save') o.ok = true;   // «💾 Зберегти» — на сервер (і позначка «перевірено»)
        if (t === 'hide') { o.hidden = !o.hidden; if (!o.hidden) delete o.hidden; }
        if (t === 'reset') { if (item.standOf) overrides[id] = {stand: true}; else delete overrides[id]; }
        if (t !== 'place') {
          applyOverride(item);
          // «💾 Зберегти» і «✕ Видалити модель» — одразу на сервер; решта — чекає «Зберегти»
          if (t === 'save' || t === 'hide') saveOverrides([id, ...(unsaved.has(id + STAND_SUFFIX) ? [id + STAND_SUFFIX] : [])]); else markUnsaved([id]);
          renderMenu(); renderScene(zone);
          return;
        }
      }
      if (state.testMode && !t) return;   // у тест-режимі клік по картці нічого не ставить
      // картка з «Куплене» ставить саме вашу річ (без купівлі); звичайна — купує нову
      const stockUid = card.dataset.stock || null;
      const same = state.placing === card.dataset.id && (state.placingUid || null) === stockUid;
      state.placing = same ? null : card.dataset.id;
      state.placingUid = same ? null : stockUid;
      state.selected = null;
      state.brush = null;
      state.placingFlip = false;
      state.moving = null;
      renderMenu(); renderScene(zone);
    });
    // тест-режим: назва, ціна, «на підставці» → overrides.json
    ui.querySelectorAll('[data-tin]').forEach(inp => inp.onchange = () => {
      const id = inp.closest('.isocard').dataset.id, item = byId.get(id);
      const f = inp.dataset.tin;
      if (f === 'stand') {
        // галочка на оригіналі: створити / прибрати окрему річ «… на підставці» (з тими ж розмірами і зсувами)
        const vid = id + STAND_SUFFIX;
        if (inp.checked) {
          const copy = {...(overrides[id] || {})};
          delete copy.name; delete copy.hidden;
          overrides[vid] = {...copy, stand: true};
        } else delete overrides[vid];
        buildStandVariants();
        markUnsaved([vid]);
        renderMenu(); renderScene(zone);
        return;
      }
      const o = overrides[id] ||= {};
      if (f === 'name') { const v = inp.value.trim(); if (!v || v === item._base.name) delete o.name; else o.name = v; }
      if (f === 'group') { const v = inp.value; if (v === item._base.group) delete o.group; else o.group = v; toast(`📂 «${item.name}» → ${v} (не забудьте «💾 Зберегти»)`); }
      if (f === 'price') { o.price = Math.max(0, Math.round(Number(inp.value) || 0)); }
      // «за пиріжки»: річ продається за 🥧 (без галочки — за $); ціна вводиться заново у вибраній валюті
      if (f === 'pies') { if (inp.checked) { o.pies = true; delete o.plusPies; delete o.pricePies; } else delete o.pies; delete o.price; }
      if (f === 'pricePies') { o.pricePies = Math.max(0, Math.round(Number(inp.value) || 0)); }
      // «+ пиріжки»: і $, і 🥧 (знімає «за пиріжки»)
      if (f === 'plusPies') { if (inp.checked) { o.plusPies = true; if (o.pies) { delete o.pies; delete o.price; } } else { delete o.plusPies; delete o.pricePies; } }
      if (f === 'free') { if (inp.checked) o.free = true; else delete o.free; }
      if (!Object.keys(o).length && !item.standOf) delete overrides[id];
      applyOverride(item);
      markUnsaved([id]);
      renderMenu(); renderScene(zone);
    });
    ui.querySelector('[data-act="test"]').onchange =e => { state.testMode = e.target.checked; renderMenu(); };
    ui.querySelector('[data-act="prizepool"]')?.addEventListener('click', pushPrizePool);
    ui.querySelector('[data-act="addmodel"]')?.addEventListener('click', () => modelEditor(null));
    ui.querySelector('[data-act="showhidden"]')?.addEventListener('change', e => { state.showHidden = e.target.checked; renderMenu(); });

    ui.querySelectorAll('.sw.cov').forEach(b => b.onclick = () => {
      state.brush = state.brush === b.dataset.cov ? null : b.dataset.cov;
      state.placing = null; state.selected = null;
      renderMenu(); renderScene(zone);
    });
    ui.querySelectorAll('.sw.fen').forEach(b => b.onclick = () => {
      const v = 'fence:' + b.dataset.fen;
      state.brush = state.brush === v ? null : v;
      state.placing = null; state.selected = null;
      renderMenu(); renderScene(zone);
    });
    ui.querySelector('[data-act="nobrush"]')?.addEventListener('click', () => { state.brush = null; renderMenu(); });
    ui.querySelector('[data-act="eraser"]')?.addEventListener('click', () => {
      state.brush = state.brush === 'eraser' ? null : 'eraser'; state.placing = null; state.selected = null; renderMenu();
    });
    // гумка дому: покриття → трава + паркани по краях клітинки
    ui.querySelector('[data-act="wipe"]')?.addEventListener('click', () => {
      state.brush = state.brush === 'wipe' ? null : 'wipe'; state.placing = null; state.selected = null; renderMenu(); renderScene(zone);
    });
    ui.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      const cnt = state.draft[zone].length;
      if (!cnt) { toast('На полі немає речей', zone); return; }
      modal('Все в кошик?', `<div>Ви впевнені? Усі <b>${cnt} шт.</b> речей з ${zone === 'office' ? 'офісу' : 'дому'} буде прибрано в 🗑 кошик.</div>
        <div class="note">Нічого не продається одразу: з кошика можна повернути все на місце, покласти в «🎒 Куплене» або продати.</div>`, '🗑 Так, все в кошик', () => {
        [...state.draft[zone]].forEach(p => toBin(zone, p));
        renderScene(zone); renderMenu();
        return null;
      });
    });
    ui.querySelectorAll('[data-binback]').forEach(b => b.onclick = () => {
      const p = state.bin[Number(b.dataset.binback)];
      const item = byId.get(p.id);
      // повертаємо на старе місце, якщо воно вільне
      if (item && (p.wall ? fits(zone, item, p, p.flip, p.uid) : fits(zone, item, p, p.flip, p.uid))) {
        state.bin.splice(Number(b.dataset.binback), 1);
        state.draft[zone].push(p);
        renderScene(zone); renderMenu();
      } else toast('Місце вже зайняте — звільніть його, щоб повернути', zone);
    });
    ui.querySelector('[data-act="binback"]')?.addEventListener('click', () => {
      const keep = [];
      state.bin.forEach(p => { const item = byId.get(p.id); if (item && fits(zone, item, p, p.flip, p.uid)) state.draft[zone].push(p); else keep.push(p); });
      if (keep.length) toast(`${keep.length} не повернуто — місце зайняте`, zone);
      state.bin = keep;
      renderScene(zone); renderMenu();
    });
    ui.querySelector('[data-act="binsell"]')?.addEventListener('click', () => {
      // речі лишаються прибраними — гроші за них прийдуть при «Зберегти»
      state.bin = [];
      renderMenu();
      toast('Прибрані речі буде продано при збереженні', zone);
    });
    ui.querySelectorAll('.sw.view').forEach(b => b.onclick = e => {
      if (e.target.closest('[data-sellview]')) return;
      const prev = state.view.draft, next = b.dataset.view, L = state.lib.draft.view;
      if (prev !== next && !state.lib.owned.view.includes(prev)) { const i = L.indexOf(prev); if (i >= 0) L.splice(i, 1); }
      if (!L.includes(next)) L.push(next);
      state.view.draft = next; renderScene(zone); renderMenu();
    });
    ui.querySelector('[data-act="plotgrow"]')?.addEventListener('click', () => {
      const pl = state.plot.draft;
      if (pl.n >= PLOT_MAX || pl.x0 <= 1) return;
      state.plot.draft = {x0: pl.x0 - 1, y0: pl.y0 - 1, n: pl.n + 1};
      renderScene(zone); renderMenu(); layout();
    });
    ui.querySelector('[data-act="plotshrink"]')?.addEventListener('click', () => {
      const pl = state.plot.draft, nx = {x0: pl.x0 + 1, y0: pl.y0 + 1, n: pl.n - 1};
      if (nx.n < PLOT_BASE.n) return;
      const blocked = state.draft[zone].some(p => { const it = byId.get(p.id); return it && cellsOf(it, p.flip).some(([a, b]) => !inPlot(nx, p.i + a, p.j + b)); });
      if (blocked) { toast('Спершу приберіть речі з верхнього ряду', zone); return; }
      // покриття і паркани, що лишаються за межею, прибираємо (вони продаються як звичайно)
      Object.keys(state.cover.draft).forEach(key => { const [i, j] = key.split(',').map(Number); if (!inPlot(nx, i, j)) delete state.cover.draft[key]; });
      Object.keys(state.fence.draft).forEach(key => { const [i, j, d] = key.split(','); const a = Number(i), b = Number(j);
        if (!inPlot(nx, a, b) && !(d === 'L' ? inPlot(nx, a - 1, b) : inPlot(nx, a, b - 1))) delete state.fence.draft[key]; });
      state.plot.draft = nx;
      renderScene(zone); renderMenu(); layout();
    });
    // вибір у «бібліотеці»: нове (не куплене раніше) додається в покупки; «приміряне й покинуте» — прибирається з покупок
    const pick = (list, prev, next, ownedList) => {
      if (prev !== next && !ownedList.includes(prev)) { const i = list.indexOf(prev); if (i >= 0) list.splice(i, 1); }
      if (!list.includes(next)) list.push(next);
    };
    ui.querySelectorAll('[data-finish] .sw').forEach(b => b.onclick = e => {
      if (e.target.closest('[data-sellfin]')) return;
      const key = b.closest('[data-finish]').dataset.finish;
      pick(state.lib.draft[key], state.finish.draft[key], b.dataset.fin, state.lib.owned[key]);
      state.finish.draft[key] = b.dataset.fin;
      state.finishFocus = null;
      renderScene(zone); renderMenu();
    });
    // картки «Стіни» / «Підлога» у сітці: клік — застосувати (куплене раніше — безкоштовно)
    ui.querySelectorAll('.fincard').forEach(card => card.onclick = e => {
      if (e.target.closest('[data-sellfin],[data-sellinv]')) return;
      const key = card.dataset.fkey, id = card.dataset.fin;
      if (key === 'fence') { const b = 'fence:' + id; state.brush = state.brush === b ? null : b; state.placing = null; state.selected = null; renderMenu(); renderScene(zone); return; }
      if (key === 'view') { pick(state.lib.draft.view, state.view.draft, id, state.lib.owned.view); state.view.draft = id; renderScene(zone); renderMenu(); return; }
      pick(state.lib.draft[key], state.finish.draft[key], id, state.lib.owned[key]);
      state.finish.draft[key] = id;
      renderScene(zone); renderMenu();
    });
    // ручний продаж (💰): оздоблення / вид — прибрати з «бібліотеки»; склад парканів / покриття — продати весь запас цього виду
    const sellIn = (sel, fn) => ui.querySelectorAll(sel).forEach(s => s.onclick = e => { e.stopPropagation(); fn(s); renderMenu(); });
    sellIn('[data-sellfin]', s => { const [key, id] = s.dataset.sellfin.split(':'); const L = state.lib.draft[key], i = L.indexOf(id); if (i >= 0 && state.finish.draft[key] !== id) L.splice(i, 1); toast('Буде продано при «Зберегти»', zone); });
    sellIn('[data-sellview]', s => { const id = s.dataset.sellview, L = state.lib.draft.view, i = L.indexOf(id); if (i >= 0 && state.view.draft !== id) L.splice(i, 1); toast('Буде продано при «Зберегти»', zone); });
    sellIn('[data-sellinv]', s => { const [kind, id] = s.dataset.sellinv.split(':'); const m = state.lib.draft[kind === 'fence' ? 'sellFence' : 'sellCover']; m[id] = (m[id] || 0) + 9999; toast('Запас буде продано при «Зберегти»', zone); });
    ui.querySelectorAll('[data-act="zoom"]').forEach(b => b.onclick = () => {
      state.zoom.draft = Math.round(Math.max(0.5, Math.min(2.5, state.zoom.draft + Number(b.dataset.d))) * 10) / 10;
      renderMenu(); layout();
    });
    ui.querySelector('[data-act="grow"]')?.addEventListener('click', () => {
      state.size.draft = Math.min(ROOM_MAX, state.size.draft + 1);
      renderScene(zone); renderMenu(); layout();
    });
    ui.querySelector('[data-act="shrink"]')?.addEventListener('click', () => {
      const n = state.size.draft - 1;
      // не можна зменшити, якщо щось стоїть у рядах, які зникнуть
      const blocked = state.draft[zone].some(p => {
        const item = byId.get(p.id);
        if (!item) return false;
        if (p.wall) return p.k + item.fw > n;
        const [fw, fd] = dims(item, p.flip);
        return p.i + fw > n || p.j + fd > n;
      });
      if (blocked) { toast('Спершу приберіть речі з нових рядів', zone); return; }
      state.size.draft = Math.max(ROOM_BASE, n);   // нижче купленого — продаж за півціни (рахує кошик)
      renderScene(zone); renderMenu(); layout();
    });
    ui.querySelector('[data-act="stop"]')?.addEventListener('click', () => { state.placing = null; state.hover = null; renderMenu(); renderScene(zone); });
    ui.querySelector('[data-act="flip"]')?.addEventListener('click', () => {
      const item = byId.get(sel.id);
      flipItem(zone, sel); renderScene(zone); renderMenu();
    });
    ui.querySelector('[data-act="remove"]')?.addEventListener('click', () => {
      toBin(zone, sel);   // у кошик — звідти можна повернути
      renderScene(zone); renderMenu(); layout();
    });
    ui.querySelector('[data-act="cancel"]').onclick = closeEdit;
    ui.querySelector('[data-act="undo"]').onclick = undo;
    ui.querySelector('[data-act="preview"]').onclick = () => { state.preview = true; state.placing = null; render(); };
    ui.querySelector('.save').onclick = save;
  }

  function render() {
    loadSaved();
    ensureOpenButton();
    const mine = isMine();
    ZONES.forEach(zone => {
      zones[zone].classList.toggle('plain', !mine || state.preview);
      const title = zones[zone].querySelector('.isozone-title');
      title.innerHTML = `<span>${esc(ZONE_CFG[zone].title)}</span>` +
        (mine ? `<button class="isozone-btn" type="button"${state.editing ? ' style="visibility:hidden"' : ''}>${esc(ZONE_CFG[zone].button)}</button>` : '') +
        // виграш у колесі — бачать усі (щоб ділитись), тільки над «Дім»
        (zone === 'home' && wonList().length && !state.editing ? `<button class="wonlink" type="button" title="Що цей пілот виграв у колесі удачі">🎡 Виграш (${wonList().length})</button>` : '');
      title.querySelector('.isozone-btn')?.addEventListener('click', () => openEdit(zone));
      title.querySelector('.wonlink')?.addEventListener('click', wonModal);
      if (CATALOG.length) renderScene(zone);
    });
    renderMenu();
    layout();
  }

  // ---------- дії ----------
  function openEdit(zone) {
    // поки кабінет не прочитано з сервера — не редагуємо (інакше збереження «з нуля» затерло б справжнє оформлення)
    if (!(profilePilotId() in ACC.data)) { toast('⚠ Сервер кабінету ще не відповів — спробуйте за хвилину.', zone); ensureFile(profilePilotId()); return; }
    state.group[zone] = ALL_CATS; state.showStock = false;   // меню відкривається з «Всі категорії»
    state.draft = clone(state.owned);
    state.size.draft = state.size.owned;
    state.finish.draft = {...state.finish.owned};
    state.zoom.draft = state.zoom.owned;
    state.cover.draft = {...state.cover.owned};
    state.fence.draft = {...state.fence.owned};
    state.brush = null;
    state.plot.draft = {...state.plot.owned};
    state.view.draft = state.view.owned;
    state.lib.draft = libDraft(state.lib.owned);
    state.bin = [];
    state.moving = null; state.placingFlip = false; state.moveUndoFlip = null; state.moveUndoSide = null;
    state.editing = zone;
    state.preview = false; state.placing = null; state.selected = null; state.hover = null;
    UNDO.stack = []; UNDO.cur = null;   // історія дій — з нуля
    render();
  }
  // ---------- чернетка в браузері: автозбереження раз на 30 с, перед закриттям вкладки — ще раз ----------
  const DRAFT_KEY = id => `devIsoDraft1:${id}`;
  let lastDraftJson = '';
  function hasChanges() {
    const zone = state.editing;
    if (!zone) return false;
    const c = cart(zone);
    return JSON.stringify(state.draft[zone]) !== JSON.stringify(state.owned[zone]) || JSON.stringify(state.draft.stock) !== JSON.stringify(state.owned.stock)
      || (zone === 'office' && state.size.draft !== state.size.owned) || (zone === 'home' && state.plot.draft.n !== state.plot.owned.n)
      || JSON.stringify(state.finish.draft) !== JSON.stringify(state.finish.owned) || state.view.draft !== state.view.owned
      || c.covers.cells > 0 || c.fences.segs > 0 || state.bin.length > 0 || JSON.stringify(state.lib.draft) !== JSON.stringify(libDraft(state.lib.owned));
  }
  const draftData = () => ({draft: state.draft, size: state.size.draft, finish: state.finish.draft, zoom: state.zoom.draft, cover: state.cover.draft, fence: state.fence.draft,
    plot: state.plot.draft, view: state.view.draft, lib: state.lib.draft, bin: state.bin});
  function applyDraft(d) {
    d = JSON.parse(JSON.stringify(d));
    state.draft = d.draft; state.size.draft = d.size; state.finish.draft = d.finish; state.zoom.draft = d.zoom; state.cover.draft = d.cover;
    state.fence.draft = d.fence; state.plot.draft = d.plot; state.view.draft = d.view; state.lib.draft = d.lib; state.bin = d.bin || [];
  }
  // «↶ Відмінити дію»: стан після кожної дії запам'ятовується (до 50 кроків); відкат — попередній стан
  const UNDO = {stack: [], cur: null};
  const undoReset = () => { UNDO.stack = []; UNDO.cur = state.editing ? JSON.stringify(draftData()) : null; };
  function undoTick() {   // викликається при кожному перемальовуванні меню
    if (!state.editing) return;
    const json = JSON.stringify(draftData());
    if (UNDO.cur == null) { UNDO.cur = json; return; }
    if (json === UNDO.cur) return;
    UNDO.stack.push(UNDO.cur); if (UNDO.stack.length > 50) UNDO.stack.shift();
    UNDO.cur = json;
  }
  function undo() {
    if (!state.editing || !UNDO.stack.length) return;
    const prev = UNDO.stack.pop();
    applyDraft(JSON.parse(prev)); UNDO.cur = prev;
    state.selected = null; state.moving = null; state.placing = null;
    renderScene(state.editing); renderMenu(); layout();
  }
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && state.editing && !e.target.closest?.('input,textarea')) { e.preventDefault(); undo(); }
  });
  function persistDraft(force) {
    if (!state.editing || !state.auth) return;
    if (!hasChanges()) { localStorage.removeItem(DRAFT_KEY(state.auth)); lastDraftJson = ''; return; }
    const d = draftData();
    const json = JSON.stringify(d);
    if (!force && json === lastDraftJson) return;
    lastDraftJson = json;
    localStorage.setItem(DRAFT_KEY(state.auth), JSON.stringify({zone: state.editing, pilot: state.auth, at: Date.now(), d}));
  }
  const dropDraft = () => { if (state.auth) localStorage.removeItem(DRAFT_KEY(state.auth)); lastDraftJson = ''; };
  setInterval(() => persistDraft(false), 30e3);
  // закриття / перезавантаження вкладки: зберегти чернетку і, якщо є незбережене, — стандартне питання браузера «Покинути сторінку?»
  addEventListener('beforeunload', e => {
    if (!state.editing) return;
    persistDraft(true);
    if (hasChanges()) { e.preventDefault(); e.returnValue = ''; }
  });
  const agoText = ms => { const m = Math.round(ms / 60000);
    if (m < 1) return 'щойно';
    if (m < 60) return `${m} ${m % 10 === 1 && m % 100 !== 11 ? 'хвилину' : [2, 3, 4].includes(m % 10) && ![12, 13, 14].includes(m % 100) ? 'хвилини' : 'хвилин'} тому`;
    const h = Math.round(m / 60); return `${h} год тому`; };
  // після перезавантаження: одне питання «Відновити незбережені зміни від 12:25 (3 хвилини тому)?»
  function offerRestore() {
    if (state.editing || state.draftAsked || !isMine() || !zones.office.classList.contains('show')) return;
    const st = JSON.parse(localStorage.getItem(DRAFT_KEY(state.auth)) || 'null');
    if (!st || st.pilot !== state.auth || !ZONES.includes(st.zone)) return;
    state.draftAsked = true;
    const t = new Date(st.at), hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    modal('Незбережені зміни', `<div>Знайдено незбережені зміни (<b>${st.zone === 'office' ? 'Офіс' : 'Дім'}</b>) від <b>${hm}</b> (${agoText(Date.now() - st.at)}).</div>
      <div>Відновити й продовжити з того самого місця?</div>`, '✓ Відновити', () => {
      openEdit(st.zone);
      applyDraft(st.d);
      lastDraftJson = JSON.stringify(st.d);
      render(); undoReset();
      toast('Зміни відновлено — не забудьте «💾 Зберегти»', st.zone);
      return null;
    });
    const back = [...document.querySelectorAll('.devauth-back')].pop(), cancel = back?.querySelector('[data-act="cancel"]');
    if (cancel) { cancel.textContent = 'Почати заново'; cancel.addEventListener('click', dropDraft); }
  }
  setInterval(offerRestore, 1500);
  function closeEdit() {
    dropDraft();   // «Скасувати» — свідомо відмовився від змін
    state.draft = clone(state.owned);
    state.size.draft = state.size.owned;
    state.finish.draft = {...state.finish.owned};
    state.zoom.draft = state.zoom.owned;
    state.cover.draft = {...state.cover.owned};
    state.fence.draft = {...state.fence.owned};
    state.brush = null;
    state.plot.draft = {...state.plot.owned};
    state.view.draft = state.view.owned;
    state.lib.draft = libDraft(state.lib.owned);
    state.bin = [];
    state.moving = null; state.placingFlip = false; state.moveUndoFlip = null; state.moveUndoSide = null;
    state.editing = null; state.preview = false; state.placing = null; state.selected = null;
    render();
  }

  function modal(title, bodyHtml, okText, onOk, cls = '') {
    const back = document.createElement('div');
    back.className = 'devauth-back';
    back.innerHTML = `<div class="devauth${cls ? ' ' + cls : ''}"><h3>${esc(title)}</h3><div class="body">${bodyHtml}<div class="err"></div>
      <div class="row"><button type="button" data-act="cancel">Скасувати</button><button type="button" class="ok">${esc(okText)}</button></div></div></div>`;
    const close = () => back.remove();
    // клік повз вікно НЕ закриває його (щоб випадково не втратити введений пароль) — тільки кнопка «Скасувати»
    back.querySelector('[data-act="cancel"]').onclick = close;
    // onOk може бути async (запит до сервера) — поки чекаємо, кнопка неактивна
    const okBtn = back.querySelector('.ok');
    let busy = false;
    const submit = async () => {
      if (busy) return;
      busy = true; okBtn.disabled = true;
      let err;
      try { err = await onOk(back); } catch (e) { console.error(e); err = 'Помилка: ' + e.message; }
      busy = false; okBtn.disabled = false;
      if (err) back.querySelector('.err').textContent = err; else close();
    };
    okBtn.onclick = submit;
    back.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    document.body.appendChild(back);
    back.querySelector('input:not([readonly])')?.focus();
  }

  // Вікно «🗑 Кошик»: прибране з екрана; для кожної речі — на місце / у «Куплене» / продати; внизу — для всіх разом
  function binModal(zone) {
    const back = document.createElement('div');
    back.className = 'devauth-back';
    const ownedUids = () => new Set([...state.owned.office, ...state.owned.home, ...state.owned.stock].map(p => p.uid));
    const place = zone === 'office' ? '↩ В офіс' : '↩ На поле';                                   // для однієї речі
    const placeAll = zone === 'office' ? '↩ Повернути в «Офіс»' : '↩ Повернути на поле «Дім»';    // для всіх
    const refresh = () => { renderScene(zone); renderMenu(); layout(); };
    const draw = (err = '') => {
      if (!state.bin.length) { back.remove(); refresh(); return; }
      const own = ownedUids();
      const sum = {usd: 0, pies: 0};
      state.bin.forEach(p => { const it = byId.get(p.id); if (it && own.has(p.uid)) { sum.usd += sellPrice(it.cost.usd); sum.pies += sellPrice(it.cost.pies); } });
      back.innerHTML = `<div class="devauth receipt wide"><h3>🗑 Кошик прибраного</h3><div class="body">
        <div class="note">Тут речі, які ви прибрали з екрана (${zone === 'office' ? 'офіс' : 'дім'}). Поверніть їх на місце, у «🎒 Куплене» або продайте за 50%. Гроші — при «💾 Зберегти».</div>
        <div class="rows">${state.bin.map((p, n) => { const it = byId.get(p.id); const mine = own.has(p.uid);
          return `<div class="r binr"><span>${it ? `<img src="${it.src}" alt="">` : ''}${esc(it?.name || p.id)}<br><small>${mine ? `продаж: +${costText(it, true)}` : 'ще не куплено — просто прибрати'}</small></span>
            <span class="acts"><button type="button" data-b="back" data-n="${n}" title="Поставити туди, де стояла">${place}</button><button type="button" data-b="stock" data-n="${n}" title="Не продавати — покласти в «🎒 Куплене»">🎒 У куплене</button><button type="button" data-b="sell" data-n="${n}" class="sell">${mine ? '💰 Продати' : '✕ Прибрати'}</button></span></div>`; }).join('')}</div>
        <div class="sum"><span>У кошику:</span><b>${state.bin.length} шт.</b><span>Якщо продати все:</span><b class="pos">+${both(sum)}</b></div>
        <div class="err">${esc(err)}</div>
        <div class="row" style="flex-wrap:wrap"><button type="button" data-b="close">Скасувати</button><button type="button" data-b="allback">${placeAll}</button><button type="button" data-b="allstock">🎒 Все у куплене</button><button type="button" data-b="allsell" class="ok" style="background:#e03131;border-color:#e03131">💰 Продати все</button></div></div></div>`;
    };
    const backOne = p => { const it = byId.get(p.id); if (!it || !fits(zone, it, p, p.flip, p.uid)) return false; state.draft[zone].push(p); return true; };
    back.addEventListener('click', e => {
      if (e.target === back) { back.remove(); refresh(); return; }
      const b = e.target.closest('[data-b]');
      if (!b) return;
      const act = b.dataset.b, n = Number(b.dataset.n);
      let err = '';
      if (act === 'close') { back.remove(); refresh(); return; }
      if (act === 'back') { if (backOne(state.bin[n])) state.bin.splice(n, 1); else err = 'Місце вже зайняте — звільніть його або покладіть річ у «🎒 Куплене»'; }
      if (act === 'stock') { const [p] = state.bin.splice(n, 1); state.draft.stock.push({uid: p.uid, id: p.id}); }
      if (act === 'sell') { state.bin.splice(n, 1); }   // лишається прибраною — продається при «Зберегти»
      if (act === 'allback') { const keep = state.bin.filter(p => !backOne(p)); if (keep.length) err = `${keep.length} не повернуто — місце зайняте`; state.bin = keep; }
      if (act === 'allstock') { state.bin.forEach(p => state.draft.stock.push({uid: p.uid, id: p.id})); state.bin = []; }
      if (act === 'allsell') { state.bin = []; toast('Прибрані речі буде продано при збереженні', zone); }
      refresh();
      draw(err);
    });
    draw();
    document.body.appendChild(back);
  }

  function toast(text, zone) {
    const el = Object.assign(document.createElement('div'), {className: 'devtoast', textContent: text});
    document.body.appendChild(el);
    const box = zone && zones[zone]?.classList.contains('show') ? zones[zone].getBoundingClientRect() : null;
    if (box) {
      el.style.left = `${box.left + box.width / 2}px`;
      const above = box.top - GAP - el.offsetHeight >= 0;
      el.style.top = `${above ? box.top - GAP : box.top + GAP}px`;
      el.style.transform = above ? 'translate(-50%,-100%)' : 'translate(-50%,0)';
    } else Object.assign(el.style, {left: '50%', top: '20px', transform: 'translateX(-50%)'});
    setTimeout(() => el.remove(), 2500);
  }

  // ---------- вхід (сервер на Railway) ----------
  // Логін = ID NewSky або нікнейм (без різниці великих/малих) — перевіряє сервер. Паролі видає Дмитро (/admin на сервері),
  // при першому вході сервер повертає mustChange → вікно «Змініть пароль». Вхід пам'ятається (localStorage, токен на 30 днів).
  const AUTH_NAME_KEY = 'devCabinetAuthName', AUTH_AVA_KEY = 'devCabinetAuthAvatar', AUTH_ADMIN_KEY = 'devCabinetAuthAdmin';
  // адмін сайту (позначка в /admin на сервері): бачить «🛠 Редагувати каталог» з усіма правками каталогу
  function isAdmin() { return Boolean(state.auth) && localStorage.getItem(AUTH_ADMIN_KEY) === '1'; }
  function setAdmin(v) {
    const was = isAdmin();
    localStorage.setItem(AUTH_ADMIN_KEY, v ? '1' : '0');
    if (was !== isAdmin() && state.editing) renderMenu();
    if (was !== isAdmin()) ensureHeaderLogin();
  }
  const PW_RULES = 'англійські букви і цифри, мінімум 7 символів, хоча б одна цифра';
  const pwProblem = pw => pw.length < 7 ? 'Пароль — мінімум 7 символів.' : !/^[A-Za-z0-9]+$/.test(pw) ? 'Тільки англійські букви і цифри (без пробілів і значків).'
    : !/\d/.test(pw) ? 'Потрібна хоча б одна цифра.' : !/[A-Za-z]/.test(pw) ? 'Потрібна хоча б одна англійська буква.' : null;
  // аватарка NewSky за ID пілота — з польотів сайту
  async function pilotAvatar(id) {
    try {
      const b = await window.UCAAFlightData?.loadWeeklyFlights?.();
      let av = 'default';
      (b?.flights || []).forEach(f => { const a = String(f?.pilot?.avatar || '').trim(); if (String(f?.pilot?.id) === id && a && a !== 'null' && a !== 'default') av = a; });
      return av;
    } catch (e) { return 'default'; }
  }
  function setAuth(id, name, token) {
    state.auth = id;
    state.loadedFor = undefined;                             // перечитати профіль з урахуванням входу
    localStorage.setItem(AUTH_KEY, id);
    localStorage.setItem(AUTH_NAME_KEY, name);
    if (token) localStorage.setItem(TOKEN_KEY, token);
  }
  // обов'язкова зміна пароля після першого входу (і за бажанням — потім)
  function changePasswordModal(oldPw, forced) {
    modal(forced ? 'Змініть пароль' : 'Зміна пароля', `
      ${forced ? '<div>Це перший вхід — придумайте свій пароль замість виданого.</div>' : ''}
      <input type="text" name="username" autocomplete="username" value="${esc(localStorage.getItem(AUTH_NAME_KEY) || state.auth)}" hidden>
      ${oldPw ? '' : '<label>Старий пароль<input type="password" data-k="old" autocomplete="current-password"></label>'}
      <label>Новий пароль<input type="password" data-k="new" autocomplete="new-password"></label>
      <label>Ще раз<input type="password" data-k="new2" autocomplete="new-password"></label>
      <div class="note">Вимоги: ${PW_RULES}.</div>`, 'Зберегти пароль', async back => {
      const v = k => back.querySelector(`[data-k="${k}"]`)?.value || '';
      const old = oldPw || v('old'), nw = v('new');
      const bad = pwProblem(nw) || (nw !== v('new2') ? 'Паролі не збігаються.' : null);
      if (bad) return bad;
      const res = await api('/password', {old, new: nw});
      if (!res.ok) return res.error;
      localStorage.setItem(TOKEN_KEY, res.data.token);
      toast('Пароль змінено ✓');
      return null;
    });
    addPwEyes([...document.querySelectorAll('.devauth-back')].pop());
  }
  // «👁» справа в полі пароля: показати / сховати те, що вводиш
  function addPwEyes(root) {
    root?.querySelectorAll('input[type=password]').forEach(inp => {
      if (inp.dataset.eye) return;
      inp.dataset.eye = '1';
      const wrap = Object.assign(document.createElement('span'), {className: 'pweye-wrap'});
      inp.replaceWith(wrap); wrap.appendChild(inp);
      const b = Object.assign(document.createElement('button'), {type: 'button', className: 'pweye', title: 'Показати пароль', textContent: '👁'});
      b.onclick = () => { const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; b.classList.toggle('on', show); b.title = show ? 'Сховати пароль' : 'Показати пароль'; inp.focus(); };
      wrap.appendChild(b);
    });
  }
  // відкрили сторінку — перевіряємо, чи вхід ще дійсний
  if (state.auth) api('/me').then(res => {
    if (res.status === 401 || res.status === 403) { logout(); return; }
    if (!res.ok) return;
    setAdmin(res.data.isAdmin);
    if (res.data.mustChange) changePasswordModal(null, true);
  });

  function ensureHeaderLogin() {
    const head = document.querySelector('header.topline');
    if (!head) return;
    let box = head.querySelector('.devlogin');
    if (!box) { box = Object.assign(document.createElement('div'), {className: 'devlogin'}); head.appendChild(box); }
    const free = freeSpinNow();
    const mode = state.auth ? `in:${state.auth}:${isAdmin() ? 'a' : ''}:${free ? 'f' : ''}` : 'out';
    if (box.dataset.mode === mode) return;
    box.dataset.mode = mode;
    if (state.auth) {
      const av = localStorage.getItem(AUTH_AVA_KEY) || 'default';
      // з 🎡 рядок не влазить у 260 px — тоді коротко «(адм.)»
      const adm = isAdmin() ? `${free ? '' : ' '}<a class="adm" href="${API}/admin" target="_blank" rel="noopener" title="Адмінка сервера кабінету"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 22s8-4 8-12V5l-8-3-8 3v5c0 8 8 12 8 12z"/><path d="m9 12 2 2 4-4"/></svg>${free ? 'Адм.' : 'Адмінка'}</a>` : '';
      // 🎡 — є безкоштовна прокрутка на сьогодні: клік = свій профіль → «Облаштувати» → вікно колеса
      const fw = free ? `<button type="button" class="fwheel" title="Сьогодні є безкоштовна прокрутка колеса фортуни — натисніть, щоб крутити"><img class="pieic" src="${WHEEL_ICON}" alt="🎡"></button>` : '';
      box.innerHTML = `<div class="me"><div class="devlogin-identity">
        <img class="ava" alt="" src="https://newsky.app/api/pilot/avatar/${encodeURIComponent(av)}"
          onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='https://newsky.app/api/pilot/avatar/default'}">
        <div class="devlogin-person"><b class="nm" title="${esc(localStorage.getItem(AUTH_NAME_KEY) || state.auth)}">${esc(localStorage.getItem(AUTH_NAME_KEY) || state.auth)}</b>
          <span class="cap"><span class="capt">✈ Пілот UCAA</span>${fw}${adm}</span></div></div>
        <div class="row"><button type="button" class="prof"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>Мій профіль</button><button type="button" class="out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 17l5-5-5-5m5 5H3m11-8h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/></svg>Вийти</button></div></div>`;
      box.querySelector('.out').onclick = logout;
      // аватарка в шапці → налаштування NewSky (там міняється аватарка)
      const avaImg = box.querySelector('.ava');
      avaImg.title = 'Змінити аватарку';
      avaImg.onclick = () => window.open('https://newsky.app/pilot/settings', '_blank', 'noopener');
      box.querySelector('.prof').onclick = () => { location.hash = `#profile/${encodeURIComponent(state.auth)}`; };
      const fwb = box.querySelector('.fwheel');
      if (fwb) fwb.onclick = openFreeWheel;
      // тестовий «Містер Кеш» (для відео-інструкцій): клік по «✈ Пілот UCAA» повертає безкоштовну прокрутку на сьогодні
      if (FREE_RESET_IDS.includes(state.auth)) {
        const capt = box.querySelector('.capt');
        capt.style.cursor = 'pointer';
        capt.title = 'Тест: повернути безкоштовну прокрутку колеса на сьогодні';
        capt.onclick = async () => {
          const res = await api('/free-reset', {});
          if (!res.ok) { toast(`⚠ ${res.error}`); return; }
          if (wheel.data) wheel.data.limits = res.data.limits;
          freeCheck = {at: Date.now(), auth: state.auth};
          ensureHeaderLogin();
          toast('🎁 Безкоштовну прокрутку повернуто');
        };
      }
      return;
    }
    box.innerHTML = `<form method="post" action="#" autocomplete="on">
      <span class="cap">✈ Вхід для пілотів</span>
      <div class="row"><input name="username" type="text" autocomplete="username" placeholder="ID NewSky або нікнейм" required><span class="help" tabindex="0" aria-label="Що вводити?">?<span class="tip">
        <b>Логін</b> — ваш ID пілота NewSky (як в адресі профілю: #profile/…) або нікнейм, як у NewSky. Великі чи малі букви — неважливо.<br>
        <b>Пароль</b> — надсилає адміністратор в особисті NewSky. При першому вході сайт попросить змінити його на свій.</span></span></div>
      <div class="row"><input name="password" type="password" autocomplete="current-password" placeholder="Пароль"><button type="submit" class="yel">Увійти</button></div>
      <div class="err" hidden></div></form>`;
    const form = box.querySelector('form');
    const help = form.querySelector('.help');
    help.onclick = e => { e.stopPropagation(); help.classList.toggle('open'); };   // на телефоні — по кліку
    document.addEventListener('click', () => help.classList.remove('open'));
    // спливаюче повідомлення про помилку ховається, щойно починаєте виправляти, або по кліку на нього
    const errBox = form.querySelector('.err');
    form.addEventListener('input', () => { errBox.hidden = true; });
    errBox.onclick = () => { errBox.hidden = true; };
    form.onsubmit = async e => {
      e.preventDefault();
      const err = form.querySelector('.err');
      const show = t => { err.textContent = t; err.hidden = !t; };
      const btn = form.querySelector('button');
      const login = form.elements.username.value.trim(), pw = form.elements.password.value;
      if (!login || !pw) return show('Введіть логін і пароль.');
      show(''); btn.disabled = true;
      const res = await api('/login', {login, password: pw});
      if (!res.ok) { btn.disabled = false; return show(res.error); }
      const {id, name, token, mustChange, isAdmin: adm} = res.data;
      localStorage.setItem(AUTH_ADMIN_KEY, adm ? '1' : '0');
      localStorage.setItem(AUTH_AVA_KEY, await pilotAvatar(id));
      btn.disabled = false;
      setAuth(id, name, token);
      ensureHeaderLogin();                                   // форма зникає — браузер вважає вхід успішним і пропонує зберегти пароль
      render();                                              // лишаємось на тій самій сторінці (у профіль — кнопка «Мій профіль»)
      if (mustChange) changePasswordModal(pw, true);
    };
  }

  // «(увійти)» біля заголовка профілю — підставляє ID цього пілота у форму в шапці
  function login() {
    if (state.auth) logout();
    ensureHeaderLogin();
    const f = document.querySelector('.devlogin form');
    if (!f) return;
    const id = profilePilotId();
    if (id) f.elements.username.value = id;
    (id ? f.elements.password : f.elements.username).focus();
    f.scrollIntoView({block: 'nearest'});
  }

  function logout() {
    Object.assign(state, {auth: null, editing: null, preview: false, changedThisSession: false, loadedFor: undefined});
    [AUTH_KEY, AUTH_NAME_KEY, AUTH_AVA_KEY, AUTH_ADMIN_KEY, TOKEN_KEY].forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k); });
    sessionStorage.removeItem('devCabinetChanged');
    ensureHeaderLogin();
    render();
  }

  function save() {
    const zone = state.editing;
    const c = cart(zone);
    const moved = JSON.stringify(state.draft[zone]) !== JSON.stringify(state.owned[zone]) || JSON.stringify(state.draft.stock) !== JSON.stringify(state.owned.stock) || (zone === 'office' && state.size.draft !== state.size.owned) || c.finishes.length > 0 || state.zoom.draft !== state.zoom.owned || c.covers.cells > 0 || (zone === 'home' && state.plot.draft.n !== state.plot.owned.n) || Boolean(c.view) || c.fences.segs > 0
      || JSON.stringify(state.finish.draft) !== JSON.stringify(state.finish.owned) || state.view.draft !== state.view.owned
      || JSON.stringify(state.lib.draft) !== JSON.stringify(libDraft(state.lib.owned));
    if (!moved) { closeEdit(); return; }
    // Чек: що купуєте, що продаєте (за півціни), що прибрано в «Куплене», і підсумок — кожне з нового рядка
    const buyRows = [], sellRows = [];
    const lvl = n => n - PLOT_BASE.n + 1;
    // однакові речі — одним рядком «× N»
    const grouped = (list, half) => { const m = new Map(); list.forEach(i => { const k = i.id; m.set(k, {i, n: (m.get(k)?.n || 0) + 1}); });
      return [...m.values()].map(({i, n}) => [`${esc(i.name)}${n > 1 ? ` × ${n}` : ''}`, half ? both({usd: sellPrice(i.cost.usd) * n, pies: sellPrice(i.cost.pies) * n}) : i.free ? '🎁 $0' : both({usd: i.cost.usd * n, pies: i.cost.pies * n})]); };
    buyRows.push(...grouped(c.bought, false));
    if (c.room) buyRows.push([`Розширення офісу до ${state.size.draft}×${state.size.draft}`, money(c.room)]);
    if (c.plot) buyRows.push([`Розширення ділянки до ${lvl(state.plot.draft.n)} рівня`, money(c.plot)]);
    c.finishes.forEach(f => buyRows.push([`${f.label}: «${esc(f.name)}»`, money(f.price)]));
    if (c.view) buyRows.push([`Вид: «${esc(c.view.name)}»`, money(c.view.price)]);
    if (c.covers.buy) buyRows.push([`Покриття землі (${c.covers.cells} кл.)`, money(c.covers.buy)]);
    if (c.fences.buy) buyRows.push([`Паркани`, money(c.fences.buy)]);
    sellRows.push(...grouped(c.sold, true));
    if (c.roomRefund) sellRows.push([`Частина офісу (тепер ${state.size.draft}×${state.size.draft})`, money(c.roomRefund)]);
    if (c.plotRefund) sellRows.push([`Частина ділянки (тепер ${lvl(state.plot.draft.n)} рівень)`, money(c.plotRefund)]);
    c.finSold.forEach(f => sellRows.push([`${f.label}: «${esc(f.name)}»`, money(f.refund)]));
    c.viewSold.forEach(v => sellRows.push([`Вид «${esc(v.name)}»`, money(v.refund)]));
    if (c.covers.refund) sellRows.push([`Покриття зі складу (${c.covers.sold} кл.)`, money(c.covers.refund)]);
    if (c.fences.refund) sellRows.push([`Паркани зі складу (${c.fences.sold} шт.)`, money(c.fences.refund)]);
    const ownedStock = new Set(state.owned.stock.map(s => s.uid)), draftStock = new Set(state.draft.stock.map(s => s.uid));
    const toStockN = state.draft.stock.filter(s => !ownedStock.has(s.uid)).length;
    const fromStockN = state.owned.stock.filter(s => !draftStock.has(s.uid)).length;
    // склад парканів / покриття — теж у розділ «🎒 Куплене»
    const invRows = [...(c.fences.toInv ? [[`Паркани — на склад`, `${c.fences.toInv} шт.`]] : []), ...(c.fences.fromInv ? [[`Паркани зі складу (без оплати)`, `${c.fences.fromInv} шт.`]] : []),
      ...(c.covers.toInv ? [[`Покриття — на склад`, `${c.covers.toInv} кл.`]] : []), ...(c.covers.fromInv ? [[`Покриття зі складу (без оплати)`, `${c.covers.fromInv} кл.`]] : [])];
    const rowsHtml = (rows, plus) => `<div class="rows">${rows.map(([a, b]) => `<div class="r${plus ? ' plus' : ''}"><span>${a}</span><span>${plus ? '+' : ''}${b}</span></div>`).join('')}</div>`;
    const net = c.net;
    const after = {usd: balUsd() - net.usd, pies: balPies() - net.pies};
    modal('Зберегти зміни', `
      ${buyRows.length ? `<div class="sec">🛒 Купуєте</div>${rowsHtml(buyRows)}` : ''}
      ${sellRows.length ? `<div class="sec">💰 Продаєте (за півціни)</div>${rowsHtml(sellRows, true)}` : ''}
      ${toStockN || fromStockN || invRows.length ? `<div class="sec">🎒 Куплене</div><div class="rows">${toStockN ? `<div class="r"><span>Прибрано без продажу</span><span>${toStockN} шт.</span></div>` : ''}${fromStockN ? `<div class="r"><span>Поставлено з купленого (без оплати)</span><span>${fromStockN} шт.</span></div>` : ''}${invRows.map(([a, b]) => `<div class="r"><span>${a}</span><span>${b}</span></div>`).join('')}</div>` : ''}
      ${state.bin.length ? `<div class="binwarn">⚠ У 🗑 кошику ${state.bin.length} шт. — їх буде <b>продано</b> за 50%. Не хочете продавати? <button type="button" data-openbin>Відкрити кошик</button></div>` : ''}
      ${!buyRows.length && !sellRows.length && !toStockN && !fromStockN && !invRows.length ? '<div>Тільки переставлено речі — нічого не купується і не продається.</div>' : ''}
      <div class="sum"><span>Баланс зараз:</span><b>${fmtUsd(balUsd())} · ${fmtPies(balPies())}</b>
        <span>${net.usd <= 0 && net.pies <= 0 && (net.usd || net.pies) ? 'Повернеться:' : 'Витрачено:'}</span><b class="${net.usd > 0 || net.pies > 0 ? 'neg' : 'pos'}">${spentText(net)}</b>
        <span>Баланс після:</span><b>${fmtUsd(after.usd)} · ${fmtPies(after.pies)}</b></div>
      <label>Пароль для підтвердження<input type="password" autocomplete="current-password" placeholder="Пароль"></label>`, '💾 Зберегти', async back => {
      const pw = back.querySelector('input[type="password"]').value;
      if (!pw) return 'Введіть пароль.';
      const chk = await api('/login', {login: state.auth, password: pw});   // підтвердження паролем (той самий, що для входу)
      if (!chk.ok) return chk.status === 401 ? 'Невірний пароль.' : chk.error;
      localStorage.setItem(TOKEN_KEY, chk.data.token);
      // якщо сервер не прийме — повертаємо все як було (редагування лишається відкритим)
      const snap = clone({owned: state.owned, lib: state.lib, size: state.size, finish: state.finish, zoom: state.zoom, cover: state.cover,
        plot: state.plot, view: state.view, fence: state.fence, spent: state.spent, spentUsd: state.spentUsd, bin: state.bin});
      // склад парканів / покриття — рахуємо ДО того, як draft стане owned
      const invF = zone === 'home' ? invCalc('fence') : null, invC = zone === 'home' ? invCalc('cover') : null;
      const invOf = (r, old) => r ? Object.fromEntries(Object.entries(r.res).filter(([, x]) => x.inv > 0).map(([s, x]) => [s, x.inv])) : {...old};
      const L = state.lib.draft;
      state.lib.owned = {wall: [...L.wall], floor: [...L.floor], view: [...L.view], fence: invOf(invF, state.lib.owned.fence), cover: invOf(invC, state.lib.owned.cover)};
      state.lib.draft = libDraft(state.lib.owned);
      state.owned[zone] = clone(state.draft[zone]);
      state.owned.stock = clone(state.draft.stock);
      if (zone === 'office') { state.size.owned = state.size.draft; state.finish.owned = {...state.finish.draft}; }
      if (zone === 'home') { state.zoom.owned = state.zoom.draft; state.cover.owned = {...state.cover.draft}; state.plot.owned = {...state.plot.draft}; state.view.owned = state.view.draft; state.fence.owned = {...state.fence.draft}; state.bin = []; }
      state.spentUsd += net.usd; state.spent += net.pies;
      // запис на сервер: новий стан + що куплено / продано і на скільки
      const res = await pushAccount(state.auth, {zone, usd: net.usd, pies: net.pies, bought: c.bought.map(i => i.id), sold: c.sold.map(i => i.id),
        extra: [c.room && 'office-size', c.plot && 'plot', c.finishes.length && 'finish', c.view && 'view', c.covers.buy && 'covers', c.fences.buy && 'fences'].filter(Boolean)});
      if (!res.ok) { Object.assign(state, snap); return `Не збережено: ${res.error}`; }
      localStorage.setItem(SAVE_KEY(state.auth), JSON.stringify(saveObj()));   // запасна копія в браузері
      Object.assign(state, {editing: null, preview: false, placing: null, selected: null, changedThisSession: true});
      sessionStorage.setItem('devCabinetChanged', '1');
      render();
      localStorage.removeItem(DRAFT_KEY(state.auth)); lastDraftJson = '';   // збережено — чернетка більше не потрібна
      toast(net.usd || net.pies ? `Збережено ✓ ${signedBoth(net)}` : 'Збережено ✓', zone);
      return null;
    }, 'receipt');
    // «Відкрити кошик» з попередження: закриваємо чек і відкриваємо кошик
    const rb = [...document.querySelectorAll('.devauth-back')].pop();
    rb?.querySelector('[data-openbin]')?.addEventListener('click', () => { rb.remove(); binModal(zone); });
  }

  // ---------- 🎡 колесо удачі (з 26.11.2026) ----------
  // Кнопки «🎡 1 🥧» і «🎡 $4к» — у меню «Облаштувати» перед «Кошик / Куплене» (тимчасово). Колесо відкривається великим по центру екрана.
  // Приз вибирає СЕРВЕР (POST /spin), тут — лише анімація: колесо категорій → стрічка з предметами категорії → приз у «🎒 Куплене» (🎡).
  const PIE_USD = 4000;   // 1 🥧 = $4 000 — скрізь у колесі (той самий курс, що на сервері)
  const WHEEL_COLORS = ['#ffd43b', '#74c0fc', '#ff8787', '#8ce99a', '#b197fc', '#ffa94d', '#63e6be', '#f783ac', '#a9e34b', '#4dabf7', '#e599f7', '#ffe066', '#66d9e8', '#ff922b', '#c0eb75', '#91a7ff'];
  const wheel = {data: null, tried: 0, busy: false, rot: {pies: 0, usd: 0}};
  // виграні речі пілота, чий профіль відкрито (сервер веде doc.wheel.won [{uid, id, t, wheel}])
  // + речі з «Куплене» з позначкою from: 'wheel', виграні до появи списку won (без дати)
  function wonList() {
    const d = ACC.data[profilePilotId()];
    const won = d?.wheel?.won || [], have = new Set(won.map(x => x.uid));
    return [...(d?.stock || []).filter(s => s.from === 'wheel' && !have.has(s.uid)).map(s => ({uid: s.uid, id: s.id, t: null, wheel: ''})), ...won];
  }
  function wonUids() { return new Set(wonList().map(x => x.uid)); }
  // «🎡 Мій виграш» — усі виграні речі однією сіткою (зручно для скріншота)
  function wonModal() {
    const won = [...wonList()].reverse();
    const where = new Map();
    [['office', 'в офісі'], ['home', 'вдома'], ['stock', 'у «Куплене»']].forEach(([k, label]) => (state.editing ? state.draft : state.owned)[k]?.forEach(p => where.set(p.uid, label)));
    const sum = won.reduce((s, x) => s + ((byId.get(x.id)?.cost.usd || 0) + (byId.get(x.id)?.cost.pies || 0) * PIE_USD), 0);
    const cards = won.map(x => { const it = byId.get(x.id); if (!it) return '';
      return `<div class="wwon${where.has(x.uid) ? '' : ' gone'}"><img src="${it.src}" alt=""><b>${esc(it.name)}</b><span>${costText(it)}</span>
        <i>${x.t ? `${new Date(x.t).toLocaleDateString('uk-UA', {day: '2-digit', month: '2-digit'})} · ` : ''}${x.wheel ? `${x.wheel === 'pies' ? 'за 🥧' : 'за $'} · ` : ''}${where.get(x.uid) || 'продано'}</i></div>`; }).join('');
    modal(`🎡 Виграш у колесі: ${esc(profileName())}`, won.length
      ? `<div class="note">Усього ${won.length} шт. на ~${fmtUsd(sum)}.</div><div class="wwongrid">${cards}</div>`
      : '<div class="note">Поки нічого не виграно — крутніть колесо 🎡</div>', 'Закрити', () => null, 'receipt wide');
    const b = [...document.querySelectorAll('.devauth-back')].pop();
    const c = b?.querySelector('[data-act="cancel"]');
    if (c) c.hidden = true;
  }
  // список призів для сервера: усе з каталогу, що можна купити (без видалених, безкоштовних, «на підставці», сторони Б)
  async function pushPrizePool() {
    const items = CATALOG.filter(c => !c.hidden && !c.free && !c.standOf && !SIDE_B.has(c.id) && (c.cost.usd + c.cost.pies) > 0)
      .map(c => ({id: c.id, group: c.group, usd: c.cost.usd, pies: c.cost.pies}));
    const res = await api('/prize-pool', {items});
    if (!res.ok) { toast(`⚠ ${res.error}`, state.editing); return; }
    toast(`🎡 Призи оновлено: ${res.data.count} речей`, state.editing);
    wheel.data = null;
  }
  // ---------- «➕ Додати модель» (адміни): 1) картинка з комп'ютера → 2) категорія, розмір, ціна → сервер ----------
  // Розмір картинки рахується з клітинок: ширина ромба (fw + fd) × 32 px на екрані (на стіні — fw × 39), зберігається ×3 для чіткості, WebP 0.85.
  const MODEL_HD = 3, MODEL_Q = 0.85;
  const modelDispW = m => m.place === 'wall' ? Math.max(1, m.fw) * 39 : Math.max(1, m.fw + m.fd) * 32;
  function modelEditor(existing) {
    const groupsAll = [...new Set(CATALOG.map(c => c.group))];
    const ov = existing ? overrides[existing.id] || {} : {};
    const m = existing ? {...existing} : {id: '', name: '', group: groupsAll[0], zone: 'office', place: 'floor', flat: false, fw: 2, fd: 2, usd: 1000};
    // ціна: $ (з каталогу) / 🥧 / $ + 🥧 — як галочки на картці (overrides: pies, price, plusPies, pricePies)
    m.cur = ov.pies ? 'pies' : ov.plusPies ? 'both' : 'usd';
    m.pies = ov.pies ? ov.price ?? 1 : ov.plusPies ? ov.pricePies ?? 1 : 1;
    let mirror = false, trimmed = null;                 // trimmed — canvas з обрізаними прозорими краями (оригінальні пікселі)
    // «викривити під стіну»: пласку (фронтальну) картинку нахиляємо як ліву стіну (−26,565°, права частина вище); на правій стіні сайт сам віддзеркалює
    let skew = false;
    // рамка для картинки на стіну (опційно): малюється навколо картинки ДО нахилу під стіну
    let frame = 'none', frameColor = '#c92a2a';
    const FRAMES = [['none', 'Без рамки'], ['wood', 'Дерев\'яна'], ['gold', 'Золота'], ['black', 'Чорна тонка'], ['white', 'Паспарту (біле поле + чорна)'], ['flag', 'Синьо-жовта'], ['check', 'Візерунок «клітинка»'], ['color', 'Свій колір']];
    function framed(src, kind, col) {
      if (kind === 'none') return src;
      const W = src.width, H = src.height, mn = Math.min(W, H);
      const b = Math.max(3, Math.round(mn * (kind === 'black' ? 0.035 : kind === 'white' ? 0.13 : 0.075)));
      const c = document.createElement('canvas'); c.width = W + 2 * b; c.height = H + 2 * b;
      const g = c.getContext('2d');
      const grad = (stops) => { const gr = g.createLinearGradient(0, 0, c.width, c.height); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); return gr; };
      if (kind === 'wood') g.fillStyle = grad(['#a0703c', '#6b4220', '#9a6633', '#5c3a1a']);
      else if (kind === 'gold') g.fillStyle = grad(['#ffe9a0', '#b8860b', '#f5d76e', '#8a6508', '#ffe08a']);
      else if (kind === 'black') g.fillStyle = '#1e1e1e';
      else if (kind === 'white') g.fillStyle = '#fbfaf6';
      else if (kind === 'color') g.fillStyle = col;
      else {   // візерунки: діагональні смуги синьо-жовті / клітинка
        const s = Math.max(4, Math.round(b * 0.9)), pc = document.createElement('canvas'); pc.width = pc.height = s * 2;
        const pg = pc.getContext('2d');
        if (kind === 'flag') { pg.fillStyle = '#ffd500'; pg.fillRect(0, 0, s * 2, s * 2); pg.strokeStyle = '#0057b7'; pg.lineWidth = s * 0.7;
          [-s * 2, 0, s * 2].forEach(o => { pg.beginPath(); pg.moveTo(o, s * 2); pg.lineTo(o + s * 2, 0); pg.stroke(); }); }
        else { pg.fillStyle = '#f1f3f5'; pg.fillRect(0, 0, s * 2, s * 2); pg.fillStyle = '#495057'; pg.fillRect(0, 0, s, s); pg.fillRect(s, s, s, s); }
        g.fillStyle = g.createPattern(pc, 'repeat');
      }
      g.fillRect(0, 0, c.width, c.height);
      if (kind === 'white') { g.strokeStyle = '#1e1e1e'; g.lineWidth = Math.max(2, b * 0.18); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, c.width - g.lineWidth, c.height - g.lineWidth); }
      // об'єм: світлий верхній-лівий край, темний нижній-правий, тінь усередині
      g.lineWidth = Math.max(1, b * 0.12);
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(1, c.height - 1); g.lineTo(1, 1); g.lineTo(c.width - 1, 1); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(c.width - 1, 1); g.lineTo(c.width - 1, c.height - 1); g.lineTo(1, c.height - 1); g.stroke();
      g.drawImage(src, b, b);
      g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = Math.max(1, b * 0.08); g.strokeRect(b, b, W, H);
      return c;
    }
    // маленька копія картинки — для прев'ю рамок
    let thumbSrc = null;
    const frameThumb = kind => {
      if (!trimmed) return '';
      if (!thumbSrc) { const k = Math.min(1, 70 / Math.max(trimmed.width, trimmed.height)); thumbSrc = document.createElement('canvas');
        thumbSrc.width = Math.max(1, Math.round(trimmed.width * k)); thumbSrc.height = Math.max(1, Math.round(trimmed.height * k));
        thumbSrc.getContext('2d').drawImage(trimmed, 0, 0, thumbSrc.width, thumbSrc.height); }
      return framed(thumbSrc, kind, frameColor).toDataURL('image/png');
    };
    let moved = Boolean(existing);                      // картинку вже рухали / масштабували — не перераховувати автоматично
    const back = Object.assign(document.createElement('div'), {className: 'devauth-back wheelover modeled'});
    back.innerHTML = `<div class="wpanel" style="width:min(1120px,97vw)"><h3>${existing ? '✏ Змінити модель' : '➕ Додати модель'}</h3><div class="mbody"></div></div>`;
    document.body.appendChild(back);
    const body = back.querySelector('.mbody');
    let blobUrl = null, dlUrls = [];
    const close = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); dlUrls.forEach(u => URL.revokeObjectURL(u)); back.remove(); };
    const ghUrl = () => `${SITE_URL}${CUSTOM_DIR}${m.id}.webp`;
    // картинка, яка реально піде на сайт: обрізана + (за бажанням) нахилена під стіну
    const shaped = () => {
      return shapedSide('L');
    };
    // side: 'L' — ліва стіна (права частина вище), 'R' — права стіна (ліва частина вище), без дзеркала: текст читається на обох
    const wallSkew = () => m.place === 'wall' && skew;
    // «покласти на підлогу»: пласку картинку (килим, мат) натягуємо на ромб клітинок fw×fd; друга версія — повернута на інший бік (↔ у кабінеті)
    const floorSkew = () => m.place !== 'wall' && skew;
    const anySkew = () => wallSkew() || floorSkew();
    function floorShape(src, side) {
      // A — клітинки по ↗ (від лівого кута до заднього), B — по ↖; після ↔ у кабінеті ромб стає fd×fw
      const A = side === 'R' ? Math.max(1, m.fd) : Math.max(1, m.fw), B = side === 'R' ? Math.max(1, m.fw) : Math.max(1, m.fd);
      const W = src.width, H = src.height, K = Math.max(1, Math.min(6, W / ((side === 'R' ? B : A) * 32)));
      const c = document.createElement('canvas'); c.width = Math.round((A + B) * 32 * K); c.height = Math.round((A + B) * 16 * K);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      if (side === 'R')   // повернуто: верх картинки — від заднього кута до правого (↘), ліво — від заднього до лівого (↙); не дзеркало
        g.setTransform(B * 32 * K / W, B * 16 * K / W, -A * 32 * K / H, A * 16 * K / H, A * 32 * K, 0);
      else                // як стоїть: верх картинки — від лівого кута до заднього (↗), ліво — від лівого до переднього (↘)
        g.setTransform(A * 32 * K / W, -A * 16 * K / W, B * 32 * K / H, B * 16 * K / H, 0, A * 16 * K);
      g.drawImage(src, 0, 0);
      return c;
    }
    function shapedSide(side) {
      if (!trimmed) return trimmed;
      const base = m.place === 'wall' ? framed(trimmed, frame, frameColor) : trimmed;
      if (floorSkew()) return floorShape(base, side);
      if (!wallSkew()) return base;
      const W = base.width, c = document.createElement('canvas');
      c.width = W; c.height = Math.round(base.height + W / 2);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      if (side === 'R') g.setTransform(1, 0.5, 0, 1, 0, 0);      // y' = y + x/2
      else g.setTransform(1, -0.5, 0, 1, 0, W / 2);             // y' = y − x/2 + W/2
      g.drawImage(base, 0, 0);
      return c;
    }
    const ratio = () => { const s = shaped(); return s ? s.height / s.width : (m.h || 1) / (m.w || 1); };
    // автоматичне місце: ширина = ромб клітинок, низ картинки — у передньому куті (на стіні — по центру знизу)
    const autoGeom = () => {
      const w = modelDispW(m), h = Math.round(w * ratio());
      Object.assign(m, {w, h, ax: m.place === 'wall' ? w / 2 : Math.max(1, m.fd) * 32, ay: h});
    };
    const toBlob = c => new Promise(r => c.toBlob(b => r(b), 'image/webp', MODEL_Q));
    const blobToData = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    // файл для сайту: ширина показу × MODEL_HD (не більша за оригінал), WebP
    const outCanvas = (side = 'L') => {
      const sh = shapedSide(side), want = Math.round(m.w * MODEL_HD), k = Math.min(1, want / sh.width);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sh.width * k)); c.height = Math.max(1, Math.round(sh.height * k));
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      if (mirror && !anySkew()) { g.translate(c.width, 0); g.scale(-1, 1); }
      g.drawImage(sh, 0, 0, c.width, c.height);
      return c;
    };
    let previewSrc = existing ? byId.get(m.id)?.src || '' : '';
    let previewR = existing ? byId.get(m.id)?.srcR || '' : '';
    const makePreview = () => {              // картинка для сцени (дзеркало враховано)
      if (!trimmed) return;
      const sh = shaped();
      const c = document.createElement('canvas'); c.width = sh.width; c.height = sh.height;
      const g = c.getContext('2d'); if (mirror && !anySkew()) { g.translate(c.width, 0); g.scale(-1, 1); } g.drawImage(sh, 0, 0);
      previewSrc = c.toDataURL('image/png');
      previewR = anySkew() ? shapedSide('R').toDataURL('image/png') : '';
    };
    // ---- вікно 1: картинка ----
    // вікно 1: велика — сама завантажена картинка; для JPG під нею 4 прев'ю (стіна ліва / права, підлога / підлога ↔) — клік вибирає, куди
    let isJpeg = false;
    const origSrc = () => {
      if (!trimmed) return '';
      const c = document.createElement('canvas'); c.width = trimmed.width; c.height = trimmed.height;
      const g = c.getContext('2d'); if (mirror && !anySkew()) { g.translate(c.width, 0); g.scale(-1, 1); } g.drawImage(trimmed, 0, 0);
      return c.toDataURL('image/png');
    };
    const placeThumb = (place, side) => {
      const keepPlace = m.place, keepSkew = skew;
      m.place = place; skew = true;
      const sh = shapedSide(side);
      m.place = keepPlace; skew = keepSkew;
      const k = Math.min(1, 220 / Math.max(sh.width, sh.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sh.width * k)); c.height = Math.max(1, Math.round(sh.height * k));
      c.getContext('2d').drawImage(sh, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    };
    function step1() {
      const big = trimmed ? origSrc() : existing ? previewSrc : '';
      // галочка «на стіну / на підлогу» (= викривлення); з нею — прев'ю, клік по прев'ю вибирає місце
      const opts = skew && trimmed ? [['wall', 'L', 'ліва стіна'], ['wall', 'R', 'права стіна'], ['floor', 'L', 'підлога'], ['floor', 'R', 'підлога ↔']] : [];
      body.innerHTML = `<div class="note">Виберіть картинку з комп'ютера: <b>PNG або WebP з прозорим фоном</b> — предмет в ізометрії (як інші в каталозі), прозорі краї обріжуться самі. <b>JPG / JPEG</b> — плакат, фото або килим: сайт сам покладе його на стіну чи підлогу.</div>
        <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-top:10px">
          <div class="mprev" style="flex:none;width:420px;height:420px;border:1px solid #888;background:repeating-conic-gradient(#e9ecef 0 25%,#fff 0 50%) 0 0/20px 20px;display:flex;align-items:center;justify-content:center">${big ? `<img src="${big}" style="max-width:410px;max-height:410px">` : '<span style="color:#888">картинки ще нема</span>'}</div>
          <div style="flex:1;min-width:260px;display:flex;flex-direction:column;gap:10px">
            <input type="file" accept="image/png,image/webp,image/jpeg,.jpg,.jpeg" class="mfile">
            <div class="minfo" style="color:#555;font-size:12px">${trimmed ? `Оригінал після обрізки: ${trimmed.width}×${trimmed.height} px` : ''}</div>
            ${trimmed ? `<label style="cursor:pointer;font-weight:bold" title="Для пласкої картинки (плакат, фото, килим): викривити під стіну або підлогу. Уже ізометричну модель — не ставте."><input type="checkbox" class="m1skew" ${skew ? 'checked' : ''}> ⟋ На стіну / на підлогу (викривити пласку картинку)</label>` : ''}
            ${opts.length ? `<div class="mplaces">${opts.map(([pl, sd, lab]) => `<button type="button" class="mpl${m.place === pl ? ' on' : ''}" data-pl="${pl}" title="Поставити ${pl === 'wall' ? 'на стіну' : 'на підлогу'}"><img src="${placeThumb(pl, sd)}" alt=""><small>${lab}</small></button>`).join('')}</div>
              <div style="font-size:12px;color:#555">Зараз: <b>${m.place === 'wall' ? 'на стіну' : 'на підлогу'}</b> — клік по прев'ю, щоб змінити. Друга версія (права стіна / підлога ↔) — окрема картинка, текст не перевертається.</div>` : ''}
            ${anySkew() ? '' : `<label style="cursor:pointer"><input type="checkbox" class="mmir" ${mirror ? 'checked' : ''}> ↔ Дзеркально (повернути в інший бік)</label>`}
          </div></div>
        <div class="wctrl"><button type="button" class="wclose">Скасувати</button><button type="button" class="wspin mnext" ${trimmed || existing ? '' : 'disabled'}>Далі →</button></div>`;
      const s1 = body.querySelector('.m1skew');
      if (s1) s1.onchange = () => { skew = s1.checked; if (skew && m.place === 'floor') m.flat = true; moved = false; thumbSrc = null; makePreview(); step1(); };
      const mir = body.querySelector('.mmir');
      if (mir) mir.onchange = e => { mirror = e.target.checked; if (trimmed) step1(); };
      body.querySelectorAll('.mpl').forEach(b => b.onclick = () => {
        const pl = b.dataset.pl;
        m.place = pl; skew = true; if (pl === 'floor') m.flat = true;
        moved = false; thumbSrc = null; makePreview(); step1();
      });
      body.querySelector('.mfile').onchange = async e => {
        const f = e.target.files[0];
        if (!f) return;
        if (!/^image\/(png|webp|jpeg)$/.test(f.type)) { toast('⚠ Тільки PNG, WebP або JPG'); return; }
        const bmp = await createImageBitmap(f).catch(() => null);
        if (!bmp) { toast('⚠ Не вдалося прочитати картинку'); return; }
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < 0) { toast('⚠ Картинка повністю прозора'); return; }
        const t = document.createElement('canvas'); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
        t.getContext('2d').drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
        trimmed = t; thumbSrc = null;
        // JPG — плакат / фото / килим: одразу «на стіну» з викривленням; PNG / WebP — як є (без галочки і прев'ю)
        isJpeg = f.type === 'image/jpeg';
        if (isJpeg) { m.place = 'wall'; skew = true; mirror = false; } else skew = false;
        if (!m.id) m.id = 'custom-' + f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        if (!m.name) m.name = f.name.replace(/\.[^.]+$/, '');
        if (!existing) { m.fw = 2; m.fd = 2; }            // за замовчуванням 2×2, далі — кнопками − / +
        moved = false;
        makePreview();
        step1();
      };
      body.querySelector('.wclose').onclick = close;
      body.querySelector('.mnext').onclick = () => { if (!moved) autoGeom(); step2(); };
    }
    // ---- сцена: сітка підлоги з запасом, зелені клітинки речі, картинка поверх (тягається мишкою) ----
    const ST_W = 620, ST_H = 520, PAD = 3;               // розмір сцени і запас клітинок навколо речі
    function stageHtml() {
      const fw = Math.max(1, m.fw), fd = m.place === 'wall' ? 1 : Math.max(1, m.fd);
      // масштаб сцени: щоб влізли і клітинки з запасом, і картинка
      const gridW = (fw + fd + 2 * PAD) * 32, gridH = (fw + fd + 2 * PAD) * 16;
      const S = Math.max(0.4, Math.min(4, (ST_W - 40) / Math.max(gridW, m.w + 64), (ST_H - 40) / Math.max(gridH + m.h * 0.6, m.h + 60)));
      // передній кут речі: по центру знизу (з місцем під запасні клітинки)
      const F = {x: ST_W / 2 + (fd - fw) * 16 * S, y: ST_H - 30 - PAD * 16 * S};
      const cell = (a, b) => { const x = F.x + (a - b) * 32 * S, y = F.y - (a + b) * 16 * S;   // нижній кут клітинки (a — по fw ↗, b — по fd ↖)
        return `${x},${y} ${x + 32 * S},${y - 16 * S} ${x},${y - 32 * S} ${x - 32 * S},${y - 16 * S}`; };
      let grid = '';
      if (m.place === 'wall') {
        // ліва стіна (як у кабінеті): піднімається вправо на 1/2; зелене — місце речі (fw клітинок), низ речі — на червоній точці
        const half = fw * 16 * S, ext = 2 * 32 * S, Hh = F.y - 30;
        const P = (x, up) => `${F.x + x},${F.y - x / 2 - up}`;
        grid = `<polygon points="${P(-half - ext, 0)} ${P(half + ext, 0)} ${P(half + ext, Hh)} ${P(-half - ext, Hh)}" fill="#efe9dd" stroke="#c9c0ad"/>
          <polygon points="${P(-half, 0)} ${P(half, 0)} ${P(half, Hh)} ${P(-half, Hh)}" fill="#d3f9d8" fill-opacity=".55" stroke="#2f9e44" stroke-dasharray="5 4"/>`;
      } else {
        for (let a = -PAD; a < fw + PAD; a++) for (let b = -PAD; b < fd + PAD; b++) {
          const on = a >= 0 && b >= 0 && a < fw && b < fd;
          grid += `<polygon points="${cell(a, b)}" fill="${on ? '#8ce99a' : '#f1f3f5'}" fill-opacity="${on ? 0.75 : 1}" stroke="${on ? '#2f9e44' : '#ced4da'}" stroke-width="1"/>`;
        }
      }
      const L = F.x - m.ax * S, T = F.y - m.ay * S;
      return {S, F, html: `<div class="mstage" style="position:relative;width:${ST_W}px;height:${ST_H}px;border:1px solid #888;background:#fff;overflow:hidden;flex:none">
        <svg width="${ST_W}" height="${ST_H}" style="position:absolute;left:0;top:0">${grid}</svg>
        <img class="mimg" src="${previewSrc}" draggable="false" style="position:absolute;left:${L}px;top:${T}px;width:${m.w * S}px;height:${m.h * S}px;cursor:move;opacity:.92;user-select:none">
        <div style="position:absolute;left:${F.x - 5}px;top:${F.y - 5}px;width:10px;height:10px;border-radius:50%;background:#e03131;box-shadow:0 0 0 2px #fff;pointer-events:none"></div>
        <div style="position:absolute;left:6px;top:6px;font-size:11px;color:#666;background:rgba(255,255,255,.85);padding:2px 5px">тягніть картинку мишкою · червона точка — передній кут (низ речі)</div></div>`};
    }
    // ---- вікно 2: сцена + дані ----
    async function step2() {
      let blob = null;
      if (trimmed) {
        const c = outCanvas();
        blob = await toBlob(c);
        m._out = {w: c.width, h: c.height, kb: Math.round(blob.size / 1024)};
      }
      // файли для GitHub — окремі посилання під мініатюрами (кожен скачується своїм кліком)
      const blobR = blob && anySkew() ? await toBlob(outCanvas('R')) : null;
      dlUrls.forEach(u => URL.revokeObjectURL(u));
      dlUrls = [blob, blobR].filter(Boolean).map(b => URL.createObjectURL(b));
      const dlLink = (i, name, b) => `<a class="mdlink" data-suf="${i ? R_SUFFIX : ''}" href="${dlUrls[i]}" download="${esc(name)}" title="Скачати файл для папки ${CUSTOM_DIR} на GitHub">⬇ Скачати<br><small><span class="mdname">${esc(name)}</span> · ${Math.max(1, Math.round(b.size / 1024))} КБ</small></a>`;
      const st = stageHtml();
      const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label || v)}</option>`;
      // клітинки — кнопками − / + (як «Розмір картинки»)
      const cellBtns = k => `<button type="button" class="wclose mc" data-k="${k}" data-d="-1" ${m[k] <= 1 ? 'disabled' : ''}>−</button><b class="mcv">${m[k]}</b><button type="button" class="wclose mc" data-k="${k}" data-d="1" ${m[k] >= 9 ? 'disabled' : ''}>+</button>`;
      body.innerHTML = `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <div>${st.html}
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:12px">
            <span>Розмір картинки:</span><button type="button" class="wclose mz" data-z="0.9">− 10%</button><button type="button" class="wclose mz" data-z="0.98">−</button>
            <button type="button" class="wclose mz" data-z="1.02">+</button><button type="button" class="wclose mz" data-z="1.1">+ 10%</button>
            <button type="button" class="wclose mauto" title="Ширина = клітинки, низ — у передньому куті">↺ Авто</button>
            <span style="color:#555">на екрані ${Math.round(m.w)}×${Math.round(m.h)} px${m._out ? ` · файл WebP <b>${m._out.w}×${m._out.h} px, ${m._out.kb} КБ</b>` : ''}</span></div>
          ${anySkew() && previewR ? `<div class="mwalls"><div><img src="${previewSrc}" alt=""><small>${m.place === 'wall' ? 'ліва стіна' : 'як стоїть'}</small>${blob ? dlLink(0, `${m.id}.webp`, blob) : ''}</div><div><img src="${previewR}" alt=""><small>${m.place === 'wall' ? 'права стіна' : 'після ↔ у кабінеті (окрема картинка, не дзеркало)'}</small>${blobR ? dlLink(1, `${m.id}${R_SUFFIX}.webp`, blobR) : ''}</div></div>` : ''}</div>
        <div style="flex:1;min-width:300px;display:grid;grid-template-columns:auto 1fr;gap:7px 8px;align-items:center;font-size:13px">
          <span>Назва</span><input class="mf" data-k="name" value="${esc(m.name)}">
          <span>ID (файл)</span><input class="mf" data-k="id" value="${esc(m.id)}" ${existing ? 'disabled' : ''} title="Латиниця, цифри, дефіс — так буде називатись файл на GitHub: <id>.webp">
          <span>Де</span><select class="mf" data-k="zone">${opt('office', m.zone, 'Офіс')}${opt('home', m.zone, 'Дім')}${opt('both', m.zone, 'Офіс і дім')}</select>
          <span>Категорія</span><select class="mf" data-k="group">${groupsAll.map(x => opt(x, m.group)).join('')}</select>
          <span>Місце</span><select class="mf" data-k="place">${opt('floor', m.place, 'На підлозі / землі')}${opt('wall', m.place, 'На стіні')}</select>
          ${m.place === 'wall' ? `<span></span><label style="cursor:pointer" title="Для пласкої (фронтальної) картинки: нахилити під ліву стіну, як інші речі на стіні. На правій стіні сайт віддзеркалить сам. Уже викривлену картинку — не ставте галочку."><input type="checkbox" class="mskew" ${skew ? 'checked' : ''} ${trimmed ? '' : 'disabled'}> ⟋ Викривити під стіну (якщо картинка пласка)${trimmed ? '' : ' — спершу виберіть картинку'}</label>
            <span>Рамка</span><span class="mframes">${trimmed ? FRAMES.map(([k, label]) => `<button type="button" class="mfr${frame === k ? ' on' : ''}" data-fr="${k}" title="${label}"><img src="${frameThumb(k)}" alt=""><small>${label}</small></button>`).join('') + (frame === 'color' ? `<label class="mfcolw">колір <input type="color" class="mfcol" value="${frameColor}"></label>` : '') : '<span style="color:#888">спершу виберіть картинку (← Картинка)</span>'}</span>` : ''}
          <span>Клітинки</span><span class="mcells">${m.place === 'wall' ? `ширина ${cellBtns('fw')}` : `↗ fw ${cellBtns('fw')} &nbsp; ↖ fd ${cellBtns('fd')}`}</span>
          ${m.place === 'wall' ? '' : `<span></span><label style="cursor:pointer" title="Для пласкої картинки «зверху» (килим, мат, плитка): натягнути на клітинки підлоги. Уже ізометричну модель — не ставте галочку."><input type="checkbox" class="mskew" ${skew ? 'checked' : ''} ${trimmed ? '' : 'disabled'}> ⬦ Покласти на підлогу (якщо картинка пласка — килим, мат)${trimmed ? '' : ' — спершу виберіть картинку'}</label>
          <span></span><label style="cursor:pointer"><input type="checkbox" class="mf" data-k="flat" ${m.flat ? 'checked' : ''}> пласка (килим, доріжка — на неї можна ставити меблі)</label>`}
          <span>Валюта</span><select class="mf" data-k="cur">${opt('usd', m.cur, 'Тільки $')}${opt('pies', m.cur, 'Тільки 🥧 пиріжки')}${opt('both', m.cur, '$ і 🥧 разом')}</select>
          ${m.cur !== 'pies' ? `<span>Ціна $</span><input class="mf" data-k="usd" type="number" min="0" step="10" value="${m.usd}" style="width:8em">` : ''}
          ${m.cur !== 'usd' ? `<span>Ціна 🥧</span><input class="mf" data-k="pies" type="number" min="0" step="1" value="${m.pies}" style="width:8em">` : ''}
          <div style="grid-column:1/-1;font-size:12px;color:#555;line-height:1.45;margin-top:4px">Після збереження модель одразу з'явиться в каталозі в усіх (картинка — з сервера). Потім її можна підправити на картці в «🛠 Редагувати каталог».<br>
            Щоб картинка йшла з сайту: ${blobR ? '<b>⬇ Скачати</b> під обома мініатюрами (2 файли)' : '<b>⬇ Скачати WebP</b>'} → завантажити у папку <b>${CUSTOM_DIR}</b> репозиторію сайту на GitHub → <b>🔍 Перевірити на GitHub</b>.</div>
          <div class="mgh" style="grid-column:1/-1;font-size:12px">${m.gh ? '✓ Картинка вже є на GitHub — береться з сайту' : ''}</div>
          <div class="mdlbox" style="grid-column:1/-1;font-size:12px" hidden></div>
        </div></div>
        <div class="wctrl"><button type="button" class="wclose mcancel">Скасувати</button><button type="button" class="wclose mback">← Картинка</button>
          ${blobR ? '' : `<button type="button" class="wclose mdl" ${blob ? '' : 'disabled'}>⬇ Скачати WebP</button>`}<button type="button" class="wclose mgcheck">🔍 Перевірити на GitHub</button>
          <button type="button" class="wspin msave">💾 Зберегти</button></div>`;
      // тягнути картинку: міняється передній кут (ax, ay) у пікселях показу
      const img = body.querySelector('.mimg');
      img.onpointerdown = e => {
        e.preventDefault(); img.setPointerCapture(e.pointerId);
        const sx = e.clientX, sy = e.clientY, ax0 = m.ax, ay0 = m.ay, L0 = parseFloat(img.style.left), T0 = parseFloat(img.style.top);
        img.onpointermove = ev => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          img.style.left = `${L0 + dx}px`; img.style.top = `${T0 + dy}px`;
          m.ax = ax0 - dx / st.S; m.ay = ay0 - dy / st.S;
        };
        img.onpointerup = () => { img.onpointermove = null; moved = true; };
      };
      body.querySelectorAll('.mz').forEach(b => b.onclick = () => {
        const k = Number(b.dataset.z);
        // масштаб довкола переднього кута: точка під червоною крапкою лишається на місці
        m.w *= k; m.h *= k; m.ax *= k; m.ay *= k; moved = true; step2();
      });
      body.querySelector('.mauto').onclick = () => { autoGeom(); moved = false; step2(); };
      body.querySelectorAll('.mfr').forEach(b => b.onclick = () => { frame = b.dataset.fr; makePreview(); autoGeom(); moved = false; step2(); });
      const fc = body.querySelector('.mfcol');
      if (fc) fc.onchange = () => { frameColor = fc.value; makePreview(); step2(); };
      const sk = body.querySelector('.mskew');
      if (sk) sk.onchange = () => { skew = sk.checked; if (skew && m.place !== 'wall') m.flat = true; makePreview(); autoGeom(); moved = false; step2(); };
      body.querySelectorAll('.mc').forEach(b => b.onclick = () => {
        const k = b.dataset.k;
        m[k] = Math.max(1, Math.min(9, m[k] + Number(b.dataset.d)));
        if (floorSkew()) { makePreview(); autoGeom(); moved = false; }
        else if (!moved) autoGeom();
        step2();
      });
      body.querySelectorAll('.mf').forEach(inp => inp.onchange = () => {
        const k = inp.dataset.k;
        m[k] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? Number(inp.value) : inp.value.trim();
        if (k === 'id') {
          m.id = m.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
          inp.value = m.id;
          // нове ID — нові імена файлів у кнопках «⬇ Скачати»
          body.querySelectorAll('a.mdlink[data-suf]').forEach(a => { const n = `${m.id}${a.dataset.suf}.webp`; a.download = n; const s = a.querySelector('.mdname'); if (s) s.textContent = n; });
        }
        if (k === 'place' || k === 'fw' || k === 'fd') { if (k === 'place') makePreview(); if (!moved || k === 'place') autoGeom(); step2(); }
        else if (k === 'cur') step2();
      });
      body.querySelector('.mcancel').onclick = close;
      body.querySelector('.mback').onclick = step1;
      // «⬇ Скачати WebP»: звичайні посилання на файли (браузер не блокує, як «невидиме» скачування двох файлів одразу)
      const mdl = body.querySelector('.mdl');   // два файли (стіна / підлога з нахилом) — кнопки під мініатюрами, а цієї нема
      if (mdl) mdl.onclick = async () => {
        if (!blob) return;
        const files = [{name: `${m.id}.webp`, b: blob}];
        if (blobR) files.push({name: `${m.id}${R_SUFFIX}.webp`, b: blobR});
        const box = body.querySelector('.mdlbox');
        box.innerHTML = `Файли для папки <b>${CUSTOM_DIR}</b> на GitHub${files.length > 1 ? ' (обидва)' : ''}: ` +
          files.map((f, i) => `<a class="mdlink" href="${dlUrls[i]}" download="${esc(f.name)}">⬇ ${esc(f.name)} <small>(${Math.max(1, Math.round(f.b.size / 1024))} КБ)</small></a>`).join(' ') + (files.length > 1 ? '<br>Другий файл — кнопкою «⬇ Скачати» під мініатюрою «права стіна / після ↔» (зліва внизу).' : '');
        box.hidden = false;
        // перший файл — одразу (посилання в документі; другий браузер може не дати скачати без кліку — тоді клікніть по посиланню)
        const a = box.querySelector('a'); a.click();
      };
      body.querySelector('.mgcheck').onclick = () => {
        const out = body.querySelector('.mgh');
        if (!m.id) { out.textContent = '⚠ Спершу вкажіть ID'; return; }
        out.textContent = `Шукаю ${ghUrl()}…`;
        const im = new Image();
        im.onload = () => { m.gh = true; out.innerHTML = `✓ Є на GitHub: <a href="${ghUrl()}" target="_blank" rel="noopener">${esc(ghUrl())}</a> (${im.naturalWidth}×${im.naturalHeight} px) — після «Зберегти» картинка йтиме з сайту`; };
        im.onerror = () => { m.gh = false; out.innerHTML = `✗ Нема на GitHub: ${esc(ghUrl())}<br>Завантажте файл <b>${esc(m.id)}.webp</b> у папку <b>${CUSTOM_DIR}</b> (після завантаження GitHub оновлює сайт ~1–2 хв).`; };
        const needR = anySkew() || Boolean(existing?.r);
        im.src = `${ghUrl()}?t=${Date.now()}`;
        if (needR) {   // друга картинка (права стіна) теж має бути на GitHub
          const ok1 = im.onload;
          im.onload = () => { const r = new Image(); r.onload = ok1; r.onerror = () => { m.gh = false; out.innerHTML = `✗ Є ${esc(m.id)}.webp, але нема <b>${esc(m.id)}${R_SUFFIX}.webp</b> (права стіна) у папці <b>${CUSTOM_DIR}</b>`; }; r.src = `${SITE_URL}${CUSTOM_DIR}${m.id}${R_SUFFIX}.webp?t=${Date.now()}`; };
        }
      };
      body.querySelector('.msave').onclick = async e => {
        if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(m.id)) { toast('⚠ ID: латиниця, цифри, дефіс (3–60)'); return; }
        if (!existing && byId.has(m.id)) { toast('⚠ Модель з таким ID уже є'); return; }
        e.target.disabled = true;
        const item = {id: m.id, name: m.name || m.id, group: m.group, zone: m.zone, place: m.place, flat: m.place === 'wall' ? false : m.flat,
          fw: m.fw, fd: m.place === 'wall' ? 0 : m.fd, w: Math.round(m.w), h: Math.round(m.h), ax: Math.round(m.ax * 10) / 10, ay: Math.round(m.ay * 10) / 10,
          usd: m.cur === 'pies' ? 0 : m.usd, gh: Boolean(m.gh)};
        // стіна з нахилом — ще й картинка для правої стіни (не дзеркало, а нахил в інший бік)
        const blobR = blob && anySkew() ? await toBlob(outCanvas('R')) : null;
        const res = await api('/custom-item', {item, ...(blob ? {image: await blobToData(blob)} : {}), ...(blobR ? {imageRight: await blobToData(blobR)} : {}), ...(blob && !blobR ? {noRight: true} : {})});
        e.target.disabled = false;
        if (!res.ok) { toast(`⚠ ${res.error}`); return; }
        customItems = res.data.items;
        // ціна в 🥧 — як галочки на картці (overrides); розмір і місце — у самій моделі, тому старі зсуви/масштаб скидаємо
        const o = {...(overrides[m.id] || {})};
        ['pies', 'price', 'plusPies', 'pricePies', 'fw', 'fd', 'dx', 'dy', 'scale'].forEach(k => delete o[k]);
        if (m.cur === 'pies') Object.assign(o, {pies: true, price: Math.max(0, Math.round(m.pies))});
        if (m.cur === 'both') Object.assign(o, {plusPies: true, pricePies: Math.max(0, Math.round(m.pies)), price: Math.round(m.usd)});
        if (Object.keys(o).length) overrides[m.id] = o; else delete overrides[m.id];
        saveOverrides([m.id]);
        const ci = res.data.item, fresh = customToCatalog(ci);
        const old = byId.get(ci.id);
        if (old) { Object.keys(old).forEach(k => delete old[k]); Object.assign(old, fresh); applyOverride(old); }
        else { CATALOG.push(fresh); byId.set(fresh.id, fresh); applyOverride(fresh); }
        toast(`✓ Модель «${ci.name}» збережено — вона вже в каталозі (${ci.group})`);
        close();
        renderMenuSafe();
        if (state.editing) renderScene(state.editing);
      };
    }
    if (existing) step2(); else step1();
  }
  async function loadWheel() {
    wheel.tried = Date.now();
    const res = await api(`/wheel?salary=${Math.round(baseUsd())}`);
    if (res.ok) wheel.data = res.data;
    return res;
  }
  const wheelCats = w => { const o = wheel.data?.odds?.[w]; if (!o) return [];
    const cons = {group: o.cons.usd ? `💰 ${fmtUsd(o.cons.usd)}` : `🥧 ${o.cons.pies} пиріжок`, p: o.cons.p, cons: true};
    const cash = (o.cash || []).map(c => ({group: `💵 ${fmtUsd(c.usd)}`, p: c.p, cash: c.usd}));   // сектори «просто гроші»
    let a = 0;   // кути секторів: 0° — угорі, за годинниковою
    return [...o.cats, cons, ...cash].map(c => { const r = {...c, a0: a, a1: a + c.p * 360}; a = r.a1; return r; }); };
  // SVG колеса: сектори = категорії (розмір = шанс)
  function wheelSvg(w, D) {
    const cats = wheelCats(w), R = D / 2;
    let out = '';
    const pt = (deg, r) => [R + r * Math.sin(deg * Math.PI / 180), R - r * Math.cos(deg * Math.PI / 180)];
    cats.forEach((c, n) => {
      const a = c.a0, a1 = c.a1, da = a1 - a;
      const [x0, y0] = pt(a, R - 3), [x1, y1] = pt(a1, R - 3);
      const col = c.cons ? '#dee2e6' : c.cash ? '#40c057' : WHEEL_COLORS[n % WHEEL_COLORS.length];
      out += da >= 359.9 ? `<circle cx="${R}" cy="${R}" r="${R - 3}" fill="${col}"/>`
        : `<path d="M${R} ${R}L${x0.toFixed(2)} ${y0.toFixed(2)}A${R - 3} ${R - 3} 0 ${da > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z" fill="${col}" stroke="#fff" stroke-width="1.5"/>`;
      if (da >= 6) {   // підпис — тільки для помітних секторів (уздовж радіуса)
        const mid = a + da / 2, [tx, ty] = pt(mid, R * 0.62);
        const label = c.group.replace(/^Люди: /, '👤 ').slice(0, 18);
        out += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${Math.max(9, Math.min(14, D / 34))}" font-weight="bold" text-anchor="middle" dominant-baseline="middle"
          transform="rotate(${(mid > 180 ? mid + 90 : mid - 90).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" fill="#222">${esc(label)}</text>`;
      }
    });
    return `<svg width="${D}" height="${D}" viewBox="0 0 ${D} ${D}"><circle cx="${R}" cy="${R}" r="${R - 1}" fill="#fff" stroke="#555" stroke-width="3"/>${out}
      <circle cx="${R}" cy="${R}" r="${D / 11}" fill="#fff" stroke="#555" stroke-width="2"/><circle cx="${R}" cy="${R}" r="${D / 30}" fill="#c92a2a"/></svg>`;
  }
  // скільки ще можна сьогодні
  function wheelLeftText(w) {
    const L = wheel.data?.limits?.[w];
    if (!L) return '';
    if (w === 'pies') return `Сьогодні ще: ${L.spinsLeft} з 5 спроб · баланс ${fmtPies(balPies())}`;
    const n = Math.floor(Math.min(L.usdLeftToday, L.usdLeftSalary) / (wheel.data?.wheels?.usd?.cost?.usd || PIE_USD));
    return `Сьогодні ще: ${n} спроб${L.usdLeftSalary < L.usdLeftToday ? ' (ліміт — 50% зарплати)' : ''} · баланс ${fmtUsd(balUsd())}`;
  }
  // велике колесо по центру екрана
  async function openWheel(w) {
    if (!isMine() || wheel.busy) return;
    wheel.last = w;
    const back = Object.assign(document.createElement('div'), {className: 'devauth-back wheelover'});
    // одна кнопка в меню → у вікні кнопки «Крутити за 1 🥧» / «Крутити за $4к» / «🧪 Крутити як адмін»
    back.innerHTML = `<div class="wpanel"><h3>🎡 Колесо фортуни</h3><div class="wbody"><div class="note">Завантаження…</div></div></div>`;
    document.body.appendChild(back);
    const res = await loadWheel();
    const body = back.querySelector('.wbody');
    if (!res.ok || !wheel.data?.odds) {
      body.innerHTML = `<div class="note">${!res.ok ? esc(res.error) : 'Колесо ще не налаштоване: адмін має натиснути «🎡 Оновити призи колеса» (смужка «🛠 Редагувати каталог» у меню).'}</div>
        <div class="wctrl"><button type="button" class="wclose">Закрити</button></div>`;
      body.querySelector('.wclose').onclick = () => back.remove();
      return;
    }
    const D = Math.round(Math.max(260, Math.min(innerHeight - 250, innerWidth - 80, 540)));
    // безкоштовна щоденна спроба (колесо за 🥧, нічого не списує); старий сервер її не знає — тоді кнопки нема
    const freeL = wheel.data?.limits?.free;
    const freeBtn = freeL ? (freeL.spinsLeft > 0
      ? '<button type="button" class="wspin wfree" data-spin="pies" data-free="1" title="Раз на день для кожного пілота: колесо за 🥧, але нічого не списується">🎁 Крутити безкоштовно</button>'
      : '<button type="button" class="wspin wfree" disabled title="Наступна безкоштовна спроба — завтра з 00:00 UTC">🎁 Безкоштовна — завтра</button>') : '';
    body.innerHTML = `<div class="wstage" style="height:${D + 10}px"><div class="wwrap" style="width:${D}px;height:${D}px"><div class="wptr"></div>
        <div class="wrot" style="transform:rotate(${wheel.rot[w]}deg)">${wheelSvg(w, D)}</div></div></div>
      <div class="wctrl">${freeBtn}<button type="button" class="wspin" data-spin="pies">Крутити за 1 🥧</button>
        <button type="button" class="wspin" data-spin="usd">Крутити за $${PIE_USD / 1000}к</button>
        ${isAdmin() ? '<button type="button" class="wspin wdry" title="Тестова спроба: приз показується, але нічого не списується і нікуди не зараховується">🧪 Крутити як адмін</button>' : ''}</div>
      <div class="wctrl"><span class="wleft">${freeL ? `🎁 Безкоштовна спроба: ${freeL.spinsLeft > 0 ? 'є 1 на сьогодні' : 'наступна завтра (з 00:00 UTC)'}<br>` : ''}${wheelLeftText('pies')}<br>${wheelLeftText('usd')}</span>
        <a href="#" class="wodds">Шанси</a><button type="button" class="wclose">Закрити</button></div>`;
    // колеса за 🥧 і за $ відрізняються лише сірим сектором (втішний приз) — перемальовуємо перед обертанням
    let shown = w;
    const show = nw => {
      if (nw === shown) return;
      wheel.rot[nw] = wheel.rot[shown];
      body.querySelector('.wrot').innerHTML = wheelSvg(nw, D);
      shown = nw;
    };
    body.querySelectorAll('[data-spin]').forEach(b => { b.onclick = () => { if (wheel.busy || b.disabled) return; show(b.dataset.spin); wheel.last = shown; spinIn(back, shown, false, b.dataset.free === '1'); }; });
    body.querySelector('.wdry')?.addEventListener('click', () => { if (!wheel.busy) spinIn(back, shown, true); });
    body.querySelector('.wodds').onclick = e => { e.preventDefault(); oddsModal(shown); };
    body.querySelector('.wclose').onclick = () => { if (!wheel.busy) back.remove(); };
  }
  function oddsModal(w) {
    const o = wheel.data?.odds?.[w];
    if (!o) return;
    const rows = wheelCats(w).map(c => `<div class="r"><span>${esc(c.group)}${c.n ? ` <i style="color:#888">(${c.n} шт., до ${fmtUsd(c.max)})</i>` : ''}</span><span>${(c.p * 100).toFixed(1).replace('.', ',')}%</span></div>`).join('');
    modal(`🎡 Шанси: колесо ${w === 'pies' ? 'за 🥧' : 'за $'}`, `<div class="note">Спочатку колесо вибирає категорію, потім — річ з неї.
      Найчастіше випадають речі вартістю близько ставки (${fmtUsd(o.center || 0)}); дуже дешеві й дуже дорогі — рідко
      (річ удесятеро дешевша і вдесятеро дорожча за ставку мають однаковий шанс).
      Половина спроб дає щонайменше ${fmtUsd(o.median || 0)}, у середньому — ${fmtUsd(o.ev)} (1 🥧 = ${fmtUsd(PIE_USD)}). Найгірший випадок — ${o.cons.usd ? fmtUsd(o.cons.usd) : `${o.cons.pies} 🥧`}, тобто просто обмін 🥧 ↔ $.
      Виграні речі — у «🎒 Куплене» з позначкою 🎡. Можуть бути дублі.</div><div class="rows">${rows}</div>`, 'Закрити', () => null, 'receipt');
    const b = [...document.querySelectorAll('.devauth-back')].pop();
    const c = b?.querySelector('[data-act="cancel"]');
    if (c) c.hidden = true;
  }
  // виграш уже записаний на сервері — переносимо в сторінку (і в чернетку, якщо зараз «Облаштувати»)
  function applySpin(doc, prize, limits) {
    const id = profilePilotId();
    ACC.data[id] = doc;
    if (wheel.data) wheel.data.limits = limits;
    if (state.editing) {
      const s = prize.uid && (doc.stock || []).find(x => x.uid === prize.uid);
      if (s) { state.owned.stock.push({...s}); state.draft.stock.push({...s}); }
      state.spent = doc.money.spentPies; state.spentUsd = doc.money.spentUsd;
      undoReset();                     // щоб «↶ Відмінити» не прибрало виграш із «Куплене»
      renderMenu();
    } else { state.loadedFor = undefined; render(); }
  }
  // dry — «🧪 Крутити як адмін»: приз показується, але нічого не списується і не зараховується
  async function spinIn(back, w, dry = false, free = false) {
    if (wheel.busy) return;
    const id = profilePilotId();
    if (!dry && !(id in ACC.data)) { toast('⚠ Кабінет ще не завантажився — спробуйте за хвилину.'); return; }
    const body = back.querySelector('.wbody');
    const btns = [...body.querySelectorAll('button')];
    const wasOff = btns.map(b => b.disabled);
    wheel.busy = true; btns.forEach(b => { b.disabled = true; });
    const res = await api('/spin', {wheel: w, salaryUsd: Math.round(baseUsd()), piesEarned: basePies(), ...(dry ? {test: true} : {}), ...(free ? {free: true} : {})});
    if (!res.ok) { wheel.busy = false; btns.forEach((b, i) => { b.disabled = wasOff[i]; }); toast(`⚠ ${res.error}`); return; }
    const {prize, doc, limits} = res.data;
    if (!dry) applySpin(doc, prize, limits);
    // колесо: зупиняємось на секторі категорії (випадкове місце всередині сектора)
    const cats = wheelCats(w);
    const cat = (prize.type === 'cons' ? cats.find(c => c.cons) : prize.type === 'cash' ? cats.find(c => c.cash === prize.usd)
      : cats.find(c => c.group === prize.group)) || cats[0];
    const span = cat.a1 - cat.a0, theta = cat.a0 + span * (0.15 + Math.random() * 0.7);
    const base = wheel.rot[w] - (wheel.rot[w] % 360);
    wheel.rot[w] = base + 360 * 6 + (360 - theta);
    const rot = body.querySelector('.wrot');
    rot.style.transition = 'transform 5s cubic-bezier(.1,.7,.1,1)';
    requestAnimationFrame(() => { rot.style.transform = `rotate(${wheel.rot[w]}deg)`; });
    await new Promise(r => setTimeout(r, 5300));
    if (prize.type === 'cons' || prize.type === 'cash') { showPrize(back, w, null, prize, dry, free); return; }   // гроші / пиріжок — без стрічки
    // стрічка з предметами категорії (випадковий порядок, однакова ширина карток), зупиняється на виграші
    const CARD = 120, WIN_AT = 42, N = 50;
    const pool = CATALOG.filter(c => c.group === prize.group && !c.hidden && !c.free && !c.standOf && !SIDE_B.has(c.id));
    const win = byId.get(prize.id) || pool[0];
    // без повторів: кожна річ категорії — один раз за «коло» (коло щоразу перемішане, на стику кіл — не підряд);
    // виграна річ — тільки одна, там, де зупиниться стрічка. Категорія з ≥50 речей — узагалі без повторів.
    const shuffle = a => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [r[i], r[k]] = [r[k], r[i]]; } return r; };
    const others = pool.filter(c => c.id !== win.id);    const fill = [];
    while (others.length && fill.length < N - 1) {
      const lap = shuffle(others);
      if (fill.length && lap.length > 1 && lap[0] === fill[fill.length - 1]) lap.push(lap.shift());
      fill.push(...lap);
    }
    while (fill.length < N - 1) fill.push(win);          // категорія з однієї речі
    const cards = fill.slice(0, N - 1);
    cards.splice(WIN_AT, 0, win);
    body.querySelector('.wstage').innerHTML = `<div class="wcat">${esc(prize.group)}</div><div class="wview"><div class="wmark"></div>
      <div class="wtrack">${cards.map(c => `<div class="wcard"><img src="${c.src}" alt=""><span>${esc(c.name)}</span></div>`).join('')}</div></div>`;
    const view = body.querySelector('.wview'), track = body.querySelector('.wtrack');
    const target = WIN_AT * CARD + CARD / 2 - view.clientWidth / 2 + (Math.random() - 0.5) * CARD * 0.6;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      track.style.transition = 'transform 5.5s cubic-bezier(.08,.6,.12,1)';
      track.style.transform = `translateX(${-target}px)`;
    }));
    await new Promise(r => setTimeout(r, 5700));
    track.children[WIN_AT].classList.add('win');
    await new Promise(r => setTimeout(r, 900));
    showPrize(back, w, win, prize, dry, free);
  }
  function showPrize(back, w, item, prize, dry, free = false) {
    wheel.busy = false;
    const body = back.querySelector('.wbody');
    const isItem = item && !item.cash;                       // річ (а не гроші / пиріжок)
    const got = (free ? '🎁 Безкоштовна спроба · ' : '') + (dry ? '🧪 Тест адміна — нічого не списано і не зараховано' : isItem ? `лежить у «🎒 Куплене» 🎡` : 'Зараховано на рахунок');
    body.innerHTML = `<div class="wprize"><div class="wbig">${dry ? '🧪 Випало б:' : '🎉 Вам випало!'}</div>${item ? `<img src="${item.src}" alt="">` : ''}
        <b>${isItem ? esc(item.name) : `${prize.usd ? fmtUsd(prize.usd) : `${prize.pies} 🥧`} на рахунок`}</b>
        <span>${isItem ? `Вартість: ${costText(item)} · ` : ''}${got}</span></div>
      <div class="wctrl"><button type="button" class="wspin">${dry ? '🧪 Ще раз як адмін' : '🎡 Ще раз'}</button><span class="wleft">${wheelLeftText(w)}</span><button type="button" class="wclose">Закрити</button></div>`;
    body.querySelector('.wspin').onclick = async () => {
      if (!dry) { back.remove(); openWheel(w); return; }
      back.remove(); await openWheel(w);                 // тест — одразу ще одна тестова спроба
      const nb = [...document.querySelectorAll('.wheelover')].pop();
      if (nb?.querySelector('.wdry')) spinIn(nb, w, true);
    };
    body.querySelector('.wclose').onclick = () => back.remove();
  }

  addEventListener('resize', layout);
  // перехід на іншу сторінку під час редагування: чернетку зберігаємо (запропонує відновити, коли повернешся), редагування ховаємо
  // Сайт відкриває профіль і через hashchange, і «тихо» через history.replaceState (список пілотів, пошук) — ловимо обидва
  let routePid = profilePilotId();
  function checkRoute() {
    const pid = profilePilotId();
    if (pid === routePid) return;
    routePid = pid;
    if (state.editing) { persistDraft(true); state.draftAsked = false; }
    state.editing = null; state.preview = false;
    setTimeout(render, 300);
  }
  addEventListener('hashchange', checkRoute);
  addEventListener('popstate', checkRoute);
  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function (...args) { const r = orig.apply(this, args); setTimeout(checkRoute, 0); return r; };
  });
  new MutationObserver(() => { if (infoTitle() && !document.querySelector('#profileView .devcab-open')) ensureOpenButton(); })
    .observe(document.body, {childList: true, subtree: true});
  setTimeout(render, 500);
  // ---------- 🎡 у шапці: чи є сьогодні безкоштовна прокрутка (сервер /wheel → limits.free) ----------
  let freeCheck = {at: 0, auth: null};
  function checkFreeSpin() {
    if (!state.auth || wheel.busy) return;
    if (freeCheck.auth === state.auth && Date.now() - freeCheck.at < 5 * 60e3) return;   // раз на 5 хв (і одразу після входу)
    freeCheck = {at: Date.now(), auth: state.auth};
    loadWheel().then(() => ensureHeaderLogin());
  }
  // клік по 🎡: свій профіль → «Облаштувати» (офіс) → вікно колеса
  async function openFreeWheel() {
    const me = state.auth;
    if (!me) return;
    if (profilePilotId() !== me) location.hash = `#profile/${encodeURIComponent(me)}`;
    for (let k = 0; k < 60; k++) {             // до ~18 с: чекаємо, поки відкриється профіль і прочитається кабінет
      if (profilePilotId() === me && (me in ACC.data) && infoTitle()) break;
      await new Promise(r => setTimeout(r, 300));
    }
    if (profilePilotId() !== me || !(me in ACC.data)) { toast('⚠ Кабінет ще не завантажився — спробуйте за хвилину.'); return; }
    if (!state.editing) { openEdit('office'); await new Promise(r => setTimeout(r, 300)); }
    if (state.editing) openWheel('pies');
  }
  ensureHeaderLogin();
  setInterval(() => { ensureOpenButton(); ensureHeaderLogin(); layout(); checkFreeSpin(); }, 1000);
  if (LOCAL) window.devCabinetReset = () => { Object.keys(localStorage).filter(k => k.startsWith('devIsoCabinet')).forEach(k => localStorage.removeItem(k)); location.reload(); };
})();
