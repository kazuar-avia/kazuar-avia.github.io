const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');
const rewards = require('../pie-rewards.js');

const root = path.resolve(__dirname, '..');
const now = new Date('2026-10-01T12:00:00Z');
const initialLedger = () => ({version:1, ruleVersion:1, activatedAt:'2026-10-01T06:00:00Z', updatedAt:null, entries:{}});
function fixture(id = 'flight-1', rank = 1, pilotId = 'pilot-1') {
  const record = {
    state:'DONE', status:'earned', pie:true, pieType:'hot', pieRank:rank, pieRewardRulesVersion:2,
    pilotId, aircraftId:'aircraft-1', depIcao:'UKBB', arrIcao:'UKLL', flightNumber:'00123', proposalType:'schedule',
    piePoolKey:'hot|1|aircraft-1|123|UKBB|UKLL', piePoolId:'pool-1',
    piePoolGeneratedAt:'2026-10-01T06:00:00Z', piePoolActiveUntil:'2026-10-01T12:00:00Z', piePoolClaimableUntil:'2026-10-02T12:00:00Z'
  };
  const flight = {
    id, status:'completed', pilot:{id:pilotId}, aircraft:{id:'aircraft-1'}, flightNumber:'123',
    departure:{icao:'UKBB'}, arrival:{icao:'UKLL'}, actualArrival:{icao:'UKLL'}, operations:{scheduled:true, free:false},
    times:{actualDeparture:'2026-10-01T07:00:00Z', closed:'2026-10-01T09:00:00Z'}
  };
  return {record, flight};
}
function credit(record, flight, ledger = initialLedger(), at = now) {
  return rewards.syncLedger(ledger, {[flight.id]:record}, [flight], at);
}
function loadUpdater(fixtureRoot = root) {
  const file = path.join(root,'scripts','update-guaranteed-bonuses.js');
  const context = vm.createContext({require:createRequire(file), module:{exports:{}}, __dirname:path.join(fixtureRoot,'scripts'), process:{argv:[],env:{}}, console, Date, Set, Map});
  vm.runInContext(fs.readFileSync(file,'utf8'), context);
  return context.module.exports;
}

test('TOP #1/#2 award 3/2 pies and TOP #3 through #6 award one each', () => {
  for (const [rank, expected] of [[1,3],[2,2],[3,1],[4,1],[5,1],[6,1],[7,0],[0,0],[-1,0],[1.5,0],['bad',0]]) {
    const {record,flight} = fixture('flight-'+rank,rank);
    assert.equal(rewards.balanceForPilot(credit(record,flight),'pilot-1'), expected);
  }
});

test('old pools keep their original rewards without retroactive TOP #4 through #6 earnings', () => {
  for (const [rank, expected] of [[1,3],[2,2],[3,1],[4,0],[5,0],[6,0]]) {
    const {record,flight} = fixture('legacy-'+rank,rank);
    delete record.pieRewardRulesVersion;
    assert.equal(rewards.balanceForPilot(credit(record,flight),'pilot-1'),expected);
    assert.equal(rewards.rewardForRank(rank,1),expected);
  }
});

test('six new qualifying flights accumulate nine pies without changing saved entries', () => {
  const old = fixture('existing',2);
  delete old.record.pieRewardRulesVersion;
  const previous = credit(old.record,old.flight);
  const fixtures = [1,2,3,4,5,6].map(rank=>fixture('new-'+rank,rank));
  const next = rewards.syncLedger(previous,Object.fromEntries(fixtures.map(({record,flight})=>[flight.id,record])),fixtures.map(x=>x.flight),now);
  assert.equal(rewards.balanceForPilot(next,'pilot-1'),11);
  assert.deepEqual(next.entries['hot:existing'],previous.entries['hot:existing']);
  assert.strictEqual(rewards.syncLedger(next,Object.fromEntries(fixtures.map(({record,flight})=>[flight.id,record])),fixtures.map(x=>x.flight),now),next);
});

