# Route Audit

Check that your published URLs still work before you deploy.

## Catch a missing page

With Node.js 22.12 or later, run:

```sh
npx route-audit@0.3.2 --demo
```

The demo checks two URLs in a temporary build, removes `guide.html`, and checks the same URLs again:

```text
Before removing guide.html
static: 2/2 OK, 0 failed, 0 inconclusive.

After removing guide.html
static: 1/2 OK, 1 failed, 0 inconclusive.
fail  /guide  expected=reachable  observed=404  missing
```

The command exits with code 1 because `/guide` disappeared. It cleans up its temporary files.

The Venus Protocol docs built successfully while six URLs embedded in governance proposals returned 404. In local HTTP previews of the real builds, Route Audit caught all six before the fix and followed all six permanent redirects to the right pages afterward. [See the before-and-after results.](cases/venus-429/README.md)

## Find the links your consumers already use

Point `sources` at local SDK or example directories:

```json
{
  "site": "https://docs.example.org",
  "sources": ["../sdk/src", "../sdk/examples"]
}
```

Compare the same discovered inventory against the published site and a completed PR preview:

```sh
npx --no-install route-audit --baseline https://docs.example.org --preview https://pr-42.example.org --markdown route-audit.md --json comparison.json
```

New failures can block a PR; existing failures appear in the backlog. The summary includes both HTTP chains, the number of references and a source permalink from the SDK checkout. To inspect the route and line inventory independently, run `npx --no-install route-audit --discover --json inventory.json`.

[Discovery, exit codes and PR comments](docs/pull-requests.md) · [Reproduce the historical Venus comparison](cases/venus-429/README.md#discover-links-in-the-consumer-repository)

## Try it on your Astro or Starlight site

Install in the site project with Node.js 22.12 or later:

```sh
npm install -D route-audit
```

Release tarballs are also available on [GitHub](https://github.com/Caf3z1n/route-audit/releases).

Save the sitemap from your **last published version** in `reference/` and commit it. For Astro sites with a sitemap index, copy `sitemap-index.xml` and its child files (such as `sitemap-0.xml`) from the published build, keeping their relative paths. This snapshot is the list of URLs future builds must preserve.

Create `route-audit.json` in the project root, replacing the origin with the one in your sitemap. For a single sitemap, use its filename instead of the index.

```json
{
  "site": "https://docs.example.org",
  "sitemaps": ["./reference/sitemap-index.xml"]
}
```

Build the proposed change and compare it with the snapshot:

```sh
npm run build
npx route-audit --dist dist --report-only
```

If a page disappears, the report names its old path. For example, removing one page from a copy of the OpenDialog build produced this result:

```text
static: 203/204 OK, 1 failed, 0 inconclusive.
fail  /getting-started-1/getting-ready  expected=reachable  observed=404  missing
```

### Run on pull requests

Add this step after the static build in your existing GitHub Actions job. A [complete workflow for npm-based sites](examples/github-actions/route-audit.yml) is also available. For a site hosted under a prefix, add its Astro base, for example `--base /docs`.

```yaml
- name: Check published URLs
  run: npx --no-install route-audit --dist dist --report-only
```

With `--report-only`, missing pages appear in the job log without failing the job. Configuration errors and inconclusive results still exit with code 2. Remove the flag when route failures should block the build.

## Define the URL contract

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

Already using a link checker? Compare destinations from its existing crawl:

```js
import { compareDestinations } from 'route-audit/destinations';

const result = compareDestinations({
  requestedUrl: 'https://docs.example.org/old/',
  expected: '/guide/',
  observed: 'https://docs.example.org/',
});
// result.outcome === 'fail'; result.reason === 'wrong-final-destination'
```

See the [Linkinator, broken-link-checker and link-check examples](examples/checkers/README.md) for runnable adapters and comparisons across preview origins.

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

## Development

Run `npm ci` and `npm test`. Keep user-facing messages, documentation, identifiers and commit subjects in English. Use Conventional Commits and group each change with its tests.

See [case-study results](RESULTS.md) for the public inputs and the scope of each observation.
