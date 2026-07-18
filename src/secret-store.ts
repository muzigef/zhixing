export interface SecretStore {
  set(reference: string, value: string): Promise<void>;
  get(reference: string): Promise<string | undefined>;
  delete(reference: string): Promise<boolean>;
}

/** Test-only/in-memory implementation; production Keychain integration remains outside this process. */
export class MemorySecretStore implements SecretStore {
  readonly #values = new Map<string, string>();
  async set(reference: string, value: string): Promise<void> { this.#values.set(reference, value); }
  async get(reference: string): Promise<string | undefined> { return this.#values.get(reference); }
  async delete(reference: string): Promise<boolean> { return this.#values.delete(reference); }
}
