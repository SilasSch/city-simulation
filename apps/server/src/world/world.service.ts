import { Injectable, Logger } from '@nestjs/common';
import {
  NPC_INTERACT_PAUSE_TICKS,
  NPC_INTERACTION_RANGE,
  WORLD_ZONE_IDS,
  centralSquareNpcGreeting,
  isNpcWorldInteractPayload,
  isWorldPositionWalkable,
  worldZonePortal,
  worldZoneSpawn,
  type WorldEntity,
  type WorldInputPayload,
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
import {
  WorldPositionService,
  type WorldTickResult,
} from './world-position.service';
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

/** Serverautoritärer Eintritt und Bewegungszustand der statischen Zone. */
@Injectable()
export class WorldService {
  private readonly logger = new Logger(WorldService.name);
  /** Zuletzt eingetretener Character je PlayerProfile (DB-freier Move-Pfad). */
  private readonly enteredByProfile = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly worlds: WorldRepository,
    private readonly simulation: SimulationService,
    private readonly presence: WorldPresenceService,
    private readonly positions: WorldPositionService,
  ) {}

  /** Ersetzt die persistierte durch die Tick-Position, falls bekannt. */
  withLivePosition(entity: WorldEntity): WorldEntity {
    const live = this.positions.position(entity.characterId);
    return live ? { ...entity, x: live.x, y: live.y } : entity;
  }

  /** Letzter Socket eines Characters ist weg: Position sichern, Tick verlassen. */
  async leave(characterId: string): Promise<void> {
    await this.positions.untrack(characterId);
    for (const [profileId, entered] of this.enteredByProfile) {
      if (entered === characterId) this.enteredByProfile.delete(profileId);
    }
  }

  private async snapshotOf(
    context: EnteredWorldContext,
  ): Promise<WorldSnapshotPayload> {
    const entities = await this.simulation.entitiesInZone(context.zoneId);
    return {
      zoneId: context.zoneId,
      selfCharacterId: context.characterId,
      clock: this.simulation.clockSnapshot(),
      entities: entities.map((entity) => this.withLivePosition(entity)),
    };
  }

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
    // Der Eintritt liest die Position aus PostgreSQL: die Tick-Position des
    // ausgewählten Characters vorher sichern (er kann noch in einem anderen
    // Tab unterwegs sein).
    const selectedBefore = await this.worlds.findSelectedCharacter(
      principal.playerProfileId,
    );
    if (selectedBefore) await this.positions.flush(selectedBefore.id);
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

    const stored = await this.simulation.entity(context.characterId);
    this.positions.track(
      context.characterId,
      zoneId,
      stored.x,
      stored.y,
      stored.interaction !== null,
    );
    this.enteredByProfile.set(principal.playerProfileId, context.characterId);

    const entry: WorldEntry = {
      context,
      snapshot: await this.snapshotOf(context),
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
    // Reichweite gegen die aktuelle Tick-Position prüfen.
    await this.positions.flush(context.characterId);

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

    this.positions.track(
      contextAfter.characterId,
      contextAfter.zoneId,
      spawn.x,
      spawn.y,
      false,
    );
    const entry: WorldEntry = {
      context: contextAfter,
      snapshot: await this.snapshotOf(contextAfter),
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
    // Reichweite gegen die aktuelle Tick-Position prüfen.
    await this.positions.flush(context.characterId);
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
    this.positions.markInteracting(
      context.characterId,
      entity.interaction !== null,
    );
    return { kind: 'object', entity: this.withLivePosition(entity) };
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

  /**
   * Übernimmt eine stufenlose Bewegungsabsicht für den Zonen-Tick. Der Pfad
   * ist datenbankfrei; angewendet wird sie im nächsten Tick.
   */
  input(
    principal: AuthenticatedPrincipal,
    context: EnteredWorldContext,
    payload: WorldInputPayload,
  ): void {
    if (
      this.enteredByProfile.get(principal.playerProfileId) !==
      context.characterId
    ) {
      throw new ApplicationError(
        'WORLD_NOT_ENTERED',
        409,
        'Enter the world with the currently selected character first',
      );
    }
    this.positions.setInput(context.characterId, context.zoneId, payload);
  }

  /** Meldet jeden Zonen-Tick an den Transport. */
  onTick(listener: (result: WorldTickResult) => void): () => void {
    return this.positions.onTick(listener);
  }
}
