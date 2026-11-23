# Relay resource budget, 2026-11-24

The free Render target has 512 MiB RAM. A limit of 32 queued requests and 8 MiB
per HTTP body is insufficient to bound memory: parsed JSON objects, fingerprints
and queued response buffers have different costs from wire bytes.

## Local evidence

These are Windows Node 26.13.0 loopback measurements, not Render measurements.
The relay ran in a separate child with `--max-old-space-size=256`, a sampled
360 MiB RSS diagnostic stop line and a bounded fixture. This sampled line cannot
interrupt synchronous parsing; OS peak RSS was added for that reason. No real tokens, cloud connections,
business data or writes were used. RSS includes V8 allocator/GC effects; it is
not an exact projection of Linux RSS or a proof of an absolute process ceiling.

| Fixture | Before budget | Initial post-parse budget |
| --- | --- | --- |
| 24 calls, each about 4 MiB text | All 24 admitted; baseline 58.8 MiB RSS, retained 186.1 MiB | 3 admitted, 21 rejected 503 before dispatch; baseline 57.8 MiB, retained 81.5 MiB, sampled peak 93.4 MiB |
| 8 calls, each about 1 MiB array of empty objects | All 8 admitted; baseline 58.8 MiB RSS, retained 307.2 MiB, sampled peak 307.9 MiB | All 8 rejected 413 for structure budget; baseline 57.7 MiB, retained/sampled peak 167.0 MiB |

The pre-budget measurement deliberately stopped below the 512 MiB target. No
out-of-memory failure was induced. Linear extrapolation to 32 complex requests
would exceed the target, but that is an estimate rather than an observed OOM.
The observed object expansion already justifies limiting retained structure.

A follow-up single-body experiment exposed a peak the timer sampler missed:
one approximately 7 MiB empty-object array returned 413 under the initial
post-parse check, but reached **361.8 MiB OS peak RSS**, versus 286.2 MiB sampled.
After adding the linear pre-parse structure scan, the same fixture returned
413 at **81.0 MiB OS peak RSS** (80.8 MiB sampled). This is the current code.
An independent regression also runs that 7 MiB body in a **64 MiB heap** child
and requires rejection with OS peak below 192 MiB, demonstrating that it is
rejected before millions of objects are materialized. The heap limit is a
fixture control, not a new production V8 configuration.

## Enforced admission and release

- Individual HTTP bodies remain bounded to 8 MiB. At most four bodies read at
  once, with a combined reservation of 8 MiB. A body without Content-Length
  reserves the full 8 MiB; a smaller declaration is also the read limit.
- Before parsing, a linear scan counts containers, tokens and nesting while
  respecting quoted strings, backslash escapes and Unicode. It only enforces
  resource limits; `JSON.parse` remains the syntax validator. Each parsed body
  is then limited to 100,000 JSON values and depth 128 before
  fingerprinting. Retained request structures share a 32 MiB accounting budget.
  Accounting uses conservative charges for strings, containers and properties;
  these are admission units, not a promise about V8 allocation sizes.
- Serialized outgoing buffers share 16 MiB until HTTP `finish` or `close`.
  A blocked device delivery remains queued, with no local dispatch. If a known
  local result cannot fit the current output budget, the MCP caller receives an
  `unknown` error carrying the operation ID so it can inspect the local journal.
- Completion, timeout and relay close release the retained request charge.
  Disconnect/error releases reader and outgoing-buffer charges. There is no
  new execution retry or cloud business persistence.

The budgets keep the ordinary large-text/UI path and original RPC routing.
Inputs beyond the explicit resource bounds are rejected; normal behavior still
needs actual Render measurement after a deliberate deployment. The currently
running Render deployment was not changed by this work.

## Reproduce

From this worktree (only loopback access is required):

```powershell
node --test prototypes/remote-companion/relay-budget-test.mjs
node --test prototypes/remote-companion/test.mjs
node prototypes/remote-companion/measure-relay-budget.mjs 24 4194304
node prototypes/remote-companion/measure-relay-budget.mjs 8 1048576 --objects
node prototypes/remote-companion/measure-relay-budget.mjs 1 7340032 --objects
```

The original 12 HTTP/SDK regressions and the 7 resource-budget regressions passed.
The latter verify aggregate admission/release on completion and timeout,
structure rejection, escaped/Unicode string compatibility, pre-parse rejection
in a heap-limited child, unfinished body/disconnect recovery, and unknown-result
correlation when the response budget is exceeded. Windows sandbox loopback
initially failed with `EACCES`; the same isolated checks passed with authorized
loopback execution. That initial environment failure is not a product pass.
