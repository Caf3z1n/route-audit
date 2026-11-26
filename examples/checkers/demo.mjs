import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { compareDestinations } from 'route-audit/destinations';

const adapter = process.argv[2];
if (!['link-check', 'linkinator', 'broken-link-checker'].includes(adapter))
  throw new Error('Choose link-check, linkinator, or broken-link-checker.');
const { observe } = await import(`./${adapter}.mjs`);
const paths = ['/stable', '/old-guide', '/old-api'];

async function fixture(preview) {
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const redirects = {
      '/old-guide': '/guide',
      '/old-api': '/v2/api',
      ...(preview && { '/v2/api': '/' }),
    };
    const location = redirects[req.url];
    if (location) res.writeHead(301, { location }).end();
    else if (['/stable', '/guide', '/v2/api', '/'].includes(req.url))
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<title>Example</title>');
    else res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    origin: 'http://127.0.0.1:' + server.address().port,
    requests: () => requests,
  };
}

const sites = [];
try {
  sites.push(await fixture(false));
  sites.push(await fixture(true));
  const [published, preview] = sites;
  const expected = await observe(paths.map((path) => published.origin + path));
  const observed = await observe(paths.map((path) => preview.origin + path));
  const requestCount = preview.requests() + published.requests();
  for (const path of paths) {
    const baselineUrl = published.origin + path;
    const requestedUrl = preview.origin + path;
    // Compare against a known-good capture.
    assert.ok(expected.get(baselineUrl));
    const result = compareDestinations({
      baselineUrl,
      requestedUrl,
      expected: expected.get(baselineUrl),
      observed: observed.get(requestedUrl),
    });
    assert.equal(result.outcome, path === '/old-api' ? 'fail' : 'pass');
    console.log(
      `${path}  ${result.outcome}  expected=${new URL(result.expected).pathname}  observed=${new URL(result.observed).pathname}`,
    );
  }
  assert.equal(preview.requests() + published.requests(), requestCount);
  console.log('Additional requests during comparison: 0');
} finally {
  for (const { server } of sites) {
    server.close();
    server.closeAllConnections();
  }
}