test('bonus claims freeze the new reward rules and rank when a later pool changes them', () => {
  const updater=loadUpdater();
  const pool={pieRewardRulesVersion:2,generatedAt:'2026-10-03T06:00:00Z',activeUntil:'2026-10-03T12:00:00Z',claimableUntil:'2026-10-04T12:00:00Z',
    categories:{quick:{items:[{rank:6,aircraftId:'aircraft-1',proposal:{type:'schedule',flightNumber:'123',depIcao:'UKBB',arrIcao:'UKLL',premiumUsd:300}}]}}};
  const match=updater.topPoolItemsFromPools([pool])[0];
  const fields=updater.topPoolRecordFields(match);
  assert.equal(fields.pieRewardRulesVersion,2);
  const {record,flight}=fixture('frozen-six',6);
  const previous={...record,...fields};
  const next={...previous,pieRank:1,pieRewardRulesVersion:1};
  updater.preserveTopPoolClaims({[flight.id]:previous},{[flight.id]:next});
  assert.equal(next.pieRank,6);
  assert.equal(next.pieRewardRulesVersion,2);
  assert.equal(rewards.rewardForRank(next.pieRank,next.pieRewardRulesVersion),1);
});

test('external updater records recover new reward rules from the exact saved snapshot', t => {
  const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ucaa-pies-expanded-'));
  t.after(()=>{assert.ok(path.resolve(fixtureRoot).startsWith(path.join(os.tmpdir(),'ucaa-pies-expanded-')));fs.rmSync(fixtureRoot,{recursive:true,force:true});});
  fs.mkdirSync(path.join(fixtureRoot,'COMPANY'));
  fs.writeFileSync(path.join(fixtureRoot,'COMPANY','pies-ledger.json'),JSON.stringify(initialLedger()));
  const {record,flight}=fixture('external-six',6);
  delete record.pieRewardRulesVersion;
  const pool={pieRewardRulesVersion:2,generatedAt:record.piePoolGeneratedAt,activeUntil:record.piePoolActiveUntil,claimableUntil:record.piePoolClaimableUntil,
    categories:{quick:{items:[{rank:6,aircraftId:'aircraft-1',proposal:{type:'schedule',flightNumber:'123',depIcao:'UKBB',arrIcao:'UKLL',premiumUsd:300}}]}}};
  record.piePoolKey='quick|6|aircraft-1|123|UKBB|UKLL';
  fs.writeFileSync(path.join(fixtureRoot,'COMPANY','top-pool-current.json'),JSON.stringify(pool));
  const updater=loadUpdater(fixtureRoot);
  const next=updater.updatePiesLedger({[flight.id]:record},[flight],now,true);
  assert.equal(rewards.balanceForPilot(next,'pilot-1'),1);
  assert.equal(next.entries['hot:'+flight.id].rewardRulesVersion,2);
  pool.pieRewardRulesVersion=1;
  fs.writeFileSync(path.join(fixtureRoot,'COMPANY','top-pool-current.json'),JSON.stringify(pool));
  assert.equal(rewards.balanceForPilot(updater.updatePiesLedger({[flight.id]:record},[flight],now,true),'pilot-1'),0);
});

test('three different qualifying flights accumulate six pies', () => {
  const fixtures = [fixture('one',1),fixture('two',2),fixture('three',3)];
  const ledger = rewards.syncLedger(initialLedger(),Object.fromEntries(fixtures.map(({record,flight})=>[flight.id,record])),fixtures.map(x=>x.flight),now);
  assert.equal(rewards.balanceForPilot(ledger,'pilot-1'),6);
  assert.equal(Object.keys(ledger.entries).length,3);
});

test('repeated updates and changed pool IDs cannot award the same flight again', () => {
  const {record,flight} = fixture();
  const ledger = credit(record,flight);
  const repeated = credit({...record,pieRank:2,piePoolId:'different-pool'},flight,ledger);
  assert.strictEqual(repeated,ledger);
  assert.equal(rewards.balanceForPilot(repeated,'pilot-1'),3);
});

test('balances belong to pilot IDs and survive name changes', () => {
  const first = fixture('one',1,'pilot-1');
  const second = fixture('two',2,'pilot-2');
  const ledger = credit(second.record,second.flight,credit(first.record,first.flight));
  assert.equal(rewards.balanceForPilot(ledger,'pilot-1'),3);
  assert.equal(rewards.balanceForPilot(ledger,'pilot-2'),2);
  assert.equal(rewards.balanceForPilot(ledger,'unknown'),0);
});

