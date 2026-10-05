const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rewards = require('../pie-rewards.js');
const source = fs.readFileSync(path.join(__dirname,'..','pilot-cabinet.js'),'utf8');
function functions(first, next) {
  return source.slice(source.indexOf('function '+first+'('),source.indexOf('function '+next+'('));
}
const record = {
  state:'LIVE',status:'matched',pie:true,pieType:'hot',pieRank:2,pieRewardRulesVersion:2,
  pilotId:'pilot',aircraftId:'plane',depIcao:'UKOO',arrIcao:'LTAI',flightNumber:'221',proposalType:'schedule',
  piePoolKey:'quick|2|plane|221|UKOO|LTAI',piePoolGeneratedAt:'2026-10-05T06:00:45.825Z',
  piePoolActiveUntil:'2026-10-05T12:00:45.825Z',piePoolClaimableUntil:'2026-10-06T12:00:45.825Z'
};
const item = {rank:2,pieRewardRulesVersion:2,aircraftId:'plane',generatedAt:record.piePoolGeneratedAt,
  proposal:{type:'schedule',flightNumber:'221',depIcao:'UKOO',arrIcao:'LTAI',premiumUsd:672}};
const completed = {id:'flight-221',status:'completed',pilot:{id:'pilot',name:'Mozhehov Denys'},
  aircraft:{id:'plane'},flightNumber:'221',departure:{icao:'UKOO'},arrival:{icao:'LTAI'},actualArrival:{icao:'LTAI'},
  operations:{scheduled:true,free:false},times:{actualDeparture:'2026-10-05T09:03:45.976Z',closed:'2026-10-05T10:40:07.113Z'}};
function context(extra={}) {
  const ctx=vm.createContext({window:{UCAAPieRewards:rewards},
    app:{piesLedger:{version:1,ruleVersion:1,activatedAt:'2026-10-01T18:32:16.018Z',entries:{}}},
    companyLiveryLivePilotName:()=> 'Mozhehov Denys',pilotProfileUrl:id=>'#profile/'+id,esc:String,
    guaranteedBonusRecordForFlight:()=>null,companyFixedTopPoolConsumedFlight:()=>null,
    companyFixedTopPoolLiveMatchFlight:()=>null,companyFixedTopPoolInterceptedFlight:()=>null,
    companyFixedTopPoolLiveStatus:()=>null,...extra});
  vm.runInContext(functions('companyPiesRewardHtml','companyFixedTopPoolModeForPieType'),ctx);
  return ctx;
}
function render(saved, currentMatch=null, knownLive=false) {
  let note;
  const row={...item,...(saved?{livePieRecord:{...saved}}:{})};
  const before=JSON.stringify(row);
  const ctx=context({
    companyFixedTopPoolCategory:()=>({items:[row]}),companyFixedTopPoolHotItemAllowed:()=>true,
    companyFixedTopPoolLivePieItems:()=>[],companyLiveHotCardAllowed:()=>true,companyFixedTopPoolCardForItem:()=>({}),
    cloneCompanyLiveExtractCard:()=>({querySelector:()=>null}),companyLiveCloneStatus:()=>({prepend:value=>{note=value.innerHTML;}}),
    applyCompanyFixedTopPoolStatus:()=>{},companyFixedTopPoolCurrentOfferMatches:()=>currentMatch,
    companyFixedTopPoolLiveOfferKnown:()=>knownLive,document:{createElement:()=>({})}});
  vm.runInContext(functions('renderCompanyFixedTopPoolItems','renderCompanyLiveFleetExtract'),ctx);
  ctx.renderCompanyFixedTopPoolItems({appendChild:()=>{}},'quick',[],null,null);
  assert.equal(JSON.stringify(row),before,'rendering must preserve the saved claim');
  return note;
}

test('the reported confirmed TOP #2 claim names its recipient while LIVE data and the fleet offer are missing', () => {
  const html=render(record);
  assert.match(html,/2 пиріжки буде видано пілоту.*Mozhehov Denys/u);
  assert.doesNotMatch(html,/не передбачені|Перевіряємо|Нагорода:/u);
});

