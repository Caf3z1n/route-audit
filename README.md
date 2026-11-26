# Route Audit

Check that your published URLs still work before you deploy.

A docs build can succeed after someone renames a guide that your SDK, an old blog post, or a customer's bookmark still links to. Route Audit remembers the published URLs and shows which ones disappear from the next build. You can also check whether a redirect still lands on the right page.

## Try it on your Astro or Starlight site

From the root of an **already published** site, using Node.js 22.12 or later:

```sh
npm run build
npx route-audit@latest init
```

`init` uses your Astro site settings to find the **published** sitemap, follows its index files, and saves the URL list in `route-audit.json`. It then checks the local build in report-only mode. Commit that file. Future checks use the same list, even if a page disappears from both the site and its sitemap.

For another static site, or if the URL cannot be detected:

```sh
npx route-audit@latest init --site https://docs.example.org --dist dist
```

Use `--sitemap <url>` for a custom sitemap, or `--base /docs` for a site mounted under a prefix. Without a build, the command saves the list and prints the next step. An existing `route-audit.json` is always preserved.

## Check the next build

Install the CLI once and add the check after your usual build, locally or in CI:

```sh
npm install -D route-audit
npm run build
npx route-audit --dist dist --report-only
```

For example, removing one guide from a copy of a real OpenDialog build produced:

```text
static: 203/204 OK, 1 failed, 0 inconclusive.
fail  /getting-started-1/getting-ready  expected=reachable  observed=404  missing
```

Here `404` means the file is missing from the build. With `--report-only`, missing pages are reported in the job log. Remove the flag to fail CI on a regression against your saved list. Inconclusive checks and setup errors exit with code 2. [GitHub Actions example](examples/github-actions/route-audit.yml)

## Check redirects or an SDK's links

- **My hosting provider handles redirects, or my site uses SSR.** Run `npx route-audit --preview https://preview.example.org` against a running preview to measure HTTP responses. Add a route like `{ "path": "/old-guide/", "finalLocation": "/guide/" }` to catch a redirect to the homepage even if it returns 200. [Route rules and Astro build integration](docs/configuration.md)
- **I maintain an SDK or examples that link to our docs.** Point `sources` at the consumer checkout. Route Audit can compare production with a PR preview and show the source file and line for each newly broken link. [SDK discovery and PR reports](docs/pull-requests.md)
- **I already use a link checker.** Compare its observed destinations without sending another request. [Linkinator, broken-link-checker and link-check examples](examples/checkers/README.md)

## See a failure without a project

```sh
npx route-audit@latest --demo
```

The demo checks two temporary pages, removes one, and runs again. It exits with code 1 to demonstrate a detected regression.

In the Venus Protocol docs, six URLs in on-chain governance proposals returned 404 while the upstream build passed. Route Audit reproduced all six failures and verified the redirects after the fix. [Before-and-after study](cases/venus-429/README.md) · [Other case studies](RESULTS.md)

## Development

Run `npm ci`, `npm test` and `npm run format:check`. Use English for code, documentation and diagnostics, and Conventional Commits for commit subjects.
