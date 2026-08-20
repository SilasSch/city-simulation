import { Injectable, Logger } from '@nestjs/common';
import type { Character } from '@prisma/client';
import type { CharacterDto } from '@city/shared-types';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import { validateCharacterName } from './character-name';
import { CharacterRepository } from './character.repository';

/** Explizites Mapping: Prisma-Records werden niemals direkt ausgeliefert. */
function toCharacterDto(character: Character): CharacterDto {
  return {
    id: character.id,
    name: character.name,
    createdAt: character.createdAt.toISOString(),
  };
}

/**
 * Fachliche Use Cases rund um Characters. Der Server entscheidet allein:
 * Besitzerzuordnung kommt aus dem Principal, niemals vom Client.
 */
@Injectable()
export class CharacterService {
  private readonly logger = new Logger(CharacterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly characters: CharacterRepository,
  ) {}

  /**
   * Erstellt einen Character für das eigene Profil. Der erste Character
   * eines Profils wird in derselben Transaktion automatisch ausgewählt
   * (ADR 0009).
   */
  async createCharacter(
    principal: AuthenticatedPrincipal,
    rawName: string,
  ): Promise<CharacterDto> {
    const name = validateCharacterName(rawName);

    const created = await this.prisma.$transaction(async (tx) => {
      const existingCount = await this.characters.countByProfile(
        principal.playerProfileId,
        tx,
      );
      const character = await this.characters.create(
        { playerProfileId: principal.playerProfileId, name },
        tx,
      );
      if (existingCount === 0) {
        await this.characters.setSelected(
          principal.playerProfileId,
          character.id,
          tx,
        );
      }
      return character;
    });

    this.logger.log({
      event: 'character-created',
      characterId: created.id,
      playerProfileId: principal.playerProfileId,
    });
    return toCharacterDto(created);
  }

  /** Listet ausschließlich die Characters des eigenen Profils. */
  async listCharacters(
    principal: AuthenticatedPrincipal,
  ): Promise<CharacterDto[]> {
    const characters = await this.characters.findManyByProfile(
      principal.playerProfileId,
    );
    return characters.map(toCharacterDto);
  }

  /** Wählt einen eigenen Character als aktuell ausgewählten aus. */
  async selectCharacter(
    principal: AuthenticatedPrincipal,
    characterId: string,
  ): Promise<CharacterDto> {
    const character = await this.characters.findById(characterId);
    if (!character) {
      throw new ApplicationError(
        'CHARACTER_NOT_FOUND',
        404,
        'Character not found',
      );
    }
    if (character.playerProfileId !== principal.playerProfileId) {
      // Besitzverletzung: strukturiert loggen, kontrolliert ablehnen.
      this.logger.warn({
        event: 'character-ownership-violation',
        characterId,
        playerProfileId: principal.playerProfileId,
      });
      throw new ApplicationError(
        'CHARACTER_NOT_OWNED',
        403,
        'Character does not belong to the current player',
      );
    }

    await this.characters.setSelected(principal.playerProfileId, character.id);
    this.logger.log({
      event: 'character-selected',
      characterId: character.id,
      playerProfileId: principal.playerProfileId,
    });
    return toCharacterDto(character);
  }

  async deleteCharacter(
    principal: AuthenticatedPrincipal,
    characterId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const character = await this.characters.findById(characterId, tx);
      if (!character) {
        throw new ApplicationError(
          'CHARACTER_NOT_FOUND',
          404,
          'Character not found',
        );
      }
      if (character.playerProfileId !== principal.playerProfileId) {
        throw new ApplicationError(
          'CHARACTER_NOT_OWNED',
          403,
          'Character does not belong to the current player',
        );
      }

      const selected = await tx.playerProfile.findUniqueOrThrow({
        where: { id: principal.playerProfileId },
        select: { selectedCharacterId: true },
      });
      if (selected.selectedCharacterId === characterId) {
        await this.characters.clearSelected(principal.playerProfileId, tx);
      }
      await this.characters.delete(characterId, tx);
    });

    this.logger.log({
      event: 'character-deleted',
      characterId,
      playerProfileId: principal.playerProfileId,
    });
  }

  /** Lädt den dauerhaft gespeicherten, aktuell ausgewählten Character. */
  async getSelectedCharacter(
    principal: AuthenticatedPrincipal,
  ): Promise<CharacterDto> {
    const selected = await this.characters.findSelectedByProfile(
      principal.playerProfileId,
    );
    if (!selected) {
      throw new ApplicationError(
        'NO_CHARACTER_SELECTED',
        404,
        'No character selected',
      );
    }
    return toCharacterDto(selected);
  }
}
