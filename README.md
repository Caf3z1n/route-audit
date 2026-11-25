# Astro Route Audit

Check that previously published URLs still work after a documentation change. Run against a static Astro build or an HTTP preview. The CLI reads a historical sitemap, explicit route expectations, or both. Requires Node.js 22.12 or later.

[Venus Protocol before-and-after case study](cases/venus-429/README.md)

## Try it locally

From the source checkout:

```sh
npm ci
npm test
node bin/cli.js --config examples/bioconductor.json --preview https://bioconductor.org --json audit.json
```

For another project, install the local tarball as a development dependency and run `npx astro-route-audit`. The package is private during evaluation.

## Define the URL contract

```json
{
  "site": "https://docs.example.org",
  "sitemaps": ["./reference/sitemap.xml"],
  "routes": [
    "/guides/",
    { "path": "/old/", "status": 308, "location": "/new/" },
    { "path": "/retired/", "status": 410 }
  ]
}
```

Save as `route-audit.json`. Paths include the public base prefix. Explicit paths override sitemap entries. Local UTF-8 XML sitemap indexes are expanded relative to the index directory. For an index originally served under a subdirectory, specify `{"file":"reference/index.xml","publicPath":"/docs/index.xml"}`.

## Audit a build or a preview

```sh
npx astro-route-audit --dist dist --base /docs
npx astro-route-audit --preview https://preview.example.org --json audit.json
```

The static check looks for the file, an HTML page, or a directory index. It follows immediate HTML meta refresh redirects. An HTTP preview is required to verify hosting rules and exact HTTP status codes. Raw static checks do not interpret hosting-provider configuration.

The HTTP check uses anonymous GET requests. It inspects the first response and follows up to ten redirects to verify the destination. Ordinary routes must end at HTTP 200. Cross-origin destinations require an explicit expected location. Network errors, 401, 403, 429, and 5xx responses are inconclusive. A soft 404 returned as HTTP 200 and an in-page fragment are outside the scope of this check.

Exit codes are 0 for a passing audit, 1 for a failed expectation, and 2 for invalid configuration, operational errors or inconclusive results. With `--report-only`, failures alone yield exit code 0. JSON includes the route contract, observed redirect chain, outcome and UTC timestamp.

## Astro integration

```js
import { defineConfig } from 'astro/config';
import routeAudit from '@caf3z1n/astro-route-audit';

export default defineConfig({
  integrations: [routeAudit({ config: 'route-audit.json', reportOnly: true })],
});
```

Place the integration after plugins that modify the emitted HTML. Use the preview CLI after deployment to verify the behavior of a hosting platform.

## Development

Run `npm ci` and `npm test`. Keep user-facing messages, documentation, identifiers and commit subjects in English. Use Conventional Commits and group each change with its tests.

See [case-study results](RESULTS.md) for the public inputs and the scope of each observation.
