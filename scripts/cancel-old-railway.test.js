const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');

const workflow = fs.readFileSync(path.join(__dirname,'../.github/workflows/cancel-old-railway.yml'),'utf8');
const marker = '        run: |\n';
const script = workflow.slice(workflow.lastIndexOf(marker)+marker.length)
  .split('\n').map(line=>line.replace(/^ {10}/,'')).join('\n');
const bash = process.env.BASH_PATH || 'bash';
const hasBash = spawnSync(bash,['--version'],{encoding:'utf8'}).status === 0;

// Only external commands are mocked; run the exact Bash published in the workflow.
const mockCli = `
const fs=require('node:fs');
const path=require('node:path');
const file=process.env.FIXTURE_STATE;
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const [command,...args]=process.argv.slice(2);
function save(){fs.writeFileSync(file,JSON.stringify(state));}
function output(value){process.stdout.write(typeof value==='string'?value:JSON.stringify(value));}
function fixtureFile(name){
  const target=path.resolve(name);
  if(path.dirname(target)!==path.dirname(file))throw Error('Outside fixture directory');
  return target;
}
if(command==='curl'){
  const url=args.at(-1);
  if(url.includes('/git/ref/heads/main')){
    state.mainReads=(state.mainReads||0)+1;
    if(state.mainReadsSequence?.length)state.main=state.mainReadsSequence.shift();
    output({object:{sha:state.main}});
  }else{
    const [candidate,target]=url.split('/compare/')[1].split('...');
    const chain=state.history||['A','B','C'];
    const index=chain.indexOf(candidate), tip=chain.indexOf(target);
    output({status:index>=0&&tip>index?'ahead':index===tip&&index>=0?'identical':'diverged',
      merge_base_commit:{sha:index>=0&&tip>index?candidate:target}});
  }
  save();
}else if(command==='railway'){
  if(args[0]==='deployment'){
    state.listReads=(state.listReads||0)+1;save();
    if(state.listReads<=(state.failList||0)){process.stderr.write('Temporary CLI error');process.exit(1);}
    output(state.deployments);
  }else{
    const id=args.find(arg=>arg.startsWith('id=')).slice(3);
    state.cancelled.push(id);
    if(!state.keepCancelledActive)state.deployments=state.deployments.filter(row=>row.id!==id);
    save();output({data:{deploymentCancel:true}});
  }
}else if(command==='sleep'){
  state.sleeps=(state.sleeps||0)+1;
  if(state.mainAfterSleep && state.sleeps===1)state.main=state.mainAfterSleep;
  save();
}else if(command==='rm'){
  for(const name of args.filter(arg=>!arg.startsWith('-')))fs.rmSync(fixtureFile(name),{force:true});
}else if(command==='mv'){
  fs.renameSync(fixtureFile(args[0]),fixtureFile(args[1]));
}else if(command==='tail'){
  output(fs.readFileSync(fixtureFile(args.at(-1)),'utf8').split('\\n').slice(-10).join('\\n'));
}else if(command==='jq'){
  const filter=args.find(arg=>!arg.startsWith('-'));
  const input=args.at(-1)===filter?fs.readFileSync(0,'utf8'):fs.readFileSync(args.at(-1),'utf8');
  let data;try{data=JSON.parse(input);}catch{process.exit(1);}
  if(filter==='type == "array"'){if(!Array.isArray(data))process.exit(1);output('true');}
  else if(filter.includes('.object.sha'))output(data.object?.sha||'');
  else if(filter.includes('.merge_base_commit.sha'))output(data.merge_base_commit?.sha||'');
  else if(filter.includes('.status //'))output(data.status||'');
  else if(filter.includes('@tsv'))output(data.filter(row=>['INITIALIZING','WAITING','QUEUED','BUILDING','DEPLOYING'].includes(row.status))
    .map(row=>[row.id,row.status,row.meta?.commitHash||''].join('\\t')).join('\\n')+'\\n');
  else throw Error('Unrecognized jq filter');
}
`;