test('initial activation gives no rewards for flights already started', () => {
  const {record,flight} = fixture();
  const fresh = {...initialLedger(),activatedAt:null};
  const activated = credit(record,flight,fresh);
  assert.equal(activated.activatedAt,now.toISOString());
  assert.equal(rewards.balanceForPilot(activated,'pilot-1'),0);
  assert.strictEqual(credit(record,flight,activated,new Date('2026-10-01T13:00:00Z')),activated);
});

test('a new flight after activation is credited normally', () => {
  const {record,flight} = fixture();
  const activated = rewards.syncLedger({...initialLedger(),activatedAt:null},{},[],new Date('2026-10-01T06:00:00Z'));
  assert.equal(rewards.balanceForPilot(credit(record,flight,activated),'pilot-1'),3);
});

test('LIVE, pending, manual and other categories do not earn currency', () => {
  const {record,flight} = fixture();
  for (const change of [{state:'LIVE'},{status:'matched'},{status:'manual'},{pie:false},{pieType:'cash'},{pieType:'returnRoute'},{pieType:'idle'}]) {
    assert.equal(rewards.balanceForPilot(credit({...record,...change},flight),'pilot-1'),0);
  }
  assert.equal(rewards.balanceForPilot(credit(record,{...flight,status:'live'}),'pilot-1'),0);
});

test('wrong pilot, aircraft, actual airport and operation are rejected', () => {
  const {record,flight} = fixture();
  for (const change of [{pilot:{id:'other'}},{aircraft:{id:'other'}},{departure:{icao:'UKOO'}},{actualArrival:{icao:'UKOO'}},{flightNumber:'456'},{operations:{scheduled:false,free:true}}]) {
    assert.equal(Object.keys(credit(record,{...flight,...change}).entries).length,0);
  }
  assert.equal(Object.keys(credit({...record,proposalType:'free'},flight).entries).length,0);
});

test('valid FREE flights receive the rank reward', () => {
  const {record,flight} = fixture();
  assert.equal(rewards.balanceForPilot(credit({...record,proposalType:'free',flightNumber:'FREE'},{...flight,operations:{scheduled:false,free:true}}),'pilot-1'),3);
});

test('pies and existing money bonuses share the same start window, including grace hours', () => {
  const {record,flight} = fixture();
  const updater = loadUpdater();
  const pool = {generatedAt:record.piePoolGeneratedAt,activeUntil:record.piePoolActiveUntil,claimableUntil:record.piePoolClaimableUntil,categories:{quick:{items:[{rank:1,aircraftId:'aircraft-1',proposal:{type:'schedule',flightNumber:'123',depIcao:'UKBB',arrIcao:'UKLL',premiumUsd:123}}]}}};
  const items = updater.topPoolItemsFromPools([pool]);
  const at = new Date('2026-10-03T12:00:00Z');
  for (const [started,eligible] of [
    ['2026-10-01T05:59:59Z',false],
    ['2026-10-01T06:00:00Z',true],
    ['2026-10-01T12:00:01Z',true],
    ['2026-10-02T12:00:00Z',true],
    ['2026-10-02T12:00:00.001Z',false]
  ]) {
    const candidate = {...flight,times:{actualDeparture:started,closed:new Date(new Date(started).getTime()+3600000).toISOString()}};
    const moneyMatch = updater.topPoolMatchForLive(updater.liveFromCompletedFlight(candidate),'aircraft-1',items);
    assert.equal(Boolean(moneyMatch),eligible);
    assert.equal(rewards.balanceForPilot(credit(record,candidate,initialLedger(),at),'pilot-1'),eligible?3:0);
  }
  const later = {...flight,times:{actualDeparture:'2026-10-02T11:00:00Z',closed:'2026-10-02T14:00:00Z'}};
  assert.equal(rewards.balanceForPilot(credit({...record,piePoolActiveUntil:null},later,initialLedger(),at),'pilot-1'),3);
});

