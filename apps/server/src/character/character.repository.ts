import { Injectable } from '@nestjs/common';
import type { Character, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma.service';

type TransactionClient = Prisma.TransactionClient;

/**
 * Konkrete Persistence für Characters. Einzige Stelle mit Prisma-Zugriff
 * für dieses Fachmodul; alle Methoden können optional innerhalb einer
 * bestehenden Transaktion laufen.
 */
@Injectable()
export class CharacterRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyByProfile(playerProfileId: string): Promise<Character[]> {
    return this.prisma.character.findMany({
      where: { playerProfileId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(
    id: string,
    tx?: TransactionClient,
  ): Promise<Character | null> {
    const client = tx ?? this.prisma;
    return client.character.findUnique({ where: { id } });
  }

  async countByProfile(
    playerProfileId: string,
    tx: TransactionClient,
  ): Promise<number> {
    return tx.character.count({ where: { playerProfileId } });
  }

  async create(
    data: { playerProfileId: string; name: string },
    tx: TransactionClient,
  ): Promise<Character> {
    return tx.character.create({ data });
  }

  async setSelected(
    playerProfileId: string,
    characterId: string,
    tx?: TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.playerProfile.update({
      where: { id: playerProfileId },
      data: { selectedCharacterId: characterId },
    });
  }

  async clearSelected(
    playerProfileId: string,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.playerProfile.update({
      where: { id: playerProfileId },
      data: { selectedCharacterId: null },
    });
  }

  async delete(id: string, tx: TransactionClient): Promise<void> {
    await tx.character.delete({ where: { id } });
  }

  async findSelectedByProfile(
    playerProfileId: string,
  ): Promise<Character | null> {
    const profile = await this.prisma.playerProfile.findUnique({
      where: { id: playerProfileId },
      select: { selectedCharacter: true },
    });
    return profile?.selectedCharacter ?? null;
  }
}
