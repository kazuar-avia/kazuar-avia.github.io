const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {hotCandidateAllowed, buildTopPool} = require('./update-top-pool.js');
const rewards = require('../pie-rewards.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pilot-cabinet.js'), 'utf8');

function candidate(id, minutes = 210, type = 'schedule', group = 'wet') {
  return {aircraftId:id, aircraft:{id}, aircraftTitle:id, group, registration:id,
    dep:'UKBB', arr:'EPWA', proposalKind:type, proposalReason:'schedule', flightNumber:'123',
    blockMinutes:minutes, amount:300, ratePerHour:300/(minutes/60)};
}
function pool(candidates) {
  return buildTopPool({candidates, completedFlights:[], now:new Date('2026-10-03T12:00:00Z'), windowHours:6, graceHours:24});
}
function card(group = 'wetlease-section') {
  return {closest:()=>({classList:{contains:name=>name===group}})};
}
function frontend(extra = {}) {
  const context = vm.createContext(extra);
  vm.runInContext(source.slice(source.indexOf('function companyLiveHotCardAllowed('), source.indexOf('function companyLiveReservedCardsBeforeMode(')), context);
  vm.runInContext(source.slice(source.indexOf('function companyFixedTopPoolHotItemAllowed('), source.indexOf('function renderCompanyFixedTopPoolItems(')), context);
  return context;
}

test('SCHEDULE and FREE offers include exactly 210 minutes and reject anything longer', () => {
  for (const type of ['schedule','free']) {
    assert.equal(hotCandidateAllowed(candidate('boundary',210,type)),true);
    assert.equal(hotCandidateAllowed(candidate('under',209,type)),true);
    assert.equal(hotCandidateAllowed(candidate('over',211,type)),false);
    assert.equal(hotCandidateAllowed(candidate('fraction-over',210.01,type)),false);
    assert.equal(hotCandidateAllowed(candidate('zero',0,type)),false);
  }
});

test('hot selection excludes Dry Lease, missing routes, premiums and unsupported operations', () => {
  const valid = candidate('normal');
  for (const change of [{group:'dry'},{group:'unknown',aircraftTitle:'DRY LEASE A320'},
    {dep:''},{arr:''},{arr:'UKBB'},{amount:0},{amount:-1},{proposalKind:'charter'}]) {
    assert.equal(hotCandidateAllowed({...valid,...change}),false);
  }
  assert.equal(pool([valid,candidate('dry',90,'free','dry')]).counts.hot,1);
});

test('shortest SCHEDULE offers come first; FREE only fills remaining places', () => {
  const result = pool([candidate('free-short',60,'free'),candidate('schedule-long',210),
    candidate('schedule-short',90),candidate('too-long',211),candidate('dry',80,'free','dry')]);
  assert.deepEqual(result.categories.quick.items.map(item=>item.aircraftId),['schedule-short','schedule-long','free-short']);
  assert.deepEqual(result.categories.quick.items.map(item=>item.rank),[1,2,3]);
  assert.equal(result.pieRewardRulesVersion,2);
  assert.ok(result.categories.quick.items.every(item=>item.pieRewardRulesVersion===2));
  assert.match(result.categories.quick.items[0].categoryLabel,/3 год 30 хв/);
  assert.equal(result.categories.earn.items.some(item=>item.aircraftId==='too-long'),true);
});

test('six eligible SCHEDULE offers do not get replaced by a shorter FREE offer', () => {
  const schedules = Array.from({length:7},(_,index)=>candidate('schedule-'+index,150+index));
  const result = pool([candidate('free',30,'free'),...schedules]);
  assert.equal(result.counts.hot,6);
  assert.ok(result.categories.quick.items.every(item=>item.proposalKind==='schedule'));
  assert.equal(pool([]).counts.hot,0);
});

