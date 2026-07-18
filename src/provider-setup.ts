import type { SecretStore } from "./secret-store.js";

const PROVIDER_ID = /^[a-z][a-z0-9-]*$/;

/** Stores an API key in the configured secret backend and returns only a safe reference. */
export class ProviderSetup {
  constructor(private readonly secrets: SecretStore) {}

  async configureApiKey(providerId: string, apiKey: string): Promise<{ secretRef: string }> {
    if (!PROVIDER_ID.test(providerId)) throw new Error("invalid_provider_id");
    if (apiKey.trim().length < 8) throw new Error("invalid_api_key");
    const secretRef = `keychain:zhixing/${providerId}`;
    await this.secrets.set(secretRef, apiKey);
    return { secretRef };
  }

  async removeApiKey(providerId: string): Promise<boolean> {
    if (!PROVIDER_ID.test(providerId)) throw new Error("invalid_provider_id");
    return this.secrets.delete(`keychain:zhixing/${providerId}`);
  }
}
