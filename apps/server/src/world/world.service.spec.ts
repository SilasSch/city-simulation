import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MARKET_LANE_SPAWN_POSITION,
  MARKET_LANE_ZONE_ID,
  WORLD_ENTITY_RADIUS,
  WORLD_MOVE_SPEED,
  WORLD_SPAWN_POSITION,
  WORLD_TICK_SECONDS,
  WORLD_ZONE_ID,
  worldZonePortal,
} from '@city/game-protocol';
import { AppModule } from '../app.module';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { AuthService } from '../auth/auth.service';
import { CharacterService } from '../character/character.service';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import { cleanDatabase } from '../../test/test-database';
import { WorldPositionService } from './world-position.service';
import { WorldService } from './world.service';

describe('WorldService (integration)', () => {
  let app: INestApplication;
  let auth: AuthService;
  let characters: CharacterService;
  let prisma: PrismaService;
  let world: WorldService;
  let positions: WorldPositionService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    auth = moduleRef.get(AuthService);
    characters = moduleRef.get(CharacterService);
    prisma = moduleRef.get(PrismaService);
    world = moduleRef.get(WorldService);
    positions = moduleRef.get(WorldPositionService);
  });

  beforeEach(async () => cleanDatabase(prisma));
  afterAll(async () => app.close());

  async function register(email: string): Promise<AuthenticatedPrincipal> {
    const result = await auth.register(email, 'geheim-123');
    const resolution = await auth.resolvePrincipal(result.sessionToken);
    if (resolution.status !== 'ok') throw new Error('Session not available');
    return resolution.session.principal;
  }

  let seq = 0;
  /** Läuft `ticks` feste Ticks lang in Richtung (x, y) und bleibt stehen. */
  function walk(
    principal: AuthenticatedPrincipal,
    context: Parameters<WorldService['input']>[1],
    x: number,
    y: number,
    ticks: number,
  ): void {
    world.input(principal, context, { seq: (seq += 1), x, y });
    for (let tick = 0; tick < ticks; tick += 1) positions.tick();
    world.input(principal, context, { seq: (seq += 1), x: 0, y: 0 });
  }
  const STEP = WORLD_MOVE_SPEED * WORLD_TICK_SECONDS;

  async function playerWithCharacter(
    email: string,
    name = 'Ayla',
  ): Promise<AuthenticatedPrincipal> {
    const principal = await register(email);
    await characters.createCharacter(principal, name);
    return principal;
  }

  it('requires a selected character', async () => {
    const principal = await register('no-character@example.com');

    await expect(world.enter(principal, WORLD_ZONE_ID)).rejects.toMatchObject({
      code: 'NO_CHARACTER_SELECTED',
    } satisfies Partial<ApplicationError>);
  });

  it('spawns once and keeps the persisted position on re-entry', async () => {
    const principal = await playerWithCharacter('enter@example.com');

    const firstEntry = await world.enter(principal, WORLD_ZONE_ID);
    expect(firstEntry.snapshot.entities.length).toBeGreaterThanOrEqual(2);
    const self = firstEntry.snapshot.entities.find(
      (entity) => entity.characterId === firstEntry.snapshot.selfCharacterId,
    );
    expect(self).toMatchObject({
      characterId: firstEntry.snapshot.selfCharacterId,
      kind: 'character',
      name: 'Ayla',
      x: WORLD_SPAWN_POSITION.x,
      y: WORLD_SPAWN_POSITION.y,
      interaction: null,
    });
    expect(self?.energy).toBeGreaterThan(99);
    expect(firstEntry.snapshot.entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'npc', name: 'Nachbar' }),
      ]),
    );

    const characterId = firstEntry.context.characterId;
    walk(principal, firstEntry.context, 1, 0, 10);
    const moved = positions.position(characterId);
    expect(moved?.x).toBeCloseTo(WORLD_SPAWN_POSITION.x + 10 * STEP);

    const secondEntry = await world.enter(principal, WORLD_ZONE_ID);
    const restored = secondEntry.snapshot.entities.find(
      (entity) => entity.characterId === characterId,
    );
    expect(restored?.x).toBeCloseTo(moved?.x ?? Number.NaN);
    expect(restored?.y).toBe(WORLD_SPAWN_POSITION.y);

    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId },
    });
    expect(stored.revision).toBe(1);
  });

  it('moves continuously in the tick and persists only on flush', async () => {
    const principal = await playerWithCharacter('movement@example.com');
    const entry = await world.enter(principal, WORLD_ZONE_ID);

    walk(principal, entry.context, 1, 0, 20);
    expect(positions.position(entry.context.characterId)?.x).toBeCloseTo(
      WORLD_SPAWN_POSITION.x + 20 * STEP,
    );

    // Eine veraltete Sequenz setzt die Figur nicht wieder in Bewegung.
    world.input(principal, entry.context, { seq: 1, x: 1, y: 0 });
    positions.tick();
    expect(positions.position(entry.context.characterId)?.x).toBeCloseTo(
      WORLD_SPAWN_POSITION.x + 20 * STEP,
    );

    // Bewegung schreibt nicht pro Schritt in PostgreSQL (ADR 0015).
    const beforeFlush = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: entry.context.characterId },
    });
    expect(beforeFlush).toMatchObject({
      x: WORLD_SPAWN_POSITION.x,
      revision: 0,
    });

    await positions.flush(entry.context.characterId);
    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: entry.context.characterId },
    });
    expect(stored.x).toBeCloseTo(WORLD_SPAWN_POSITION.x + 20 * STEP);
    expect(stored.y).toBe(WORLD_SPAWN_POSITION.y);
    expect(stored.revision).toBe(1);
  });

  it('stops at world bounds and obstacles without persisting per step', async () => {
    const principal = await playerWithCharacter('collision@example.com');
    const entry = await world.enter(principal, WORLD_ZONE_ID);

    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: WORLD_ENTITY_RADIUS, y: 50, revision: 10 },
    });
    await world.enter(principal, WORLD_ZONE_ID);
    // Schon an der Grenze: kein Schritt, also auch nichts zu speichern.
    walk(principal, entry.context, -1, 0, 10);
    expect(positions.position(entry.context.characterId)).toMatchObject({
      x: WORLD_ENTITY_RADIUS,
      y: 50,
    });

    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: 30, y: 10, revision: 11 },
    });
    await world.enter(principal, WORLD_ZONE_ID);
    // building-north-west reicht bis x = 25.
    walk(principal, entry.context, -1, 0, 30);
    expect(positions.position(entry.context.characterId)?.x).toBeCloseTo(
      25 + WORLD_ENTITY_RADIUS,
    );

    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: entry.context.characterId },
    });
    expect(stored).toMatchObject({ x: 30, y: 10, revision: 11 });
  });

  it('relocates a persisted position that became invalid after a map change', async () => {
    const principal = await playerWithCharacter('relocate@example.com');
    const entry = await world.enter(principal, WORLD_ZONE_ID);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: 50, y: 50 },
    });

    const reentered = await world.enter(principal, WORLD_ZONE_ID);

    expect(
      reentered.snapshot.entities.find(
        (entity) => entity.characterId === entry.context.characterId,
      ),
    ).toMatchObject({
      name: 'Ayla',
      ...WORLD_SPAWN_POSITION,
    });
  });

  it('invalidates an entered context after the selected character changes', async () => {
    const principal = await playerWithCharacter('selection@example.com');
    const entry = await world.enter(principal, WORLD_ZONE_ID);
    const second = await characters.createCharacter(principal, 'Borin');
    await characters.selectCharacter(principal, second.id);
    await world.enter(principal, WORLD_ZONE_ID);

    expect(() =>
      world.input(principal, entry.context, { seq: 1, x: 1, y: 0 }),
    ).toThrowError(
      expect.objectContaining({ code: 'WORLD_NOT_ENTERED' }) as Error,
    );
  });

  it('enters market-lane at its spawn without central-square NPCs', async () => {
    const principal = await playerWithCharacter('market@example.com');

    const entry = await world.enter(principal, MARKET_LANE_ZONE_ID);
    expect(entry.context.zoneId).toBe(MARKET_LANE_ZONE_ID);
    expect(entry.snapshot.zoneId).toBe(MARKET_LANE_ZONE_ID);
    const self = entry.snapshot.entities.find(
      (entity) => entity.characterId === entry.snapshot.selfCharacterId,
    );
    expect(self).toMatchObject({
      ...MARKET_LANE_SPAWN_POSITION,
      kind: 'character',
      name: 'Ayla',
    });
    expect(
      entry.snapshot.entities.every((entity) => entity.kind !== 'npc'),
    ).toBe(true);

    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: entry.context.characterId },
    });
    expect(stored.zoneId).toBe(MARKET_LANE_ZONE_ID);
  });

  it('rejects unknown zones and relocates when switching into market-lane', async () => {
    const principal = await playerWithCharacter('switch-zone@example.com');
    const square = await world.enter(principal, WORLD_ZONE_ID);
    walk(principal, square.context, 1, 0, 5);

    await expect(
      world.enter(principal, 'unknown-zone' as typeof WORLD_ZONE_ID),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const lane = await world.enter(principal, MARKET_LANE_ZONE_ID);
    expect(lane.snapshot.zoneId).toBe(MARKET_LANE_ZONE_ID);
    expect(
      lane.snapshot.entities.find(
        (entity) => entity.characterId === lane.context.characterId,
      ),
    ).toMatchObject(MARKET_LANE_SPAWN_POSITION);

    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: lane.context.characterId },
    });
    expect(stored).toMatchObject({
      zoneId: MARKET_LANE_ZONE_ID,
      ...MARKET_LANE_SPAWN_POSITION,
    });
  });

  it('transitions via portal when in range and rejects out-of-range', async () => {
    const principal = await playerWithCharacter('portal@example.com');
    const square = await world.enter(principal, WORLD_ZONE_ID);
    const portal = worldZonePortal('central-square-east');

    await expect(
      world.transition(principal, square.context, {
        portalId: 'central-square-east',
      }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OUT_OF_RANGE' });

    await prisma.characterWorldState.update({
      where: { characterId: square.context.characterId },
      data: { x: portal.x, y: portal.y },
    });

    const lane = await world.transition(principal, square.context, {
      portalId: 'central-square-east',
    });
    expect(lane.context.zoneId).toBe(MARKET_LANE_ZONE_ID);
    expect(lane.snapshot.zoneId).toBe(MARKET_LANE_ZONE_ID);
    expect(
      lane.snapshot.entities.find(
        (entity) => entity.characterId === lane.context.characterId,
      ),
    ).toMatchObject(MARKET_LANE_SPAWN_POSITION);
    expect(
      lane.snapshot.entities.every((entity) => entity.kind !== 'npc'),
    ).toBe(true);

    const returnPortal = worldZonePortal('market-lane-west');
    await prisma.characterWorldState.update({
      where: { characterId: lane.context.characterId },
      data: { x: returnPortal.x, y: returnPortal.y },
    });
    const back = await world.transition(principal, lane.context, {
      portalId: 'market-lane-west',
    });
    expect(back.snapshot.zoneId).toBe(WORLD_ZONE_ID);
    expect(
      back.snapshot.entities.find(
        (entity) => entity.characterId === back.context.characterId,
      ),
    ).toMatchObject(WORLD_SPAWN_POSITION);
  });
});
