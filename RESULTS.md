# Case studies

## OpenDialog

The historical sitemap in [OpenDialog revision 7725f67](https://github.com/opendialogai/docs/tree/7725f67634797fd147211195f65d9302a9a69cb4/reference) lists 204 URLs. All 204 resolved in its static build. Omitting only `getting-started-1/getting-ready/index.html` from a disposable copy produced 203 passes and one missing route. The untouched build returned exit code 0 and the controlled regression returned 1.

Three separate GET requests to the public site returned 200. They covered the homepage, the getting-ready guide and the version 3 upgrade guide. The static report measures files on disk. Its 404 represents a missing file.

[Static build](reports/opendialog-build.json) · [Controlled removal](reports/opendialog-simulated-removal.json) · [HTTP sample](reports/opendialog-http.json)

## Bioconductor

On November 25, 2026, five publication subpages reached HTTP 200, including one via a 302. Eight URLs returned HTTP 200 where the [migration plan](https://github.com/seandavi/bioc-infrastructure/issues/187) specified two redirects and six intentionally removed routes. The sample includes both concrete Git log RSS feeds. The project later [restored its help-wanted page](https://github.com/Bioconductor/bioconductor.org/issues/440#issuecomment-6931042391). A difference from a historical contract can be an intentional change.

[HTTP observations](reports/bioconductor.json)
