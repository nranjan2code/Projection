# Projection handover — 2026-10-27

## Current architecture

Runtime schemaMode is removed: host/agent use typed descriptors with one prompt owner per active protocol. Trusted context loaders use counted answer steps, not external rounds. App must adopt the matching kind metadata and avoid charging local skills as external operations.


Generic transactional authoring and progressive rendering share one catalog, canonical surface/data store and projectors. Table/chart/stat field mappings resolve a single record collection. Inputs edit existing pointers. Permissions, caller checks, revision/stale-candidate checks, persistence and receipts retain their existing owners.

At the user's explicit request the source-specific derive/prepare/workspace pipeline is removed, including table source/parameter/relation options, compiled form/report layout, CSV bridge consumer, obsolete tests and its provider script. There is no compatibility shim or parallel replacement stack. submissionTool now takes an options object for dataSchema/surfaceCount. App callers must move their dependency pin and remove the old options.

Form submission now preserves repeated record-field names under canonical pointer keys instead of retaining only the last value. A fresh skill-led provider run exposed this general boundary; skill/request/checks remain unchanged for its mechanism rerun.

## Evidence and limits

383 framework tests/replay and typecheck pass after removing nine tests of the deleted source execution APIs. Existing transactional security, stale edits, multiple surfaces and record mapping tests remain. Package build passes. Earlier 388-test result predates removal. Live/installed results belong to their recorded revisions; previous source-workspace success is historical and cannot certify this path. Earlier local mapped-table gate2/3 retains an unrequested-total failure. App EVALUATION.md owns current skill/provider and WebKit outcomes.

## Next work

Finish the app pin/caller cleanup, verify ordinary task input/continuation/export and shared views, run the user's authorized hosted model comparison with frozen checks, and document all failures. Keep local primary-provider failures open; do not tune a fixture or expand retry limits. No installation or release implied. AGENTS.md and RELEASING.md apply.
