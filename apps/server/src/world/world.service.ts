import { Injectable, Logger } from '@nestjs/common';
import {
  WORLD_COORDINATE_MAX,
  WORLD_COORDINATE_MIN,
  WORLD_MOVE_STEP,
  WORLD_SPAWN_COORDINATE,
  WORLD_ZONE_ID,
  type WorldDirection,
  type WorldEntity,
  type WorldSnapshotPayload,
  type WorldZoneId,
} from '@city/game-protocol';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import type { EnteredWorldContext } from './world.constants';
import { WorldRepository } from './world.repository';

export interface WorldEntry {
  context: EnteredWorldContext;
  snapshot: WorldSnapshotPayload;
}

const MAX_MOVE_RETRIES = 8;

function clampCoordinate(value: number): number {
  return Math.min(WORLD_COORDINATE_MAX, Math.max(WORLD_COORDINATE_MIN, value));
}

function nextPosition(
  x: number,
  y: number,
  direction: WorldDirection,
): { x: number; y: number } {
  switch (direction) {
    case 'N':
      return { x, y: clampCoordinate(y - WORLD_MOVE_STEP) };
    case 'E':
      return { x: clampCoordinate(x + WORLD_MOVE_STEP), y };
    case 'S':
      return { x, y: clampCoordinate(y + WORLD_MOVE_STEP) };
    case 'W':
      return { x: clampCoordinate(x - WORLD_MOVE_STEP), y };
  }
}

/** Serverautoritärer Eintritt und Bewegungszustand der statischen Zone. */
@Injectable()
export class WorldService {
  private readonly logger = new Logger(WorldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly worlds: WorldRepository,
  ) {}

  async enter(
    principal: AuthenticatedPrincipal,
    zoneId: WorldZoneId,
  ): Promise<WorldEntry> {
    // zoneId ist bereits durch game-protocol validiert; der explizite Check
    // schützt direkte Service-Aufrufer und hält die statische Zone sichtbar.
    if (zoneId !== WORLD_ZONE_ID) {
      throw new ApplicationError('VALIDATION_ERROR', 400, 'Unknown world zone');
    }

    const entry = await this.prisma.$transaction(async (tx) => {
      const selected = await this.worlds.findSelectedCharacter(
        principal.playerProfileId,
        tx,
      );
      if (!selected) {
        throw new ApplicationError(
          'NO_CHARACTER_SELECTED',
          404,
          'No character selected',
        );
      }

      await this.worlds.enter(selected.id, zoneId, WORLD_SPAWN_COORDINATE, tx);
      const entities = await this.worlds.findEntitiesInZone(zoneId, tx);
      return {
        context: { characterId: selected.id, zoneId },
        snapshot: {
          zoneId,
          selfCharacterId: selected.id,
          entities,
        },
      } satisfies WorldEntry;
    });

    this.logger.log({
      event: 'world-entered',
      characterId: entry.context.characterId,
      zoneId,
    });
    return entry;
  }

  async move(
    principal: AuthenticatedPrincipal,
    context: EnteredWorldContext,
    direction: WorldDirection,
  ): Promise<WorldEntity> {
    for (let attempt = 0; attempt < MAX_MOVE_RETRIES; attempt += 1) {
      const moved = await this.prisma.$transaction(async (tx) => {
        const selected = await this.worlds.findSelectedCharacter(
          principal.playerProfileId,
          tx,
        );
        if (selected?.id !== context.characterId) {
          throw new ApplicationError(
            'WORLD_NOT_ENTERED',
            409,
            'Enter the world with the currently selected character first',
          );
        }

        const state = await this.worlds.findState(context.characterId, tx);
        if (!state || state.zoneId !== context.zoneId) {
          throw new ApplicationError(
            'WORLD_NOT_ENTERED',
            409,
            'Enter the world before moving',
          );
        }

        const position = nextPosition(state.x, state.y, direction);
        const updated = await this.worlds.tryMove(
          context.characterId,
          state.revision,
          position.x,
          position.y,
          tx,
        );
        if (!updated) return null;

        return {
          characterId: selected.id,
          name: selected.name,
          ...position,
        } satisfies WorldEntity;
      });

      if (moved) {
        this.logger.log({
          event: 'world-moved',
          characterId: moved.characterId,
          direction,
          x: moved.x,
          y: moved.y,
        });
        return moved;
      }
    }

    throw new ApplicationError(
      'PERSISTENCE_ERROR',
      503,
      'World position could not be updated',
    );
  }
}
