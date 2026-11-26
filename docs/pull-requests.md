# Compare published and preview URLs

Requires Route Audit 0.4.0 or later. Run the comparison after the PR preview is ready. Both endpoints must be accessible to anonymous GET requests from the CI runner.

## Choose the contract

A single configuration can combine local sitemaps, explicit status or redirect expectations, and links discovered in local directories:

```json
{
  "site": "https://docs.example.org",
  "sources": ["route-audit-consumer/src", "route-audit-consumer/examples"],
  "routes": [{ "path": "/retired", "status": 410 }]
}
```

Directories are relative to the configuration file. Point them at **consumer code** such as the SDK that ships links to your docs. Check out the revision your users rely on. A route is checked once per target; repeated occurrences contribute to its reference count. Explicit expectations take precedence and keep their source references.

In Git worktrees the scanner reads tracked source files. If the checkout has a GitHub origin, clean files get permalinks to the checked-out commit. Changed files still get current working-copy line numbers. In directories outside Git, the scanner walks local files. It skips symlinks, dependency trees and common generated directories. Default formats are Markdown, MDX, reStructuredText, JavaScript, TypeScript, Python, Go, Rust, Java, Kotlin, C#, Ruby, PHP and Swift.

To select extensions or link an exported source directory to a browser URL, use an object:

```json
{
  "site": "https://docs.example.org",
  "sources": [{
    "directory": "../sdk/examples",
    "extensions": [".md", ".ts", ".yaml"],
    "linkBase": "https://github.com/your-org/sdk/blob/YOUR_COMMIT/examples"
  }]
}
```

`linkBase` points to the selected directory and should correspond to its contents. Routes come from literal HTTP(S) URLs matching the exact origin in `site`. Discovery retains trailing slashes, omits query strings and fragments, and does not execute source code or expand dynamically constructed URLs. Each reference records its file, one-based line and column, plus a browser URL when available.

## Run once or freeze the inventory

```sh
npx --no-install route-audit --config route-audit.json --baseline https://docs.example.org --preview https://pr-42.example.org --markdown route-audit.md --json comparison.json
```

The CLI loads the contract once and compares identical rules on both targets. To inspect the inputs first, run `route-audit --discover --config route-audit.json --json inventory.json`. You can then use `inventory.json` as the configuration without the SDK checkout. The frozen inventory includes the references.

| Published | Preview | Classification | Effect on CI |
| --- | --- | --- | --- |
| Pass | Fail | Regression | Exit 1 |
| Fail | Fail | Existing failure | Report only |
| Fail | Pass | Fixed | Report only |
| Pass | Pass | Passing | Report only |
| Either side inconclusive | — | Inconclusive | Exit 2 |

Inconclusive results take precedence. With `--report-only`, regressions also exit 0. If neither side can establish a route's HTTP status, inspect the JSON traces. For ordinary routes, a redirect that ends at HTTP 200 passes. To enforce a particular destination, set an explicit `status` and `location`.

The Markdown summary ranks new regressions by reference count, includes both HTTP chains and one source example per route, and groups existing failures separately. The JSON report includes every route and occurrence. The public Markdown summary omits URL queries and fragments from HTTP traces.

## Put the report in a pull request

Install Route Audit as a dev dependency in the site, commit its npm lockfile and add `route-audit.json`. Copy [the reusable workflow](../.github/workflows/compare-routes.yml) into the site's `.github/workflows/compare-routes.yml`. Add this job to the PR workflow that already deploys the preview. Substitute your own deployment job, output and origins:

```yaml
  route-audit:
    needs: deploy-preview
    permissions:
      contents: read
      pull-requests: write
    uses: ./.github/workflows/compare-routes.yml
    with:
      baseline: https://docs.example.org
      preview: ${{ needs.deploy-preview.outputs.url }}
      source-repository: your-org/sdk
      source-ref: YOUR_CONSUMER_COMMIT
```

The optional source checkout is placed in `route-audit-consumer/`. Choose folders under it in the configuration. For sources already in the site repository, omit the two source inputs. Set `report-only: true` for a nonblocking first run.

To retain every failure and source reference, set `upload-json: true`. The seven-day artifact contains the full HTTP traces, including any query strings in them.

The comparison job has read access. Its summary is available under the PR check even when it fails. A separate job with comment permission updates one bot comment for same-repository PRs and skips superseded heads. Fork PRs and Dependabot PRs ordinarily have read-only tokens and receive the check summary. To comment on a fork from an existing **trusted** deployment-status or workflow-run pipeline, pass `pr-number` and `head-sha` from the verified GitHub deployment or PR metadata. The publisher checks the PR's current head before writing and does not check out or execute PR code. Use the head SHA corresponding to the preview being compared.
