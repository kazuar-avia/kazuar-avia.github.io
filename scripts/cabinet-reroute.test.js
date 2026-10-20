'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'pilot-cabinet.js'), 'utf8');
function extract(start, end) {
  const a = source.indexOf('function ' + start + '(');
  const b = source.indexOf('function ' + end + '(', a + 1);
  assert.ok(a >= 0 && b > a, 'functions exist in the cabinet');
  return source.slice(a, b);
}

const aircraftId = '695ebf3c3dc76275ba3e31f1';
const rerouteId = '6ad4efc1e2b73bbe59c9dd12';
const entry = {flightId:rerouteId, icao:'LTAI', updatedAt:'2026-10-20T21:13:43.716Z'};
const route = {number:'813',dep:'LTAI',arr:'EDDL',active:true};

function cabinet(closedAt='2026-10-20T14:58:37.402Z') {
  const aircraft = {id:aircraftId, registration:'UR-AZR',locationIcao:'LTAI'};
  const latest = {id:'6ad7407ff7e01a7089dc816e',status:'completed',
    aircraft:{id:aircraftId},times:{closed:closedAt},actualArrival:{icao:'KLAX'}};
  const app = {flights:[latest], companyReroutes:{version:1,aircraft:{[aircraftId]:entry}}};
  const ctx = vm.createContext({
    app,
    companyLiveryMatchingIcao:()=> 'KLAX',
    companyLiveryAircraftForCard:()=>aircraft,
    liveryCardFallbackAirport:()=>({icao:'KLAX'}),
    liveryScheduleRoutesForAircraft:()=>[route],
    liveryLatestScheduleAirportIcao:()=> 'LTAI',
    liveryScheduleCandidateRoutes:routes=>routes,
    liveryChooseScheduleRoute:(_routes,dep)=>dep==='LTAI'?route:null,
    liveryRouteProposalData:(kind,num,dep,arr)=>({kind,num,dep,arr}),
    liveryScheduleRouteFrom:()=>route,
    liveryScheduleTimingLabel:()=> 'сьогодні',
    liveryAppendNearestScheduleTooltip:()=> '',
    liveryRangeSafeFreeProposal:(dep,arr)=>({kind:'free',dep,arr})
  });
  vm.runInContext(extract('companyLiveryActiveReroute', 'companyLiveryAircraftForCard'),ctx);
  vm.runInContext(extract('liverySuggestedRouteData','ensureCompanyLiveryImageWrap'),ctx);
  return {ctx,aircraft,latest};
}

test('!reroute LTAI supersedes a completed FREE flight into KLAX for the normal fleet proposal',()=>{
  const {ctx,aircraft,latest}=cabinet();
  assert.equal(ctx.companyLiveryActiveReroute(aircraft).icao,'LTAI');
  assert.equal(ctx.companyLiveryEffectiveCurrentIcao(aircraft,latest),'LTAI');
  const proposal=ctx.liverySuggestedRouteData({},'UR-AZR',[latest],latest,null);
  assert.equal(proposal.kind,'schedule');
  assert.equal(proposal.dep,'LTAI');
  assert.equal(proposal.arr,'EDDL');
});

test('reroute expires when a genuinely newer flight is completed',()=>{
  const {ctx,aircraft,latest}=cabinet('2026-10-20T22:10:00.000Z');
  assert.equal(ctx.companyLiveryActiveReroute(aircraft),null);
  assert.equal(ctx.companyLiveryEffectiveCurrentIcao(aircraft,latest),'KLAX');
  const proposal=ctx.liverySuggestedRouteData({},'UR-AZR',[latest],latest,null);
  assert.equal(proposal.kind,'free');
  assert.equal(proposal.dep,'KLAX');
});

test('invalid reroute cannot replace actual location',()=>{
  const {ctx,aircraft,latest}=cabinet();
  ctx.app.companyReroutes.aircraft[aircraftId]={...entry,icao:'FAKE5'};
  assert.equal(ctx.companyLiveryActiveReroute(aircraft),null);
  assert.equal(ctx.companyLiveryEffectiveCurrentIcao(aircraft,latest),'KLAX');
});
