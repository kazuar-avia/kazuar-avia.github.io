'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const engines = ['scripts/update-top-pool.js', 'scripts/update-guaranteed-bonuses.js', 'COMPANY/update-guaranteed-bonuses.js'];
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
function extracted(file, name) {
  const body = source(file);
  const start = body.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' is missing');
  const end = body.indexOf('\nfunction ', start + 1);
  return body.slice(start, end < 0 ? body.length : end);
}
const distance = (a,b) => a===b ? 0 : a==='UKLN' ? ({UKLL:180,UKOO:420,UKBB:900,MDLR:1200}[b]||0)
  : ({UKLL:180,UKOO:390,UKBB:510,MDLR:750}[b]||0);
const azr = [
  {dep:'MDLR',arr:'UKBB',number:'819',today:false,tomorrow:true,active:true},
  {dep:'UKBB',arr:'EDDL',number:'837',today:true,tomorrow:false,active:true}
];
const ukOO = {dep:'UKOO',arr:'LTAI',number:'1',today:true,tomorrow:true,active:true};
const ukLL = {dep:'UKLL',arr:'LGRP',number:'2',today:true,tomorrow:true,active:true};
function browser(p) {
  const ctx = vm.createContext({
    companyLiveryAircraftForCard:()=>({id:'p',registration:'UR-TEST'}),
    liveryEffectiveCurrentIcao:()=>p.current, liveryCardFallbackAirport:()=>({icao:p.current}),
    liveryScheduleRoutesForAircraft:()=>p.routes, liveryBaseIcaosForAircraft:()=>p.bases,
    liveryRouteDistanceNm:distance, liveryLatestScheduleAirportIcao:()=>p.configured,
    liveryScheduleCandidateRoutes:rows=>rows.filter(r=>r.today),
    liveryChooseScheduleRoute:(rows,dep)=>rows.find(r=>r.dep===dep&&r.today)||null,
    liveryRouteProposalData:(kind,number,dep,arr)=>({kind,number,dep,arr}),
    liveryScheduleRouteFrom:(rows,dep)=>rows.find(r=>r.dep===dep&&r.today)||null,
    liveryRouteRunsTodayOrTomorrow:r=>r.today||r.tomorrow,
    liveryRouteRunsTomorrow:r=>r.tomorrow,
    liveryScheduleTimingLabel:()=> 'сьогодні',
    liveryAppendNearestScheduleTooltip:x=>x,
    liveryRangeSafeFreeProposal:(dep,arr,aircraft,title,meta)=>({kind:'free',dep,arr,reason:meta.reason}),
    liveryCharterDemandProposal:()=>null, liveryIsScheduleStuck:()=>false,
    liveryNearestScheduleFromIcao:()=>null
  });
  for(const name of ['preferredBaseIcao','liverySuggestedRouteData'])
    vm.runInContext(extracted('pilot-cabinet.js',name),ctx);
  return ctx.liverySuggestedRouteData({},'test',[],null,{});
}
function server(file,p) {
  const ctx = vm.createContext({
    upper:v=>String(v||'').toUpperCase(),isCargoAircraft:()=>false,
    scheduleRoutesForAircraft:db=>db.scheduleAssignments,
    baseIcaosForAircraft:a=>a.basesFromName,
    distanceNm:(airports,from,to)=>distance(from,to),
    routeRunsToday:r=>r.today,routeRunsTodayOrTomorrow:r=>r.today||r.tomorrow,
    pickScheduleRoute:rows=>rows[0]||null,
    topProposalCompletedToday:()=>false,demandProposalFromOrigin:()=>null,
    freeProposalWithRange:(d,airports,dep,arr,a,mode,reason)=>
      dep===arr?null:{kind:'free',dep,arr,reason}
  });
  for(const name of ['preferredBaseIcao','proposedRouteForAircraft'])
    vm.runInContext(extracted(file,name),ctx);
  return ctx.proposedRouteForAircraft({
    db:{scheduleAssignments:p.routes},
    aircraft:{id:'p',locationIcao:p.configured,lastflightlocationICAO:p.current,basesFromName:p.bases},
    airports:{},demand:{},now:new Date('2026-10-30T12:00:00Z'),completedFlights:[],completedToday:[]
  });
}
const scenarios = [
  ['UR-AZR MDLR Saturday 819: do not ferry', {current:'MDLR',configured:'MDLR',bases:['UKBB'],routes:azr},'wait','NO_FERRY'],
  ['UR-AZR staging matches locationIcao', {current:'MDLR',configured:'MDLR',bases:['UKBB'],routes:[azr[1]]},null,'NO_FERRY'],
  ['UR-AZR from KLAX returns to staging MDLR', {current:'KLAX',configured:'MDLR',bases:['UKBB'],routes:azr},'MDLR','MDLR'],
  ['UR-SUN no schedule nearest base', {current:'UKLN',configured:'UKBB',bases:['UKOO','UKLL'],routes:[]},'UKLL','UKLL'],
  ['UR-SUN both schedule bases nearest base', {current:'UKLN',configured:'UKBB',bases:['UKOO','UKLL'],routes:[ukOO,ukLL]},'UKLL','UKLL'],
  ['UR-SUN one schedule base UKOO', {current:'UKLN',configured:'UKBB',bases:['UKOO','UKLL'],routes:[ukOO]},'UKOO','UKOO'],
  ['UR-SUN already at scheduled base UKLL', {current:'UKLL',configured:'UKBB',bases:['UKOO','UKLL'],routes:[ukOO,ukLL]},'schedule','schedule'],
  ['UR-SUN at base UKLL with no schedule', {current:'UKLL',configured:'UKBB',bases:['UKOO','UKLL'],routes:[]},null,null],
  ['UR-SUN at UKLL with UKOO-only schedule', {current:'UKLL',configured:'UKBB',bases:['UKOO','UKLL'],routes:[ukOO]},'UKOO','UKOO']
];
function verify(proposal,expected) {
  if(expected==='NO_FERRY') return assert.notEqual(proposal?.kind,'free');
  if(expected==='wait') return assert.equal(proposal,'Очікує на SCHEDULE завтра');
  assert.equal(expected==='schedule'?proposal?.kind:(typeof proposal==='string'?proposal:proposal?.arr??null),expected);
}
for (const [title,p,frontend,backend] of scenarios) {
  test(title+' / pilot cabinet',()=>verify(browser(p),frontend));
  for(const file of engines) test(title+' / '+file,()=>verify(server(file,p),backend));
}
