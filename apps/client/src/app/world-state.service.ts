import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  WORLD_POSITION_CHANGED_EVENT_TYPE,
  WORLD_SNAPSHOT_EVENT_TYPE,
  WORLD_ZONE_ID,
} from '@city/game-protocol';
import type {
  ParsedServerMessage,
  WorldDirection,
  WorldEntity,
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
  readonly entities = signal<readonly WorldEntity[]>([]);
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
        this.realtime.sendWorldEnter(WORLD_ZONE_ID);
      }
    });
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
        this.entities.set([...message.payload.entities]);
        return;
      case WORLD_POSITION_CHANGED_EVENT_TYPE:
        if (!this.zoneId()) return;
        this.entities.update((entities) => {
          const existing = entities.findIndex(
            (entity) =>
              entity.characterId === message.payload.entity.characterId,
          );
          if (existing < 0) return [...entities, message.payload.entity];

          const updated = [...entities];
          updated[existing] = message.payload.entity;
          return updated;
        });
        return;
      default:
        return;
    }
  }

  private clearWorld(): void {
    this.zoneId.set(null);
    this.selfCharacterId.set(null);
    this.entities.set([]);
  }
}
