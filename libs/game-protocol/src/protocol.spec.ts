import { describe, expect, it } from 'vitest';
import {
  CONNECT_COMMAND_TYPE,
  PROTOCOL_VERSION,
  connectionEstablishedPayloadSchema,
  connectPayloadSchema,
  createMessage,
  protocolEnvelopeSchema,
} from './protocol';
import { parseIncomingMessage } from './parse';

describe('protocol schemas', () => {
  it('accepts a valid connect command envelope', () => {
    const message = createMessage(CONNECT_COMMAND_TYPE, {
      clientName: 'test-client',
    });
    expect(protocolEnvelopeSchema.safeParse(message).success).toBe(true);
    expect(connectPayloadSchema.safeParse(message.payload).success).toBe(true);
  });

  it('rejects an envelope without version', () => {
    const message = createMessage(CONNECT_COMMAND_TYPE, {
      clientName: 'x',
    }) as Record<string, unknown>;
    delete message['version'];
    expect(protocolEnvelopeSchema.safeParse(message).success).toBe(false);
  });

  it('rejects a connect payload with empty clientName', () => {
    expect(connectPayloadSchema.safeParse({ clientName: '' }).success).toBe(
      false,
    );
  });

  it('validates a connection-established payload', () => {
    const payload = {
      connectionId: '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e',
      protocolVersion: PROTOCOL_VERSION,
      serverTime: new Date().toISOString(),
    };
    expect(connectionEstablishedPayloadSchema.safeParse(payload).success).toBe(
      true,
    );
  });
});

describe('parseIncomingMessage', () => {
  it('parses a valid connect command', () => {
    const message = createMessage(CONNECT_COMMAND_TYPE, {
      clientName: 'test-client',
    });
    const result = parseIncomingMessage(message);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe(CONNECT_COMMAND_TYPE);
      expect(result.payload.clientName).toBe('test-client');
    }
  });

  it('rejects unsupported protocol versions with the requestId attached', () => {
    const message = {
      ...createMessage(
        CONNECT_COMMAND_TYPE,
        { clientName: 'x' },
        '3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e',
      ),
      version: PROTOCOL_VERSION + 1,
    };
    const result = parseIncomingMessage(message);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
      expect(result.receivedVersion).toBe(PROTOCOL_VERSION + 1);
      expect(result.requestId).toBe('3f6f1c2a-9f3d-4f2a-9b3d-2f1a2b3c4d5e');
    }
  });

  it('rejects malformed envelopes', () => {
    const result = parseIncomingMessage({ nope: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_MESSAGE');
  });

  it('rejects unknown message types', () => {
    const result = parseIncomingMessage(createMessage('spawn-dragon', {}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_MESSAGE');
  });

  it('rejects invalid payloads of known types', () => {
    const result = parseIncomingMessage(
      createMessage(CONNECT_COMMAND_TYPE, { clientName: '' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
  });
});
