# Publication independent effects — local evidence

`write-effects-publication.mjs` implements independent effects for the original
`initPublish` and `retryPush` RPCs. This is a local acceptance module, not a new
publishing command or authorization surface. The launcher supplies its verified
adapter and trusted project/thread. The frozen publication handler and UI stay
unchanged; the local command overlay must enforce the returned publication
context before executing a classified original command.

## Captured facts and dispatch binding

Preparation performs only fixed Git/HTTP GET reads. It reads the current local
GitHub CLI account, binds `owner/UI-name`, and preserves the original visibility
selection (default private). A new publication requires a confirmed 404 for that
exact repository; an unreadable or pre-existing repository does not qualify.
Git must be absent or rooted at exactly this project. Origin must have at most
one standard GitHub HTTPS/SSH-scplike URL and no push URLs. No caller URL can
authorize a repository.

`dispatchContext.publication` has exactly `repository`, `visibility`, `before`,
and (retry only) `retry`. `before` contains `repositoryExists`, `headOid`,
`branch`, `originUrls`, `originPushUrls`; retry contains the previously proved
`repositoryId`, `commitOid`, and `branch`. The command guard must compare these
local facts at dispatch, independently recheck the local account, and qualify the
already-classified original `gh repo create name` to `owner/name`. It must also
check effective push URLs after Git URL rewrite rules, including the internal
push done by `gh repo create --source=. --push`.

## Independent terminal proof

Verification requires unchanged source bytes, exact local branch and origin,
and an independently read repository ID, exact full name/owner and private bit.
Initial commits must have precisely the former HEAD as their sole parent (or
no parent for the first commit), the original `initial commit` message, and a
clean tracked/untracked status. Complete branch/tag pages must prove exactly the
expected target-branch commit and unchanged other remote refs. Response URLs,
`ok`, and `halfCreated` are insufficient by themselves.

The source snapshot is bounded to 2,048 file/directory entries, 16 MiB per file
and 64 MiB total. Complete remote refs are bounded to 100 pages per kind,
100 rows per page, and 32 MiB aggregate. Exceeding a bound fails closed.

After proving a terminal state, generated evidence is atomically written and
file-synced in the current project's worker-private
`publication/half-created.json`. A failed push is a known partial only when the
exact repository exists, the expected local commit/origin are proved and remote
refs stayed unchanged. It records repo ID, visibility, commit and branch; a new
factory can accept a subsequent explicit `retryPush`. Retry never creates a
repository and rejects owner/URL/head/branch/origin/remote-ID/ref drift. Successful
completion marks that record no longer half-created. Unknown reads create no
retry authorization and do not replay either operation.

## Repeatable local acceptance

Run from the worktree root:

```powershell
node --test prototypes/remote-companion/publication-effects-test.mjs
```

Result: **10/10 passed** using the actual original `createPublishFlow`, isolated
Git configuration/hooks/home, temporary source repositories and real local bare
pushes. A fixed in-process GitHub reader/creator supplies metadata without using
any account or network. Every original argv is classified before the fixture
substitutes its exact local bare origin; actual pushes reject network URLs.
The initial sandbox run failed because Git for Windows MSYS could not create its
named object (`NtCreateDirectoryObject`, access denied). The same bounded local
suite passed outside that restriction. This is not online GitHub acceptance.

Coverage: preparation has no writes, new/existing Git and old origin, exact
parent and pushed commit, created-but-not-pushed partial, a new verifier's failed
and successful explicit retry without duplicate creation, false success/URL
claims, absent/unreadable metadata, account/visibility/source races, wrong
thread/model-selected retry target, multiple push URLs, remote replacement,
unexpected remote branches, and changed HEAD. The DeepSeek provider sentinel
is retained.

## Actual GitHub acceptance still required

Use only a dedicated private fixture through the frozen v5 original adapter and
normal launcher/executor/ledger. Confirm the exact owner and private visibility,
original initial commit tree/parent/message, actual origin and effective push
URL, and GitHub repository ID/branch SHA via an independent GET. Exercise a
controlled push failure after creation, verify the known partial and durable
record, restart the worker, explicitly retry, and prove no duplicate repository
was created. Check the final ledger and journal state and original UI result.
Also test account/origin/URL-rewrite drift between prepare and command dispatch.
No actual GitHub write, production pairing, Render, core routing, provider config,
or frozen source was changed for this local module acceptance.
