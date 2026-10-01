#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {loadCompletedFlights, updatePiesLedger} = require('./update-guaranteed-bonuses.js');

const bonuses = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'COMPANY', 'guaranteed-bonuses.json'), 'utf8').replace(/^\uFEFF/, ''));
const dryRun = process.argv.includes('--dry-run');
const ledger = updatePiesLedger(bonuses.flights || {}, loadCompletedFlights(), new Date(), dryRun);
console.log(JSON.stringify({activatedAt: ledger.activatedAt, entries: Object.keys(ledger.entries).length, dryRun}));
