# Configuration reference

## What init saves

`npx route-audit init` looks for sitemap declarations in the published site's `robots.txt`, then tries `sitemap-index.xml` and `sitemap.xml` under the site base if none are advertised. Use `--sitemap` to choose an XML sitemap explicitly. It follows same-origin redirects and sitemap indexes, including gzip-compressed sitemaps. For sites hosted under a prefix, only URLs under that prefix enter the snapshot.

The generated `route-audit.json` stores the site origin and a sorted list of unique paths. It also stores the public base when needed, so subsequent `--dist` checks use the same mapping. Review and commit changes to this list when you intentionally add or retire URLs. To add a status or destination expectation to a captured path, replace its string entry with a rule object.

## Routes and local sitemaps

```json
{
  "site": "https://docs.example.org",
  "sitemaps": ["./reference/sitemap.xml"],
  "routes": [
    "/guides/",
    { "path": "/old/", "status": 308, "location": "/v2/", "finalLocation": "/guide/" },
    { "path": "/retired/", "status": 410 }
  ]
}
```

Save as `route-audit.json`. Paths include the public base prefix. Explicit paths override sitemap entries. Local UTF-8 XML sitemap indexes are expanded relative to the index directory. For an index originally served under a subdirectory, specify `{"file":"reference/index.xml","publicPath":"/docs/index.xml"}`.

`location` checks the first redirect. `finalLocation` checks the URL of the final successful page. In the example above, `/old/ → /v2/ → /` fails even when the homepage returns 200. Use `finalLocation` on its own to accept any supported chain leading to the expected page. Paths and query strings are compared after URL resolution; fragments are ignored. A static build can verify the final destination of immediate HTML meta refreshes. For a rule with an HTTP status, use an HTTP preview. A `410` rule cannot specify a final page.

## Reuse results from a link checker

Pass the expected URL and the final URL your checker observed to `compareDestinations`:

```js
import { compareDestinations } from 'route-audit/destinations';

const result = compareDestinations({
  requestedUrl: 'https://docs.example.org/old/',
  expected: '/guide/',
  observed: 'https://docs.example.org/',
});
// result.outcome === 'fail'; result.reason === 'wrong-final-destination'
```

The [checker examples](../examples/checkers/README.md) show how to collect final URLs with Linkinator and broken-link-checker and compare results across preview origins. The link-check example includes a local patch to expose the final URL.

## Audit a build or a preview

```sh
npx route-audit --dist dist --base /docs
npx route-audit --preview https://preview.example.org --json audit.json
```

The static check looks for the file, an HTML page, or a directory index. It follows immediate HTML meta refresh redirects. An HTTP preview is required to verify hosting rules and exact HTTP status codes. Raw static checks do not interpret hosting-provider configuration.

The HTTP check uses anonymous GET requests. It inspects the first response and follows up to ten redirects to verify the destination. Ordinary routes must end at HTTP 200. External origins must be explicitly named in `location` or `finalLocation` for that route. Network errors, 401, 403, 429, and 5xx responses are inconclusive. A soft 404 returned as HTTP 200 and an in-page fragment are outside the scope of this check.

Exit codes are 0 for a passing audit, 1 for a failed expectation, and 2 for invalid configuration, operational errors or inconclusive results. With `--report-only`, failures alone yield exit code 0. JSON includes the route contract, observed redirect chain, outcome and UTC timestamp.

## Route Audit for Astro

```js
import { defineConfig } from 'astro/config';
import routeAudit from 'route-audit/astro';

export default defineConfig({
  integrations: [routeAudit({ config: 'route-audit.json', reportOnly: true })],
});
```

Place the integration after plugins that modify the emitted HTML. Use the preview CLI after deployment to verify the behavior of a hosting platform.
