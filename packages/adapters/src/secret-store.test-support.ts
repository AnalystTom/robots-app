import { EncryptedSecretStore } from "./secrets.js";

export const testSecretStore = new EncryptedSecretStore("test-only-encryption-key");
