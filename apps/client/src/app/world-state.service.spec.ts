import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDto } from '@city/shared-types';
import {
  CENTRAL_SQUARE_NPCS,
  CONNECTION_ESTABLISHED_EVENT_TYPE,
  WORLD_ENTITY_JOINED_EVENT_TYPE,
  WORLD_ENTITY_LEFT_EVENT_TYPE,
  WORLD_INTERACT_RESULT_EVENT_TYPE,
  WORLD_POSITIONS_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_ZONE_ID,
  MARKET_LANE_ZONE_ID,
  MARKET_LANE_SPAWN_POSITION,
  createMessage,
  parseServerMessage,
} from '@city/game-protocol';
import type { ParsedServerMessage } from '@city/game-protocol';
import { CharacterService } from './character.service';
import { RealtimeService } from './realtime.service';
import { WorldStateService } from './world-state.service';

const CHARACTER_A: CharacterDto = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ayla',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const CHARACTER_B: CharacterDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Borin',
  createdAt: '2026-01-02T00:00:00.000Z',
};
const CONNECTION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONNECTION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function parsedEvent(raw: unknown): ParsedServerMessage {
  const parsed = parseServerMessage(raw);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed;
}

describe('WorldStateService', () => {
  const selected = signal<CharacterDto | null>(null);
  const connectionId = signal<string | null>(null);
  let serverMessages: Subject<ParsedServerMessage>;
  let realtimeStub: {
    connectionId: typeof connectionId;
    serverMessages: Subject<ParsedServerMessage>;
    sendWorldEnter: ReturnType<typeof vi.fn>;
    sendWorldInteract: ReturnType<typeof vi.fn>;
    sendWorldInput: ReturnType<typeof vi.fn>;
    sendWorldTransition: ReturnType<typeof vi.fn>;
  };
  let world: WorldStateService;

  beforeEach(() => {
    selected.set(null);
    connectionId.set(null);
    serverMessages = new Subject<ParsedServerMessage>();
    realtimeStub = {
      connectionId,
      serverMessages,
      sendWorldEnter: vi.fn(),
      sendWorldInteract: vi.fn(),
      sendWorldInput: vi.fn(),
      sendWorldTransition: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        WorldStateService,
        { provide: RealtimeService, useValue: realtimeStub },
        { provide: CharacterService, useValue: { selected } },
      ],
    });
    world = TestBed.inject(WorldStateService);
    TestBed.flushEffects();
  });

  it('enters the zone after connection, reconnect, and selection changes', () => {
    selected.set(CHARACTER_A);
    connectionId.set(CONNECTION_A);
    TestBed.flushEffects();

    expect(realtimeStub.sendWorldEnter).toHaveBeenLastCalledWith(WORLD_ZONE_ID);

    connectionId.set(CONNECTION_B);
    TestBed.flushEffects();
    selected.set(CHARACTER_B);
    TestBed.flushEffects();

    expect(realtimeStub.sendWorldEnter).toHaveBeenCalledTimes(3);
    expect(realtimeStub.sendWorldEnter).toHaveBeenLastCalledWith(WORLD_ZONE_ID);
  });

  it('projects snapshots and changes position only after a server event', () => {
    selected.set(CHARACTER_A);
    connectionId.set(CONNECTION_A);
    TestBed.flushEffects();

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
          zoneId: WORLD_ZONE_ID,
          selfCharacterId: CHARACTER_A.id,
          clock: {
            simulatedTime: '2026-01-01T00:00:00.000Z',
            speed: 60,
          },
          entities: [
            {
              characterId: CHARACTER_A.id,
              name: CHARACTER_A.name,
              x: 50,
              y: 50,
              energy: 90,
              money: 0,
              interaction: null,
            },
          ],
        }),
      ),
    );

    expect(world.selfEntity()?.x).toBe(50);
    expect(world.sendInput({ x: 1, y: 0 })).toBe(1);
    expect(realtimeStub.sendWorldInput).toHaveBeenCalledWith({
      seq: 1,
      x: 1,
      y: 0,
    });
    expect(world.selfEntity()?.x).toBe(50);

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_POSITIONS_EVENT_TYPE, {
          zoneId: WORLD_ZONE_ID,
          entities: [{ characterId: CHARACTER_A.id, x: 50.3, y: 50, seq: 1 }],
        }),
      ),
    );

    expect(world.selfEntity()?.x).toBe(50.3);
    expect(world.selfEntity()?.energy).toBe(90);
    expect(world.selfAck()).toEqual({ seq: 1, x: 50.3, y: 50 });
  });

  it('clears stale state and ignores a snapshot for the previous selection', () => {
    selected.set(CHARACTER_A);
    connectionId.set(CONNECTION_A);
    TestBed.flushEffects();
    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
          zoneId: WORLD_ZONE_ID,
          selfCharacterId: CHARACTER_A.id,
          clock: {
            simulatedTime: '2026-01-01T00:00:00.000Z',
            speed: 60,
          },
          entities: [
            {
              characterId: CHARACTER_A.id,
              name: CHARACTER_A.name,
              x: 50,
              y: 50,
              energy: 90,
              money: 0,
              interaction: null,
            },
          ],
        }),
      ),
    );

    selected.set(CHARACTER_B);
    TestBed.flushEffects();
    expect(world.entities()).toEqual([]);

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
          zoneId: WORLD_ZONE_ID,
          selfCharacterId: CHARACTER_A.id,
          clock: {
            simulatedTime: '2026-01-01T00:00:00.000Z',
            speed: 60,
          },
          entities: [
            {
              characterId: CHARACTER_A.id,
              name: CHARACTER_A.name,
              x: 55,
              y: 50,
              energy: 90,
              money: 0,
              interaction: null,
            },
          ],
        }),
      ),
    );
    expect(world.zoneId()).toBeNull();

    connectionId.set(null);
    TestBed.flushEffects();
    expect(world.entities()).toEqual([]);
  });

  it('adds joined players, updates them, and removes them on leave', () => {
    selected.set(CHARACTER_A);
    connectionId.set(CONNECTION_A);
    TestBed.flushEffects();
    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
          zoneId: WORLD_ZONE_ID,
          selfCharacterId: CHARACTER_A.id,
          clock: {
            simulatedTime: '2026-01-01T00:00:00.000Z',
            speed: 60,
          },
          entities: [
            {
              characterId: CHARACTER_A.id,
              name: CHARACTER_A.name,
              x: 50,
              y: 70,
              energy: 90,
              money: 0,
              interaction: null,
            },
          ],
        }),
      ),
    );

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_ENTITY_JOINED_EVENT_TYPE, {
          entity: {
            characterId: CHARACTER_B.id,
            name: CHARACTER_B.name,
            x: 40,
            y: 70,
            energy: 90,
            money: 0,
            interaction: null,
          },
        }),
      ),
    );
    expect(world.entities().map((entity) => entity.characterId)).toContain(
      CHARACTER_B.id,
    );

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_POSITIONS_EVENT_TYPE, {
          zoneId: WORLD_ZONE_ID,
          entities: [{ characterId: CHARACTER_B.id, x: 45, y: 70, seq: 4 }],
        }),
      ),
    );
    expect(
      world.entities().find((entity) => entity.characterId === CHARACTER_B.id)
        ?.x,
    ).toBe(45);

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_ENTITY_LEFT_EVENT_TYPE, {
          characterId: CHARACTER_B.id,
        }),
      ),
    );
    expect(world.entities()).toHaveLength(1);
  });

  it('ignores movement before the selected character has entered the world', () => {
    selected.set(CHARACTER_A);
    connectionId.set(CONNECTION_A);
    TestBed.flushEffects();

    expect(world.sendInput({ x: 0, y: -1 })).toBeNull();

    expect(realtimeStub.sendWorldInput).not.toHaveBeenCalled();
  });

  it('ignores non-world server events', () => {
    serverMessages.next(
      parsedEvent(
        createMessage(CONNECTION_ESTABLISHED_EVENT_TYPE, {
          connectionId: CONNECTION_A,
          protocolVersion: 1,
          serverTime: '2026-01-01T00:00:00.000Z',
        }),
      ),
    );

    expect(world.entities()).toEqual([]);
  });

  it('stores NPC interact feedback and sends npc interact commands', () => {
    selected.set(CHARACTER_A);
    connectionId.set(CONNECTION_A);
    TestBed.flushEffects();

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
          zoneId: WORLD_ZONE_ID,
          selfCharacterId: CHARACTER_A.id,
          clock: {
            simulatedTime: '2026-01-01T00:00:00.000Z',
            speed: 60,
          },
          entities: [
            {
              characterId: CHARACTER_A.id,
              name: CHARACTER_A.name,
              x: 42,
              y: 58,
              energy: 90,
              money: 0,
              interaction: null,
            },
          ],
        }),
      ),
    );

    const npcId = CENTRAL_SQUARE_NPCS[0]!.characterId;
    world.interactWith({
      kind: 'npc',
      id: npcId,
      label: 'E – Sprechen',
      x: 42,
      y: 60,
    });
    expect(realtimeStub.sendWorldInteract).toHaveBeenCalledWith({
      npcCharacterId: npcId,
    });
    world.interactWith({
      kind: 'object',
      id: 'kiosk-north',
      label: 'E – Arbeiten (+25)',
      x: 40,
      y: 42,
    });
    expect(realtimeStub.sendWorldInteract).toHaveBeenLastCalledWith({
      objectId: 'kiosk-north',
    });

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_INTERACT_RESULT_EVENT_TYPE, {
          kind: 'npc-greet',
          npcCharacterId: npcId,
          npcName: 'Nachbar',
          message: 'Hallo! Am Nord-Kiosk gibt es Arbeit.',
        }),
      ),
    );
    expect(world.interactFeedback()?.message).toContain('Kiosk');
  });

  it('sends portal transition and applies the confirmed zone snapshot', () => {
    selected.set(CHARACTER_A);
    connectionId.set(CONNECTION_A);
    TestBed.flushEffects();

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
          zoneId: WORLD_ZONE_ID,
          selfCharacterId: CHARACTER_A.id,
          clock: {
            simulatedTime: '2026-01-01T00:00:00.000Z',
            speed: 60,
          },
          entities: [
            {
              characterId: CHARACTER_A.id,
              name: CHARACTER_A.name,
              x: 95,
              y: 50,
              energy: 90,
              money: 0,
              interaction: null,
            },
          ],
        }),
      ),
    );

    world.interactWith({
      kind: 'portal',
      id: 'central-square-east',
      label: 'E – Zur Marktgasse',
      x: 95,
      y: 50,
    });
    expect(realtimeStub.sendWorldTransition).toHaveBeenCalledWith(
      'central-square-east',
    );
    // No optimistic jump — zone stays until snapshot.
    expect(world.zoneId()).toBe(WORLD_ZONE_ID);

    serverMessages.next(
      parsedEvent(
        createMessage(WORLD_SNAPSHOT_EVENT_TYPE, {
          zoneId: MARKET_LANE_ZONE_ID,
          selfCharacterId: CHARACTER_A.id,
          clock: {
            simulatedTime: '2026-01-01T00:00:00.000Z',
            speed: 60,
          },
          entities: [
            {
              characterId: CHARACTER_A.id,
              name: CHARACTER_A.name,
              ...MARKET_LANE_SPAWN_POSITION,
              energy: 90,
              money: 0,
              interaction: null,
            },
          ],
        }),
      ),
    );
    expect(world.zoneId()).toBe(MARKET_LANE_ZONE_ID);
    expect(world.selfEntity()).toMatchObject(MARKET_LANE_SPAWN_POSITION);
  });
});
