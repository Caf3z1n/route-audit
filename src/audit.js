import path from 'node:path';
import { loadConfig, origin } from './input.js';
import { httpTarget, staticTarget } from './targets.js';

const redirect = status => status === 'meta' || [301,302,303,307,308].includes(status);

async function check(rule, {site, preview, read}) {
  const trace = [];
  const result = (outcome, reason) => ({path:rule.path, expected:rule.status ?? 'reachable', ...(rule.location && {expectedLocation:rule.location}), outcome, reason, trace});
  let current = new URL(rule.path,site);
  const visited = new Set();
  try {
    for (let hop = 0; hop <= 10; hop++) {
      current.hash = '';
      if (visited.has(current.href)) return result('fail','redirect-loop');
      visited.add(current.href);
      const {status,location} = await read(current);
      trace.push({url:current.href,status,...(location && {location})});
      if (preview && ([401,403,429].includes(status) || status >= 500)) return result('unknown','http-unavailable');
      if (hop === 0 && rule.status !== undefined && !preview) return result('unknown','requires-http-status');
      if (hop === 0 && rule.status !== undefined && rule.status !== status) return result('fail','wrong-status');
      if (status === 410 && rule.status === 410 && hop === 0) return result('pass','gone-as-expected');
      if (status === 200) return result('pass', hop ? 'redirect-resolves' : 'present');
      if (!redirect(status)) return result('fail',status === 404 ? 'missing' : 'unreachable');
      if (!location) return result('fail','missing-location');
      const dest = new URL(location,current);
      if (preview && dest.origin === preview && current.origin === site) {
        dest.href = site + dest.pathname + dest.search + dest.hash;
      }
      if (hop === 0 && rule.location && dest.href !== rule.location) return result('fail','wrong-destination');
      if (!['https:','http:'].includes(dest.protocol) || dest.username || dest.password) return result('fail','invalid-destination');
      if (dest.origin !== site && (!preview || !rule.location || dest.origin !== new URL(rule.location).origin)) return result('unknown','external-target-not-checked');
      current = dest;
    }
    return result('fail','too-many-redirects');
  } catch (e) {
    return {...result('unknown','read-error'), detail:e.cause?.code ?? e.message};
  }
}
export async function audit({config,dist,preview,base='/'}) {
  if (Boolean(dist) === Boolean(preview)) throw new Error('Selecione exatamente um alvo: dist ou preview.');
  if (!base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base)) throw new Error('Base estática inválida.');
  const {site,routes} = await loadConfig(config);
  if (preview) preview = origin(preview);
  const read = preview ? httpTarget(site,preview) : await staticTarget(dist,base);
  const results = [];
  // Sequential by design: low request load, stable evidence order.
  for (const rule of routes) results.push(await check(rule,{site,preview,read}));
  const summary = {total:results.length,pass:0,fail:0,unknown:0};
  for (const row of results) summary[row.outcome]++;
  return {timestamp:new Date().toISOString(),mode:preview?'http':'static',target:preview ?? path.basename(path.resolve(dist)),site,summary,results};
}
export function exitCode(report,reportOnly=false) {
  if (report.summary.unknown) return 2;
  return report.summary.fail && !reportOnly ? 1 : 0;
}
export function format(report) {
  const s = report.summary;
  return [report.mode + ': ' + s.pass + '/' + s.total + ' OK, ' + s.fail + ' divergente(s), ' + s.unknown + ' inconclusiva(s).',
    ...report.results.filter(r=>r.outcome !== 'pass').map(r=>[r.outcome,r.path,'esperado='+r.expected,'observado='+r.trace.map(h=>h.status).join('->'),r.reason,r.detail].filter(Boolean).join('  '))].join('\n');
}
