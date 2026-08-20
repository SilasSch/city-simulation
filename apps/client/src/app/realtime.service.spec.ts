import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_ESTABLISHED_EVENT_TYPE,
  PROTOCOL_ERROR_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_ZONE_ID,
  createMessage,
} from '@city/game-protocol';
import { RealtimeService } from './realtime.service';

const CONNECTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHARACTER_ID = '11111111-1111-4111-8111-111111111111';

describe('RealtimeService server-event routing', () => {
  let realtime: RealtimeService;

  beforeEach(() => {
    realtime = new RealtimeService();
  });

  afterEach(() => {
    realtime.ngOnDestroy();
  });

  it('accepts and publishes a validated connection-established event', () => {
    const received = vi.fn();
    realtime.serverMessages.subscribe(received);

    realtime.handleMessage(
      createMessage(CONNECTION_ESTABLISHED_EVENT_TYPE, {
        connectionId: CONNECTION_ID,
        protocolVersion: 1,
        serverTime: '2026-01-01T00:00:00.000Z',
      }),
    );

    expect(realtime.connectionState()).toBe('connected');
    expect(realtime.connectionId()).toBe(CONNECTION_ID);
    expect(realtime.lastMessageType()).toBe(CONNECTION_ESTABLISHED_EVENT_TYPE);
    expect(received).toHaveBeenCalledOnce();
  });

  it('routes validated world snapshots without deriving client state', () => {
    const received = vi.fn();
    realtime.serverMessages.subscribe(received);

    realtime.handleMessage(
      createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
        zoneId: WORLD_ZONE_ID,
        selfCharacterId: CHARACTER_ID,
        clock: {
          simulatedTime: '2026-01-01T00:00:00.000Z',
          speed: 60,
        },
        entities: [
          {
            characterId: CHARACTER_ID,
            name: 'Ayla',
            x: 50,
            y: 50,
            energy: 90,
            interaction: null,
          },
        ],
      }),
    );

    expect(received).toHaveBeenCalledOnce();
    expect(received.mock.calls[0]?.[0].kind).toBe(WORLD_SNAPSHOT_EVENT_TYPE);
    expect(realtime.lastMessageType()).toBe(WORLD_SNAPSHOT_EVENT_TYPE);
  });

  it('keeps an established connection usable after a domain error', () => {
    const received = vi.fn();
    realtime.serverMessages.subscribe(received);
    realtime.handleMessage(
      createMessage(CONNECTION_ESTABLISHED_EVENT_TYPE, {
        connectionId: CONNECTION_ID,
        protocolVersion: 1,
        serverTime: '2026-01-01T00:00:00.000Z',
      }),
    );

    realtime.handleMessage(
      createMessage(PROTOCOL_ERROR_EVENT_TYPE, {
        code: 'WORLD_NOT_ENTERED',
        message: 'Enter the world again',
      }),
    );

    expect(realtime.connectionState()).toBe('connected');
    expect(realtime.protocolError()?.code).toBe('WORLD_NOT_ENTERED');
    expect(received).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed and unknown server messages at the boundary', () => {
    const received = vi.fn();
    realtime.serverMessages.subscribe(received);

    realtime.handleMessage({ garbage: true });
    expect(realtime.connectionState()).toBe('error');

    realtime.handleMessage(createMessage('world-weather', {}));
    expect(realtime.connectionState()).toBe('error');
    expect(received).not.toHaveBeenCalled();
  });
});
