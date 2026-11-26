const DB_FILES={archive:'flights-archive.json',current:'flights-current.json'};
const state={flights:[],allPilots:[],period:'today',sort:'minutes',direction:-1,referenceNow:null};
let insuranceCoverage=new Map();
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sum=(items,fn)=>items.reduce((total,item)=>total+(Number(fn(item))||0),0);

function dateOf(f){return new Date(f.times.actualArrival||f.times.closed||f.times.takeoff||f.times.scheduledDeparture)}
function money(value,signed=false){const v=Math.round(Number(value)||0);return `${v<0?'−':signed&&v>0?'+':''}$${Math.abs(v).toLocaleString('uk-UA')}`}
function formatMinutes(value){const m=Math.max(0,Math.round(Number(value)||0));return `${Math.floor(m/60)} год ${String(m%60).padStart(2,'0')} хв`}
function flightWord(count){const n=Math.abs(count)%100,m=n%10;return n>10&&n<20?'рейсів':m===1?'рейс':m>=2&&m<=4?'рейси':'рейсів'}
function pilotPay(f){return window.UCAAPilotPay.pay(f,insuranceCoverage.get(f)||0,state.flights)}
function pilotCompanyBalance(f){return (Number(f.finance.balance)||0)+(insuranceCoverage.get(f)||0)}

function bounds(period){
  const now=state.referenceNow||new Date();let start,end=now;
  if(period==='all')return null;
  if(period==='today')start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  if(period==='weekToDate'||period==='previousWeek'){
    const weekday=(now.getUTCDay()+6)%7;const monday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-weekday));
    if(period==='weekToDate')start=monday;else{start=new Date(monday.getTime()-7*86400000);end=monday}
  }
  if(period==='monthToDate')start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
  if(period==='previousMonth'){start=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1));end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1))}
  return {start,end};
}
function periodFlights(){const range=bounds(state.period);return range?state.flights.filter(f=>{const d=dateOf(f);return d>=range.start&&d<range.end}):state.flights}
function favorite(items,keyFn){const map=new Map();items.forEach(x=>{const key=keyFn(x);if(key)map.set(key,(map.get(key)||0)+1)});return [...map].map(([key,count])=>({key,count})).sort((a,b)=>b.count-a.count||a.key.localeCompare(b.key))[0]||null}

function aggregate(){
  insuranceCoverage=window.UCAAInsurance.coverageMap(state.flights);
  const selected=periodFlights();const byPilot=new Map(state.allPilots.map(p=>[p.id,{...p,flights:[]}]))
  selected.forEach(f=>byPilot.get(f.pilot.id)?.flights.push(f));
  return [...byPilot.values()].map(p=>{
    const completed=p.flights.filter(f=>f.status==='completed');const ratings=completed.map(f=>Number(f.rating)).filter(v=>v>0);
    const aircraft=favorite(completed,f=>`${f.aircraft.icao}|${f.aircraft.name}`);
    const airports=[];completed.forEach(f=>{airports.push(f.departure.icao,f.arrival.icao)});const airport=favorite(airports,x=>x);
    return {...p,completed:completed.length,minutes:sum(completed,f=>f.times.durationMinutes),rating:ratings.length?sum(ratings,x=>x)/ratings.length:0,salary:sum(p.flights,pilotPay),balance:sum(p.flights,pilotCompanyBalance),aircraft,airport,active:p.flights.length>0};
  });
}

