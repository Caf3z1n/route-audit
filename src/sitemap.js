import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { SaxesParser } from 'saxes';

function parseLocations(xml) {
  const parser = new SaxesParser({ xmlns: true });
  const elements = [];
  const locations = [];
  let root;
  let content = '';

  parser.on('doctype', () => {
    throw new Error('DOCTYPE is unsupported in sitemaps.');
  });
  parser.on('opentag', (tag) => {
    root ??= tag.local;
    elements.push(tag.local);
    content = '';
  });
  parser.on('text', (text) => {
    content += text;
  });
  parser.on('cdata', (text) => {
    content += text;
  });
  parser.on('closetag', () => {
    const parent = elements.at(-2);
    if (
      elements.length === 3 &&
      elements.at(-1) === 'loc' &&
      ((root === 'urlset' && parent === 'url') ||
        (root === 'sitemapindex' && parent === 'sitemap'))
    ) {
      locations.push(content.trim());
    }
    elements.pop();
    content = '';
  });
  parser.write(xml).close();
  if (!['sitemapindex', 'urlset'].includes(root) || !locations.length)
    throw new Error('Invalid or empty sitemap.');
  return { index: root === 'sitemapindex', locations };
}

export async function sitemapPaths(entries, directory, site) {
  const visited = new Set();
  const paths = new Set();

  async function visit(file, publicPath) {
    if (visited.has(file)) return;
    visited.add(file);
    const sitemap = parseLocations(await readFile(file, 'utf8'));
    for (const location of sitemap.locations) {
      const url = new URL(location);
      if (url.origin !== site || url.username || url.password)
        throw new Error('Unexpected sitemap origin: ' + location);
      if (!sitemap.index) {
        paths.add(url.pathname + url.search);
        continue;
      }
      const relative = path.posix.relative(
        path.posix.dirname(publicPath),
        decodeURIComponent(url.pathname),
      );
      if (
        !relative ||
        /[\\:]/.test(relative) ||
        relative.split('/').includes('..')
      )
        throw new Error(
          'Child sitemap outside the index directory: ' + location,
        );
      await visit(path.resolve(path.dirname(file), relative), url.pathname);
    }
  }

  for (const entry of entries) {
    const filename = typeof entry === 'string' ? entry : entry.file;
    const file = path.resolve(directory, filename);
    await visit(
      file,
      typeof entry === 'string' ? '/' + path.basename(file) : entry.publicPath,
    );
  }
  return paths;
}
