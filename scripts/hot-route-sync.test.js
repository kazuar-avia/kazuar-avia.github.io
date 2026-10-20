const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {buildTopPool, refreshHotPool} = require('./update-top-pool.js');
const rewards = require('../pie-rewards.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pilot-cabinet.js'), 'utf8');
const generated = '2026-10-03T12:00:00Z';
const now = new Date('2026-10-03T12:05:00Z');
function candidate(change = {}) {
  return {aircraftId:'plane',aircraft:{id:'plane',lastflightlocationICAO:'UKLL'},registration:'UR-TEST',aircraftTitle:'Plane',
    group:'unknown',dep:'UKLL',arr:'EPWA',proposalKind:'schedule',proposalReason:'schedule',
    flightNumber:'123',blockMinutes:150,amount:300,ratePerHour:120,...change};
}
function pool() {
  return buildTopPool({candidates:[candidate()],completedFlights:[],now:new Date(generated),windowHours:6,graceHours:24});
}
function completed(change = {}) {
  return {id:'other-flight',status:'completed',aircraft:{id:'plane'},flightNumber:'567',
    departure:{icao:'UKLL'},arrival:{icao:'UKOO'},actualArrival:{icao:'UKOO'},
    operations:{scheduled:true,free:false},
    times:{actualDeparture:'2026-10-03T11:45:00Z',closed:'2026-10-03T12:03:00Z'},...change};
}
function refresh(original, candidates, flights = [], bonusRecords = {}) {
  return refreshHotPool({currentPool:original,candidates,completedFlights:flights,bonusRecords,now});
}
function updater(fixtureRoot = root) {
  const file=path.join(root,'scripts','update-guaranteed-bonuses.js');
  const context=vm.createContext({require:createRequire(file),module:{exports:{}},__dirname:path.join(fixtureRoot,'scripts'),process:{argv:[],env:{}},console});
  vm.runInContext(fs.readFileSync(file,'utf8'),context);
  return context.module.exports;
}

test('the reported return flight updates the hot route and premium even though it started before publication', () => {
  const original=pool();
  const next=refresh(original,[candidate({dep:'UKOO',arr:'LTAI',flightNumber:'216',amount:914,blockMinutes:180})],[completed()]);
  const item=next.categories.quick.items[0];
  assert.equal(item.rank,1);
  assert.deepEqual([item.proposal.flightNumber,item.proposal.depIcao,item.proposal.arrIcao,item.proposal.premiumUsd],['216','UKOO','LTAI',914]);
  assert.equal(item.generatedAt,now.toISOString());
  assert.equal(item.activeUntil,original.activeUntil);
  assert.ok(next.retiredHotOffers[original.categories.quick.items[0].poolId]);
  assert.deepEqual(next.categories.earn,original.categories.earn);
  assert.equal(original.categories.quick.items[0].proposal.depIcao,'UKLL');
  assert.strictEqual(refresh(next,[candidate({dep:'UKOO',arr:'LTAI',flightNumber:'216',amount:914,blockMinutes:180})],[completed()]),next);
});

test('unchanged proposals and unrelated aircraft do not create another snapshot', () => {
  const original=pool();
  assert.strictEqual(refresh(original,[candidate()]),original);
  assert.strictEqual(refresh(original,[candidate()],[completed({aircraft:{id:'another-plane'}})]),original);
});

test('a qualifying completed flight retains its promised offer instead of becoming a new route', () => {
  const original=pool();
  const flight=completed({flightNumber:'123',arrival:{icao:'EPWA'},actualArrival:{icao:'EPWA'},
    times:{actualDeparture:'2026-10-03T12:01:00Z',closed:'2026-10-03T12:04:00Z'}});
  assert.strictEqual(refresh(original,[candidate({dep:'EPWA',arr:'UKLL',flightNumber:'124'})],[flight]),original);
});

test('a later matching completion cannot revive an offer interrupted by another flight', () => {
  const original=pool();
  const later=completed({id:'later',flightNumber:'123',arrival:{icao:'EPWA'},actualArrival:{icao:'EPWA'},
    times:{actualDeparture:'2026-10-03T12:04:00Z',closed:'2026-10-03T12:04:30Z'}});
  const next=refresh(original,[candidate({dep:'EPWA',arr:'UKLL',flightNumber:'124'})],[completed(),later]);
  assert.notStrictEqual(next,original);
  assert.equal(next.categories.quick.items[0].proposal.flightNumber,'124');
});

