import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
    spawnX: number,
    spawnY: number,
    client: DatabaseClient,
  ): Promise<StoredWorldState> {
    return client.characterWorldState.upsert({
      where: { characterId },
      create: {
        characterId,
        zoneId,
        x: spawnX,
        y: spawnY,
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

  async relocate(
    characterId: string,
    x: number,
    y: number,
    client: DatabaseClient,
  ): Promise<void> {
    await client.characterWorldState.update({
      where: { characterId },
      data: { x, y, revision: { increment: 1 } },
    });
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
      data: {
        x,
        y,
        revision: { increment: 1 },
        interactionObjectId: null,
        interactionStartedAt: null,
        interactionEndsAt: null,
      },
    });
    return result.count === 1;
  }
}