test('browser fallback uses the same 210-minute boundary and validates route, premium and fleet', () => {
  const context = frontend();
  for (const type of ['schedule','free']) {
    const item={card:card(),proposalType:type,origin:'UKBB',destination:'EPWA',premium:300,minutes:210};
    assert.equal(context.companyLiveHotOfferAllowed(item),true);
    for (const change of [{minutes:211},{minutes:0},{premium:0},{destination:''},{card:card('drylease-section')},{card:card('waiting-section')}]) {
      assert.equal(context.companyLiveHotOfferAllowed({...item,...change}),false);
    }
  }
});

test('browser fallback preserves SCHEDULE priority and never fills the list with invalid offers', () => {
  const scheduleCards=[card(),card(),card(),card('drylease-section')];
  const scheduleMinutes=[210,90,211,70];
  const freeCard=card();
  const offers=new Map(scheduleCards.map((current,index)=>[current,{card:current,aircraftId:'s'+index,
    proposalType:'schedule',origin:'UKBB',destination:'EPWA',premium:300,rate:100,title:'s'+index,minutes:scheduleMinutes[index]}]));
  const free={card:freeCard,aircraftId:'free',proposalType:'free',origin:'EPWA',destination:'UKBB',
    premium:300,rate:100,title:'free',minutes:60,isUkraineDomestic:false};
  const context=frontend({companyLiveScheduleOfferForCard:current=>offers.get(current),
    companyLiveOfferForCard:current=>current===freeCard?free:null,companyLiveBuildCandidateAllowed:()=>true,
    companyLiveQuickCompare:(a,b)=>a.minutes-b.minutes||b.rate-a.rate});
  vm.runInContext(source.slice(source.indexOf('function companyLivePushUniqueOffers('),source.indexOf('function companyLiveShortFallbackOfferForCard(')),context);
  const selected=context.companyLiveQuickTopItems([...scheduleCards,freeCard]);
  assert.deepEqual(Array.from(selected,item=>item.aircraftId),['s1','s0','free']);
});

test('saved hot cards reject Dry Lease and invalid offers while including 03:30', () => {
  const context=frontend();
  const item={group:'wet',aircraftTitle:'normal',proposal:{type:'schedule',depIcao:'UKBB',arrIcao:'EPWA',premiumUsd:300,durationText:'03:30'}};
  assert.equal(context.companyFixedTopPoolHotItemAllowed(item),true);
  assert.equal(context.companyFixedTopPoolHotItemAllowed({...item,proposal:{...item.proposal,durationText:'03:31'}}),false);
  assert.equal(context.companyFixedTopPoolHotItemAllowed({...item,group:'dry'}),false);
  assert.equal(context.companyFixedTopPoolHotItemAllowed({...item,proposal:{...item.proposal,arrIcao:''}}),false);
});

test('TOP #4 through #6 show one promised pie with the saved pilot and one earned pie after credit', () => {
  const activatedAt='2026-10-03T06:00:00Z';
  const app={piesLedger:{version:1,ruleVersion:1,activatedAt,entries:{}}};
  let record;
  const context=vm.createContext({app,window:{UCAAPieRewards:rewards},guaranteedBonusRecordForFlight:()=>record,
    companyLiveryLivePilotName:()=> 'Pilot',pilotProfileUrl:id=>'#profile/'+id,esc:String});
  vm.runInContext(source.slice(source.indexOf('function companyPiesRewardHtml('),source.indexOf('function companyFixedTopPoolNoteHtml(')),context);
  for (const rank of [4,5,6]) {
    record={state:'LIVE',status:'matched',pie:true,pieType:'hot',pieRank:rank,pieRewardRulesVersion:2,
      pilotId:'pilot',piePoolGeneratedAt:activatedAt,piePoolClaimableUntil:'2026-10-04T12:00:00Z'};
    const item={rank,pieRewardRulesVersion:2};
    const live={depTimeAct:'2026-10-03T07:00:00Z'};
    assert.match(context.companyPiesRewardHtml(item,null,live),/1 пиріжок буде видано пілоту.*Pilot/);
    record.pieRewardRulesVersion=1;
    assert.equal(context.companyPiesRewardHtml(item,null,live),'');
    const flight={id:'flight-'+rank,status:'completed',pilot:{id:'pilot',name:'Pilot'}};
    app.piesLedger.entries['hot:'+flight.id]={id:'hot:'+flight.id,flightId:flight.id,pilotId:'pilot',kind:'earn',delta:1};
    assert.match(context.companyPiesRewardHtml(item,flight,null),/1 пиріжок нараховано пілоту.*Pilot/);
  }
});