test('reported TOP #2 flight earns two pies after the six-hour active window, once', () => {
  const {record,flight} = fixture('reported-top-2',2);
  Object.assign(record,{piePoolGeneratedAt:'2026-10-01T18:00:46.653Z',piePoolActiveUntil:'2026-10-02T00:00:46.653Z',piePoolClaimableUntil:'2026-10-03T00:00:46.653Z'});
  flight.times = {actualDeparture:'2026-10-02T14:16:24.078Z',closed:'2026-10-02T15:01:26.779Z'};
  const existing = {...initialLedger(),activatedAt:'2026-10-01T18:32:16.018Z',entries:{previous:{id:'previous',kind:'earn',pilotId:'pilot-1',flightId:'previous-flight',delta:3}}};
  const at = new Date('2026-10-02T17:10:00Z');
  const awarded = credit(record,flight,existing,at);
  assert.equal(awarded.entries['hot:reported-top-2'].delta,2);
  assert.equal(rewards.balanceForPilot(awarded,'pilot-1'),5);
  assert.equal(awarded.activatedAt,existing.activatedAt);
  assert.strictEqual(credit(record,flight,awarded,at),awarded);
});

test('Railway standalone bonus script runs without the currency module and preserves its ledger', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(),'ucaa-railway-top-sync-'));
  t.after(()=>{
    assert.ok(path.resolve(fixtureRoot).startsWith(path.join(os.tmpdir(),'ucaa-railway-top-sync-')));
    fs.rmSync(fixtureRoot,{recursive:true,force:true});
  });
  fs.mkdirSync(path.join(fixtureRoot,'scripts'));
  fs.mkdirSync(path.join(fixtureRoot,'COMPANY'));
  const script = path.join(fixtureRoot,'scripts','update-guaranteed-bonuses.js');
  fs.copyFileSync(path.join(root,'scripts','update-guaranteed-bonuses.js'),script);
  for (const name of ['aircraft-difficulty-coefficients.js','pilot-pay-policy.js']) fs.copyFileSync(path.join(root,name),path.join(fixtureRoot,name));
  const ledgerFile = path.join(fixtureRoot,'COMPANY','pies-ledger.json');
  const ledgerText = JSON.stringify(initialLedger());
  fs.writeFileSync(ledgerFile,ledgerText);
  const {record} = fixture();
  fs.writeFileSync(path.join(fixtureRoot,'COMPANY','guaranteed-bonuses.json'),JSON.stringify({version:1,flights:{'flight-1':record}}));
  fs.writeFileSync(path.join(fixtureRoot,'COMPANY','top-pool-current.json'),JSON.stringify({version:1,items:[]}));
  assert.equal(fs.existsSync(path.join(fixtureRoot,'pie-rewards.js')),false);
  const result = spawnSync(process.execPath,[script,'--skip-live','--dry-run'],{cwd:fixtureRoot,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).flights['flight-1'].status,'earned');
  assert.equal(fs.readFileSync(ledgerFile,'utf8'),ledgerText);
  const standalone = require(script);
  assert.throws(()=>standalone.updatePiesLedger({},[],now,true),error=>error.code==='MODULE_NOT_FOUND');
});

test('late data imports still earn currency for a previously valid flight', () => {
  const {record,flight} = fixture();
  const ledger = credit(record,flight,initialLedger(),new Date('2026-10-05T12:00:00Z'));
  assert.equal(rewards.balanceForPilot(ledger,'pilot-1'),3);
});

test('missing snapshot times, invalid chronology and future completion are rejected', () => {
  const {record,flight} = fixture();
  for (const change of [{piePoolGeneratedAt:null},{piePoolClaimableUntil:null},{piePoolKey:''}]) {
    assert.equal(Object.keys(credit({...record,...change},flight).entries).length,0);
  }
  for (const closed of ['invalid','2026-10-01T06:00:00Z','2026-10-01T13:00:00Z']) {
    assert.equal(Object.keys(credit(record,{...flight,times:{...flight.times,closed}}).entries).length,0);
  }
});

