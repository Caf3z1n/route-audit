# Compare destinations from a link checker

Each adapter exports `observe(urls)`, which returns a map from the requested URL to the URL of the successful final response. The demo scans two local sites with the chosen checker. Both sites serve HTTP 200 at the end of the chain, but the preview sends `/old-api` to the homepage. The comparison reuses the scan results and makes zero network requests of its own.

## Run the demo

In a disposable npm project with Node 24, install Route Audit and the checker you want. To try an unpublished candidate, substitute the local Route Audit tarball for `route-audit@0.5.0`.

```sh
npm install -D route-audit@0.5.0 linkinator@8.1.0
node node_modules/route-audit/examples/checkers/demo.mjs linkinator
```

For `broken-link-checker`, install `broken-link-checker@0.7.8` and pass `broken-link-checker` to the same demo. It exposes `url.redirected` after a redirect and `url.resolved` for a direct response. Linkinator exposes the followed destination in a `redirect` event with `redirects: 'warn'`.

### link-check 5.6.0

The published callback reports whether the link is alive and the final HTTP status. Its `link` field still holds the input URL. This example includes a **local demonstration patch** that exposes `finalUrl` from redirects Needle already followed, including when GET is retried after HEAD. Apply it in the disposable consumer project:

```sh
npm install -D route-audit@0.5.0 link-check@5.6.0
git apply --no-index --directory=node_modules/link-check node_modules/route-audit/examples/checkers/link-check-5.6.0.patch
node node_modules/route-audit/examples/checkers/demo.mjs link-check
```

Reinstalling `link-check` restores the published implementation. The three checker packages are installed only in the example project.

## Use the comparison in your integration

```js
import { compareDestinations } from 'route-audit/destinations';

const result = compareDestinations({
  baselineUrl: 'https://docs.example.org/old-api',
  expected: 'https://docs.example.org/v2/api',
  requestedUrl: 'https://pr.example.org/old-api',
  observed: 'https://pr.example.org/',
});
// { outcome: 'fail', reason: 'wrong-final-destination',
//   expected: 'https://pr.example.org/v2/api', observed: 'https://pr.example.org/' }
```

Use a known-good baseline or a configured expectation. `baselineUrl` defaults to `requestedUrl`. Relative destinations resolve against their respective requested URLs. Comparing two environments maps the baseline site's own origin to the preview origin; absolute third-party destinations retain their origin. Matching includes the query string and trailing slash and ignores fragments.

Pass `observed: null` when no successful final response was observed. The outcome is `unknown`; keep the checker's own diagnosis for broken or skipped links. Invalid URLs, credentials, and non-HTTP(S) destinations raise an error. The helper is synchronous and can also be imported from `route-audit`.