function render(){
  const allRows=aggregate();const rows=allRows.filter(p=>p.minutes>0);const selected=periodFlights();const ok=selected.filter(f=>f.status==='completed');
  rows.sort((a,b)=>{const av=a[state.sort],bv=b[state.sort];if(typeof av==='string')return av.localeCompare(bv)*state.direction;return ((av||0)-(bv||0))*state.direction});
  $('#allPilots').textContent=allRows.length;$('#activePilots').textContent=rows.length;$('#periodFlights').textContent=ok.length;$('#periodHours').textContent=formatMinutes(sum(ok,f=>f.times.durationMinutes));
  $('#pilotsTable').innerHTML=rows.length?rows.map((p,i)=>`<tr><td class="rank">${i+1}</td><td><button class="pilot-name" data-pilot-id="${esc(p.id)}">${esc(p.name)}</button><span class="pilot-id">${esc(p.id)}</span></td><td class="num cell-small">${formatMinutes(p.minutes)}</td><td class="num">${p.completed}</td><td class="num">${p.rating?p.rating.toFixed(2):'—'}</td><td class="num cell-small">${money(p.salary)}</td><td class="num cell-small ${p.balance<0?'negative':p.balance>0?'positive':''}">${money(p.balance,true)}</td><td class="cell-small">${p.aircraft?`${esc(p.aircraft.key.split('|')[1])}<br><strong>${esc(p.aircraft.key.split('|')[0])}</strong> — ${p.aircraft.count} ${flightWord(p.aircraft.count)}`:'—'}</td><td class="cell-small">${p.airport?`${esc(p.airport.key)} · ${p.airport.count}`:'—'}</td></tr>`).join(''):'<tr><td colspan="9" class="loading">За вибраний період немає завершених рейсів</td></tr>';
  $$('#pilotsView .pilot-name[data-pilot-id]').forEach(button=>button.onclick=()=>window.UCAAPilotProfile.open(button.dataset.pilotId,state.flights));
  $$('#pilotsView .sortable').forEach(th=>{const active=th.dataset.sort===state.sort;th.querySelector('.sort-mark')?.remove();if(active)th.insertAdjacentHTML('beforeend',` <span class="sort-mark">${state.direction<0?'▼':'▲'}</span>`)});
}

async function load(){try{const loaded=await window.UCAAFlightData.loadWeeklyFlights(message=>{$('#dataStatus').textContent=message});const {archive,current}=loaded;state.flights=loaded.flights;window.UCAAPilotProfile.setFlights(state.flights);const pilots=new Map();state.flights.forEach(f=>pilots.set(f.pilot.id,{id:f.pilot.id,name:f.pilot.name}));state.allPilots=[...pilots.values()].sort((a,b)=>a.name.localeCompare(b.name));const latest=loaded.latest||[...state.flights].sort((a,b)=>dateOf(b)-dateOf(a))[0];state.referenceNow=latest?new Date(dateOf(latest).getTime()+1):new Date();$('#dataStatus').innerHTML=`за цей тиждень: ${current.flights.length} · минулі тижні: ${archive.flights.length}<br>оновлено ${latest?dateOf(latest).toLocaleString('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'}`;render()}catch(error){console.error(error);$('#dataStatus').textContent='Помилка завантаження FLIGHTS';$('#pilotsTable').innerHTML='<tr><td colspan="9" class="loading negative">Не вдалося прочитати тижневі JSON-файли з папки FLIGHTS.</td></tr>'}}
$$('#pilotsView [data-period]').forEach(button=>button.onclick=()=>{state.period=button.dataset.period;$$('#pilotsView [data-period]').forEach(x=>x.classList.toggle('active',x===button));render()});
$$('#pilotsView .sortable').forEach(th=>th.onclick=()=>{if(state.sort===th.dataset.sort)state.direction*=-1;else{state.sort=th.dataset.sort;state.direction=th.dataset.sort==='name'?1:-1}render()});
load();
addEventListener('ucaa-flights-updated',event=>{const loaded=event.detail;state.flights=loaded.flights;window.UCAAPilotProfile.setFlights(state.flights);const pilots=new Map();state.flights.forEach(f=>pilots.set(f.pilot.id,{id:f.pilot.id,name:f.pilot.name}));state.allPilots=[...pilots.values()].sort((a,b)=>a.name.localeCompare(b.name));const latest=loaded.latest||[...state.flights].sort((a,b)=>dateOf(b)-dateOf(a))[0];state.referenceNow=latest?new Date(dateOf(latest).getTime()+1):new Date();$('#dataStatus').innerHTML=`за цей тиждень: ${loaded.current.flights.length} · минулі тижні: ${loaded.archive.flights.length}<br>оновлено ${latest?dateOf(latest).toLocaleString('uk-UA',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'}`;render()});
