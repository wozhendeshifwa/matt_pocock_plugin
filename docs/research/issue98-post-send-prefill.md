# #98: unverified drafts, verification after sending

Date: 2026-11-27. Base: `ae69fe1` from the running restricted UI/Copy
release; isolated implementation branch `codex/issue98-post-send`, based on
`codex/issue82-post-send-fill`. The production sidebar seam was already
confirmed in #82 and reused by #98; no new seam interview was needed.

## Behavior changed

Draft preparation now reports its ability to produce a usable draft separately
from the observed execution prerequisites. Unknown/missing execution tools or
required references do not by themselves stop a draft request. The actual
execution result remains false/unknown; backend skill inspection, maintenance
assessment and task-execution guards were not changed.

Every generated request carries an explicit unverified-draft instruction: after
the user sends it, the target Agent must check actual skill sources/loading,
required tools and materials before dependent work, and pause on missing,
unknown or substantive conflicts. This also applies to ordinary requests with
no recognized managed skill. It does not claim host loading or task execution.

Real source preparation/read failure or an unreadable rule still stops the
outlet. Changed snapshots still need explicit regeneration. Existing labels,
required More fields, same-sidebar waiting, target/project/cwd protection,
unknown outcomes and retained Copy are kept. Successful request feedback says
the draft is unverified; an empty host receipt remains requested, not filled.

Only the source-preparation and direct-consumer production modules changed,
plus regenerated bundle and behavior tests. Native current/new adapters were
not rewritten. Normal Copy retains the exact generated request; historical
Copy remains original text.

## Red and green evidence

1. Added a production list/detail scenario with execution prerequisites false,
   a missing tool/material explanation and an expected host request carrying
   the warning. Against the old bundle it failed waiting for the first host
   request (old guard stopped it). After the small boundary change, both
   surfaces requested the warning-bearing text and active Copy matched it.
2. Revised obsolete fail-before-prefill cases rather than deleting their
   useful coverage: long reasons remain in the generated text, Copy failure
   does not resubmit, changed observations stop stale text and explicit
   regeneration uses the latest explanation. Actual prepare/read transport
   errors and missing source rules still produce no host call or automatic
   Copy.
3. The existing public preparation adapter's ordinary path-only request was
   changed to require the same global unverified notice without triggering
   skill maintenance. It first failed while the notice was conditional on a
   recognized skill; making it unconditional passed. The adapter still
   reports dependenciesAllowed=false for the unverified case.

## Checks actually run

- Final bundle build passed.
- Final `verify-request-preparation`, `verify-direct-issue-actions`,
  `verify-direct-new-chat` and `verify-direct-recovery` passed. The new-chat
  matrix uses execution=false and covers source root, linked-worktree and
  subdirectory paths, missing capability/identity and normal navigation.
- More-actions, reviewed-draft-output and legacy action-draft recovery checks
  passed during the same slice before the final global no-managed-skill notice
  correction; the parent will run the complete integration check once after
  independent merge/review.
- Production skill-binding maintenance/execution separation check passed on
  the host. Its first normal Windows sandbox run failed inside the unchanged
  Git source fixture; the same check passed elevated. No assertion or backend
  implementation was relaxed to make that check pass.
- `git diff --check` passed.

These are controlled production-UI/adapter and local fixture results. No
actual native composer/project/cwd acceptance, runtime deployment, configuration
change, automatic message send, tracker closure, main merge or push was done
by this implementation. #98/#82/#92 native work remains for the parent;
#70 reliable readback and atomic-target standards remain separate.

## Integration follow-up: explicitly empty legacy text

After independent integration at `77eba8a`, the complete check found the
archived-renderer fixture's second `seed('')` waiting for a source-review
approval before it could clear surviving text. Reproduced with
`verify-legacy-draft-copy`: the old renderer attempted to replace edited text
with the new global source notice, the unchanged fixture confirmation guard
refused, and the wait for ready timed out. Earlier nonempty original-text,
Copy, pending and isolation cases had passed.

The fixture now uses the archived public "清空草稿" action only for an explicit
empty seed. That action also invalidates its in-flight review. Nonempty seeds,
the confirmation assertion, the archived renderer and all production source
change behavior remain unchanged. This tests the real intentional-empty
history path rather than approving regeneration or deleting original-text
coverage. Legacy Copy, action-draft isolation, issue actions and reviewed
outputs pass after the fixture correction. No complete check was rerun by the
implementer; remaining integration validation belongs to the independent
merger.
