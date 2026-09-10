import { Injectable, Logger } from '@nestjs/common';
import {
  NPC_INTERACT_PAUSE_TICKS,
  NPC_INTERACTION_RANGE,
  WORLD_MOVE_STEP,
  WORLD_ZONE_IDS,
  centralSquareNpcGreeting,
  isNpcWorldInteractPayload,
  isWorldPositionWalkable,
  worldZonePortal,
  worldZoneSpawn,
  type WorldDirection,
  type WorldEntity,
  type WorldInteractPayload,
  type WorldSnapshotPayload,
  type WorldTransitionPayload,
  type WorldZoneId,
} from '@city/game-protocol';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import { SimulationService } from '../simulation/simulation.service';
import type { EnteredWorldContext } from './world.constants';
import { WorldPresenceService } from './world-presence.service';
import { WorldRepository } from './world.repository';

export interface WorldEntry {
  context: EnteredWorldContext;
  snapshot: WorldSnapshotPayload;
}

export type WorldInteractOutcome =
  | { kind: 'object'; entity: WorldEntity }
  | {
      kind: 'npc';
      npcCharacterId: string;
      npcName: string;
      message: string;
    };

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
    private readonly presence: WorldPresenceService,
  ) {}

  async enter(
    principal: AuthenticatedPrincipal,
    zoneId: WorldZoneId,
  ): Promise<WorldEntry> {
    // zoneId ist bereits durch game-protocol validiert; der explizite Check
    // schützt direkte Service-Aufrufer vor unbekannten Zonen.
    if (!(WORLD_ZONE_IDS as readonly string[]).includes(zoneId)) {
      throw new ApplicationError('VALIDATION_ERROR', 400, 'Unknown world zone');
    }

    const spawn = worldZoneSpawn(zoneId);
    const simulatedNow = new Date(
      this.simulation.clockSnapshot().simulatedTime,
    );
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

      const previous = await this.worlds.findState(selected.id, tx);
      const state = await this.worlds.enter(
        selected.id,
        zoneId,
        spawn.x,
        spawn.y,
        simulatedNow,
        tx,
      );
      const switchedZone = previous !== null && previous.zoneId !== zoneId;
      if (switchedZone || !isWorldPositionWalkable(state.x, state.y, zoneId)) {
        await this.worlds.relocate(selected.id, spawn.x, spawn.y, tx);
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

  /**
   * Server-authoritative portal transition: range-check in the source zone,
   * then atomically set zoneId + destination spawn. Gateway leaves/joins rooms.
   */
  async transition(
    principal: AuthenticatedPrincipal,
    context: EnteredWorldContext,
    payload: WorldTransitionPayload,
  ): Promise<WorldEntry> {
    const portal = worldZonePortal(payload.portalId);
    const spawn = worldZoneSpawn(portal.toZoneId);

    const contextAfter = await this.prisma.$transaction(async (tx) => {
      const selected = await this.worlds.findSelectedCharacter(
        principal.playerProfileId,
        tx,
      );
      const state = await this.worlds.findState(context.characterId, tx);
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

      if (state.zoneId !== portal.fromZoneId) {
        throw new ApplicationError(
          'INTERACTION_OBJECT_NOT_FOUND',
          404,
          'Portal is not available in this zone',
        );
      }

      const distance = Math.hypot(state.x - portal.x, state.y - portal.y);
      if (distance > portal.interactionRange) {
        throw new ApplicationError(
          'INTERACTION_OUT_OF_RANGE',
          409,
          'Move closer to the portal before transitioning',
        );
      }

      await this.worlds.transition(
        context.characterId,
        portal.toZoneId,
        spawn.x,
        spawn.y,
        tx,
      );
      return {
        characterId: context.characterId,
        zoneId: portal.toZoneId,
      } satisfies EnteredWorldContext;
    });

    const entry: WorldEntry = {
      context: contextAfter,
      snapshot: {
        zoneId: contextAfter.zoneId,
        selfCharacterId: contextAfter.characterId,
        clock: this.simulation.clockSnapshot(),
        entities: await this.simulation.entitiesInZone(contextAfter.zoneId),
      },
    };
    this.logger.log({
      event: 'world-transitioned',
      characterId: entry.context.characterId,
      portalId: portal.id,
      fromZoneId: portal.fromZoneId,
      toZoneId: portal.toZoneId,
    });
    return entry;
  }

  async interact(
    principal: AuthenticatedPrincipal,
    context: EnteredWorldContext,
    payload: WorldInteractPayload,
  ): Promise<WorldInteractOutcome> {
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

    if (isNpcWorldInteractPayload(payload)) {
      return this.interactNpc(state.x, state.y, payload.npcCharacterId);
    }

    const entity = await this.simulation.startInteraction(
      context.characterId,
      payload.objectId,
    );
    return { kind: 'object', entity };
  }

  private interactNpc(
    playerX: number,
    playerY: number,
    npcCharacterId: string,
  ): WorldInteractOutcome {
    const npc = this.presence.npc(npcCharacterId);
    if (!npc || npc.kind !== 'npc') {
      throw new ApplicationError(
        'INTERACTION_OBJECT_NOT_FOUND',
        404,
        'NPC not found',
      );
    }

    const distance = Math.hypot(playerX - npc.x, playerY - npc.y);
    if (distance > NPC_INTERACTION_RANGE) {
      throw new ApplicationError(
        'INTERACTION_OUT_OF_RANGE',
        409,
        'Move closer before interacting',
      );
    }

    const message = centralSquareNpcGreeting(npc.characterId);
    if (!message) {
      throw new ApplicationError(
        'INTERACTION_OBJECT_NOT_FOUND',
        404,
        'NPC has nothing to say',
      );
    }

    this.presence.pauseNpcInteract(npc.characterId, NPC_INTERACT_PAUSE_TICKS);

    return {
      kind: 'npc',
      npcCharacterId: npc.characterId,
      npcName: npc.name,
      message,
    };
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
        if (!isWorldPositionWalkable(position.x, position.y, context.zoneId)) {
          throw new ApplicationError(
            'WORLD_MOVE_BLOCKED',
            409,
            'Movement is blocked by the zone map',
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
