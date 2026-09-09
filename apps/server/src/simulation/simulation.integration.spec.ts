import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WORLD_ZONE_ID } from '@city/game-protocol';
import { AppModule } from '../app.module';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { AuthService } from '../auth/auth.service';
import { CharacterService } from '../character/character.service';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import { cleanDatabase } from '../../test/test-database';
import { WorldService } from '../world/world.service';
import { SimulationService } from './simulation.service';

describe('first simulation loop (integration)', () => {
  let app: INestApplication;
  let auth: AuthService;
  let characters: CharacterService;
  let prisma: PrismaService;
  let simulation: SimulationService;
  let world: WorldService;

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
      world.interact(principal, entry.context, 'bench-south'),
    ).rejects.toMatchObject({
      code: 'INTERACTION_OUT_OF_RANGE',
    } satisfies Partial<ApplicationError>);

    await world.move(principal, entry.context, 'E');
    await world.move(principal, entry.context, 'E');
    const simulatedNow = new Date(simulation.clockSnapshot().simulatedTime);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { energy: 40, energyUpdatedAt: simulatedNow },
    });

    const active = await world.interact(
      principal,
      entry.context,
      'bench-south',
    );
    expect(active.interaction?.objectId).toBe('bench-south');
    await expect(
      world.interact(principal, entry.context, 'bench-south'),
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

    await world.interact(principal, entry.context, 'bench-south');
    const moved = await world.move(principal, entry.context, 'W');
    expect(moved.interaction).toBeNull();
    expect(
      await prisma.characterWorldState.findUniqueOrThrow({
        where: { characterId: entry.context.characterId },
      }),
    ).toMatchObject({
      interactionObjectId: null,
      interactionStartedAt: null,
      interactionEndsAt: null,
    });
  });

  it('pays money when a job interaction completes', async () => {
    const principal = await player();
    const entry = await world.enter(principal, WORLD_ZONE_ID);
    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { x: 38, y: 30, money: 0 },
    });

    const active = await world.interact(
      principal,
      entry.context,
      'kiosk-north',
    );
    expect(active.interaction?.objectId).toBe('kiosk-north');
    expect(active.money).toBe(0);

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
      data: { x: 70, y: 50, money: 10, energy: 50 },
    });

    await expect(
      world.interact(principal, entry.context, 'snack-east'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });

    await prisma.characterWorldState.update({
      where: { characterId: entry.context.characterId },
      data: { money: 15 },
    });
    const purchased = await world.interact(
      principal,
      entry.context,
      'snack-east',
    );
    expect(purchased.interaction).toBeNull();
    expect(purchased.money).toBe(0);
    expect(purchased.energy).toBeGreaterThanOrEqual(69.9);
    expect(purchased.energy).toBeLessThanOrEqual(70);
  });
});
