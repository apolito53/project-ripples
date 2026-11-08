# Working Memory

Reconstructed from surviving repository source and tracked evidence on
2026-11-07. This is a new handoff, not a recovered earlier memory file.

The catch-up review found the application baseline at
`67bfa1a8b421c867bf1ea023903874bd8b6da70f` (2026-07-27, restore WebGPU field
reflections). Local `main` and GitHub `main` matched at review; Git object
integrity passed and there were no tracked deletions. The app is
`v0.6.0-ALPHA` with later fixes described under [Unreleased](CHANGELOG.md).

The lab has Training, Track, and Arena modes. WebGL remains the default and
Stage-0 `auto` cohort is zero; WebGPU requires explicit selection. Forced
WebGPU defaults to Classic 3D, while Core remains a supported minimalist
style. Both share WebGL-matched field dynamics. See the
[code map](CODEBASE_INDEX.md) and [durable context](CRYSTALIZED_MEMORY.md).

The main and pause menu version pills open a formatted, player-friendly
changelog maintained in `src/playerChangelog.ts`; both renderer paths share
the renderer. The isolated changelog worktree passed typecheck and production
build, and the WebGL main-menu reader was checked in a browser. The forced
WebGPU browser did not respond to the menu click during this check; the current
production baseline behaved the same way, so that interaction remains
unverified. These checks do not replace the broader
current-machine runtime review below.

The canonical checkout's current-machine runtime status is unverified. At the
catch-up review, `npm.cmd` was unavailable on PATH and its `node_modules`/`dist`
were absent. Bundled Node passed
`scripts/verify-benchmark-reporting.mjs`, `scripts/verify-smoke-harness.mjs`,
and syntax checks for all 22 `.mjs` scripts; no dependency install, application
build, or browser run was performed. These checks do not re-establish the
historical browser, visual, or performance results.

Tracked benchmark summaries, baseline projections, acceptance records, and
manifests survive under [benchmark baselines](devlog/benchmark-baselines/README.md).
Generated `parity-results`/`benchmark-results` bundles and raw captures were not
present locally; `logs/` contained only its README. Their location or prior
storage cannot be established from this checkout.

The configured ports are dev `5183`, logs `5184`, preview/benchmark `4183`, and
parity audit `4184`. All four were imported as **unreserved; pending** in the
[central registry](../PORT_REGISTRY.md), with no listener observed at review.
Reconcile reservations and check live listeners/exclusions before startup.
The existing [log receiver](logs/README.md) has health/tail/events/summary
endpoints, but source inspection found incomplete error forwarding, disk
retention, origin restrictions, and collector-failure visibility. It has not
been verified against the workspace logging standard end to end.

The next useful step is to restore local npm/dependency tooling, then run
`npm.cmd ci`, typecheck/build, and browser smoke across all three modes on both
backends before visual review or racing changes. The
[resumption backlog](TODO.md#resume-on-this-machine) records that work and the
logger gaps. Existing local changes to `AGENTS.md`, `README.md`, and the
untracked `SPITBALL.md` predate this review and must be preserved separately.
