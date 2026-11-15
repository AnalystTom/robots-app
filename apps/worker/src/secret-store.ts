import type { RealtimeFanout, SecretStore } from "@robots/adapter-kit";
import { createSecretStore } from "@robots/adapters";
import { resolveEncryptionKey } from "@robots/core";

/** Worker composition without starting job hosts or database connections. */
export async function createWorkerSecretStore(
  source: NodeJS.ProcessEnv,
  realtime?: RealtimeFanout,
): Promise<SecretStore> {
  const store = createSecretStore(resolveEncryptionKey(source), source, realtime);
  await store.start();
  return store;
}
