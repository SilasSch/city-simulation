import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WORLD_COORDINATE_MIN,
  WORLD_SPAWN_COORDINATE,
  WORLD_ZONE_ID,
} from '@city/game-protocol';
import { AppModule } from '../app.module';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { AuthService } from '../auth/auth.service';
import { CharacterService } from '../character/character.service';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import { cleanDatabase } from '../../test/test-database';
import { WorldService } from './world.service';

describe('WorldService (integration)', () => {
  let app: INestApplication;
  let auth: AuthService;
  let characters: CharacterService;
  let prisma: PrismaService;
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
    world = moduleRef.get(WorldService);
  });

  beforeEach(async () => cleanDatabase(prisma));
  afterAll(async () => app.close());

  async function register(email: string): Promise<AuthenticatedPrincipal> {
    const result = await auth.register(email, 'geheim-123');
    const resolution = await auth.resolvePrincipal(result.sessionToken);
    if (resolution.status !== 'ok') throw new Error('Session not available');
    return resolution.session.principal;
  }

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
    expect(firstEntry.snapshot.entities).toEqual([
      {
        characterId: firstEntry.snapshot.selfCharacterId,
        name: 'Ayla',
        x: WORLD_SPAWN_COORDINATE,
        y: WORLD_SPAWN_COORDINATE,
      },
    ]);

    const moved = await world.move(principal, firstEntry.context, 'E');
    const secondEntry = await world.enter(principal, WORLD_ZONE_ID);
    expect(
      secondEntry.snapshot.entities.find(
        (entity) => entity.characterId === moved.characterId,
      ),
    ).toEqual(moved);

    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: moved.characterId },
    });
    expect(stored.revision).toBe(1);
  });

  it('clamps movement at the bounds and serializes concurrent moves', async () => {
    const principal = await playerWithCharacter('movement@example.com');
    const entry = await world.enter(principal, WORLD_ZONE_ID);

    await Promise.all([
      world.move(principal, entry.context, 'E'),
      world.move(principal, entry.context, 'E'),
    ]);
    for (let step = 0; step < 30; step += 1) {
      await world.move(principal, entry.context, 'N');
      await world.move(principal, entry.context, 'W');
    }

    const stored = await prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId: entry.context.characterId },
    });
    expect(stored.x).toBe(WORLD_COORDINATE_MIN);
    expect(stored.y).toBe(WORLD_COORDINATE_MIN);
    expect(stored.revision).toBe(62);
  });

  it('invalidates an entered context after the selected character changes', async () => {
    const principal = await playerWithCharacter('selection@example.com');
    const entry = await world.enter(principal, WORLD_ZONE_ID);
    const second = await characters.createCharacter(principal, 'Borin');
    await characters.selectCharacter(principal, second.id);

    await expect(
      world.move(principal, entry.context, 'E'),
    ).rejects.toMatchObject({ code: 'WORLD_NOT_ENTERED' });
  });
});
