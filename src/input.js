import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SaxesParser } from 'saxes';

export function origin(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.href !== url.origin + '/') {
    throw new Error('Informe uma origem HTTP(S) sem caminho, credenciais ou parâmetros.');
  }
  return url.origin;
}
function routePath(value, site) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.includes('#')) {
    throw new Error('Rota inválida: ' + value);
  }
  const url = new URL(value, site);
  return url.pathname + url.search;
}
function parseSitemap(xml) {
  const p = new SaxesParser({ xmlns: true });
  let root, buffer = '';
  const elements = [], urls = [];
  p.on('doctype', () => { throw new Error('DOCTYPE em sitemap não é suportado.'); });
  p.on('opentag', t => { elements.push(t.local); root ??= t.local; buffer = ''; });
  p.on('text', t => { buffer += t; });
  p.on('cdata', t => { buffer += t; });
  p.on('closetag', () => {
    if (['urlset/url/loc','sitemapindex/sitemap/loc'].includes(elements.join('/'))) urls.push(buffer.trim());
    elements.pop();
    buffer = '';
  });
  p.write(xml).close();
  if (!['sitemapindex','urlset'].includes(root) || urls.length === 0) throw new Error('Sitemap inválido ou vazio.');
  return { index: root === 'sitemapindex', urls };
}
export async function loadConfig(filename) {
  const dir = path.dirname(path.resolve(filename));
  const cfg = JSON.parse(await readFile(filename,'utf8'));
  const site = origin(cfg.site);
  const routes = new Map(), seen = new Set(), explicit = new Set();
  async function visit(file, publicPath) {
    if (seen.has(file)) return;
    seen.add(file);
    const doc = parseSitemap(await readFile(file, 'utf8'));
    for (const loc of doc.urls) {
      const url = new URL(loc);
      if (url.origin !== site || url.username || url.password) throw new Error('Origem inesperada no sitemap: ' + loc);
      if (!doc.index) {
        const key = routePath(url.pathname + url.search, site);
        routes.set(key, { path: key });
        continue;
      }
      // Indexes are read from disk. Mirror their public directory layout locally.
      const parent = path.posix.dirname(publicPath);
      const rel = path.posix.relative(parent, decodeURIComponent(url.pathname));
      if (rel.includes('\\') || !rel || rel.split('/').some(s => s === '..' || s.includes(':'))) throw new Error('Sitemap filho fora do diretório: ' + loc);
      await visit(path.resolve(path.dirname(file), rel), url.pathname);
    }
  }
  for (const entry of cfg.sitemaps ?? []) {
    const file = path.resolve(dir, typeof entry === 'string' ? entry : entry.file);
    await visit(file, typeof entry === 'string' ? '/' + path.basename(file) : entry.publicPath);
  }
  for (const entry of cfg.routes ?? []) {
    const rule = typeof entry === 'string' ? { path: entry } : entry;
    const key = routePath(rule.path, site);
    if (explicit.has(key)) throw new Error('Rota explícita duplicada: ' + key);
    explicit.add(key);
    if (rule.status !== undefined && ![200,301,302,303,307,308,410].includes(rule.status)) throw new Error('Status não suportado em ' + key);
    let location;
    if (rule.location !== undefined) {
      if (![301,302,303,307,308].includes(rule.status)) throw new Error('Destino exige status de redirecionamento em ' + key);
      const u = new URL(rule.location, new URL(key,site));
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error('Destino inválido.');
      location = u.href;
    }
    routes.set(key,{path:key, status:rule.status, location});
  }
  if (!routes.size) throw new Error('Nenhuma rota configurada.');
  return {site,routes:[...routes.values()]};
}