test('a frozen proposal prevents route changes from using an old reward rank', () => {
  const {record,flight} = fixture();
  record.pieClaim = {aircraftId:record.aircraftId,depIcao:record.depIcao,arrIcao:record.arrIcao,flightNumber:record.flightNumber,proposalType:record.proposalType};
  const changed = {...record,arrIcao:'UKOO'};
  assert.equal(Object.keys(credit(changed,{...flight,actualArrival:{icao:'UKOO'}}).entries).length,0);
});

test('invalid saved ledgers fail instead of resetting balances', () => {
  for (const invalid of [{}, {...initialLedger(),version:2}, {...initialLedger(),ruleVersion:2}, {...initialLedger(),activatedAt:'bad'}, {...initialLedger(),entries:[]}]) {
    assert.throws(()=>rewards.syncLedger(invalid,{},[],now));
  }
});

test('updater records snapshot windows and freezes the original rank', () => {
  const updater = loadUpdater();
  const pool = {generatedAt:'2026-10-01T06:00:00Z',activeUntil:'2026-10-01T12:00:00Z',claimableUntil:'2026-10-02T12:00:00Z',categories:{quick:{label:'Hot',items:[{poolId:'pool-1',rank:1,aircraftId:'aircraft-1',proposal:{type:'schedule',flightNumber:'123',depIcao:'UKBB',arrIcao:'UKLL',premiumUsd:123}}]}}};
  const {record,flight} = fixture();
  const items = updater.topPoolItemsFromPools([pool]);
  const match = updater.topPoolMatchForLive(updater.liveFromCompletedFlight(flight),'aircraft-1',items);
  assert.ok(match);
  const fields = updater.topPoolRecordFields(match);
  assert.equal(fields.piePoolId,'pool-1');
  assert.equal(fields.piePoolActiveUntil,pool.activeUntil);
  const original = {...record,...fields};
  const next = {...original,pieRank:3,piePoolGeneratedAt:'2026-10-01T08:00:00Z',pieClaim:{...fields.pieClaim,arrIcao:'UKOO'}};
  updater.preserveTopPoolClaims({'flight-1':original},{'flight-1':next});
  assert.equal(next.pieRank,1);
  assert.equal(next.piePoolGeneratedAt,pool.generatedAt);
  assert.equal(next.pieClaim.arrIcao,'UKLL');
});

test('ledger updater persists currency, is idempotent, and leaves dry runs untouched', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(),'ucaa-pies-test-'));
  t.after(()=>{
    assert.ok(path.resolve(fixtureRoot).startsWith(path.join(os.tmpdir(),'ucaa-pies-test-')));
    fs.rmSync(fixtureRoot,{recursive:true,force:true});
  });
  fs.mkdirSync(path.join(fixtureRoot,'COMPANY'));
  const file = path.join(fixtureRoot,'COMPANY','pies-ledger.json');
  fs.writeFileSync(file,JSON.stringify(initialLedger()));
  const updater = loadUpdater(fixtureRoot);
  const {record,flight} = fixture();
  const before = fs.readFileSync(file,'utf8');
  const preview = updater.updatePiesLedger({'flight-1':record},[flight],now,true);
  assert.equal(rewards.balanceForPilot(preview,'pilot-1'),3);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  updater.updatePiesLedger({'flight-1':record},[flight],now,false);
  const saved = fs.readFileSync(file,'utf8');
  updater.updatePiesLedger({'flight-1':record},[flight],new Date('2026-10-01T15:00:00Z'),false);
  assert.equal(fs.readFileSync(file,'utf8'),saved);
  fs.writeFileSync(file,'broken');
  assert.throws(()=>updater.updatePiesLedger({},[],now,false));
  assert.equal(fs.readFileSync(file,'utf8'),'broken');
});

