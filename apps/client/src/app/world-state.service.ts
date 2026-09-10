import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  WORLD_ENTITY_JOINED_EVENT_TYPE,
  WORLD_ENTITY_LEFT_EVENT_TYPE,
  WORLD_ENTITY_UPDATED_EVENT_TYPE,
  WORLD_INTERACT_RESULT_EVENT_TYPE,
  WORLD_POSITION_CHANGED_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_ZONE_ID,
  SIMULATION_CLOCK_EVENT_TYPE,
} from '@city/game-protocol';
import type {
  ParsedServerMessage,
  WorldDirection,
  WorldEntity,
  WorldInteractResultPayload,
  WorldInteractionObjectId,
  WorldZoneId,
} from '@city/game-protocol';
import { CharacterService } from './character.service';
import { RealtimeService } from './realtime.service';

/**
 * Clientseitige Projektion der Welt. Sie enthält keine Bewegungslogik:
 * ausschließlich bestätigte Serverevents dürfen Positionen verändern.
 */
@Injectable({ providedIn: 'root' })
export class WorldStateService {
  private readonly realtime = inject(RealtimeService);
  private readonly characters = inject(CharacterService);

  readonly zoneId = signal<WorldZoneId | null>(null);
  readonly selfCharacterId = signal<string | null>(null);
  readonly simulatedTime = signal<string | null>(null);
  readonly simulationSpeed = signal<number | null>(null);
  readonly entities = signal<readonly WorldEntity[]>([]);
  /** Short server-validated NPC greet / hint shown in the HUD toast. */
  readonly interactFeedback = signal<WorldInteractResultPayload | null>(null);
  readonly selfEntity = computed(() => {
    const selfCharacterId = this.selfCharacterId();
    return (
      this.entities().find(
        (entity) => entity.characterId === selfCharacterId,
      ) ?? null
    );
  });

  private requestedWorldKey: string | null = null;

  constructor() {
    this.realtime.serverMessages
      .pipe(takeUntilDestroyed())
      .subscribe((message) => this.applyServerMessage(message));

    // Eine neue Connection-ID bedeutet auch bei automatischem Socket-Reconnect
    // eine neue serverseitige Welt-Teilnahme. Ein Auswahlwechsel fordert
    // dieselbe Zone für den nun ausgewählten Character erneut an.
    effect(() => {
      const connectionId = this.realtime.connectionId();
      const selectedCharacterId = this.characters.selected()?.id ?? null;
      const nextKey =
        connectionId && selectedCharacterId
          ? `${connectionId}:${selectedCharacterId}`
          : null;

      if (nextKey === this.requestedWorldKey) return;

      this.requestedWorldKey = nextKey;
      this.clearWorld();

      if (nextKey) {
        // Default remains central-square; market-lane enter/portal is #66.
        // Flip to MARKET_LANE_ZONE_ID for a manual smoke enter.
        this.realtime.sendWorldEnter(WORLD_ZONE_ID);
      }
    });
  }

  interact(objectId: WorldInteractionObjectId): void {
    if (!this.zoneId() || !this.selfEntity()) return;
    this.realtime.sendWorldInteract({ objectId });
  }

  interactNpc(npcCharacterId: string): void {
    if (!this.zoneId() || !this.selfEntity()) return;
    this.realtime.sendWorldInteract({ npcCharacterId });
  }

  move(direction: WorldDirection): void {
    if (
      !this.zoneId() ||
      this.selfCharacterId() !== this.characters.selected()?.id
    ) {
      return;
    }

    // Absichtlich kein lokales Positions-Update: der Server entscheidet und
    // bestätigt die neue Position per world-position-changed.
    this.realtime.sendWorldMove(direction);
  }

  private applyServerMessage(message: ParsedServerMessage): void {
    switch (message.kind) {
      case WORLD_SNAPSHOT_EVENT_TYPE:
        if (
          message.payload.selfCharacterId !== this.characters.selected()?.id
        ) {
          return;
        }
        this.zoneId.set(message.payload.zoneId);
        this.selfCharacterId.set(message.payload.selfCharacterId);
        this.simulatedTime.set(message.payload.clock.simulatedTime);
        this.simulationSpeed.set(message.payload.clock.speed);
        this.entities.set([...message.payload.entities]);
        return;
      case WORLD_ENTITY_JOINED_EVENT_TYPE:
      case WORLD_ENTITY_UPDATED_EVENT_TYPE:
      case WORLD_POSITION_CHANGED_EVENT_TYPE:
        if (!this.zoneId()) return;
        this.upsertEntity(message.payload.entity);
        return;
      case WORLD_ENTITY_LEFT_EVENT_TYPE:
        if (!this.zoneId()) return;
        this.entities.update((entities) =>
          entities.filter(
            (entity) => entity.characterId !== message.payload.characterId,
          ),
        );
        return;
      case WORLD_INTERACT_RESULT_EVENT_TYPE:
        if (!this.zoneId()) return;
        this.interactFeedback.set(message.payload);
        return;
      case SIMULATION_CLOCK_EVENT_TYPE:
        this.simulatedTime.set(message.payload.simulatedTime);
        this.simulationSpeed.set(message.payload.speed);
        return;
      default:
        return;
    }
  }

  private upsertEntity(entity: WorldEntity): void {
    this.entities.update((entities) => {
      const existing = entities.findIndex(
        (candidate) => candidate.characterId === entity.characterId,
      );
      if (existing < 0) return [...entities, entity];

      const updated = [...entities];
      updated[existing] = entity;
      return updated;
    });
  }

  private clearWorld(): void {
    this.zoneId.set(null);
    this.selfCharacterId.set(null);
    this.simulatedTime.set(null);
    this.simulationSpeed.set(null);
    this.entities.set([]);
    this.interactFeedback.set(null);
  }
}
