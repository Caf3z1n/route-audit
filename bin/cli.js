#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { audit, exitCode, format } from '../src/audit.js';
const help = 'astro-route-audit --config routes.json (--dist dist [--base /docs] | --preview https://preview.example) [--json report.json] [--report-only]';
try {
  const {values:v} = parseArgs({ options:{
    config:{type:'string', default:'route-audit.json'},dist:{type:'string'},preview:{type:'string'},
    base:{type:'string'},json:{type:'string'},'report-only':{type:'boolean'},help:{type:'boolean',short:'h'}
  }});
  if (v.help) console.log(help);
  else {
    const report = await audit(v);
    if (v.json) await writeFile(v.json,JSON.stringify(report,null,2)+'\n');
    console.log(format(report));
    process.exitCode = exitCode(report,v['report-only']);
  }
} catch (e) { console.error(e.message); process.exitCode = 2; }
