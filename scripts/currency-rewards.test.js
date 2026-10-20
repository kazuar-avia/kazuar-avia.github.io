const test=require('node:test');
const assert=require('node:assert/strict');
const rewards=require('../pie-rewards.js');
const api=require('./update-guaranteed-bonuses.js');
const {evaluateAwards}=require('./update-top-pool.js');
const generated='2026-10-20T11:30:00Z', start='2026-10-20T12:00:00Z', done='2026-10-20T13:00:00Z';
const flight={id:'flight-1',status:'completed',pilot:{id:'pilot'},aircraft:{id:'plane'},flightNumber:'123',
  departure:{icao:'UKBB'},arrival:{icao:'EPWA'},actualArrival:{icao:'EPWA'},
  operations:{scheduled:true,free:false},times:{actualDeparture:start,closed:done}};
const live={id:'flight-1',startedAt:start,flightNumber:'123',schedule:true,free:false,depIcao:'UKBB',arrIcao:'EPWA'};
const categories={quick:'hot',earn:'cash',return:'returnRoute',idle:'idle'};
function entries(pairs){
  const pool={version:2,pieRewardRulesVersion:2,generatedAt:generated,claimableUntil:'2026-10-21T17:00:00Z',
    categories:Object.fromEntries(pairs.map(([mode,rank])=>[mode,{items:[{
      poolId:mode+'-pool',rank,aircraftId:'plane',
      proposal:{type:'schedule',flightNumber:'123',depIcao:'UKBB',arrIcao:'EPWA',premiumUsd:683}
    }]}]))};
  return api.topPoolItemsFromPools([pool]);
}
function record(pairs){
  const items=entries(pairs);
  const owners=new Map();
  const claims=api.topPoolCurrencyClaimsForLive(live,'plane',items,[],owners);
  return {...api.topPoolRecordFields(items[0]),currencyClaims:claims,
    state:'DONE',status:'earned',pilotId:'pilot',aircraftId:'plane',amount:683};
}
function ledger(active='2026-10-20T11:50:00Z'){
  return {version:1,ruleVersion:1,activatedAt:'2026-10-01T18:32:16Z',...(active?{currenciesActivatedAt:active}:{}),entries:{}};
}
const time=new Date('2026-10-20T14:00:00Z');
test('cash and pies from same flight with a single monetary record',()=>{
  const bonus=record([['quick',3],['earn',2]]);
  assert.equal(bonus.amount,683);
  assert.deepEqual(bonus.currencyClaims.map(x=>x.pieType),['hot','cash']);
  const out=rewards.syncLedger(ledger(),{'flight-1':bonus},[flight],time);
  assert.deepEqual(Object.keys(out.entries).sort(),['cash:flight-1','hot:flight-1']);
  assert.equal(rewards.balanceForPilot(out,'pilot'),1);
  assert.equal(rewards.balanceForPilot(out,'pilot','cash'),2);
  assert.equal(rewards.earningsForFlight(out,flight).length,2);
  assert.strictEqual(rewards.syncLedger(out,{'flight-1':bonus},[flight],time),out);
});
test('return and idle categories have separate balances',()=>{
  const a=record([['return',1]]),b=record([['idle',6]]);
  const flights=[{...flight,id:'f-return'},{...flight,id:'f-idle'}];
  const out=rewards.syncLedger(ledger(),{'f-return':a,'f-idle':b},flights,time);
  assert.equal(rewards.balanceForPilot(out,'pilot','returnRoute'),3);
  assert.equal(rewards.balanceForPilot(out,'pilot','idle'),1);
  assert.equal(rewards.balanceForPilot(out,'pilot'),0);
});
test('old records cannot retroactively mint new currency',()=>{
  const bonus=record([['quick',1],['earn',1]]);
  const old=rewards.syncLedger(ledger(null),{'flight-1':bonus},[flight],time);
  assert.ok(old.entries['hot:flight-1']);
  assert.equal(old.entries['cash:flight-1'],undefined);
  const before=rewards.syncLedger(ledger('2026-10-20T12:30:00Z'),{'flight-1':bonus},[flight],time);
  assert.equal(before.entries['cash:flight-1'],undefined);
});
test('old pie earnings remain immutable and counted independently',()=>{
  const saved={id:'hot:historic',flightId:'historic',pilotId:'pilot',category:'hot',kind:'earn',delta:3};
  const source={...ledger(),entries:{'hot:historic':saved}};
  const out=rewards.syncLedger(source,{'flight-1':record([['quick',3],['earn',2]])},[flight],time);
  assert.strictEqual(out.entries['hot:historic'],saved);
  assert.equal(rewards.balanceForPilot(out,'pilot'),4);
  assert.equal(rewards.balanceForPilot(out,'pilot','cash'),2);
});
test('invalid completions and stale operations receive no currency',()=>{
  const bonus=record([['quick',1],['earn',2]]);
  const invalid=[{...flight,status:'ongoing'},{...flight,pilot:{id:'different'}},
    {...flight,departure:{icao:'UKLL'}},
    {...flight,operations:{scheduled:false,free:true}},
    {...flight,times:{actualDeparture:'2026-10-20T11:00:00Z',closed:done}},
    {...flight,times:{actualDeparture:start,closed:'2026-10-20T15:00:00Z'}}];
  for(const entry of invalid)assert.equal(Object.keys(rewards.syncLedger(ledger(),{'flight-1':bonus},[entry],time).entries).length,0);
});
test('a claimed TOP slot cannot be claimed again by another live flight',()=>{
  const items=entries([['quick',3],['earn',2]]);
  const owners=new Map();
  assert.equal(api.topPoolCurrencyClaimsForLive(live,'plane',items,[],owners).length,2);
  assert.equal(api.topPoolCurrencyClaimsForLive({...live,id:'second'},'plane',items,[],owners).length,0);
});
test('statistical awards log does not double-count archived snapshots',()=>{
  const result=evaluateAwards({claimableItems:[],completedFlights:[flight],now:time,
    windowStart:new Date('2026-10-20T11:00:00Z'),awardsLog:{awards:[{awardId:'old',flightId:'flight-1',category:'hot'}]}});
  assert.deepEqual(result,[]);
});