test('refresh removes old repositioning offers and only replaces them with demand', () => {
  const legacy=pool();
  const item=legacy.categories.quick.items[0];
  item.proposalKind='free';
  item.proposalReason='schedule-positioning';
  item.flightNumber='';
  item.proposal={...item.proposal,type:'free',flightNumber:'FREE',reason:'schedule-positioning'};
  const demand=candidate({aircraftId:'demand',aircraft:{id:'demand',lastflightlocationICAO:'UKLL'},
    proposalKind:'free',proposalReason:'charter-demand',flightNumber:'',blockMinutes:90});
  const next=refresh(legacy,[demand],[]);
  assert.deepEqual(next.categories.quick.items.map(row=>[row.aircraftId,row.proposalReason]),[['demand','charter-demand']]);
  assert.ok(next.retiredHotOffers[item.poolId]);
  assert.equal(refresh(legacy,[candidate({proposalKind:'free',proposalReason:'maintenance-positioning',flightNumber:''})],[]).counts.hot,0);
  const claim={pie:true,pieType:'hot',aircraftId:'plane',pieRank:1,piePoolGeneratedAt:generated,state:'LIVE',status:'matched'};
  assert.strictEqual(refresh(legacy,[demand],[],{claim}),legacy);
});

test('a new SCHEDULE takes precedence over an unclaimed demand FREE on refresh', () => {
  const initial=buildTopPool({candidates:[candidate({proposalKind:'free',proposalReason:'charter-demand',flightNumber:'',blockMinutes:90})],
    completedFlights:[],now:new Date(generated),windowHours:6,graceHours:24});
  const schedule=candidate({aircraftId:'schedule',aircraft:{id:'schedule',lastflightlocationICAO:'UKLL'},
    proposalKind:'schedule',proposalReason:'schedule',flightNumber:'456',blockMinutes:180});
  const next=refresh(initial,[candidate({proposalKind:'free',proposalReason:'charter-demand',flightNumber:'',blockMinutes:90}),schedule]);
  assert.deepEqual(next.categories.quick.items.map(row=>[row.aircraftId,row.proposalKind]),[['schedule','schedule']]);
});


test('a confirmed LIVE money bonus keeps its original amount when demand changes', () => {
  const api = updater();
  const id = '6ace64180fd87508e1dc2fe9';
  const record = {amount:265, pilotId:'pilot', aircraftId:'plane', depIcao:'UKLR', arrIcao:'UKKK',
    route:'UKLR-UKKK', state:'LIVE', status:'matched', proposalType:'free', proposalReason:'inbound-demand'};
  const retained = api.retainGuaranteedRecords({[id]:record},new Map(),
    new Map([[id,{id,depIcao:'UKLR',arrIcao:'UKKK'}]]),new Map(),now);
  assert.strictEqual(retained[id],record);
});

test('a temporarily missing LIVE bonus recovers and retains its amount after completion', () => {
  const api = updater();
  const id = 'flight-in-progress';
  const record = {amount:265, depIcao:'UKLR', arrIcao:'UKKK',route:'UKLR-UKKK',state:'LIVE',status:'matched'};
  const pending = api.retainGuaranteedRecords({[id]:record},new Map(),new Map(),new Map(),now);
  assert.equal(pending[id].status,'pending-completion-check');
  assert.equal(pending[id].amount,265);
  const resumed = api.retainGuaranteedRecords(pending,new Map(),new Map([[id,{id}]]),new Map(),now);
  assert.equal(resumed[id].status,'matched');
  assert.equal(resumed[id].amount,265);
  const completed = api.retainGuaranteedRecords(resumed,new Map([[id,{id}]]),new Map(),new Map(),now);
  assert.equal(completed[id].state,'DONE');
  assert.equal(completed[id].status,'earned');
  assert.equal(completed[id].amount,265);
  assert.equal(completed[id].route,'UKLR-UKKK');
  assert.equal(completed[id].arrIcao,'UKKK');
});