test('new TOP #6 promises one pie while the background bonus record is catching up', () => {
  const activatedAt='2026-10-03T06:00:00Z';
  const context=vm.createContext({app:{piesLedger:{activatedAt}},window:{UCAAPieRewards:rewards},
    guaranteedBonusRecordForFlight:()=>null,
    companyFixedTopPoolLivePayoutRecord:()=>({state:'LIVE',status:'matched',pilotId:'pilot'}),
    companyLiveryLivePilotName:()=> 'Pilot',pilotProfileUrl:id=>'#profile/'+id,esc:String});
  vm.runInContext(source.slice(source.indexOf('function companyPiesRewardHtml('),source.indexOf('function companyFixedTopPoolNoteHtml(')),context);
  const item={rank:6,pieRewardRulesVersion:2,generatedAt:activatedAt,claimableUntil:'2026-10-04T12:00:00Z'};
  assert.match(context.companyPiesRewardHtml(item,null,{depTimeAct:'2026-10-03T07:00:00Z'}),/1 пиріжок буде видано пілоту.*Pilot/);
});

function liveRewardContext(record) {
  const generatedAt='2026-10-03T07:55:42.582Z';
  const context=vm.createContext({app:{piesLedger:{activatedAt:'2026-10-01T18:32:16.018Z'}},
    window:{UCAAPieRewards:rewards},guaranteedBonusRecordForFlight:()=>record,
    companyFixedTopPoolLivePayoutRecord:()=>({state:'LIVE',status:'matched',pilotId:'pilot',...record}),
    companyLiveryLivePilotName:()=> 'Pilot',pilotProfileUrl:id=>'#profile/'+id,esc:String});
  vm.runInContext(source.slice(source.indexOf('function companyPiesRewardHtml('),source.indexOf('function companyFixedTopPoolNoteHtml(')),context);
  return {context,item:{rank:3,pieRewardRulesVersion:2,generatedAt,claimableUntil:'2026-10-04T13:55:42.582Z'}};
}

test('all six ranks name the eligible live pilot even when only the monetary record has arrived', () => {
  const {context,item}=liveRewardContext({state:'LIVE',status:'matched',pie:false,pieType:null});
  for (const [rank,quantity] of [[1,3],[2,2],[3,1],[4,1],[5,1],[6,1]]) {
    const html=context.companyPiesRewardHtml({...item,rank},null,{depTimeAct:item.generatedAt});
    assert.match(html,new RegExp(quantity+' пиріж(?:ок|ки) буде видано пілоту.*Pilot'));
    assert.doesNotMatch(html,/Нагорода:/);
  }
});

test('a live flight that started before its hot offer gets an explicit explanation, never a promise', () => {
  const {context,item}=liveRewardContext({state:'LIVE',status:'matched',pie:false,pieType:null});
  const html=context.companyPiesRewardHtml(item,null,{depTimeAct:'2026-10-03T07:54:00Z'});
  assert.match(html,/Без пиріжків: рейс почався до появи пропозиції/);
  assert.doesNotMatch(html,/буде видано|Нагорода:/);
});

test('an existing non-hot claim cannot turn into a new hot reward', () => {
  const {context,item}=liveRewardContext({state:'LIVE',status:'matched',pie:true,pieType:'cash',
    pieRank:3,pieRewardRulesVersion:2,piePoolGeneratedAt:'2026-10-03T06:00:00Z',
    piePoolClaimableUntil:'2026-10-04T12:00:00Z'});
  const html=context.companyPiesRewardHtml(item,null,{depTimeAct:'2026-10-03T07:54:00Z'});
  assert.match(html,/інша бонусна пропозиція/);
  assert.doesNotMatch(html,/буде видано/);
});