test('original four TOPs have exactly one currency image apiece',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const root=path.resolve(__dirname,'..');
  for(const file of ['pyrih.png','icons/cashcoin.png','icons/mzheton.png','icons/rem.png']){
    assert.equal(fs.existsSync(path.join(root,file)),true,file+' missing');
  }
  const src=fs.readFileSync(path.join(root,'pilot-cabinet.js'),'utf8');
  for(const name of ['companyExtraCurrencyRewardHtml','earnedExtraCurrencyIcons','liveExtraCurrencyIcons'])
    assert.ok(src.includes('function '+name+'('),name+' missing');
});
test('currency display uses the existing TOP styling and never inserts new profile controls',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const src=fs.readFileSync(path.resolve(__dirname,'../pilot-cabinet.js'),'utf8');
  const section=src.slice(src.indexOf('function companyExtraCurrencyInfo('),src.indexOf('function pieRewardIconHtml('));
  const app={piesLedger:{currenciesActivatedAt:'2026-10-20T11:50:00Z',entries:{}}};
  const rewardRecord=record([['earn',2]]);
  const liveRecord={...rewardRecord,state:'LIVE',status:'matched'};
  const context=vm.createContext({app,window:{UCAAPieRewards:rewards},
    guaranteedBonusRecordForFlight:()=>liveRecord,esc:x=>String(x),
    pilotProfileUrl:id=>'/pilot/'+id,companyLiveryLivePilotName:()=> 'Pilot Name'});
  vm.runInContext(section,context);
  const item={rank:2,aircraftId:'plane'};
  const rewardHtml=context.companyExtraCurrencyRewardHtml(item,null,null,'earn');
  assert.match(rewardHtml,/Нагорода: 2/);
  assert.match(rewardHtml,/icons\/cashcoin.png/);
  assert.match(context.companyExtraCurrencyRewardHtml(item,null,null,'idle'),/icons\/rem.png/);
  assert.match(context.companyExtraCurrencyRewardHtml(item,null,null,'return'),/icons\/mzheton.png/);
  assert.equal(context.companyExtraCurrencyRewardHtml(item,null,null,'quick'),'');
  const liveFlight={...live,depTimeAct:start};
  assert.match(context.companyExtraCurrencyRewardHtml(item,null,liveFlight,'earn'),/буде видано пілоту/);
  assert.match(context.liveExtraCurrencyIcons(liveFlight),/icons\/cashcoin.png/);
  app.piesLedger=rewards.syncLedger(ledger(),{'flight-1':rewardRecord},[flight],time);
  assert.match(context.earnedExtraCurrencyIcons(flight),/icons\/cashcoin.png/);
  assert.match(context.companyExtraCurrencyRewardHtml(item,flight,null,'earn'),/нараховано пілоту/);
  app.piesLedger={...app.piesLedger,currenciesActivatedAt:'2026-10-20T13:00:00Z'};
  assert.match(context.companyExtraCurrencyRewardHtml(item,null,liveFlight,'earn'),/до запуску/);
  assert.equal(context.liveExtraCurrencyIcons(liveFlight),'');
});
