# Continuous map execution

Applies when the user authorizes continuing across tickets. Respect the user's execution scope and any explicitly paused work.

After each batch, and before ending the turn:

1. Refresh the map's open children, native dependencies, assignees and running agents. Include required acceptance, integration and known in-scope work not yet ticketed. An assigned ticket is not automatically blocked: check its owner and actual progress, including your own claims.
2. Record each remaining item as executable, running, blocked or explicitly paused. For each blocked item record current evidence, the exact missing prerequisite, attempted authorized recovery, affected work and the smallest unblocking action. A failed command alone is an observation, not a map-wide blocker.
3. Recheck historical blockers against current rules and capabilities. Separate sandbox network/file restrictions from authentication failure; try supported connectors or an approved escalation where appropriate. Verify UI outcomes after actions and refresh stale window/element bindings.
4. Continue the next executable item; coordinate running agents. A paused investigation blocks only work that actually depends on it. Continue unaffected collection, design, implementation and checks. Create necessary tickets when their scope becomes clear.
5. End only when the destination and required acceptance are evidenced complete, the user explicitly pauses the whole effort, or every remaining item has a demonstrated blocker/explicit pause and no agent is doing useful work. Persist the remaining-work ledger and recovery pointers on the map before stopping. Never use elapsed time, one completed batch or a partial progress report as the stopping condition.

The final report identifies which of these three stopping conditions applies. Distinguish implemented, tested, natively observed, merged and released. A summary, a saved ledger or passing this checklist does not itself authorize stopping while executable work remains.
