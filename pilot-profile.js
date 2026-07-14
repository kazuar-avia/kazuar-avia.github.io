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
  const FLIGHT_PERIODS = PERIODS;
  let current = null;
  let referenceNow = null;
  let availableFlights = [];
  let insuranceCoverage = new Map();

  const esc = value => String(value ?? '').replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
  const sum = (items, fn) => items.reduce((total, item) => total + (Number(fn(item)) || 0), 0);
  const dateOf = flight => new Date(flight.times.actualArrival || flight.times.closed || flight.times.takeoff || flight.times.scheduledDeparture);
  const formatMinutes = value => {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(minutes / 60)} год ${String(minutes % 60).padStart(2, '0')} хв`;
  };
  const compactTime = value => {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
  };
  const money = (value, signed = false) => {
    const amount = Math.round(Number(value) || 0);
    return `${amount < 0 ? '−' : signed && amount > 0 ? '+' : ''}$${Math.abs(amount).toLocaleString('uk-UA')}`;
  };
  const flightWord = count => {
    const n = Math.abs(count) % 100, last = n % 10;
    return n > 10 && n < 20 ? 'рейсів' : last === 1 ? 'рейс' : last >= 2 && last <= 4 ? 'рейси' : 'рейсів';
  };

  function aircraftCoefficient(icao = '') {
    return window.UCAAPilotPay.aircraftCoefficient(icao);
  }

  function pilotPay(flight) {
    return window.UCAAPilotPay.pay(flight, insuranceCoverage.get(flight) || 0, availableFlights);
  }

  const pilotCompanyBalance = flight => (Number(flight.finance.balance) || 0) + (insuranceCoverage.get(flight) || 0);
  const recentBalanceCell = flight => {
    const balance = pilotCompanyBalance(flight);
    const covered = insuranceCoverage.get(flight) || 0;
    return `<span class="${balance >= 0 ? 'positive' : 'negative'}">${money(balance, true)}</span>${covered ? `<br><small class="positive">страх. +${money(covered)}</small>` : ''}`;
  };
  const insuranceBreakdown = summary => {
    const companyCovered = Math.max(0, summary.criticalDamage - summary.insuranceCovered);
    return `<div class="insurance-breakdown">*Штрафи NewSky: <b class="negative">${money(-summary.penalties)}</b> (з них страхові випадки від $150 000: <b class="negative">${money(-summary.criticalDamage)}</b>, з яких покрито страховкою: <b class="positive">${money(summary.insuranceCovered, true)}</b>, не покрито через місячний ліміт: <b class="negative">${money(-companyCovered)}</b>)</div>`;
  };

  function favorite(items, keyFn) {
    const counts = new Map();
    items.forEach(item => {
      const key = keyFn(item);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts].map(([key, count]) => ({key, count})).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))[0] || null;
  }

  function periodBounds(period) {
    const now = referenceNow || new Date();
    if (period === 'all') return null;
    let start, end = now;
    if (period === 'today') start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (period === 'weekToDate' || period === 'previousWeek') {
      const weekday = (now.getUTCDay() + 6) % 7;
      const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - weekday));
      if (period === 'weekToDate') start = monday;
      else { start = new Date(monday.getTime() - 7 * 86400000); end = monday; }
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

  function defaultRecentPeriod(flights) {
    if (filterPeriod(flights, 'today').length) return 'today';
    if (filterPeriod(flights, 'weekToDate').length) return 'weekToDate';
    if (filterPeriod(flights, 'monthToDate').length) return 'monthToDate';
    if (filterPeriod(flights, 'previousMonth').length) return 'previousMonth';
    return 'all';
  }

  function defaultStatisticsPeriod(flights) {
    const hasCompleted = period => filterPeriod(flights, period).some(flight => flight.status === 'completed' && Number(flight.times.durationMinutes) > 0);
    if (hasCompleted('today')) return 'today';
    if (hasCompleted('weekToDate')) return 'weekToDate';
    if (hasCompleted('monthToDate')) return 'monthToDate';
    if (hasCompleted('previousMonth')) return 'previousMonth';
    return 'all';
  }

  function recentFlightsForSelection(flights, period) {
    const label = PERIODS.find(([key]) => key === period)?.[1] || 'Весь період';
    return {label: label.toUpperCase(), flights: filterPeriod(flights, period)};
  }

  function summarize(id, flights) {
    const list = flights.filter(flight => flight.pilot.id === id);
    const completed = list.filter(flight => flight.status === 'completed');
    const ratings = completed.map(flight => Number(flight.rating)).filter(value => value > 0);
    const aircraft = favorite(completed, flight => `${flight.aircraft.icao}|${flight.aircraft.name}`);
    const route = favorite(completed, flight => `${flight.departure.icao} → ${flight.arrival.icao}`);
    const airports = [];
    completed.forEach(flight => airports.push(flight.departure.icao, flight.arrival.icao));
    const airport = favorite(airports, value => value);
    return {
      id,
      name: list[0]?.pilot.name || 'Пілот',
      list,
      completed,
      minutes: sum(completed, flight => flight.times.durationMinutes),
      rating: ratings.length ? sum(ratings, value => value) / ratings.length : 0,
      salary: sum(list, pilotPay),
      balance: sum(list, pilotCompanyBalance),
      penalties: sum(list, flight => flight.finance.penalties),
      criticalDamage: sum(list, flight => window.UCAAInsurance.eligibleDamage(flight)),
      insuranceCovered: sum(list, flight => insuranceCoverage.get(flight) || 0),
      aircraft,
      route,
      airport
    };
  }

  function ensureProfilePage() {
    const content = document.querySelector('#profilePageContent');
    const pickerButton = document.querySelector('#profileTabLink');
    const pickerList = document.querySelector('#pilotPickerList');
    if (!document.querySelector('#ucaa-profile-style')) {
      const style = document.createElement('style');
      style.id = 'ucaa-profile-style';
      style.textContent = `
        .profile-page .profile{padding:4px 0}.identity{display:flex;gap:10px;align-items:center;margin-bottom:8px}.avatar{width:58px;height:58px;border:1px solid #555;background:linear-gradient(145deg,#caeef2,#f7e7f8);display:grid;place-items:center;font-size:25px;font-weight:bold}.identity h3{margin:0 0 3px;font-size:19px}.badge{display:inline-block;border:1px solid #777;background:#ffee8c;padding:2px 6px;font-size:11px}
        .profile-period{border:1px solid #555;background:#f7e7f8;padding:6px;margin-top:7px}.profile-period-title{font-weight:bold;margin-bottom:5px}.profile-periods{display:flex;gap:4px;flex-wrap:wrap}.profile-periods button{border:1px solid #777;background:#fff;padding:4px 8px;cursor:pointer}.profile-periods button.active{background:#d8f5e6;border-color:#17804c;font-weight:bold}.profile-periods button:hover{background:#fff7c7}
        .profile-table-wrap{overflow:auto;border:1px solid #777;margin-top:7px}.profile table{border-collapse:collapse;width:100%}.profile th,.profile td{border:1px solid #888;padding:5px;text-align:left;word-break:normal}.profile th{background:#eee;font-size:11px}.profile .num{text-align:right}.profile .positive{color:#08783f;font-weight:bold}.profile .negative{color:#a40000;font-weight:bold}.period-stat-table{table-layout:fixed;min-width:820px;font-size:11px}.period-stat-table th,.period-stat-table td{vertical-align:top}.compact-stats{table-layout:fixed}.compact-stats th{width:22%}.compact-stats td{width:28%;font-family:Consolas,monospace;font-size:14px;font-weight:bold}.compact-stats .divider{color:#888;padding:0 5px}.insurance-breakdown{border:1px solid #888;border-top:0;background:#fffbe3;padding:6px;font-size:10.5px;white-space:nowrap;overflow-x:auto}.profile-split{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.mini-title{font-weight:bold;background:#eee;border:1px solid #888;border-bottom:0;padding:5px}.recent-wrap{max-height:430px;overflow:auto;border:1px solid #888}.recent-table{table-layout:fixed;min-width:820px;font-size:12.5px}.recent-table th{position:sticky;top:0;z-index:1;font-size:12px}.recent-table th,.recent-table td{padding:6px;vertical-align:middle}.recent-table th:nth-child(n+2),.recent-table td:nth-child(n+2){text-align:center}.recent-table td.finance-click-cell{font-size:14px;text-align:center;cursor:pointer;font-weight:bold}.recent-table td.finance-click-cell:hover,.recent-table td.finance-click-cell:focus{background:#fff7c7;outline:0}.profile-note{font-size:11px;color:#666}.status-failed{color:#a40000;font-weight:bold}
        @media(max-width:700px){.profile-split{grid-template-columns:1fr}.profile-table-wrap,.recent-wrap{overflow:auto}}
      `;
      document.head.appendChild(style);
    }
    return {content, pickerButton, pickerList};
  }

  function renderPicker() {
    const page = ensureProfilePage();
    const pilots = [...new Set(availableFlights.map(flight => flight.pilot.id))]
      .map(id => summarize(id, availableFlights))
      .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
    page.pickerList.style.gridTemplateRows = `repeat(${Math.ceil(pilots.length / 3)}, auto)`;
    page.pickerList.innerHTML = pilots.map((pilot, index) => `
      <button type="button" data-picker-pilot="${esc(pilot.id)}"><span class="picker-rank">#${index + 1}</span><strong>${esc(pilot.name)}</strong><span class="picker-hours">${compactTime(pilot.minutes)}</span></button>
    `).join('');
    page.pickerList.querySelectorAll('[data-picker-pilot]').forEach(button => button.onclick = () => open(button.dataset.pickerPilot, availableFlights));
    page.pickerButton.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      page.pickerList.hidden = !page.pickerList.hidden;
      page.pickerButton.setAttribute('aria-expanded', String(!page.pickerList.hidden));
    };
  }

  function recentFlightRow(flight) {
    const ui = window.UCAADashboardFlightUI;
    if (!ui) return '';
    const date = dateOf(flight);
    const direct = ui.directFlightFinance(flight);
    const salaryVisual = ui.pilotSalaryVisual(flight, direct);
    const profitVisual = ui.companyProfitVisual(flight, direct);
    const operation = ui.flightOperation(flight);
    const payloadKind = ui.flightPayloadKind(flight);
    const rating = ui.flightRatingPresentation(flight);
    return `<tr>
      <td>${date.toLocaleDateString('uk-UA',{timeZone:'UTC'})}<span class="date-flight-meta"><span class="date-flight-time">${date.toLocaleTimeString('uk-UA',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'})}</span><a class="flight-number-link flight-number-${operation.key}" href="https://newsky.app/flight/${encodeURIComponent(flight.id)}" target="_blank" rel="noopener" title="${operation.label}">${esc(flight.flightNumber||'—')}</a></span></td>
      <td class="route"><span class="route-airports">${ui.airportWithFlag(flight.departure)} → ${ui.airportWithFlag(flight.arrival)}</span><span class="route-duration">${formatMinutes(flight.times.durationMinutes)}</span></td>
      <td>${esc(flight.aircraft.name)}<span class="flight-note">${esc(ui.aircraftTableNote ? ui.aircraftTableNote(flight) : flight.aircraft.icao)}</span></td>
      <td><span class="payload-value" title="${payloadKind.label}">${esc(ui.flightLoad(flight))}<span class="load-kind-icon" aria-hidden="true">${payloadKind.icon}</span></span></td>
      <td class="rating-cell profile-rating-detail" data-flight-id="${esc(flight.id)}" role="button" tabindex="0"><span class="rating-badge ${rating.className}">${rating.label}</span><span class="landing-line">${ui.landingStats(flight)}</span></td>
      <td class="finance-click-cell profile-company-profit-detail ${profitVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(direct.companyProfit,true)}${profitVisual.notes.map(note=>`<span class="profit-incident-note ${note.className}">${esc(note.text)}</span>`).join('')}</td>
      <td class="finance-click-cell profile-pilot-salary-detail ${salaryVisual.className}" data-flight-id="${esc(flight.id)}" role="button" tabindex="0">${money(direct.pilotSalary,true)}${salaryVisual.note?`<span class="profit-incident-note ${salaryVisual.noteClass||''}">${esc(salaryVisual.note)}</span>`:''}</td>
    </tr>`;
  }

  function render() {
    const {id, flights, period, recentPeriod} = current;
    const page = ensureProfilePage();
    const lifetime = summarize(id, flights);
    const selected = summarize(id, filterPeriod(flights, period));
    const monthSummary = summarize(id, filterPeriod(flights, 'monthToDate'));
    const weekSummary = summarize(id, filterPeriod(flights, 'weekToDate'));
    const first = [...lifetime.list].sort((a, b) => dateOf(a) - dateOf(b))[0];
    const recentSource = recentFlightsForSelection(lifetime.list, recentPeriod);
    const recent = [...recentSource.flights].filter(flight => flight.status === 'completed').sort((a, b) => dateOf(b) - dateOf(a));
    const aircraft = selected.aircraft?.key.split('|');
    const allIds = [...new Set(flights.map(flight => flight.pilot.id))];
    const lifetimeSummaries = allIds.map(pilotId => summarize(pilotId, flights));
    const hoursRank = [...lifetimeSummaries].sort((a,b) => b.minutes-a.minutes).findIndex(p => p.id === id) + 1;
    const balanceRank = [...lifetimeSummaries].sort((a,b) => b.balance-a.balance).findIndex(p => p.id === id) + 1;

    page.content.innerHTML = `<div class="profile">
      <div class="identity"><div class="avatar">${esc(lifetime.name.split(' ').map(part => part[0]).join('').slice(0,2))}</div><div><h3>${esc(lifetime.name)}</h3><span class="badge">Пілот</span> <small>ID: ${esc(id)}</small><br><small>Перша зафіксована активність: ${dateOf(first).toLocaleDateString('uk-UA',{timeZone:'UTC'})}</small></div></div>
      <div class="mini-title">ЗАГАЛЬНА ЛЬОТНА СТАТИСТИКА, РЕЙТИНГ І ФІНАНСИ</div><table class="compact-stats"><tr><th>Весь період</th><td>${compactTime(lifetime.minutes)}<span class="divider">|</span>${lifetime.completed.length} ${flightWord(lifetime.completed.length)}</td><th>Місце за нальотом в АК</th><td class="num">#${hoursRank}</td></tr><tr><th>З початку місяця</th><td>${compactTime(monthSummary.minutes)}<span class="divider">|</span>${monthSummary.completed.length} ${flightWord(monthSummary.completed.length)}</td><th>Заробітна плата пілота за весь час</th><td class="num">${money(lifetime.salary)}</td></tr><tr><th>З початку тижня</th><td>${compactTime(weekSummary.minutes)}<span class="divider">|</span>${weekSummary.completed.length} ${flightWord(weekSummary.completed.length)}</td><th>Прибуток для АК / Штрафи</th><td class="num"><span class="${lifetime.balance>=0?'positive':'negative'}">${money(lifetime.balance,true)}</span><span class="divider">/</span><span class="negative">${money(Math.max(0, lifetime.penalties - lifetime.criticalDamage))}*</span></td></tr><tr><th>Середній рейтинг</th><td>${lifetime.rating?lifetime.rating.toFixed(2):'—'} / 10</td><th>Місце за прибутком для АК</th><td class="num">#${balanceRank}</td></tr></table>
      ${insuranceBreakdown(lifetime)}
      <div class="profile-period"><div class="profile-period-title">ПЕРІОД СТАТИСТИКИ:</div><div class="profile-periods">${PERIODS.map(([key,label]) => `<button data-profile-period="${key}" class="${key===period?'active':''}">${label}</button>`).join('')}</div></div>
      <div class="profile-table-wrap"><table class="period-stat-table"><colgroup><col style="width:12%"><col style="width:8%"><col style="width:11%"><col style="width:13%"><col style="width:13%"><col style="width:25%"><col style="width:18%"></colgroup><thead><tr><th>Наліт<br>за період</th><th>Рейсів<br>за період</th><th>Середній рейтинг<br>за період</th><th>Зарплата<br>за період*</th><th>Зароблено для АК<br>за період</th><th>Улюблений літак<br>за період</th><th>Улюблений аеропорт<br>за період</th></tr></thead><tbody><tr><td>${formatMinutes(selected.minutes)}</td><td class="num">${selected.completed.length}</td><td class="num">${selected.rating?selected.rating.toFixed(2):'—'}</td><td class="num">${money(selected.salary)}</td><td class="num ${selected.balance<0?'negative':selected.balance>0?'positive':''}">${money(selected.balance,true)}</td><td>${aircraft?`${esc(aircraft[1])}<br><strong>${esc(aircraft[0])}</strong> — ${selected.aircraft.count} ${flightWord(selected.aircraft.count)}`:'—'}</td><td>${selected.airport?`${esc(selected.airport.key)} — ${selected.airport.count}`:'—'}</td></tr></tbody></table></div>
      <div class="profile-period"><div class="profile-period-title">ПЕРІОД ВІДОБРАЖЕННЯ РЕЙСІВ:</div><div class="profile-periods">${FLIGHT_PERIODS.map(([key,label]) => `<button data-flight-period="${key}" class="${key===recentPeriod?'active':''}">${label}</button>`).join('')}</div></div>
      <div class="mini-title" style="margin-top:8px">ОСТАННІ РЕЙСИ — ${recentSource.label}</div><div class="recent-wrap"><table class="recent-table dashboard-flight-table"><colgroup><col style="width:12%"><col style="width:16%"><col style="width:22%"><col style="width:9%"><col style="width:14%"><col style="width:15%"><col style="width:12%"></colgroup><thead><tr><th>Дата /<br>Рейс</th><th>Маршрут</th><th>Літак</th><th>Пейлоад</th><th>Рейтинг /<br>посадка</th><th>Прибуток<br>авіакомпанії</th><th>Зарплата<br>пілота</th></tr></thead><tbody>${recent.length?recent.map(recentFlightRow).join(''):'<tr><td colspan="7" style="text-align:center;padding:14px">За вибраний період рейсів немає</td></tr>'}</tbody></table></div>
      <p class="profile-note">* Персональна ставка формується з базових $65 / год, лояльності та регулярності, але не перевищує $130 / год. Зарплата включає одну годину підготовки, льотні коефіцієнти й премію до $2 500; утримання застосовуються за затримки та страхові випадки.</p></div>
    `;
    page.content.querySelectorAll('[data-profile-period]').forEach(button => button.onclick = () => {
      current.period = button.dataset.profilePeriod;
      render();
    });
    page.content.querySelectorAll('[data-flight-period]').forEach(button => button.onclick = () => {
      current.recentPeriod = button.dataset.flightPeriod;
      render();
    });
    const flightById = id => recent.find(flight => flight.id === id);
    const bindFlightDetail = (selector, type) => page.content.querySelectorAll(selector).forEach(cell => {
      cell.onclick = () => {
        const flight = flightById(cell.dataset.flightId);
        if (flight) window.UCAADashboardFlightUI?.openFlightInfo(flight, type);
      };
      cell.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          cell.click();
        }
      };
    });
    bindFlightDetail('.profile-rating-detail', 'rating');
    bindFlightDetail('.profile-company-profit-detail', 'finance');
    bindFlightDetail('.profile-pilot-salary-detail', 'salary');
    page.pickerButton.setAttribute('aria-expanded', 'false');
    page.pickerList.hidden = true;
    const tab = document.querySelector('#profileTabLink');
    if (tab) tab.textContent = `Профіль ${lifetime.name}`;
  }

  function open(id, flights) {
    setFlights(flights);
    const latest = [...flights].sort((a, b) => dateOf(b) - dateOf(a))[0];
    referenceNow = latest ? new Date(dateOf(latest).getTime() + 1) : new Date();
    const pilotFlights = flights.filter(flight => flight.pilot.id === id);
    current = {
      id,
      flights,
      period: defaultStatisticsPeriod(pilotFlights),
      recentPeriod: defaultRecentPeriod(pilotFlights)
    };
    render();
    if (location.hash !== '#profile') location.hash = 'profile';
  }

  function setFlights(flights) {
    availableFlights = Array.isArray(flights) ? flights : [];
    insuranceCoverage = window.UCAAInsurance.coverageMap(availableFlights);
    renderPicker();
    if (current) {
      const latest = [...availableFlights].sort((a, b) => dateOf(b) - dateOf(a))[0];
      referenceNow = latest ? new Date(dateOf(latest).getTime() + 1) : new Date();
      current.flights = availableFlights;
      render();
    }
  }

  addEventListener('hashchange', () => {
    if (location.hash === '#profile' && !current) {
      const page = ensureProfilePage();
      page.pickerList.hidden = false;
      page.pickerButton.setAttribute('aria-expanded', 'true');
    }
  });
  document.addEventListener('click', event => {
    const page = ensureProfilePage();
    if (!event.target.closest('#profileTabLink') && !event.target.closest('#pilotPickerList')) {
      page.pickerList.hidden = true;
      page.pickerButton.setAttribute('aria-expanded', 'false');
    }
  });

  window.UCAAPilotProfile = {open, setFlights};
})();
