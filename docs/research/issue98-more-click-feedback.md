# More click feedback correction

User reported the only failed manual feature was clicking More without any response. Native evidence supplied by root shows the list's HTML button was disabled. An explicit detail load then failed with GitHub GraphQL EOF, but the unavailable control still only said to open an Issue. This is not evidence of a broken available-menu handler.

Ranked falsifiable causes: native disabled suppresses clicks (confirmed by the production-sidebar red test); failed detail loading leaves no matched Issue and needs a distinct explanation (covered by error/loading boundary fixtures); an overlay/handler crash would also break the matched-detail menu (existing real menu tests continue passing).

At the existing production sidebar -> visible action -> host draft boundary, `node prototypes/upstream-port/verify-more-issue-actions.mjs` first failed with `unavailable More must respond with guidance`, actual true versus expected false. Earlier status-wait attempt also failed; an initial dependency junction permission failure and malformed shell edit did not change product behavior and were corrected before the sharp red assertion.

Unavailable More now responds with the existing bounded bottom overlay and the specific list/loading/error/mismatched-detail explanation. It never guesses a target or enables any execution. Informational help has separate scope-bound transient state so it cannot erase an existing draft retry or its pinned target. Available More still requires matching explicit Issue/effort and retains fields, cancel and normal fill behavior.

Both menu-toggle variants use an ellipsis glyph, no visible More text, with preserved accessible label/title as requested in the user's latest steering. No ordinary Copy was restored.

Build and four changed module syntax checks passed. More, direct-current and recovery production-sidebar scripts passed; More additionally covers no-selected target, held detail request, failed detail request, stale effort, icon-only label and zero host writes from explanatory clicks. Current/recovery were rerun after the main change; final separate-help state reran More/recovery. Actual final native loading remains root's acceptance step. No release, config, service, provider, root user changes or GitHub state was modified; no send/push/main merge.