test('a confirmed claim takes priority over incomplete or delayed raw LIVE timestamps', () => {
  const ctx=context();
  const live={depTimeAct:'2026-10-05T05:00:00Z'};
  assert.match(ctx.companyPiesRewardHtml({...item,livePieRecord:record},null,live),/2 пиріжки буде видано пілоту/u);
  delete live.depTimeAct;
  assert.match(ctx.companyPiesRewardHtml({...item,livePieRecord:record},null,live),/2 пиріжки буде видано пілоту/u);
});

test('a confirmed claim retains its original rank and amount even if the current fleet proposal differs', () => {
  assert.match(render(record,false),/2 пиріжки буде видано пілоту/u);
  assert.match(render({...record,pieRank:1},null),/Перевіряємо/u);
});

test('missing data displays checking; confirmed route mismatches display no reward', () => {
  assert.match(render(null),/Перевіряємо нарахування пиріжків/u);
  assert.doesNotMatch(render(null),/не передбачені|буде видано/u);
  assert.match(render(null,false),/За цим рейсом пиріжки не передбачені/u);
  assert.match(render(null,null,true),/За цим рейсом пиріжки не передбачені/u);
});

test('claims for another aircraft, route, number or bonus type never promise hot currency', () => {
  for (const change of [{aircraftId:'other'},{arrIcao:'UKLL'},{flightNumber:'123'},
    {proposalType:'free'},{pieType:'cash'},{pie:false},{state:'DONE'},{status:'unmatched'}]) {
    const html=render({...record,...change});
    assert.match(html,/Перевіряємо/u);
    assert.doesNotMatch(html,/буде видано|нараховано/u);
  }
});

test('completed flights wait for confirmation, then for the ledger, and finally show the actual credited amount', () => {
  const ctx=context();
  assert.match(ctx.companyPiesRewardHtml(item,completed,null),/Перевіряємо/u);
  const earned={...record,state:'DONE',status:'earned'};
  ctx.guaranteedBonusRecordForFlight=()=>earned;
  assert.match(ctx.companyPiesRewardHtml(item,completed,null),/2 пиріжки буде видано пілоту/u);
  ctx.app.piesLedger=rewards.syncLedger(ctx.app.piesLedger,{[completed.id]:earned},[completed],new Date('2026-10-05T10:50:19.391Z'));
  ctx.guaranteedBonusRecordForFlight=()=>null;
  const html=ctx.companyPiesRewardHtml({...item,rank:1},completed,null);
  assert.match(html,/2 пиріжки нараховано пілоту/u);
  assert.doesNotMatch(html,/буде видано|Перевіряємо/u);
});

test('saved offers render country flags when the fleet has already proposed the next route', () => {
  const ctx=vm.createContext({esc:String,
    countryForAirport:code=>code.startsWith('UK')?{cc:'ua',name:'Україна'}:{cc:'tr',name:'Туреччина'},
    liveryProposalBadge:(type,number)=>`<span class="flight-number-${type}">${number}</span>`});
  vm.runInContext(functions('liveryAirportWithFlag','money'),ctx);
  vm.runInContext(functions('companyFixedTopPoolRouteHtml','companyFixedTopPoolPremiumHtml'),ctx);
  vm.runInContext(functions('companyFixedTopPoolApplyConsumedDuration','companyFixedTopPoolConsumedPilotDateHtml'),ctx);
  ctx.companyFixedTopPoolConsumedDurationText=()=> '01:35';
  const route={innerHTML:ctx.companyFixedTopPoolRouteHtml({...item,proposal:{...item.proposal,durationText:'02:30'}}),
    insertAdjacentHTML:(_where,html)=>{route.innerHTML+=html;}};
  ctx.companyFixedTopPoolApplyConsumedDuration({querySelector:()=>route},completed);
  assert.match(route.innerHTML,/UKOO/u);
  assert.match(route.innerHTML,/LTAI/u);
  assert.match(route.innerHTML,/w20\/ua\.png/u);
  assert.match(route.innerHTML,/w20\/tr\.png/u);
  assert.match(route.innerHTML,/\(01:35\).*виплачена/u);
  assert.equal((route.innerHTML.match(/class="airport-flag"/g)||[]).length,2);
});