test('top card shows saved rank and reward even after rearranging or entering LIVE', () => {
  const source = fs.readFileSync(path.join(root,'pilot-cabinet.js'),'utf8');
  const note = source.slice(source.indexOf('function companyPiesRewardHtml('),source.indexOf('function companyFixedTopPoolModeForPieType('));
  const context = vm.createContext({window:{UCAAPieRewards:rewards},companyFixedTopPoolConsumedFlight:()=>null,companyFixedTopPoolLiveMatchFlight:()=>null,companyFixedTopPoolInterceptedFlight:()=>null,companyFixedTopPoolLiveStatus:()=>null});
  vm.runInContext(note,context);
  const html = context.companyFixedTopPoolNoteHtml({rank:3},{label:'Hot'},'quick',0);
  assert.match(html,/#3/);
  assert.match(html,/Нагорода: 1/);
  context.companyFixedTopPoolLiveStatus = ()=>({html:'LIVE'});
  const live = context.companyFixedTopPoolNoteHtml({rank:2},{label:'Hot'},'quick',0);
  assert.match(live,/#2/);
  assert.match(live,/Нагорода: 2/);
  assert.match(live,/LIVE/);
});

test('flight markers require an actual earning for the exact completed flight and pilot', () => {
  const {record,flight} = fixture();
  const ledger = credit(record,flight);
  assert.equal(rewards.earningForFlight(ledger,flight).delta,3);
  assert.equal(rewards.earningForFlight(null,flight),null);
  assert.equal(rewards.earningForFlight(initialLedger(),flight),null);
  assert.equal(rewards.earningForFlight(ledger,{...flight,status:'live'}),null);
  assert.equal(rewards.earningForFlight(ledger,{...flight,id:'different-flight'}),null);
  assert.equal(rewards.earningForFlight(ledger,{...flight,pilot:{id:'different-pilot'}}),null);
  const id = 'hot:'+flight.id;
  for (const change of [{kind:'spend'},{delta:0},{delta:-1},{delta:1.5},{pilotId:'other'},{flightId:'other'},{id:'other'}]) {
    assert.equal(rewards.earningForFlight({...ledger,entries:{[id]:{...ledger.entries[id],...change}}},flight),null);
  }
});

test('fleet and TOP cards share the matching LIVE premium before bonus data catches up', () => {
  const source = fs.readFileSync(path.join(root,'pilot-cabinet.js'),'utf8');
  const item = {aircraftId:'aircraft-1',proposal:{premiumUsd:319}};
  const flight = {_id:'live-1'};
  const liveInfo = {state:'LIVE',pilotId:'pilot-1',pilotName:'Mozhehov Denys',aircraftId:'aircraft-1'};
  let saved = null;
  let matched = true;
  const context = vm.createContext({
    companyLiveryCardAircraftIds:()=>['aircraft-1'],
    guaranteedBonusLiveRecords:()=>saved ? [{record:saved}] : [],
    guaranteedBonusRecordForFlight:()=>saved,
    companyFixedTopPoolCategory:mode=>({items:mode==='quick'?[item]:[]}),
    companyFixedTopPoolLiveMatchFlight:()=>matched?flight:null,
    companyLiveryLiveRecordFromFlight:()=>liveInfo,
    companyLiveryLivePilotName:()=>liveInfo.pilotName,
    pilotProfileUrl:id=>'#profile/'+id,esc:String
  });
  for (const [name,next] of [
    ['companyLiveryLiveRecordForCard','companyLiveryLiveFlightAircraftId'],
    ['companyFixedTopPoolLivePayoutRecord','companyFixedTopPoolLiveStatus'],
    ['companyLiveryLivePayoutText','updateCompanyLiveryLiveBadge']
  ]) vm.runInContext(source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'(')),context);
  const fleet = context.companyLiveryLiveRecordForCard({});
  const top = context.companyFixedTopPoolLivePayoutRecord(flight,item);
  assert.equal(fleet.amount,319);
  assert.equal(fleet.pilotId,top.pilotId);
  assert.equal(context.companyLiveryLivePayoutText(fleet),context.companyLiveryLivePayoutText(top));
  assert.match(context.companyLiveryLivePayoutText(fleet),/буде виплачена.*Mozhehov Denys/u);
  matched = false;
  assert.equal(context.companyLiveryLiveRecordForCard({}),null);
  matched = true;
  saved = {...liveInfo,amount:333,status:'matched'};
  assert.equal(context.companyLiveryLiveRecordForCard({}).amount,333);
  assert.equal(context.companyFixedTopPoolLivePayoutRecord(flight,item).amount,333);
  saved = {...saved,amount:0,status:'unmatched'};
  assert.equal(context.companyLiveryLiveRecordForCard({}),null);
  assert.equal(context.companyFixedTopPoolLivePayoutRecord(flight,item),null);
});

