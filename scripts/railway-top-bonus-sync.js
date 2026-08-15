#!/usr/bin/env node
'use strict';

/*
  UCAA Railway top/bonus sync
  ---------------------------
  Runs the same local scripts used by the site:
    1) scripts/update-top-pool.js
    2) scripts/update-guaranteed-bonuses.js

  Then pushes only changed generated files back to GitHub:
    - COMPANY/top-pool-current.json
    - COMPANY/top-awards-log.json
    - COMPANY/guaranteed-bonuses.json
    - COMPANY/TOP-POOLS/*.json

  Required env:
    GITHUB_TOKEN

  Optional env:
    GITHUB_REPO=kazuar-avia/kazuar-avia.github.io
    GITHUB_BRANCH=main
    NEWSKY_API_KEY=...

  Usage:
    node scripts/railway-top-bonus-sync.js --once
    node scripts/railway-top-bonus-sync.js --loop
*/

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const OUTPUT_ROOT = path.resolve(__dirname, '..');
const COMPANY_DIR = path.join(OUTPUT_ROOT, 'COMPANY');
const TOP_POOLS_DIR = path.join(COMPANY_DIR, 'TOP-POOLS');

const REPO = process.env.GITHUB_REPO || 'kazuar-avia/kazuar-avia.github.io';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN || '';
const API_BASE = `https://api.github.com/repos/${REPO}`;
const args = new Set(process.argv.slice(2));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rel(file) {
  return path.relative(OUTPUT_ROOT, file).replace(/\\/g, '/');
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(file));
    else if (entry.isFile()) out.push(file);
  }
  return out;
}

function trackedFiles() {
  return [
    path.join(COMPANY_DIR, 'top-pool-current.json'),
    path.join(COMPANY_DIR, 'top-awards-log.json'),
    path.join(COMPANY_DIR, 'guaranteed-bonuses.json'),
    ...listFiles(TOP_POOLS_DIR).filter(file => /\.json$/i.test(file))
  ];
}

function snapshot() {
  const map = new Map();
  for (const file of trackedFiles()) map.set(rel(file), readText(file));
  return map;
}

function changedFiles(before) {
  const files = [];
  for (const file of trackedFiles()) {
    const key = rel(file);
    const content = readText(file);
    if (content !== before.get(key)) files.push({path:key, content});
  }
  return files.filter(item => item.content !== null);
}

function runScript(script, extraArgs = []) {
  const result = spawnSync(process.execPath, [path.join('scripts', script), ...extraArgs], {
    cwd: OUTPUT_ROOT,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status}`);
  }
}

async function githubJson(url, options = {}) {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is required');
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `token ${TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ucaa-railway-top-bonus-sync',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? (data.message || JSON.stringify(data)) : String(data || response.statusText);
    throw new Error(`GitHub API ${response.status}: ${detail}`);
  }
  return data;
}

async function remoteSha(filePath) {
  const url = `${API_BASE}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(BRANCH)}&t=${Date.now()}`;
  try {
    const data = await githubJson(url);
    return data && data.sha ? data.sha : null;
  } catch (error) {
    if (String(error.message || '').includes('GitHub API 404')) return null;
    throw error;
  }
}

async function pushFile(filePath, content, message) {
  const sha = await remoteSha(filePath);
  const body = {
    message,
    branch: BRANCH,
    content: Buffer.from(content, 'utf8').toString('base64')
  };
  if (sha) body.sha = sha;
  const url = `${API_BASE}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`;
  await githubJson(url, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
}

async function pushChangedFiles(files) {
  if (!files.length) {
    console.log('✅ Top/bonus sync: no generated file changes.');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const message = `🤖 UCAA top/bonus sync ${stamp} UTC`;
  for (const file of files) {
    await pushFile(file.path, file.content, message);
    console.log(`✅ pushed ${file.path}`);
    await sleep(250);
  }
}

async function runOnce() {
  if (!TOKEN) throw new Error('GITHUB_TOKEN is required before generating files');
  const before = snapshot();
  runScript('update-top-pool.js');
  runScript('update-guaranteed-bonuses.js');
  const files = changedFiles(before);
  await pushChangedFiles(files);
}

function msUntilNextSixHourBoundary() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  const nextHour = Math.floor(now.getUTCHours() / 6) * 6 + 6;
  next.setUTCHours(nextHour);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 6);
  return next.getTime() - now.getTime();
}

async function runLoop() {
  console.log('🚀 UCAA Railway top/bonus sync loop started.');
  await runOnce();
  while (true) {
    const wait = msUntilNextSixHourBoundary();
    console.log(`⏳ next top/bonus sync in ${Math.round(wait / 60000)} min`);
    await sleep(wait);
    try {
      await runOnce();
    } catch (error) {
      console.error(error && error.stack ? error.stack : String(error));
    }
  }
}

(args.has('--loop') ? runLoop() : runOnce()).catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
