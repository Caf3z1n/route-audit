# Venus Protocol PR 429

Six URLs embedded in governance proposals stopped working after documentation pages were renamed. The proposal text was already on chain. The maintainers restored the links by adding six permanent redirects in [PR 429](https://github.com/VenusProtocol/venus-protocol-documentation/pull/429).

## Outcome

| Check | Before | After |
| --- | --- | --- |
| Legacy URLs | Six HTTP 404 responses | Six HTTP 308 redirects to the expected destinations, then HTTP 200 |
| Direct destination controls | Six HTTP 200 responses | Six HTTP 200 responses |
| Audit CLI exit code for legacy URLs | 1 | 0 |
| Upstream build and URL checks | Passed | Passed |

The before revision is the parent of the squash commit. Both revisions generated 230 HTML pages. Venus's parity check validated the 229 paths in its GitBook baseline. The six old paths supplied by the PR were absent from that list. Its declared redirects grew from 47 to 53.

The historical responses came from **local HTTP previews** using the real static builds, the respective unmodified `vercel.json`, Vercel's routing compiler, and a static file server. The replay checks each configuration hash before serving. It applies the redirects and trailing-slash setting used by this case. It does not emulate the full hosting platform. The auditor runs as a separate CLI process and follows real HTTP responses. All twelve canonical-page controls passed.

In a separate public-site check on November 25, 2026, all six production URLs returned 308 and then 200. That observation describes the site on that date.

[Before commit](https://github.com/VenusProtocol/venus-protocol-documentation/commit/39e5696577d089a207c671997acf996969ff67f5) · [After commit](https://github.com/VenusProtocol/venus-protocol-documentation/commit/46866f830f44b728cb732b77d0630cea7caec5cb) · [Input routes](../../examples/venus-429.json) · [Historical observations](../../reports/venus-429/) · [Production observations](../../reports/venus-429/public-site.json)

| Old path | Destination | Before | After |
| --- | --- | --- | --- |
| `/technical-reference/reference-technical-articles/multichain-governance` | `/technical-reference/reference-technical-articles/omnichain-governance` | 404 | 308 then 200 |
| `/whats-new/isolated-pools` | `/guides/isolated-pools-deprecation` | 404 | 308 then 200 |
| `/whats-new/emode` | `/whats-new/e-mode` | 404 | 308 then 200 |
| `/technical-reference/reference-technical-articles/technical-doc-xvs-bridge` | `/technical-reference/reference-technical-articles/xvs-bridge` | 404 | 308 then 200 |
| `/deployed-contracts/xvs-multichain` | `/deployed-contracts/xvs-omnichain` | 404 | 308 then 200 |
| `/technical-reference/reference-oracle/boundvalidator` | `/technical-reference/reference-oracle/bound-validator` | 404 | 308 then 200 |

## Reproduce

Use Node 24 and pnpm 10.34.9. From the audit package directory:

```sh
npm ci
npm ci --prefix cases/venus-429

git clone https://github.com/VenusProtocol/venus-protocol-documentation.git ../venus-history
git -C ../venus-history worktree add --detach ../venus-before 39e5696577d089a207c671997acf996969ff67f5
git -C ../venus-history worktree add --detach ../venus-after 46866f830f44b728cb732b77d0630cea7caec5cb

pnpm --dir ../venus-before install --frozen-lockfile
pnpm --dir ../venus-before run build
pnpm --dir ../venus-before run check
pnpm --dir ../venus-after install --frozen-lockfile
pnpm --dir ../venus-after run build
pnpm --dir ../venus-after run check

node cases/venus-429/replay.js ../venus-before ../venus-after ./local-results
```

On Windows, the upstream post-build scripts in these revisions treat a file URL pathname as a filesystem path. In each disposable checkout, add `import { fileURLToPath } from 'node:url';` to `scripts/csp.mjs` and `scripts/check-urls.mjs`, then replace `new URL(import.meta.url).pathname` with `fileURLToPath(import.meta.url)` in the root path calculation. This adjustment was used for both Windows builds. The site content, redirects, and expected routes were taken directly from the pinned sources.

The replay fails if any old path returns an unexpected status, follows a different destination, or if a canonical control fails. Run the independent production check with:

```sh
node bin/cli.js --config examples/venus-429.json --preview https://docs-v4.venus.io --json venus-live.json
```

## Discover links in the consumer repository

The independent input to this replay is the [October 30 proposal repository](https://github.com/VenusProtocol/vips/tree/19a7e734d4cd793c39ed3f447e90dcd57648139a/vips). The discovery command reads the checked-out `vips/` directory and freezes its inventory before checking either site revision. The six known URLs from the upstream PR are not used as discovery inputs.

```sh
git clone https://github.com/VenusProtocol/vips.git ../venus-vips
git -C ../venus-vips checkout --detach 19a7e734d4cd793c39ed3f447e90dcd57648139a
node cases/venus-429/compare.js ../venus-before ../venus-after ../venus-vips ./local-results/compare
```

Use the same two built worktrees and case dependencies as above. The output directory contains the reusable route inventory and JSON and Markdown for each comparison.

| Baseline | Preview | CLI result |
| --- | --- | --- |
| Before | After | Six fixes, 25 passing, exit 0 |
| After | Before (simulated rollback) | Six regressions, 25 passing, exit 1 |
| Before | Before (control) | Six existing failures, 25 passing, exit 0 |

Discovery found 360 literal references to 31 paths. The six affected routes appeared 92 times across 90 source files. The most referenced appeared 79 times. This counts occurrences in the checkout, not visits or separate installations.

[Generated PR summary for the simulated rollback](../../reports/venus-429/rollback-summary.md)
