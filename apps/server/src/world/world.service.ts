import { Injectable, Logger } from '@nestjs/common';
import {
  WORLD_MOVE_STEP,
  WORLD_SPAWN_POSITION,
  WORLD_ZONE_ID,
  isWorldPositionWalkable,
  type WorldDirection,
  type WorldEntity,
  type WorldInteractionObjectId,
  type WorldSnapshotPayload,
  type WorldZoneId,
} from '@city/game-protocol';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import { SimulationService } from '../simulation/simulation.service';
import type { EnteredWorldContext } from './world.constants';
import { WorldRepository } from './world.repository';

export interface WorldEntry {
  context: EnteredWorldContext;
  snapshot: WorldSnapshotPayload;
}

const MAX_MOVE_RETRIES = 8;

function nextPosition(
  x: number,
  y: number,
  direction: WorldDirection,
): { x: number; y: number } {
  switch (direction) {
    case 'N':
      return { x, y: y - WORLD_MOVE_STEP };
    case 'E':
      return { x: x + WORLD_MOVE_STEP, y };
    case 'S':
      return { x, y: y + WORLD_MOVE_STEP };
    case 'W':
      return { x: x - WORLD_MOVE_STEP, y };
  }
}

/** Serverautoritärer Eintritt und Bewegungszustand der statischen Zone. */
@Injectable()
export class WorldService {
  private readonly logger = new Logger(WorldService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly worlds: WorldRepository,
    private readonly simulation: SimulationService,
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

    const context = await this.prisma.$transaction(async (tx) => {
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

      const state = await this.worlds.enter(
        selected.id,
        zoneId,
        WORLD_SPAWN_POSITION.x,
        WORLD_SPAWN_POSITION.y,
        tx,
      );
      if (!isWorldPositionWalkable(state.x, state.y)) {
        await this.worlds.relocate(
          selected.id,
          WORLD_SPAWN_POSITION.x,
          WORLD_SPAWN_POSITION.y,
          tx,
        );
      }
      return { characterId: selected.id, zoneId } satisfies EnteredWorldContext;
    });

    const entry: WorldEntry = {
      context,
      snapshot: {
        zoneId,
        selfCharacterId: context.characterId,
        clock: this.simulation.clockSnapshot(),
        entities: await this.simulation.entitiesInZone(zoneId),
      },
    };
    this.logger.log({
      event: 'world-entered',
      characterId: entry.context.characterId,
      zoneId,
    });
    return entry;
  }

  async interact(
    principal: AuthenticatedPrincipal,
    context: EnteredWorldContext,
    objectId: WorldInteractionObjectId,
  ): Promise<WorldEntity> {
    const selected = await this.worlds.findSelectedCharacter(
      principal.playerProfileId,
      this.prisma,
    );
    const state = await this.worlds.findState(context.characterId, this.prisma);
    if (
      selected?.id !== context.characterId ||
      !state ||
      state.zoneId !== context.zoneId
    ) {
      throw new ApplicationError(
        'WORLD_NOT_ENTERED',
        409,
        'Enter the world with the currently selected character first',
      );
    }

    return this.simulation.startInteraction(context.characterId, objectId);
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
        if (!isWorldPositionWalkable(position.x, position.y)) {
          throw new ApplicationError(
            'WORLD_MOVE_BLOCKED',
            409,
            'Movement is blocked by the Central Square map',
          );
        }
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
          ...position,
        };
      });

      if (moved) {
        const entity = await this.simulation.entity(moved.characterId);
        this.logger.log({
          event: 'world-moved',
          characterId: entity.characterId,
          direction,
          x: entity.x,
          y: entity.y,
        });
        return entity;
      }
    }

    throw new ApplicationError(
      'PERSISTENCE_ERROR',
      503,
      'World position could not be updated',
    );
  }
}
