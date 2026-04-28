const stores = new Map<string, Record<string, unknown>>();

export class LazyStore {
  private data: Record<string, unknown>;

  constructor(path = "default") {
    const existing = stores.get(path);
    if (existing) {
      this.data = existing;
    } else {
      this.data = {};
      stores.set(path, this.data);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.data[key] as T | undefined;
  }
  async set(key: string, value: unknown): Promise<void> {
    this.data[key] = value;
  }
  async delete(key: string): Promise<void> {
    delete this.data[key];
  }
}

export function __resetStores() {
  for (const data of stores.values()) {
    for (const key of Object.keys(data)) {
      delete data[key];
    }
  }
}
