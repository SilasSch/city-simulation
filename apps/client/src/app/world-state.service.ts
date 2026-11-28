import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  WORLD_ENTITY_JOINED_EVENT_TYPE,
  WORLD_ENTITY_LEFT_EVENT_TYPE,
  WORLD_ENTITY_UPDATED_EVENT_TYPE,
  WORLD_INTERACT_RESULT_EVENT_TYPE,
  WORLD_POSITIONS_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_ZONE_ID,
  SIMULATION_CLOCK_EVENT_TYPE,
} from '@city/game-protocol';
import type {
  ParsedServerMessage,
  WorldEntity,
  WorldPoint,
  WorldPositionsPayload,
  WorldInteractResultPayload,
  WorldInteractionObjectId,
  WorldZoneId,
  WorldZonePortalId,
} from '@city/game-protocol';
import { CharacterService } from './character.service';
import type { InteractionTarget } from './interaction-target';
import { RealtimeService } from './realtime.service';

/** Letzte vom Server bestätigte Position der eigenen Figur samt Input-Sequenz. */
export interface SelfPositionAck {
  readonly seq: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Clientseitige Projektion der Welt aus bestätigten Serverevents. Die
 * Vorhersage der eigenen Figur lebt in der Engine (SelfMovement); diese
 * Projektion bleibt der bestätigte Stand für HUD und Reichweiten.
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
  /** Bestätigung für die Client-Prediction (world-positions, 20 Hz). */
  readonly selfAck = signal<SelfPositionAck | null>(null);
  readonly selfEntity = computed(() => {
    const selfCharacterId = this.selfCharacterId();
    return (
      this.entities().find(
        (entity) => entity.characterId === selfCharacterId,
      ) ?? null
    );
  });

  private requestedWorldKey: string | null = null;
  private inputSeq = 0;

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
        // Der Server setzt in der gespeicherten Zone fort (#99); das Feld
        // bleibt aus Protokollgründen und wird nur validiert.
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

  /** Löst das per `E` oder Klick gewählte Ziel aus (Objekt, NPC, Portal). */
  interactWith(target: InteractionTarget): void {
    switch (target.kind) {
      case 'object':
        this.interact(target.id);
        return;
      case 'npc':
        this.interactNpc(target.id);
        return;
      case 'portal':
        this.transition(target.id);
        return;
    }
  }

  /** Client follows confirmed snapshot only — no optimistic zone jump. */
  transition(portalId: WorldZonePortalId): void {
    if (!this.zoneId() || !this.selfEntity()) return;
    this.realtime.sendWorldTransition(portalId);
  }

  /**
   * Sendet eine stufenlose Bewegungsabsicht. Liefert die Sequenznummer oder
   * `null`, solange der ausgewählte Character die Welt nicht betreten hat.
   */
  sendInput(input: WorldPoint): number | null {
    if (
      !this.zoneId() ||
      this.selfCharacterId() !== this.characters.selected()?.id
    ) {
      return null;
    }
    this.inputSeq += 1;
    this.realtime.sendWorldInput({
      seq: this.inputSeq,
      x: input.x,
      y: input.y,
    });
    return this.inputSeq;
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
        if (!this.zoneId()) return;
        this.upsertEntity(message.payload.entity);
        return;
      case WORLD_POSITIONS_EVENT_TYPE:
        if (message.payload.zoneId !== this.zoneId()) return;
        this.applyPositions(message.payload);
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

  private applyPositions(payload: WorldPositionsPayload): void {
    const byId = new Map(
      payload.entities.map((entry) => [entry.characterId, entry] as const),
    );
    const self = byId.get(this.selfCharacterId() ?? '');
    if (self) this.selfAck.set({ seq: self.seq, x: self.x, y: self.y });

    this.entities.update((entities) =>
      entities.map((entity) => {
        const entry = byId.get(entity.characterId);
        return entry ? { ...entity, x: entry.x, y: entry.y } : entity;
      }),
    );
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
    this.selfAck.set(null);
  }
}
