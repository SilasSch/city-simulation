import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CENTRAL_SQUARE_NPCS,
  MARKET_LANE_ZONE_ID,
  NPC_INTERACTION_RANGE,
  WORLD_ZONE_ID,
  worldInteractionObject,
} from '@city/game-protocol';
import { AppModule } from '../app.module';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { AuthService } from '../auth/auth.service';
import { CharacterService } from '../character/character.service';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import { cleanDatabase } from '../../test/test-database';
import { WorldPositionService } from '../world/world-position.service';
import { WorldPresenceService } from '../world/world-presence.service';
import { WorldService } from '../world/world.service';
import { SimulationService } from './simulation.service';

describe('first simulation loop (integration)', () => {
  let app: INestApplication;
  let auth: AuthService;
  let characters: CharacterService;
  let prisma: PrismaService;
  let simulation: SimulationService;
  let world: WorldService;
  let presence: WorldPresenceService;
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
    simulation = moduleRef.get(SimulationService);
    world = moduleRef.get(WorldService);
    presence = moduleRef.get(WorldPresenceService);
    positions = moduleRef.get(WorldPositionService);
  });

  beforeEach(async () => cleanDatabase(prisma));
  afterAll(async () => app.close());

  async function player(): Promise<AuthenticatedPrincipal> {
    const registered = await auth.register(
      'simulation@example.com',
      'geheim-123',
    );
    const resolution = await auth.resolvePrincipal(registered.sessionToken);
    if (resolution.status !== 'ok') throw new Error('Session not available');
    await characters.createCharacter(resolution.session.principal, 'Ayla');
    return resolution.session.principal;
  }

  it('validates range, concurrency, completion reward, and movement abort', async () => {
    const principal = await player();
    const entry = await world.enter(principal, WORLD_ZONE_ID);

    await expect(
      world.interact(principal, entry.context, { objectId: 'bench-south' }),
    ).rejects.toMatchObject({
      code: 'INTERACTION_OUT_OF_RANGE',
    } satisfies Partial<ApplicationError>);

    // 34 Ticks à 0,3 Einheiten: von x = 50 in Reichweite der Bank (x = 62).
    world.input(principal, entry.context, { seq: 1, x: 1, y: 0 }, 'tab-a');
    for (let tick = 0; tick < 34; tick += 1) positions.tick();
    world.input(principal, entry.context, { seq: 2, x: 0, y: 0 }, 'tab-a');
    const simulatedNow = new Date(simulation.clockSnapshot().simulatedTime);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { energy: 40, energyUpdatedAt: simulatedNow },
    });

    const active = await world.interact(principal, entry.context, {
      objectId: 'bench-south',
    });
    expect(active.kind).toBe('object');
    if (active.kind !== 'object') throw new Error('expected object outcome');
    expect(active.entity.interaction?.objectId).toBe('bench-south');
    await expect(
      world.interact(principal, entry.context, { objectId: 'bench-south' }),
    ).rejects.toMatchObject({ code: 'INTERACTION_ALREADY_ACTIVE' });

    const completionNow = new Date(simulation.clockSnapshot().simulatedTime);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: {
        interactionStartedAt: new Date(completionNow.getTime() - 300_001),
        interactionEndsAt: new Date(completionNow.getTime() - 1),
      },
    });
    const completed = (await simulation.tick([entry.context.characterId]))
      .entities[0];
    expect(completed?.interaction).toBeNull();
    expect(completed?.energy).toBeGreaterThan(69.9);
    expect(completed?.energy).toBeLessThanOrEqual(70);

    await world.interact(principal, entry.context, { objectId: 'bench-south' });
    // Bewegung meldet den Abbruch; der Gateway schreibt ihn und broadcastet.
    world.input(principal, entry.context, { seq: 3, x: -1, y: 0 }, 'tab-a');
    expect(positions.tick().abortedInteractions).toEqual([
      entry.context.characterId,
    ]);
    expect(positions.tick().abortedInteractions).toEqual([]);
  });

  it('pays money when a job interaction completes', async () => {
    const principal = await player();
    const entry = await world.enter(principal, WORLD_ZONE_ID);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: 40, y: 42, money: 0 },
    });

    const active = await world.interact(principal, entry.context, {
      objectId: 'kiosk-north',
    });
    expect(active.kind).toBe('object');
    if (active.kind !== 'object') throw new Error('expected object outcome');
    expect(active.entity.interaction?.objectId).toBe('kiosk-north');
    expect(active.entity.money).toBe(0);

    const completionNow = new Date(simulation.clockSnapshot().simulatedTime);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: {
        interactionStartedAt: new Date(completionNow.getTime() - 180_001),
        interactionEndsAt: new Date(completionNow.getTime() - 1),
      },
    });
    const completed = (await simulation.tick([entry.context.characterId]))
      .entities[0];
    expect(completed?.interaction).toBeNull();
    expect(completed?.money).toBe(25);
  });

  it('rejects and applies snack purchases by wallet balance', async () => {
    const principal = await player();
    const entry = await world.enter(principal, WORLD_ZONE_ID);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: 68, y: 55, money: 10, energy: 50 },
    });

    await expect(
      world.interact(principal, entry.context, { objectId: 'snack-east' }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { money: 15 },
    });
    const purchased = await world.interact(principal, entry.context, {
      objectId: 'snack-east',
    });
    expect(purchased.kind).toBe('object');
    if (purchased.kind !== 'object') throw new Error('expected object outcome');
    expect(purchased.entity.interaction).toBeNull();
    expect(purchased.entity.money).toBe(0);
    expect(purchased.entity.energy).toBeGreaterThanOrEqual(69.9);
    expect(purchased.entity.energy).toBeLessThanOrEqual(70);
  });

  it('greets an in-range NPC and rejects out-of-range attempts', async () => {
    const principal = await player();
    const entry = await world.enter(principal, WORLD_ZONE_ID);
    const npc = CENTRAL_SQUARE_NPCS[0]!;
    const live = presence.npc(npc.characterId);
    expect(live).not.toBeNull();

    await expect(
      world.interact(principal, entry.context, {
        npcCharacterId: npc.characterId,
      }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OUT_OF_RANGE' });

    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: live!.x, y: live!.y },
    });

    const greeted = await world.interact(principal, entry.context, {
      npcCharacterId: npc.characterId,
    });
    expect(greeted).toEqual(
      expect.objectContaining({
        kind: 'npc',
        npcCharacterId: npc.characterId,
        npcName: npc.name,
      }),
    );
    if (greeted.kind !== 'npc') throw new Error('expected npc outcome');
    expect(greeted.message.length).toBeGreaterThan(0);
    expect(greeted.message.toLowerCase()).toMatch(/kiosk|snack|arbeit/);

    await expect(
      world.interact(principal, entry.context, {
        npcCharacterId: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OBJECT_NOT_FOUND' });

    // Far away again — still rejected even after a prior greet.
    const after = presence.npc(npc.characterId)!;
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: {
        x: Math.min(100, after.x + NPC_INTERACTION_RANGE + 5),
        y: after.y,
      },
    });
    await expect(
      world.interact(principal, entry.context, {
        npcCharacterId: npc.characterId,
      }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OUT_OF_RANGE' });
  });

  it('pays money when a market-lane stall job completes', async () => {
    const principal = await player();
    const stall = worldInteractionObject('stall-north');
    const entry = await world.enter(principal, MARKET_LANE_ZONE_ID);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: stall.x, y: stall.y, money: 0 },
    });

    const active = await world.interact(principal, entry.context, {
      objectId: 'stall-north',
    });
    expect(active.kind).toBe('object');
    if (active.kind !== 'object') throw new Error('expected object outcome');
    expect(active.entity.interaction?.objectId).toBe('stall-north');
    expect(active.entity.money).toBe(0);

    const completionNow = new Date(simulation.clockSnapshot().simulatedTime);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: {
        interactionStartedAt: new Date(
          completionNow.getTime() - stall.durationSimulationSeconds * 1000 - 1,
        ),
        interactionEndsAt: new Date(completionNow.getTime() - 1),
      },
    });
    const completed = (await simulation.tick([entry.context.characterId]))
      .entities[0];
    expect(completed?.interaction).toBeNull();
    expect(completed?.money).toBe(stall.moneyGain);
  });

  it('rejects stall jobs out of range or in the wrong zone', async () => {
    const principal = await player();
    const stall = worldInteractionObject('stall-north');
    const snack = worldInteractionObject('snack-east');

    const square = await world.enter(principal, WORLD_ZONE_ID);
    await prisma.characterWorldState.update({
      where: { characterId: square.context.characterId },
      data: { x: stall.x, y: stall.y, money: 15 },
    });
    await expect(
      world.interact(principal, square.context, { objectId: 'stall-north' }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OUT_OF_RANGE' });

    const lane = await world.enter(principal, MARKET_LANE_ZONE_ID);
    await expect(
      world.interact(principal, lane.context, { objectId: 'stall-north' }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OUT_OF_RANGE' });

    await prisma.characterWorldState.update({
      where: { characterId: lane.context.characterId },
      data: { x: snack.x, y: snack.y, money: 15 },
    });
    await expect(
      world.interact(principal, lane.context, { objectId: 'snack-east' }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OUT_OF_RANGE' });
  });

  it('rejects and applies market-lane street-food purchases by wallet', async () => {
    const principal = await player();
    const shop = worldInteractionObject('street-food-east');
    const entry = await world.enter(principal, MARKET_LANE_ZONE_ID);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: shop.x, y: shop.y, money: 10, energy: 50 },
    });

    await expect(
      world.interact(principal, entry.context, {
        objectId: 'street-food-east',
      }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { money: shop.price },
    });
    const purchased = await world.interact(principal, entry.context, {
      objectId: 'street-food-east',
    });
    expect(purchased.kind).toBe('object');
    if (purchased.kind !== 'object') throw new Error('expected object outcome');
    expect(purchased.entity.interaction).toBeNull();
    expect(purchased.entity.money).toBe(0);
    expect(purchased.entity.energy).toBeGreaterThanOrEqual(69.9);
    expect(purchased.entity.energy).toBeLessThanOrEqual(70);
  });

  it('rejects street-food purchases out of range or in the wrong zone', async () => {
    const principal = await player();
    const shop = worldInteractionObject('street-food-east');

    const square = await world.enter(principal, WORLD_ZONE_ID);
    await prisma.characterWorldState.update({
      where: { characterId: square.context.characterId },
      data: { x: shop.x, y: shop.y, money: 15 },
    });
    await expect(
      world.interact(principal, square.context, {
        objectId: 'street-food-east',
      }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OUT_OF_RANGE' });

    const lane = await world.enter(principal, MARKET_LANE_ZONE_ID);
    await expect(
      world.interact(principal, lane.context, {
        objectId: 'street-food-east',
      }),
    ).rejects.toMatchObject({ code: 'INTERACTION_OUT_OF_RANGE' });
  });
});
