const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const rewards = require('../pie-rewards.js');

const root = path.resolve(__dirname, '..');
const now = new Date('2026-10-01T12:00:00Z');
const initialLedger = () => ({version:1, ruleVersion:1, activatedAt:'2026-10-01T06:00:00Z', updatedAt:null, entries:{}});
function fixture(id = 'flight-1', rank = 1, pilotId = 'pilot-1') {
  const record = {
    state:'DONE', status:'earned', pie:true, pieType:'hot', pieRank:rank,
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

test('TOP #1/#2/#3 award 3/2/1 pies, other ranks award none', () => {
  for (const [rank, expected] of [[1,3],[2,2],[3,1],[4,0],[5,0],[6,0],[0,0],[-1,0],[1.5,0],['bad',0]]) {
    const {record,flight} = fixture('flight-'+rank,rank);
    assert.equal(rewards.balanceForPilot(credit(record,flight),'pilot-1'), expected);
  }
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

test('start must be in the active window, completion may use grace hours', () => {
  const {record,flight} = fixture();
  const starts = ['2026-10-01T05:59:59Z','2026-10-01T12:00:01Z'];
  for (const started of starts) {
    assert.equal(Object.keys(credit(record,{...flight,times:{...flight.times,actualDeparture:started,closed:'2026-10-01T14:00:00Z'}},initialLedger(),new Date('2026-10-01T15:00:00Z')).entries).length,0);
  }
  const later = {...flight,times:{actualDeparture:'2026-10-01T11:00:00Z',closed:'2026-10-01T14:00:00Z'}};
  assert.equal(rewards.balanceForPilot(credit(record,later,initialLedger(),new Date('2026-10-01T15:00:00Z')),'pilot-1'),3);
  assert.equal(Object.keys(credit(record,{...flight,times:{...flight.times,closed:'2026-10-02T12:00:01Z'}},initialLedger(),new Date('2026-10-02T15:00:00Z')).entries).length,0);
});

test('late data imports still earn currency for a previously valid flight', () => {
  const {record,flight} = fixture();
  const ledger = credit(record,flight,initialLedger(),new Date('2026-10-05T12:00:00Z'));
  assert.equal(rewards.balanceForPilot(ledger,'pilot-1'),3);
});

test('missing snapshot times, invalid chronology and future completion are rejected', () => {
  const {record,flight} = fixture();
  for (const change of [{piePoolGeneratedAt:null},{piePoolActiveUntil:null},{piePoolClaimableUntil:null},{piePoolKey:''}]) {
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
  const note = source.slice(source.indexOf('function companyFixedTopPoolNoteHtml('),source.indexOf('function companyFixedTopPoolModeForPieType('));
  const context = vm.createContext({window:{UCAAPieRewards:rewards},companyFixedTopPoolConsumedFlight:()=>null,companyFixedTopPoolInterceptedFlight:()=>null,companyFixedTopPoolLiveStatus:()=>null});
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