test('a pending bonus expires after two hours without a LIVE or completed flight', () => {
  const api = updater();
  const id = '6aceb8cae2b73bbe5945b33c';
  const started = new Date('2026-10-14T02:50:20.210Z');
  const record = {state:'LIVE',status:'matched',amount:2811,route:'VIDP-UKBB'};
  const first = api.retainGuaranteedRecords({[id]:record},new Map(),new Map(),new Map(),started);
  assert.equal(first[id].pendingSince,started.toISOString());
  assert.equal(first[id].amount,2811);
  const before = new Date(started.getTime()+7200000-1);
  const repeated = api.retainGuaranteedRecords(first,new Map(),new Map(),new Map(),before);
  assert.strictEqual(repeated[id],first[id]);
  assert.equal(repeated[id].pendingSince,started.toISOString());
  const deadline = new Date(started.getTime()+7200000);
  assert.equal(api.retainGuaranteedRecords(repeated,new Map(),new Map(),new Map(),deadline)[id],undefined);
  assert.equal(api.pendingBonusExpired(id,repeated[id],new Map(),new Map(),deadline),true);
  assert.equal(api.retainGuaranteedRecords(repeated,new Map([[id,{id}]]),new Map(),new Map(),deadline)[id].state,'DONE');
  const returned = api.retainGuaranteedRecords(repeated,new Map(),new Map([[id,{id}]]),new Map(),deadline)[id];
  assert.equal(returned.status,'matched');
  assert.equal(returned.pendingSince,undefined);
  assert.equal(returned.amount,2811);
});

test('older pending records use their last status update as the expiration timestamp', () => {
  const api = updater();
  const id = 'previous-pending';
  const record = {state:'LIVE',status:'pending-completion-check',amount:622,
    updatedAt:'2026-10-10T09:10:20.905Z'};
  const deadline = new Date('2026-10-10T11:10:20.905Z');
  assert.ok(api.retainGuaranteedRecords({[id]:record},new Map(),new Map(),new Map(),
    new Date(deadline.getTime()-1))[id]);
  assert.equal(api.retainGuaranteedRecords({[id]:record},new Map(),new Map(),new Map(),deadline)[id],undefined);
});

test('an existing LIVE reward keeps its original rank, route and premium', () => {
  const original=pool();
  const record={pie:true,pieType:'hot',aircraftId:'plane',pieRank:1,piePoolGeneratedAt:generated,state:'LIVE',status:'matched'};
  assert.strictEqual(refresh(original,[candidate({dep:'UKOO',arr:'LTAI'})],[completed()],{claim:record}),original);
});

test('an ineligible replacement cannot promise pies; an eligible different aircraft keeps the vacant rank', () => {
  const original=pool();
  const tooLong=candidate({dep:'UKOO',arr:'LTAI',blockMinutes:211});
  assert.equal(refresh(original,[tooLong],[completed()]).categories.quick.items.length,0);
  const domesticFree=candidate({proposalKind:'free',flightNumber:'',dep:'UKCC',arr:'UKLL'});
  assert.equal(refresh(original,[domesticFree],[completed()]).categories.quick.items.length,0);
  const replacement=candidate({aircraftId:'replacement',aircraft:{id:'replacement'},dep:'UKBB',arr:'EPWA',blockMinutes:210});
  const next=refresh(original,[tooLong,replacement],[completed()]);
  assert.deepEqual(next.categories.quick.items.map(item=>[item.aircraftId,item.rank]),[['replacement',1]]);
});

test('refreshed offers have their own publication time and cannot award a flight already started', () => {
  const api=updater();
  const original=pool();
  const next=refresh(original,[candidate({dep:'UKOO',arr:'LTAI',flightNumber:'216'})],[completed()]);
  const offers=api.topPoolItemsFromPools([original,next]);
  const live={id:'new',startedAt:'2026-10-03T12:04:00Z',depIcao:'UKOO',arrIcao:'LTAI',flightNumber:'216',schedule:true};
  assert.equal(api.topPoolMatchForLive(live,'plane',offers),null);
  assert.ok(api.topPoolMatchForLive({...live,startedAt:'2026-10-03T12:06:00Z'},'plane',offers));
});

test('retired archived offers do not reappear when the aircraft returns to their old departure', () => {
  const api=updater();
  const original=pool();
  const next=refresh(original,[candidate({dep:'UKOO',arr:'LTAI'})],[completed()]);
  const offers=api.topPoolItemsFromPools([original,next]).filter(item=>item.category==='hot');
  const live={id:'later',startedAt:'2026-10-03T14:00:00Z',depIcao:'UKLL',arrIcao:'EPWA',flightNumber:'123',schedule:true};
  assert.equal(api.topPoolMatchForLive(live,'plane',offers),null);
});

