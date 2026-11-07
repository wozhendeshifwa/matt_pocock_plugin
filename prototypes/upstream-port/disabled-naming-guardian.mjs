import { namingCapability } from "./naming-capability.mjs";

// The real event/rename services are absent. Internal startup and refresh
// callers get the same explicit capability boundary as public RPC callers.
export function createNamingGuardian() {
  return {
    startNamingGuardianEvents() {},
    namingGuardianEvent() {},
    namingSweepSoon() {},
    getEntry: async () => null,
    applySummaryResult: async () => ({ ok: false, enabled: false }),
    handleDirectCreated: async () => ({ ok: true, attributed: false, enabled: false }),
    namingRegisterHandler: async () => namingCapability("namingRegister"),
    handleNamingSignal: async () => namingCapability("namingSignal"),
    handleNamingPlan: async () => namingCapability("namingPlan"),
    handleNamingResult: async () => namingCapability("namingResult"),
    handleCancelNewSessionWatcher: async () => namingCapability("cancelNewSessionWatcher"),
    handleAwaitCreatedIssue: async () => namingCapability("awaitCreatedIssue"),
  };
}
