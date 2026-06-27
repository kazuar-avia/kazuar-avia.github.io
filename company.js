const $c = selector => document.querySelector(selector);
const escC = value => String(value ?? '').replace(/[&<>"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
const moneyC = (value, signed = false) => {
  const amount = Math.round(Number(value) || 0);
  return `${amount < 0 ? '−' : signed && amount > 0 ? '+' : ''}$${Math.abs(amount).toLocaleString('uk-UA')}`;
};
const compactMoneyC = value => {
  const amount = Math.abs(Number(value) || 0);
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}K`;
  return moneyC(amount);
};
const compactMinutesC = value => {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
};

let companyDataCache = null;
let companyFlightsCache = [];
let fleetRowsCache = [];
const fleetSort = {key:'flights', direction:-1};
let financePeriod = 'monthToDate';

const closeDateC = flight => new Date(flight.times.closed || flight.times.actualArrival || flight.times.takeoff || flight.times.scheduledDeparture);
const sumC = (items, fn) => items.reduce((total, item) => total + (Number(fn(item)) || 0), 0);
const pilotPayC = (flight, coverage, allFlights) => flight.status !== 'completed' ? 0
  : window.UCAAPilotPay.pay(flight, coverage.get(flight) || 0, allFlights);
const cabinCrewPayC = flight => {
  if (flight.status !== 'completed') return 0;
  const hours = (Number(flight.times.durationMinutes)||0)/60;
  const crew = String(flight.flightType).toLowerCase() === 'cargo'
    ? 1 : Math.ceil((Number(flight.operations?.passengers)||0)/50);
  return hours*50*crew;
};

function financeSelection(period, flights) {
  const latest = [...flights].sort((a,b) => closeDateC(b) - closeDateC(a))[0];
  const latestDate = latest ? closeDateC(latest) : new Date();
  const actualNow = new Date();
  const now = actualNow >= latestDate && actualNow - latestDate < 3 * 86400000 ? actualNow : new Date(latestDate.getTime() + 1);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let start, end = now, label;
  if (period === 'today') { start = today; end = now; label = 'За сьогодні'; }
  else if (period === 'yesterday') { start = new Date(today.getTime() - 86400000); end = today; label = 'За вчора'; }
  else if (period === 'sinceRestructure') { start = new Date('2026-05-01T00:00:00Z'); end = today; label = 'З 01.05.2026'; }
  else if (period === 'weekToDate' || period === 'previousWeek') {
    const weekday = (now.getUTCDay() + 6) % 7;
    const monday = new Date(today.getTime() - weekday * 86400000);
    if (period === 'weekToDate') { start = monday; end = today; label = 'З початку тижня'; }
    else { start = new Date(monday.getTime() - 7 * 86400000); end = monday; label = 'Минулий тиждень'; }
  } else if (period === 'monthToDate') { start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); end = today; label = 'З початку місяця'; }
  else if (period === 'previousMonth') { start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); label = 'Минулий місяць'; }
  else {
    const dates = flights.map(closeDateC).filter(date => !Number.isNaN(date.getTime()));
    start = new Date(Math.min(...dates)); end = today; label = 'Весь період';
  }
  return {start, end, label, flights:flights.filter(flight => { const date = closeDateC(flight); return date >= start && date < end; })};
}

function fixedCostsForSelection(data, start, end) {
  const fixed = data.economy.fixedCosts;
  const reliableFrom = new Date(`${data.economy.baseline.from}T00:00:00Z`);
  start = new Date(Math.max(start.getTime(), reliableFrom.getTime()));
  if (start >= end) return {fleet:0, airports:0, handling:0, schedulers:0};
  const averages = {fleet:fixed.fleet/fixed.days, airports:fixed.airports/fixed.days, handling:fixed.handling/fixed.days, schedulers:fixed.schedulers/fixed.days};
  const calibration = new Map((data.economy.calibrationDays || []).map(day => [day.date, day]));
  const result = {fleet:0, airports:0, handling:0, schedulers:0};
  const startDay = new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),start.getUTCDate()));
  const boundary = end.getUTCHours() === 0 && end.getUTCMinutes() === 0 && end.getUTCSeconds() === 0;
  const endDay = new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),end.getUTCDate() + (boundary ? 0 : 1)));
  for (let day=startDay; day<endDay; day=new Date(day.getTime()+86400000)) {
    const exact = calibration.get(day.toISOString().slice(0,10));
    result.fleet += exact?.fleetFixed ?? averages.fleet;
    result.airports += exact?.airportFixed ?? averages.airports;
    result.handling += exact?.handlingExtra ?? averages.handling;
    result.schedulers += exact?.schedulers ?? averages.schedulers;
  }
  return result;
}

function aggregateFleet(data, flights) {
  const variantToBase = new Map();
  const rows = new Map();
  data.fleet.types.forEach(type => {
    const row = {icao:type.icao, variants:[...type.variants], aircraft:type.aircraft, flights:0, minutes:0, revenue:0, expenses:0, balance:0, balancePerAircraft:0};
    rows.set(type.icao, row);
    variantToBase.set(type.icao, type.icao);
    type.variants.forEach(variant => variantToBase.set(variant, type.icao));
  });
  flights.filter(flight => flight.status === 'completed').forEach(flight => {
    const variant = flight.aircraft.icao || 'UNKNOWN';
    const base = variantToBase.get(variant) || variant;
    if (!rows.has(base)) rows.set(base, {icao:base, variants:[variant], aircraft:0, flights:0, minutes:0, revenue:0, expenses:0, balance:0, balancePerAircraft:0});
    const row = rows.get(base);
    if (!row.variants.includes(variant)) row.variants.push(variant);
    row.flights += 1;
    row.minutes += Number(flight.times.durationMinutes) || 0;
    row.revenue += Number(flight.finance.revenue) || 0;
    row.expenses += (Number(flight.finance.expenses) || 0) + (Number(flight.finance.penalties) || 0);
    row.balance += Number(flight.finance.balance) || 0;
  });
  rows.forEach(row => {
    row.balancePerAircraft = row.aircraft ? row.balance / row.aircraft : row.balance;
  });
  return [...rows.values()].sort((a,b) => b.aircraft-a.aircraft || b.flights-a.flights || a.icao.localeCompare(b.icao));
}

function renderFleetTable() {
  const rows = [...fleetRowsCache].sort((a,b) => {
    if (fleetSort.key === 'icao') return a.icao.localeCompare(b.icao) * fleetSort.direction;
    if (fleetSort.key === 'variants') return a.variants.join(',').localeCompare(b.variants.join(',')) * fleetSort.direction;
    return ((a[fleetSort.key] || 0) - (b[fleetSort.key] || 0)) * fleetSort.direction || a.icao.localeCompare(b.icao);
  });
  $c('#fleetTypesBody').innerHTML = rows.map(type => `<tr><td><strong>${escC(type.icao)}</strong></td><td>${escC(type.variants.join(', '))}</td><td class="num">${type.aircraft || '—'}</td><td class="num">${type.flights}</td><td class="num">${compactMinutesC(type.minutes)}</td><td class="num positive">${moneyC(type.revenue)}</td><td class="num negative">${moneyC(type.expenses)}</td><td class="num ${type.balance >= 0 ? 'positive' : 'negative'}">${moneyC(type.balance, true)}</td></tr>`).join('');
  $c('#fleetTypesBody').querySelectorAll('tr').forEach((row, index) => {
    const type = rows[index];
    if (!type) return;
    const cell = document.createElement('td');
    cell.className = `num ${type.balancePerAircraft >= 0 ? 'positive' : 'negative'}`;
    cell.textContent = moneyC(type.balancePerAircraft, true);
    row.appendChild(cell);
  });
  document.querySelectorAll('#companyView [data-company-sort]').forEach(header => {
    header.querySelector('.company-sort-mark')?.remove();
    if (header.dataset.companySort === fleetSort.key) header.insertAdjacentHTML('beforeend', ` <span class="company-sort-mark">${fleetSort.direction < 0 ? '▼' : '▲'}</span>`);
  });
}

function renderCompany(data, flights) {
  const selection = financeSelection(financePeriod, flights);
  const fixed = fixedCostsForSelection(data, selection.start, selection.end);
  const selected = selection.flights;
  const economy = {
    revenue:sumC(selected, flight => flight.finance.revenue),
    penalties:sumC(selected, flight => flight.finance.penalties),
    schedulers:fixed.schedulers,
    airports:sumC(selected, flight => flight.finance.details?.landing) + fixed.airports,
    handling:sumC(selected, flight => flight.finance.details?.handling) + fixed.handling,
    fleet:sumC(selected, flight => flight.finance.details?.aircraft) + fixed.fleet,
    fuel:sumC(selected, flight => flight.finance.details?.fuel) + 0
  };
  const insurance = window.UCAAInsurance.summary(flights, selection.start, selection.end);
  const payroll = sumC(selected, flight => pilotPayC(flight, insurance.coverageByFlight, flights));
  const cabinCrewPayroll = sumC(selected, cabinCrewPayC);
  const incidentCompensation = sumC(selected, flight => window.UCAAIncidentCompensation.breakdown(
    flight, insurance.coverageByFlight.get(flight) || 0, flights
  ).compensation);
  const categories = [
    ['Дохід', economy.revenue, '#82ca87'], ['Страхове відшкодування', insurance.payout, '#4b9f68'],
    ['Штрафи та інциденти', economy.penalties, '#d8333d'],
    ['Моральні компенсації / Пошкоджений вантаж', incidentCompensation, '#ef9f76'], ['Страхування', insurance.premium, '#7c5cc4'],
    ['Маршрути для регулярки', economy.schedulers, '#70c7e8'], ['Аеропортові збори', economy.airports, '#ffa62b'],
    ['Хендлінг', economy.handling, '#37afb3'], ['Флот (лізинг)', economy.fleet, '#949dd1'], ['Пальне', economy.fuel, '#ffd35a'],
    ['Зарплата пілотам', payroll, '#e89ac7'],
    ['Зарплата бортпровідникам', cabinCrewPayroll, '#d7a6e8']
  ];
  const income = economy.revenue + insurance.payout;
  const expenses = economy.penalties + incidentCompensation + insurance.premium + economy.schedulers + economy.airports + economy.handling + economy.fleet + economy.fuel + payroll + cabinCrewPayroll;
  const circleTotal = categories.reduce((total, item) => total + item[1], 0);
  const balance = income - expenses;
  let cursor = 0;
  const stops = categories.map(([, value, color]) => { const start = cursor; cursor += value / circleTotal * 100; return `${color} ${start.toFixed(3)}% ${cursor.toFixed(3)}%`; });
  $c('#financePie').style.background = `conic-gradient(${stops.join(',')})`;
  $c('#financeLegend').innerHTML = categories.map(([label,value,color]) => `<div><i class="finance-dot" style="background:${color}"></i><span>${label}</span><strong>${compactMoneyC(value)}</strong></div>`).join('') + `<div class="finance-total"><span></span><span></span><strong class="${balance >= 0 ? 'positive' : 'negative'}">${moneyC(balance, true)}</strong></div>`;
  $c('#companyPeriodBalance').textContent = moneyC(balance, true);
  $c('#companyPeriodBalance').className = balance >= 0 ? 'positive' : 'negative';
  $c('#companyPeriodLabel').textContent = selection.label;
  $c('#companyRevenueShare').textContent = `${circleTotal ? (economy.revenue / circleTotal * 100).toFixed(1) : '0.0'}%`;
  $c('#companyFleetCount').textContent = `${data.fleet.count} літаків`;
  $c('#companyFleetTypes').textContent = `${data.fleet.typeCount} базові типи`;
  $c('#companyScheduleCount').textContent = `${data.schedules.active} активних`;
  $c('#companyScheduleDays').textContent = `${data.schedules.activeDaysPerWeek} платних днів маршрутів / тиждень`;

  fleetRowsCache = aggregateFleet(data, flights);
  renderFleetTable();
}

document.querySelectorAll('#companyView [data-company-sort]').forEach(header => header.onclick = () => {
  const key = header.dataset.companySort;
  if (fleetSort.key === key) fleetSort.direction *= -1;
  else { fleetSort.key = key; fleetSort.direction = key === 'icao' || key === 'variants' ? 1 : -1; }
  renderFleetTable();
});

$c('#companyFinancePeriod').onchange = event => {
  financePeriod = event.target.value;
  if (companyDataCache) renderCompany(companyDataCache, companyFlightsCache);
};

Promise.all([
  fetch('COMPANY/company-data.json', {cache:'default'}).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }),
  window.UCAAFlightData.loadWeeklyFlights()
]).then(([data, loaded]) => {
  companyDataCache = data;
  companyFlightsCache = loaded.flights;
  renderCompany(data, loaded.flights);
}).catch(error => {
  console.error(error);
  $c('#fleetTypesBody').innerHTML = '<tr><td colspan="9" class="loading negative">Не вдалося завантажити дані флоту або польотів</td></tr>';
});

addEventListener('ucaa-flights-updated', event => {
  companyFlightsCache = event.detail.flights;
  if (companyDataCache) renderCompany(companyDataCache, companyFlightsCache);
});
