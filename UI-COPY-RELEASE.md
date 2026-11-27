# Restricted production release: UI and active Copy

Authorized 2026-11-27: publish the completed interface and active Copy; direct
fill remains blocked when execution prerequisites are not verified.

- Product baseline: common candidate dac412d, documentation head f388852.
- No product guards or assessment results have been changed for this release.
- #96 has no verified trusted observer channel. Current/new successful fill,
  #92 full native acceptance, and #70 reliable readback/atomic protection are
  not delivered by this restricted release. #82/#92 remain open.
- The deployment uses a pinned worktree and its own stdio entry. It retains
  the previously authorized issue82 connection's isolated state, without
  touching the older issue62 service or the separate issue95 connection.
- The existing issue82 MCP connection is promoted by changing only its args
  and cwd after a recoverable full configuration backup and concurrent-change
  check. Other configuration bytes and provider/DeepSeek settings stay intact.
- Rollback changes only that owned connection back to its recorded prior args
  and cwd; never restore an entire old config over later user changes.
- This directory is a running release dependency. Do not clean it as a scratch
  implementer worktree.

Preflight: full check passed (136 syntax files, 27 sandbox pass / 1 Windows
symlink-privilege skip, 18 sidebar checks). No task or message is automatically
sent.

## Actual rollout and limited user acceptance

The single explicitly authorized native backend restart was invoked once.
After reconnect, backend parent changed from 24900 to 2272; pinned release
process 24692 and preserved legacy process 21972 were observed. The initially
visible panels were still legacy registration 3b907, explaining the unchanged
appearance. The release-specific tool opened registration ebe8 and its new
MCP Apps tab 4 / native app-shell tab 6 was expanded into the right panel.

The actual page contained 7 direct-action groups and 0 old draft-editor
markers. Loaded product script: 2,114,857 characters after HTML normalization,
FNV-1a 54bbefe2, matching the pinned release. New button labels, active Copy and
More are visible. The user opened Version Control, so additional automated UI
actions stopped. Their composer text was observed unchanged; no test paste or
message send was performed.

Previous actual pointer Copy plus system Ctrl+V evidence applies to this same
product asset; a fresh post-rollout clipboard/paste check was not performed
over the user's existing draft. An attempted #92 guard recheck did not execute
because the user switched to Version Control; do not report it as a new native
pass. Guard behavior remains covered by unchanged code and the release checks.

The user said the result basically meets their requirements except for
"填入当前聊天" and "填入新聊天". Record this as limited interface acceptance,
not completed direct-fill delivery or full #82/#92 acceptance. Both actions
remain blocked by unverified prerequisites. #96's trusted-channel gate is not
passed; #70 remains separate and unchanged. All these issues stay open.
