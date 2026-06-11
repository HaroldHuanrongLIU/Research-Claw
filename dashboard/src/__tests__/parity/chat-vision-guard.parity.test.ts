/**
 * Behavioral Parity Tests: Vision-capability send guard (Scenario 3)
 *
 * When a message carries image attachments, the chat store decides how to
 * route them based on MODEL CAPABILITY, not mere config existence:
 *
 *   - Primary model supports vision  → send attachments inline to the model.
 *   - Primary text-only (regardless of imageModel) → save to workspace and
 *     route file paths for the agent's tools (/image, OCR, code); inline
 *     attachments are stripped. The send is NEVER hard-blocked — the composer
 *     shows a soft hint instead, so the conversation can still proceed and the
 *     agent may read the image via its own tooling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useChatStore } from '../../stores/chat';
import { CLIENT_ATTACHMENT_PNG } from '../../__fixtures__/gateway-payloads/chat-send';

// Controllable capability returns, hoisted above vi.mock factories.
const caps = vi.hoisted(() => ({
  primary: { value: false },
  image: { value: false },
}));

const mockGatewayClient = {
  isConnected: true,
  request: vi.fn(),
};

vi.mock('../../stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({ client: mockGatewayClient, state: 'connected' }),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('../../stores/config', () => ({
  primaryModelSupportsVision: () => caps.primary.value,
  imageModelSupportsVision: () => caps.image.value,
  useConfigStore: {
    getState: () => ({ systemPromptAppend: '' }),
  },
}));

function findCall(method: string) {
  return mockGatewayClient.request.mock.calls.find((c: unknown[]) => c[0] === method);
}

describe('Vision-capability routing parity — chat.ts send()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caps.primary.value = false;
    caps.image.value = false;
    mockGatewayClient.isConnected = true;
    mockGatewayClient.request.mockResolvedValue({ runId: 'run-1' });
    useChatStore.setState({
      messages: [],
      sending: false,
      streaming: false,
      streamText: null,
      runId: null,
      sessionKey: 'main',
      lastError: null,
      tokensIn: 0,
      tokensOut: 0,
    });
  });

  it('text-only primary + text-only imageModel: no block — saves to workspace, routes paths, strips inline attachments', async () => {
    caps.primary.value = false;
    caps.image.value = false;

    await useChatStore.getState().send('look at this', [CLIENT_ATTACHMENT_PNG]);

    // Send is NOT blocked: image saved to workspace, path marker embedded,
    // inline attachments stripped (text-only primary), no error surfaced.
    expect(findCall('rc.ws.saveImage')).toBeDefined();
    const chatSend = findCall('chat.send');
    expect(chatSend).toBeDefined();
    expect((chatSend![1] as { attachments?: unknown }).attachments).toBeUndefined();
    expect((chatSend![1] as { message: string }).message).toContain('[rc-image:');
    expect(useChatStore.getState().lastError).toBeNull();
  });

  it('text-only primary + vision-capable imageModel: PASSES, routes to workspace, strips inline attachments', async () => {
    caps.primary.value = false;
    caps.image.value = true;

    await useChatStore.getState().send('look at this', [CLIENT_ATTACHMENT_PNG]);

    // Image saved to workspace for the /image tool, then chat.send proceeds.
    expect(findCall('rc.ws.saveImage')).toBeDefined();
    const chatSend = findCall('chat.send');
    expect(chatSend).toBeDefined();
    // Text-only primary → attachments stripped (gateway would drop them anyway),
    // workspace marker embedded in message text instead.
    expect(chatSend![1]).toEqual(
      expect.objectContaining({ sessionKey: 'main' }),
    );
    expect((chatSend![1] as { attachments?: unknown }).attachments).toBeUndefined();
    expect((chatSend![1] as { message: string }).message).toContain('[rc-image:');
    expect(useChatStore.getState().lastError).toBeNull();
  });

  it('vision-capable primary: PASSES, sends attachments inline', async () => {
    caps.primary.value = true;
    caps.image.value = false; // irrelevant once primary is vision-capable

    await useChatStore.getState().send('look at this', [CLIENT_ATTACHMENT_PNG]);

    expect(findCall('rc.ws.saveImage')).toBeDefined();
    const chatSend = findCall('chat.send');
    expect(chatSend).toBeDefined();
    expect((chatSend![1] as { attachments?: unknown[] }).attachments).toBeDefined();
    expect(useChatStore.getState().lastError).toBeNull();
  });
});
