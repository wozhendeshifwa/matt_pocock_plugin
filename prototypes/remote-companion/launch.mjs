import { pathToFileURL } from 'node:url';
import { loadPairing, createRuntimeControl } from './lifecycle.mjs';
import { createExecutor, startCompanion } from './companion.mjs';
import { createStdioAdapter } from './stdio.mjs';
import { Journal } from './journal.mjs';
import path from 'node:path';
import { verifyFrozenAdapter } from './freeze-adapter.mjs';

// Config selection is a local CLI action, never an MCP argument. All tokens
// remain local; the cloud gets neither this file nor the adapter's environment.
export async function launchPairing(file, { onState = () => {} } = {}) {
  const config = await loadPairing(file, { decrypt: true });
  if (!config.baseline) throw new Error('Select a locally pinned frozen adapter baseline before connecting');
  const verified = await verifyFrozenAdapter({ directory: config.baseline.directory, expectedManifestSha256: config.baseline.manifestSha256 });
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(verified.adapterPath) !== normalize(config.adapterPath)) throw new Error('Adapter is not the locally pinned baseline');
  let journal, adapter, companion, control, stopping;
  let stopRequested = false;
  async function cleanup() {
    await adapter?.close();
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
    adapter = createStdioAdapter(config.adapterPath);
    const execute = createExecutor({ adapter, journal, resolveProject: resolveSessionProject, pairingId: config.pairingId,
      isReadMethod: (method, payload) => classifyEndpoint(method, payload) === 'read' });
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