test('an old flight on the same route cannot turn the current LIVE reward into DONE', () => {
  const source = fs.readFileSync(path.join(root,'pilot-cabinet.js'),'utf8');
  const {record,flight} = fixture();
  record.flightNumber = flight.flightNumber;
  const liveId = '6abfee39e2b73bbe59044797';
  const saved = {...record,state:'LIVE',status:'matched',amount:319};
  const app = {guaranteedBonuses:{flights:{[liveId]:saved}},flights:[{...flight,id:'older-same-route'}]};
  const context = vm.createContext({app});
  vm.runInContext(source.slice(source.indexOf('function guaranteedBonusFlightKeys('),source.indexOf('function guaranteedBonusLiveRecords(')),context);
  context.reconcileGuaranteedBonusStatesWithCompletedFlights();
  assert.equal(saved.state,'LIVE');
  assert.equal(saved.status,'matched');
  assert.equal(saved.completedFlightId,undefined);
  app.flights.push({...flight,id:liveId});
  context.reconcileGuaranteedBonusStatesWithCompletedFlights();
  assert.equal(saved.state,'DONE');
  assert.equal(saved.status,'earned');
  assert.equal(saved.completedFlightId,liveId);
  const legacy = {...record,state:'LIVE',status:'matched'};
  app.guaranteedBonuses = {flights:{'123|UKBB|UKLL':legacy}};
  app.flights = [{...flight,times:{...flight.times,actualDeparture:'2026-10-01T05:00:00Z'}}];
  context.reconcileGuaranteedBonusStatesWithCompletedFlights();
  assert.equal(legacy.state,'LIVE');
  app.flights = [flight];
  context.reconcileGuaranteedBonusStatesWithCompletedFlights();
  assert.equal(legacy.state,'DONE');
});

test('promised pies appear only in hot cards, using the confirmed LIVE rank', () => {
  const source = fs.readFileSync(path.join(root,'pilot-cabinet.js'),'utf8');
  const {record,flight} = fixture('hot-live',1);
  const saved = {...record,state:'LIVE',status:'matched',pilotName:'Mozhehov Denys'};
  const live = {_id:flight.id,depTimeAct:flight.times.actualDeparture};
  const context = vm.createContext({app:{piesLedger:initialLedger()},window:{UCAAPieRewards:rewards},
    guaranteedBonusRecordForFlight:()=>saved,companyLiveryLivePilotName:()=>saved.pilotName,
    companyFixedTopPoolConsumedFlight:()=>null,companyFixedTopPoolLiveMatchFlight:()=>live,
    companyFixedTopPoolInterceptedFlight:()=>null,companyFixedTopPoolLiveStatus:()=>({html:'✓ зараз виконується'}),
    pilotProfileUrl:id=>'#profile/'+id,esc:String});
  vm.runInContext(source.slice(source.indexOf('function companyPiesRewardHtml('),source.indexOf('function companyFixedTopPoolModeForPieType(')),context);
  const html = context.companyFixedTopPoolNoteHtml({rank:1},{label:'Hot'},'quick',0);
  assert.match(html,/3 пиріжки буде видано пілоту.*Mozhehov Denys/u);
  for (const mode of ['earn','return','idle']) {
    assert.doesNotMatch(context.companyFixedTopPoolNoteHtml({rank:1},{label:mode},mode,0),/буде видано|company-pies-reward|pyrih\.png/u);
  }
});