test('saved older hot claims retain their promised rank and validity after a pool refresh', () => {
  const {context,item}=liveRewardContext({state:'LIVE',status:'matched',pie:true,pieType:'hot',
    pieRank:1,pieRewardRulesVersion:1,piePoolGeneratedAt:'2026-10-03T06:00:00Z',
    piePoolClaimableUntil:'2026-10-04T12:00:00Z',pilotId:'pilot'});
  assert.match(context.companyPiesRewardHtml(item,null,{depTimeAct:'2026-10-03T07:54:00Z'}),/3 пиріжки буде видано пілоту.*Pilot/);
});

test('expired, pre-activation and unknown live start times never promise a hot reward', () => {
  const {context,item}=liveRewardContext(null);
  for (const [started,reason] of [['2026-10-04T13:55:42.583Z',/після завершення/],
    ['2026-10-01T18:32:16.017Z',/до запуску нагород/],['',/Перевіряємо/]]) {
    const html=context.companyPiesRewardHtml(item,null,{depTimeAct:started});
    assert.match(html,reason);
    assert.doesNotMatch(html,/буде видано/);
  }
});

function renderedPoolOrder(mode, liveRanks) {
  const items=Array.from({length:6},(_,index)=>({rank:index+1,aircraftId:'aircraft-'+(index+1)}));
  const cards=new Map(items.map(item=>[item.aircraftId,{aircraftId:item.aircraftId}]));
  const liveRows=liveRanks.map(rank=>({item:{...items[rank-1],livePieRecord:{pieRank:rank,pie:true}},
    card:cards.get(items[rank-1].aircraftId),livePieCarryover:true}));
  const savedClaims=JSON.stringify(liveRows);
  const rendered=[];
  const context=vm.createContext({
    companyFixedTopPoolCategory:()=>({label:'Offers',items}),companyFixedTopPoolHotItemAllowed:()=>true,
    companyFixedTopPoolLivePieItems:()=>liveRows,companyLiveHotCardAllowed:()=>true,
    companyFixedTopPoolCardForItem:item=>cards.get(item.aircraftId),
    cloneCompanyLiveExtractCard:card=>({...card,querySelector:()=>null}),
    companyLiveCloneStatus:()=>({prepend:()=>{}}),applyCompanyFixedTopPoolStatus:()=>{},
    companyFixedTopPoolLiveMatchFlight:()=>null,companyFixedTopPoolConsumedFlight:()=>null,
    companyFixedTopPoolInterceptedFlight:()=>null,companyFixedTopPoolNoteHtml:()=>'',
    document:{createElement:()=>({})}});
  vm.runInContext(source.slice(source.indexOf('function renderCompanyFixedTopPoolItems('),source.indexOf('function renderCompanyLiveFleetExtract(')),context);
  context.renderCompanyFixedTopPoolItems({appendChild:clone=>rendered.push(clone.aircraftId)},mode,[],null,null);
  assert.equal(JSON.stringify(liveRows),savedClaims,'rendering must preserve the saved LIVE ranks');
  return rendered;
}

test('hot cards keep TOP #1 through #6 order with one, several or all flights LIVE', () => {
  const expected=Array.from({length:6},(_,index)=>'aircraft-'+(index+1));
  for(const liveRanks of [[4],[5,2,4],[6,5,4,3,2,1],[]]) {
    assert.deepEqual(renderedPoolOrder('quick',liveRanks),expected);
  }
});

test('sorting hot cards does not change the LIVE-first display in the other offer tabs', () => {
  for(const mode of ['earn','return','idle']) {
    assert.deepEqual(renderedPoolOrder(mode,[4]),['aircraft-4','aircraft-1','aircraft-2','aircraft-3','aircraft-5','aircraft-6']);
  }
});
