# Manual local update and rollback

This local API cuts over a **pinned frozen adapter baseline** and its worker
business data. It uses the existing lifecycle, frozen-source verifier and local
data snapshot verifier. It does not download releases, update the sidebar plugin
or relay, replace the companion executable, change providers, or start a runtime.
Every result keeps `activationReady: false` until a separate real launch and
product acceptance have completed. There is no remote/MCP update endpoint.

## Prepare two fixed local releases

Freeze and independently review each source using `freeze-adapter.mjs`. Retain
the SHA-256 of each `frozen-adapter.json`. A local operator then supplies two
release-description files and independently retained SHA-256 digests. Their
shape is:

```json
{
  "schemaVersion": 1,
  "version": "reviewed-local-version",
  "pluginProtocolVersion": 1,
  "relayProtocolVersion": 1,
  "localDataSchemaVersion": 1,
  "baseline": {
    "directory": "C:\\absolute\\reviewed-frozen-adapter",
    "manifestSha256": "64 lowercase hex characters"
  }
}
```

These are reviewed local compatibility declarations, not a fetch of a server's
current state. Current code permits protocol 1 and data schema 1 only. Both
baselines undergo `verifyFrozenAdapter`; declared compatibility cannot bypass
source-byte or catalog verification. An explicit stable data root requires the
current overlay understood by this companion. An unsupported protocol, schema
or overlay blocks application. Updating the companion/plugin/relay themselves
requires their separate release/install workflow and actual compatibility
acceptance; these descriptions cannot manufacture support for a future version.

## Review a read-only plan

Create a `createLocalUpdater` instance from `local-update.mjs` in a local Node
script. Provide fixed absolute paths, both local release pins, an existing
independent snapshot parent, and the existing installation ledger. The
`registeredProjectRoots` callback must be the real trusted local project loader,
not all historical buckets and not a list received from a remote request.

```js
const updater = await createLocalUpdater({
  pairingFile: absolutePairingFile,
  sourceRelease: { manifestFile: localOldManifest, manifestSha256: retainedOldHash },
  targetRelease: { manifestFile: localNewManifest, manifestSha256: retainedNewHash },
  snapshotParent: independentExistingArchiveParent,
  stableDataRoot: fixedInstallationDataRoot,
  registeredProjectRoots: loadActualRegisteredRoots,
});
const plan = await updater.plan();
console.log(JSON.stringify(plan, null, 2));
```

The plan reads versions, protocols, exact source configuration hash, current
runtime instance token, source inventory and selected business/audit/log files.
It contains fingerprints rather than DPAPI ciphertext or business file contents.
It does not stop anything or create the destination. Cache/temporary/diagnostic
files will be archived and invalidated. The first legacy migration filters out
historical unregistered business buckets from the runtime seed while retaining
them in the independent full archive. Publication continuation records and
local palette backups have explicit business/audit classifications. Unknown
files in a registered bucket are blockers; they are not silently dropped.

An existing stable root is reused only at exactly its configured path. A shared
stable root containing unregistered or unrecognized durable state requires
local review instead of silently adopting it. Initial migration requires a new,
absent stable destination. A missing installation ledger or any installation
`running`/`unknown` operation blocks application. Do not delete or recreate a
ledger to get past that check; inspect the actual operation first.

## Explicit local apply

Only after reviewing the returned plan and its blockers, the same local process
may call:

```js
const applied = await updater.apply({
  planSha256: plan.planSha256,
  confirmation: `APPLY ${plan.planSha256}`,
});
```

The string is an explicit local operator action bound to the reviewed digest.
It is not a cryptographic approval, and a remote boolean is not accepted. A plan
is consumed on an application attempt; after a failure, inspect artifacts and
generate a fresh plan. The updater retains an independent copy: modifying the
returned display object cannot alter the reviewed operation under its digest.

Application performs the following concrete operations:

1. Recheck the pinned releases, configuration and registered-project scope.
2. Request stop through lifecycle for the exact planned runtime `instanceId`.
   Wait for that ownership record to disappear. A stale PID or elapsed heartbeat
   does not prove exit; another instance appearing aborts the update.
3. Claim a new lifecycle runtime token in `updating` state and continuously
   check ownership. Hold the installation SQLite `BEGIN IMMEDIATE` fence and
   verify there are no unresolved or newly added operations. Existing launcher
   ownership prevents another runtime on this pairing from claiming the file.
4. Create a separate new snapshot directory, copy the full source inventory,
   and independently verify every byte and retained manifest hash. Old source
   files and previous snapshots remain intact.
