import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { WorldEntity } from '@city/game-protocol';
import { PrismaService } from '../persistence/prisma.service';

type DatabaseClient = Prisma.TransactionClient | PrismaService;

export interface SelectedWorldCharacter {
  id: string;
  name: string;
}

export interface StoredWorldState {
  characterId: string;
  zoneId: string;
  x: number;
  y: number;
  revision: number;
}

/** Prisma-Zugriff des World-Slices, getrennt von Transport und Use Cases. */
@Injectable()
export class WorldRepository {
  constructor(private readonly prisma: PrismaService) {}

  findSelectedCharacter(
    playerProfileId: string,
    client: DatabaseClient = this.prisma,
  ): Promise<SelectedWorldCharacter | null> {
    return client.playerProfile
      .findUnique({
        where: { id: playerProfileId },
        select: {
          selectedCharacter: { select: { id: true, name: true } },
        },
      })
      .then((profile) => profile?.selectedCharacter ?? null);
  }

  enter(
    characterId: string,
    zoneId: string,
    spawnCoordinate: number,
    client: DatabaseClient,
  ): Promise<StoredWorldState> {
    return client.characterWorldState.upsert({
      where: { characterId },
      create: {
        characterId,
        zoneId,
        x: spawnCoordinate,
        y: spawnCoordinate,
      },
      // Ein Wiedereintritt darf die persistierte Position nicht zurücksetzen.
      update: { zoneId },
      select: {
        characterId: true,
        zoneId: true,
        x: true,
        y: true,
        revision: true,
      },
    });
  }

  async findEntitiesInZone(
    zoneId: string,
    client: DatabaseClient,
  ): Promise<WorldEntity[]> {
    const states = await client.characterWorldState.findMany({
      where: { zoneId },
      orderBy: { characterId: 'asc' },
      select: {
        characterId: true,
        x: true,
        y: true,
        character: { select: { name: true } },
      },
    });
    return states.map((state) => ({
      characterId: state.characterId,
      name: state.character.name,
      x: state.x,
      y: state.y,
    }));
  }

  findState(
    characterId: string,
    client: DatabaseClient,
  ): Promise<StoredWorldState | null> {
    return client.characterWorldState.findUnique({
      where: { characterId },
      select: {
        characterId: true,
        zoneId: true,
        x: true,
        y: true,
        revision: true,
      },
    });
  }

  async tryMove(
    characterId: string,
    expectedRevision: number,
    x: number,
    y: number,
    client: DatabaseClient,
  ): Promise<boolean> {
    const result = await client.characterWorldState.updateMany({
      where: { characterId, revision: expectedRevision },
      data: { x, y, revision: { increment: 1 } },
    });
    return result.count === 1;
  }
}