function deployment(id,commit,status='BUILDING') {
  return {id,status,meta:{commitHash:commit}};
}
function run(extra={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucaa-cancel-test-'));
  const statePath=path.join(dir,'state.json'), scriptPath=path.join(dir,'workflow.sh'), mockPath=path.join(dir,'mock.cjs');
  const state={main:'B',deployments:[deployment('old','A'),deployment('latest','B')],cancelled:[],...extra};
  fs.writeFileSync(statePath,JSON.stringify(state));
  fs.writeFileSync(mockPath,mockCli);
  fs.writeFileSync(scriptPath,`curl(){ "$TEST_NODE" "$MOCK_CLI" curl "$@"; }
railway(){ "$TEST_NODE" "$MOCK_CLI" railway "$@"; }
jq(){ "$TEST_NODE" "$MOCK_CLI" jq "$@"; }
sleep(){ "$TEST_NODE" "$MOCK_CLI" sleep "$@"; }
seq(){ local n; for ((n=$1;n<=$2;n++)); do echo "$n"; done; }
rm(){ "$TEST_NODE" "$MOCK_CLI" rm "$@"; }
mv(){ "$TEST_NODE" "$MOCK_CLI" mv "$@"; }
tail(){ "$TEST_NODE" "$MOCK_CLI" tail "$@"; }
${script}`);
  try {
    const env={...process.env,TEST_NODE:process.execPath.replace(/\\/g,'/'),MOCK_CLI:mockPath.replace(/\\/g,'/'),
      FIXTURE_STATE:statePath,CURRENT_SHA:extra.eventSha||'A',GITHUB_REPOSITORY:'owner/repo',GITHUB_TOKEN:'test-only',SERVICE_ID:'service'};
    if (path.isAbsolute(bash)) {
      const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path') || 'PATH';
      env[pathKey]=path.dirname(bash)+path.delimiter+(env[pathKey]||'');
    }
    const result=spawnSync(bash,[scriptPath.replace(/\\/g,'/')],{cwd:dir,encoding:'utf8',timeout:60000,
      env});
    if(result.error)throw result.error;
    return {...result,state:JSON.parse(fs.readFileSync(statePath,'utf8'))};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('bot-written data commits also trigger cancellation without a recursive push',()=>{
  assert.match(workflow,/workflow_run:\n\s+workflows: \[Update guaranteed bonuses, Update pies balance\]\n\s+types: \[completed\]\n\s+branches: \[main\]/);
  assert.match(workflow,/head_repository\.full_name == github\.repository/);
  assert.match(workflow,/workflow_dispatch:/);
});
test('a newer main than the event SHA cancels the old build and keeps latest', {skip:!hasBash},()=>{
  const result=run();
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.state.cancelled,['old']);
  assert.match(result.stdout,/FOLLOW MAIN: A -> B/);
  assert.doesNotMatch(result.stdout,/STOP:/);
});
test('a bot commit arriving during polling cancels the formerly current build', {skip:!hasBash},()=>{
  const result=run({main:'A',mainAfterSleep:'B'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.state.cancelled,['old']);
});
test('a main change immediately before cancellation repeats the ancestry check', {skip:!hasBash},()=>{
  const result=run({main:'C',eventSha:'C',mainReadsSequence:['C','B'],
    deployments:[deployment('latest','B')]});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.state.cancelled,[]);
  assert.match(result.stdout,/not an older ancestor of latest main B/);
});
test('newer, unrelated, unknown and already successful deployments are protected', {skip:!hasBash},()=>{
  const result=run({deployments:[deployment('old','A'),deployment('latest','B'),
    deployment('future','C'),deployment('other-branch','X'),deployment('unknown',null),deployment('running','A','SUCCESS')]});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.state.cancelled,['old']);
});
test('transient Railway errors are retried before cancelling the old build', {skip:!hasBash},()=>{
  const result=run({failList:2});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(result.state.cancelled,['old']);
  assert.match(result.stdout,/attempt 2\/5/);
});
test('missing latest main and persistent Railway errors fail without cancellation', {skip:!hasBash},()=>{
  for(const fixture of [{main:''},{failList:5}]){
    const result=run(fixture);
    assert.notEqual(result.status,0);
    assert.deepEqual(result.state.cancelled,[]);
  }
});
test('an older build that remains active cannot produce a false green result', {skip:!hasBash},()=>{
  const result=run({keepCancelledActive:true});
  assert.notEqual(result.status,0);
  assert.deepEqual(result.state.cancelled,['old']);
  assert.match(result.stdout,/genuinely older active deployments remain: 1/);
});
