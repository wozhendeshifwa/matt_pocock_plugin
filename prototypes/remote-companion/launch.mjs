import { pathToFileURL } from 'node:url';
import { loadPairing, createRuntimeControl } from './lifecycle.mjs';
import { createExecutor, startCompanion } from './companion.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { Journal } from './journal.mjs';
import path from 'node:path';
import { verifyFrozenAdapter, OVERLAY_VERSION } from './freeze-adapter.mjs';
import { mkdir } from 'node:fs/promises';
import { WriteLedger } from './write-ledger.mjs';
import { installationWriteLedgerFile, normalizeWriteGrant } from './write-grant.mjs';
import { createWriteEffects } from './write-effects.mjs';

// Config selection is a local CLI action, never an MCP argument. All tokens
// remain local; the cloud gets neither this file nor the adapter's environment.
export async function launchPairing(file, { onState = () => {}, writeLedgerFile } = {}) {
  const config = await loadPairing(file, { decrypt: true });
  if (!config.baseline) throw new Error('Select a locally pinned frozen adapter baseline before connecting');
  const verified = await verifyFrozenAdapter({ directory: config.baseline.directory, expectedManifestSha256: config.baseline.manifestSha256 });
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(verified.adapterPath) !== normalize(config.adapterPath)) throw new Error('Adapter is not the locally pinned baseline');
  const grant = config.writeEnabled === true ? normalizeWriteGrant(config.writeGrant) : null;
  if (grant && verified.overlayVersion !== OVERLAY_VERSION) throw new Error('Local writes require the current frozen project-binding overlay; legacy candidates are read-only');
  let journal, adapter, companion, control, stopping, writes;
  let stopRequested = false;
  async function cleanup() {
    await adapter?.close();
    writes?.close(); writes = null;
    journal?.close(); journal = null;
    await control?.close();
  }
  function stop() {
    stopRequested = true;
    if (!companion) return Promise.resolve();
    if (!stopping) stopping = companion.stop();
    return stopping;
  }
  try {
    // Claim first, before opening Journal and applying its crash recovery.
    control = await createRuntimeControl(file, { onStop: stop, onRevoke: stop });
    const { resolveSessionProject } = await import(new URL('./session-project.mjs', pathToFileURL(config.adapterPath)));
    const { classifyEndpoint } = await import(new URL('./rpc-endpoints.mjs', pathToFileURL(config.adapterPath)));
    journal = new Journal(config.journalPath);
    if (journal.revoked) throw new Error('Pairing journal has been revoked');
    if (grant) {
      // The override is a local programmatic test seam, never read from the
      // pairing JSON or an MCP request. Real installations share one ledger.
      const ledgerFile = writeLedgerFile ?? installationWriteLedgerFile();
      if (!path.isAbsolute(ledgerFile)) throw new Error('Select an absolute local test ledger file');
      await mkdir(path.dirname(ledgerFile), { recursive: true });
      writes = new WriteLedger(ledgerFile);
    }
    adapter = createStdioAdapter(config.adapterPath);
    const effects = grant ? await createWriteEffects({ adapterPath: config.adapterPath }) : null;
    const execute = createExecutor({ adapter, journal, resolveProject: resolveSessionProject, pairingId: config.pairingId,
      isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read', writeGrant: grant, writeLedger: writes,
      prepareWrite: effects?.prepare, observeRead: effects?.observeRead });
    companion = startCompanion({ relayOrigin: config.relayOrigin, deviceToken: config.deviceToken, execute,
      onState(state) {
        onState(state);
        void control.setState(state).catch(() => { void stop(); });
      } });
    if (stopRequested) await stop();
    const done = companion.done.finally(cleanup);
    return { done, stop, pairingId: config.pairingId };
  } catch (error) {
    await stop(); await cleanup(); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--pairing') throw new Error('Usage: node launch.mjs --pairing <absolute-local-config-file>');
  try {
    const app = await launchPairing(process.argv[3], { onState: state => console.log('Deck companion: ' + state) });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.stop(); });
    await app.done;
  } catch {
    // Configuration/DPAPI failures must not cause tokens, encrypted blobs or
    // arbitrary exception details to appear in logs.
    console.error('Deck companion could not start; inspect local configuration, version and pairing status.');
    process.exitCode = 1;
  }
}