test('hot rewards name the LIVE recipient, then distinguish pending from credited pies', () => {
  const source = fs.readFileSync(path.join(root,'pilot-cabinet.js'),'utf8');
  const {record,flight} = fixture('recipient-flight',2);
  flight.pilot.name = 'Denys <test>';
  const app = {piesLedger:initialLedger()};
  const context = vm.createContext({app,window:{UCAAPieRewards:rewards},guaranteedBonusRecordForFlight:()=>record,
    companyFixedTopPoolLivePayoutRecord:()=>({state:'LIVE',status:'matched',pilotId:flight.pilot.id}),
    companyLiveryLivePilotName:()=>flight.pilot.name,pilotProfileUrl:id=>'#profile/'+id,
    esc:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')});
  vm.runInContext(source.slice(source.indexOf('function companyPiesRewardHtml('),source.indexOf('function companyFixedTopPoolNoteHtml(')),context);
  const item = {rank:2};
  const liveRecord = {...record,state:'LIVE',status:'matched'};
  const live = context.companyPiesRewardHtml({...item,livePieRecord:liveRecord},null,{depTimeAct:flight.times.actualDeparture});
  assert.match(live,/2 пиріжки буде видано пілоту/);
  assert.match(live,/Denys &lt;test&gt;/);
  assert.doesNotMatch(live,/нараховано/);
  const pending = context.companyPiesRewardHtml(item,flight,null);
  assert.match(pending,/2 пиріжки буде видано пілоту/);
  app.piesLedger = credit(record,flight);
  assert.match(context.companyPiesRewardHtml({rank:1},flight,null),/2 пиріжки нараховано пілоту/);
  app.piesLedger = initialLedger();
  const oldFlight = {...flight,times:{...flight.times,actualDeparture:'2026-10-01T05:00:00Z'}};
  assert.doesNotMatch(context.companyPiesRewardHtml(item,oldFlight,null),/буде видано|нараховано/);
  assert.doesNotMatch(context.companyPiesRewardHtml({...item,livePieRecord:{...liveRecord,pie:false}},null,{depTimeAct:flight.times.actualDeparture}),/буде видано/);
  context.guaranteedBonusRecordForFlight = ()=>null;
  context.companyFixedTopPoolLivePayoutRecord = ()=>({state:'LIVE',status:'matched',pilotId:flight.pilot.id});
  const freshItem = {...item,generatedAt:record.piePoolGeneratedAt,claimableUntil:record.piePoolClaimableUntil};
  assert.match(context.companyPiesRewardHtml(freshItem,null,{depTimeAct:flight.times.actualDeparture}),/2 пиріжки буде видано пілоту/);
  assert.doesNotMatch(context.companyPiesRewardHtml(freshItem,null,{depTimeAct:'2026-10-02T13:00:00Z'}),/буде видано/);
});

test('legacy external bonus records recover their exact snapshot without changing rank', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(),'ucaa-pies-test-'));
  t.after(()=>{
    assert.ok(path.resolve(fixtureRoot).startsWith(path.join(os.tmpdir(),'ucaa-pies-test-')));
    fs.rmSync(fixtureRoot,{recursive:true,force:true});
  });
  const company = path.join(fixtureRoot,'COMPANY');
  fs.mkdirSync(company);
  fs.writeFileSync(path.join(company,'pies-ledger.json'),JSON.stringify(initialLedger()));
  const updater = loadUpdater(fixtureRoot);
  const pool = {generatedAt:'2026-10-01T06:00:00Z',activeUntil:'2026-10-01T12:00:00Z',claimableUntil:'2026-10-02T12:00:00Z',categories:{quick:{label:'Hot',items:[{poolId:'pool-1',rank:1,aircraftId:'aircraft-1',proposal:{type:'schedule',flightNumber:'123',depIcao:'UKBB',arrIcao:'UKLL',premiumUsd:123}}]}}};
  fs.writeFileSync(path.join(company,'top-pool-current.json'),JSON.stringify(pool));
  const {record,flight} = fixture();
  record.piePoolKey = updater.topPoolItemsFromCurrent(pool)[0].poolKey;
  delete record.piePoolActiveUntil;
  delete record.piePoolClaimableUntil;
  const ledger = updater.updatePiesLedger({'flight-1':record},[flight],now,true);
  assert.equal(rewards.balanceForPilot(ledger,'pilot-1'),3);
  const mismatch = {...record,pieRank:2};
  assert.equal(Object.keys(updater.updatePiesLedger({'flight-1':mismatch},[flight],now,true).entries).length,0);
  const absent = {...record,piePoolGeneratedAt:'2026-10-01T05:00:00Z'};
  assert.equal(Object.keys(updater.updatePiesLedger({'flight-1':absent},[flight],now,true).entries).length,0);
});