5. Seed only reviewed registered durable files into the new stable root, or
   preserve the existing compatible stable root and move its generated cache
   into this update's `invalidated-cache` archive. Verify the seeded state and
   recheck the legacy source and registry before cutover.
6. Back up the exact pairing configuration. Use an NTFS/local-filesystem
   move-claim plus exclusive hard-link publication to refuse concurrent path
   replacement. A capability probe fails before moving the config on a
   filesystem/sandbox that cannot provide this operation. Concurrent edited
   originals remain in the claimed archive; a concurrently created active file
   is never overwritten. DPAPI ciphertext, pairing ID, grant, journal and relay
   settings are preserved. The installation ledger and provider files are not
   copied, replaced, reset, or selected from a pairing setting.
7. Persist a pinned recovery receipt before publishing the configuration. Release
   the ledger and runtime fence after cutover. Return
   `configured-stopped-awaiting-launch-acceptance`, with `runtimeStarted: false`.

The `.revoked` marker is never removed or restored from a backup. A revocation
observed during the workflow stops progress. Restoring a configuration backup
cannot reactivate a revoked pairing. This API does not alter Startup shortcuts;
the existing launcher still consumes the same pairing path. It must use the
compatible companion version already reviewed for these baselines.

On failure, the old source and old data remain available. An incomplete generated
stable directory is not adopted or overwritten on another attempt. Inspect the
exception's `updateDirectory` and, if present, `receiptFile`/`receiptSha256`.
If configuration publication already occurred before a later failure, use the
receipt and a fresh rollback plan; do not blindly restore an old snapshot. No
automatic launch, retry, cache restoration or code rollback occurs on failure.

## Read-only rollback plan and explicit rollback

Retain the returned receipt path and its digest outside the candidate itself.
The same fixed-release updater, including a new local process, can inspect it:

```js
const rollbackPlan = await updater.planRollback({
  directory: applied.directory,
  receiptSha256: applied.receiptSha256,
});
// Review versions, state/ledger changes, compatibility and blockers locally.
const rolledBack = await updater.rollback({
  planSha256: rollbackPlan.planSha256,
  confirmation: `ROLLBACK ${rollbackPlan.planSha256}`,
});
```

Rollback independently rechecks the frozen source, snapshot, original config
backup hash, exact current configuration, runtime and installation ledger.
It uses the same stop/fresh-instance fence and backed-up CAS. An unresolved
write always blocks it.

If old code supports the same stable schema/overlay, rollback changes only code
selection and keeps the **current shared stable data**, including completed new
writes. If old code cannot use that stable root, rollback to the original legacy
root is allowed only while the seeded root, original root and all installation
ledger rows still match their before-use evidence. Any new write, new operation
or changed old source blocks that path. No rollback path copies an older data
snapshot over current business state; `dataRestoredFromOldSnapshot` remains false.
Cache archives remain available but stale cache is not automatically restored.

## Repeatable isolated verification

```powershell
node --test prototypes/remote-companion/local-update-test.mjs
```

**20/20 passed** in the root agent's final targeted run. Tests use fixed temporary frozen manifests, real data
files and installation SQLite records, controlled exact-instance runtime
fixtures, plus one real lifecycle stop/new-lease and real CurrentUser DPAPI case.
They verify registry/history filtering, cache archival, original config backup,
NTFS CAS conflicts, persistent revocation, unresolved and completed new writes,
safe rollback and shared-root preservation. Temporary provider sentinels remain
unchanged. The sandbox rejects NTFS hard links with `EPERM`; the same bounded
fixture suite was run with local filesystem access. No production pairing,
production runtime, Render service or GitHub resource was read or modified.

The independently reviewed failure paths now close a claimed update lease when
its first assertion fails, preserve exact opener receipts as audit state, open
the installation ledger with existing-only SQLite URI modes, and bind the
validated pairing fields to the same reviewed JSON bytes. The regression suite
includes a moved ledger (no empty replacement created), encoded space/Unicode
paths and an actual A-to-B-to-A configuration replacement (no stale business
source becomes active). A before/after matching hash alone cannot prove the
intermediate validation used those same bytes.

Configuration and its independent archive must be on the same local volume;
in-place cache archival also requires that volume. The plan reports mismatched
device IDs as blockers. NTFS hard-link capability is checked again before
moving the live configuration; unsupported filesystems fail before that move.

Production migration, restart, actual original-panel continuity, and end-to-end
acceptance remain separate work. A passing API fixture is not production
activation evidence.
