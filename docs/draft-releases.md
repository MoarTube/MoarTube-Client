# Contributing desktop builds to a draft release

The Windows, Linux and macOS desktop workflows can contribute their verified
downloads to one existing draft release. Standalone FFmpeg workflows continue
to produce Actions artifacts only.

## Run a release build

1. Push the code and updated workflows to GitHub. Make the workflow definitions
   available on the default branch to use GitHub's manual Run workflow form.
2. Under Releases, create a draft with a tag such as `v1.1.0`. Select the branch
   or existing tag containing the exact code you intend to build, then save the
   draft. The release title and description are yours to edit.
3. Open a desktop workflow and select the code branch under **Use workflow from**.
   Enter the same tag in **Draft release tag** and run the workflow.
4. Repeat for other platforms using the same commit and draft tag.
5. Review the accumulated downloads and publish the release manually when ready.

The input names an existing draft; it does not create a release or Git tag.
Push-triggered builds do not upload to releases. A fresh manual run of the
updated workflow is needed; re-running a historical run uses its older workflow.

## What gets uploaded

Each target contributes its installer/archive pair, matching FFmpeg source
archive, checksum file and generated release-notes file. Logs, test profiles,
screenshots and build workspaces remain Actions artifacts. Uploading a release
notes file does not replace the description you wrote on GitHub. Sources remain
an optional download for users and must remain available beside the binaries.

Uploads start only after the prerequisite build/test jobs succeed. Windows runs
the packaged GUI smoke test before contributing. Linux waits for both native
architecture jobs. macOS waits for both native architecture builds and all four
OS verification jobs (Intel and ARM64, each on macOS 15 and 26), then contributes
the two architecture-specific sets of downloads.
Upload jobs alone have `contents: write`; compilation jobs keep read access.

The uploader requires an existing draft and checks its effective commit against
the workflow's `GITHUB_SHA`. An existing Git tag takes precedence over the
draft's target branch. If a draft has no Git tag yet, its target branch/commit is
resolved and pinned to the successful build's full commit SHA. Other platform
builds must match that commit. Subsequent fixes require intentionally retargeting
the draft and rebuilding all contributed platforms, or starting a new draft;
do not combine downloads from different revisions.

Downloaded Actions artifacts are checked against their SHA-256 files and
expected target/version filenames. Their embedded source-download links must
match the requested repository and draft tag. A checksum mismatch, wrong target,
missing source archive, absent draft or published release fails the upload.

Re-running the same target skips byte-identical assets when GitHub reports the
matching digest. Changed assets with the same names are replaced within that
draft; other platforms' assets are left alone. If a rebuild produces a new
FFmpeg build ID/source filename, retain the matching sources for every binary
still distributed and remove obsolete downloads deliberately during review.
Per-platform concurrency prevents simultaneous contributions from that platform.

The uploader never creates or publishes releases, moves Git tags, or edits the
release title/body. Once published, the release is rejected by this uploader.
Live uploads still require the first workflow run with a real draft; local tests
exercise the GitHub interactions through an in-memory API simulation.
