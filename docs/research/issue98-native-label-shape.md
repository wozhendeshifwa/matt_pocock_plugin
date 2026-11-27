# #98 native fresh-label compatibility correction

## Evidence and scope

Root observed the actual release (2,115,775 script characters / FNV `17ecde09`) in Codex. Clicking #92's current-chat fill prepared sources, then stopped with `(issue.labels || []).map is not a function`. The existing handwritten acceptance draft remained intact and unsent. This record covers the correction and controlled checks; native success remains pending.

Production `vendor/mattskills-1.8.0-rc.7/lib/issueDetail.js` emits `labels: {nodes: [{name, color}]}` for REST-normalized detail (line 81), and requests the same connection from GraphQL (line 97). Snapshot rows use an array. Earlier direct-action fixtures incorrectly returned an array for both surfaces.

## Red / hypotheses / green

At the already agreed production-sidebar → preparation → host-draft/clipboard seam, changed only the detail response to the production connection while retaining array snapshot rows. Ran `node prototypes/upstream-port/verify-direct-issue-actions.mjs` twice against the pre-fix build. The sharpened assertion failed with the exact native `.map` error and **0 host writes**.

After that red signal, ranked hypotheses were sent to root: (1) snapshot/detail label shape mismatch, predicting connection-only detail causes the error; (2) wrong RPC envelope, predicting issue-number validation fails first; (3) malformed label elements, predicting object elements in an ordinary array also fail. The production contract and isolated response-shape change support (1).

The shared public request policy now accepts both documented shapes. An unrecognized labels collection stops with a refresh instruction, preserving the fresh-action gate rather than silently dropping labels. No adapter, execution guard, routing, source checks, or draft write behavior changed.

## Verification

Build succeeded. All six affected checks exited 0 after the change:

- `verify-direct-issue-actions.mjs`: list and detail initial load from native connection, direct request, same-text Copy, unverified execution warnings, honest receipts, actual preparation failures, and malformed fresh-label stop.
- `verify-direct-new-chat.mjs`: fresh native connection and source project/root/worktree/subdirectory request routes.
- `verify-direct-recovery.mjs`: native connection on refresh, relevant-label change stops until a new click, unrelated-label change continues, source/target/wait/unknown-result recovery.
- `verify-issue-actions.mjs`: existing array-based list/detail label policy remains compatible.
- `verify-more-issue-actions.mjs` and `verify-legacy-draft-copy.mjs`: supplemental context and verbatim recovery remain passing.

No debug instrumentation or temporary prototype was added. No running release/configuration or user-owned draft was changed by this implementer. Root must merge/review, deploy and repeat native acceptance; #98/#82/#92 stay open until their actual criteria pass. #70 standards remain unchanged.