test('SCHEDULE and FREE interruptions invalidate a hot offer without changing money-only offers', () => {
  const api=updater();
  const hot=api.topPoolItemsFromPools([pool()]).find(item=>item.category==='hot');
  const live={id:'later',startedAt:'2026-10-03T14:00:00Z',depIcao:'UKLL',arrIcao:'EPWA',flightNumber:'123',schedule:true};
  for (const flight of [completed(),completed({departure:{icao:'UKBB'},arrival:{icao:'UKCC'},actualArrival:{icao:'UKCC'},operations:{scheduled:false,free:true}})]) {
    assert.equal(api.topPoolMatchForLive(live,'plane',[hot],[flight]),null);
    assert.ok(api.topPoolMatchForLive(live,'plane',[{...hot,category:'cash'}],[flight]));
  }
  assert.ok(api.topPoolMatchForLive({...live,startedAt:'2026-10-03T12:01:00Z'},'plane',[hot],[completed()]));
});

test('a stale hot card keeps the current fleet money offer and suppresses the old pie promise', () => {
  let overwritten=0, note='';
  const item={rank:1,aircraftId:'plane'};
  const context=vm.createContext({
    companyFixedTopPoolCategory:()=>({items:[item]}),companyFixedTopPoolHotItemAllowed:()=>true,
    companyFixedTopPoolLivePieItems:()=>[],companyLiveHotCardAllowed:()=>true,companyFixedTopPoolCardForItem:()=>({}),
    cloneCompanyLiveExtractCard:()=>({querySelector:()=>null}),companyLiveCloneStatus:()=>({prepend:()=>{}}),
    applyCompanyFixedTopPoolStatus:()=>{overwritten++;},companyFixedTopPoolLiveMatchFlight:()=>null,
    companyFixedTopPoolConsumedFlight:()=>null,companyFixedTopPoolCurrentOfferMatches:()=>false,
    companyFixedTopPoolInterceptedFlight:()=>completed(),companyFixedTopPoolLiveStatus:()=>null,
    window:{UCAAPieRewards:rewards},document:{createElement:()=>({})},
    companyFixedTopPoolNormalizeFlightNumber:x=>String(x||''),esc:x=>String(x||'')});
  vm.runInContext(source.slice(source.indexOf('function companyPiesRewardHtml('),source.indexOf('function companyFixedTopPoolModeForPieType(')),context);
  vm.runInContext(source.slice(source.indexOf('function renderCompanyFixedTopPoolItems('),source.indexOf('function renderCompanyLiveFleetExtract(')),context);
  context.renderCompanyFixedTopPoolItems({appendChild:()=>{}},'quick',[],null,null);
  assert.equal(overwritten,0);
  note=context.companyFixedTopPoolNoteHtml({...item,currentOfferUnavailable:true},{},'quick',0);
  assert.match(note,/За цим рейсом пиріжки не передбачені/);
  assert.doesNotMatch(note,/Нагорода:|буде видано/);
  assert.equal(item.currentOfferUnavailable,undefined);
});

test('the frontend rejects different route, number, operation, premium and routes over 3:30', () => {
  const item={proposal:{type:'schedule',flightNumber:'123',depIcao:'UKLL',arrIcao:'EPWA',premiumUsd:300}};
  let offer={proposalType:'schedule',flightNumber:'123',origin:'UKLL',destination:'EPWA',premium:300,minutes:210};
  const context=vm.createContext({companyLiveAnyPremiumOfferForCard:()=>offer,companyFixedTopPoolNormalizeFlightNumber:x=>String(x||'')});
  vm.runInContext(source.slice(source.indexOf('function companyFixedTopPoolCurrentOfferMatches('),source.indexOf('function renderCompanyFixedTopPoolItems(')),context);
  assert.equal(context.companyFixedTopPoolCurrentOfferMatches(item,{}),true);
  const valid=offer;
  for (const change of [{origin:'UKOO'},{destination:'UKOO'},{flightNumber:'567'},{proposalType:'free'},{premium:914},{minutes:211}]) {
    offer={...valid,...change};
    assert.equal(context.companyFixedTopPoolCurrentOfferMatches(item,{}),false);
  }
});

