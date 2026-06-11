import { vi } from 'vitest';

/** Partial config store mock for parity tests that invoke chat.send(). */
export function parityConfigStoreMock() {
  return {
    primaryModelSupportsVision: vi.fn(() => true),
    imageModelSupportsVision: vi.fn(() => true),
    useConfigStore: {
      getState: () => ({ systemPromptAppend: '' }),
    },
  };
}
