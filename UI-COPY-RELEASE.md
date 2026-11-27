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
symlink-privilege skip, 18 sidebar checks). Native loading and actual Copy must
be verified after the connection promotion; preflight alone is not deployment
acceptance. No task or message is automatically sent.