test('the frontend recognizes SCHEDULE and FREE interruptions, including flights started before publication', () => {
  const item={aircraftId:'plane',generatedAt:generated};
  const context=vm.createContext({app:{flights:[]},
    companyFixedTopPoolGeneratedDate:item=>new Date(item.generatedAt),
    companyFixedTopPoolFlightAircraftId:flight=>flight.aircraft.id,
    flightStartDateForDisplay:flight=>new Date(flight.times.actualDeparture),
    flightEndDateForDisplay:flight=>new Date(flight.times.closed)});
  vm.runInContext(source.slice(source.indexOf('function companyFixedTopPoolOfferInterrupted('),source.indexOf('function companyFixedTopPoolLiveMatchFlight(')),context);
  const target={id:'target',times:{actualDeparture:'2026-10-03T12:04:00Z'}};
  for (const operations of [{scheduled:true,free:false},{scheduled:false,free:true}]) {
    context.app.flights=[completed({operations})];
    assert.equal(context.companyFixedTopPoolOfferInterrupted(item,target),true);
    assert.equal(context.companyFixedTopPoolOfferInterrupted(item,{...target,times:{actualDeparture:'2026-10-03T12:01:00Z'}}),false);
    assert.equal(context.companyFixedTopPoolOfferInterrupted({...item,generatedAt:now.toISOString()},target),false);
  }
});

test('the ledger rejects a stale external claim and preserves currency already credited', t => {
  const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ucaa-route-sync-test-'));
  t.after(()=>{
    assert.ok(path.resolve(fixtureRoot).startsWith(path.join(os.tmpdir(),'ucaa-route-sync-test-')));
    fs.rmSync(fixtureRoot,{recursive:true,force:true});
  });
  fs.mkdirSync(path.join(fixtureRoot,'COMPANY'));
  const file=path.join(fixtureRoot,'COMPANY','pies-ledger.json');
  const initial={version:1,ruleVersion:1,activatedAt:'2026-10-03T10:00:00Z',updatedAt:null,entries:{}};
  fs.writeFileSync(file,JSON.stringify(initial));
  const api=updater(fixtureRoot);
  const flight=completed({id:'target',flightNumber:'123',arrival:{icao:'EPWA'},actualArrival:{icao:'EPWA'},pilot:{id:'pilot'},
    times:{actualDeparture:'2026-10-03T12:04:00Z',closed:'2026-10-03T12:04:30Z'}});
  const record={...api.topPoolRecordFields(api.topPoolItemsFromPools([pool()]).find(item=>item.category==='hot')),
    state:'DONE',status:'earned',pilotId:'pilot',aircraftId:'plane',depIcao:'UKLL',arrIcao:'EPWA',proposalType:'schedule',flightNumber:'123'};
  assert.equal(rewards.balanceForPilot(api.updatePiesLedger({target:record},[completed(),flight],now,true),'pilot'),0);
  const valid=api.updatePiesLedger({target:record},[flight],now,true);
  assert.equal(rewards.balanceForPilot(valid,'pilot'),3);
  fs.writeFileSync(file,JSON.stringify(valid));
  const preserved=api.updatePiesLedger({target:record},[completed(),flight],now,true);
  assert.equal(rewards.balanceForPilot(preserved,'pilot'),3);
  assert.deepEqual(JSON.parse(JSON.stringify(preserved)),JSON.parse(JSON.stringify(valid)));
});

test('hot refresh never fills a vacant rank with an aircraft reserved for idle', () => {
  const original=pool();
  original.categories.idle.items=[{aircraftId:'idle-plane'}];
  const reserved=candidate({aircraftId:'idle-plane',aircraft:{id:'idle-plane',lastflightlocationICAO:'UKLL'},flightNumber:'456'});
  const available=candidate({aircraftId:'replacement',aircraft:{id:'replacement',lastflightlocationICAO:'UKLL'},flightNumber:'789'});
  const next=refresh(original,[reserved,available],[]);
  assert.deepEqual(next.categories.quick.items.map(item=>item.aircraftId),['replacement']);
  const claim={pie:true,pieType:'hot',aircraftId:'plane',pieRank:1,
    piePoolGeneratedAt:generated,state:'LIVE',status:'matched'};
  assert.strictEqual(refresh(original,[reserved,available],[],{claim}),original,
    'an existing LIVE hot promise remains reserved even if the pool rotates');
});
