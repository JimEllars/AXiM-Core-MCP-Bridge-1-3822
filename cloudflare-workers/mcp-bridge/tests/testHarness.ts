type TestCallback = () => void | Promise<void>;
type Matcher = (expected: unknown) => void;

const cleanupCallbacks: Array<() => void> = [];

export function describe(_name: string, callback: () => void): void {
  callback();
}

export function it(name: string, callback: TestCallback): void {
  void (async () => {
    try {
      await callback();
    } catch (error) {
      throw new Error(`Test failed: ${name}`, {cause: error});
    } finally {
      for (const cleanup of cleanupCallbacks) {
        cleanup();
      }
    }
  })();
}

export function afterEach(callback: () => void): void {
  cleanupCallbacks.push(callback);
}

function matchesObject(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') {
    return Object.is(actual, expected);
  }

  if (actual === null || typeof actual !== 'object') {
    return false;
  }

  return Object.entries(expected).every(([key, value]) =>
    matchesObject((actual as Record<string, unknown>)[key], value)
  );
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) {
    return true;
  }

  if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') {
    return false;
  }

  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);

  return actualEntries.length === expectedEntries.length &&
    expectedEntries.every(([key, value]) =>
      Object.prototype.hasOwnProperty.call(actual, key) &&
      deepEqual((actual as Record<string, unknown>)[key], value)
    );
}

export function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatchObject(expected: unknown): void;
  resolves: {toMatchObject(expected: unknown): Promise<void>};
} {
  const toMatchObject: Matcher = (expected) => {
    if (!matchesObject(actual, expected)) {
      throw new Error(`Expected ${String(actual)} to match ${String(expected)}`);
    }
  };

  return {
    toBe(expected) {
      if (!Object.is(actual, expected)) {
        throw new Error(`Expected ${String(actual)} to be ${String(expected)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) {
        throw new Error(`Expected ${String(actual)} to equal ${String(expected)}`);
      }
    },
    toMatchObject,
    resolves: {
      async toMatchObject(expected) {
        toMatchObject(await actual);
      }
    }
  };
}

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();

export const vi = {
  fn<T extends (...args: any[]) => any>(implementation: T): T {
    return implementation;
  },
  stubGlobal(name: string, value: unknown): void {
    if (!originalGlobals.has(name)) {
      originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value
    });
  },
  unstubAllGlobals(): void {
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
    originalGlobals.clear();
  },
  restoreAllMocks(): void {
    // Mock functions are plain functions in this dependency-free test harness.
  }
};
