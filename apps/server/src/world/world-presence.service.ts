import { Injectable } from '@nestjs/common';
import {
  mergeZoneNpcEntities,
  WORLD_ZONE_ID,
  type WorldEntity,
} from '@city/game-protocol';
import {
  createNpcPatrolRuntimes,
  tickNpcPatrols,
  type NpcPatrolRuntime,
} from './npc-patrol';

interface CharacterPresence {
  entity: WorldEntity;
  socketIds: Set<string>;
}

export interface PresenceDeparture {
  characterId: string;
  lastSocket: boolean;
}

/**
 * Prozesslokale Live-Presence für die einzelne Serverinstanz des aktuellen
 * Deployment-Milestones. Persistente Positionen bleiben im Repository; diese
 * Registry entscheidet nur, welche Characters gerade sichtbar sein sollen.
 * Zonen-NPCs sind session-stabil, server-tick-bewegt und immer Teil der
 * sichtbaren Entity-Liste — Clients können NPC-Positionen nicht setzen.
 */
@Injectable()
export class WorldPresenceService {
  private readonly presences = new Map<string, CharacterPresence>();
  private readonly characterBySocket = new Map<string, string>();
  private readonly npcRuntimes: Map<string, NpcPatrolRuntime> =
    createNpcPatrolRuntimes();

  enter(socketId: string, entity: WorldEntity): boolean {
    if (entity.kind === 'npc') {
      return false;
    }
    const existing = this.presences.get(entity.characterId);
    if (existing) {
      existing.entity = entity;
      existing.socketIds.add(socketId);
      this.characterBySocket.set(socketId, entity.characterId);
      return false;
    }

    this.presences.set(entity.characterId, {
      entity,
      socketIds: new Set([socketId]),
    });
    this.characterBySocket.set(socketId, entity.characterId);
    return true;
  }

  leave(socketId: string): PresenceDeparture | null {
    const characterId = this.characterBySocket.get(socketId);
    if (!characterId) return null;

    this.characterBySocket.delete(socketId);
    const presence = this.presences.get(characterId);
    if (!presence) return { characterId, lastSocket: true };

    presence.socketIds.delete(socketId);
    if (presence.socketIds.size > 0) {
      return { characterId, lastSocket: false };
    }

    this.presences.delete(characterId);
    return { characterId, lastSocket: true };
  }

  update(entity: WorldEntity): void {
    // NPC positions are server-tick only — ignore client-origin updates.
    if (entity.kind === 'npc') return;
    const presence = this.presences.get(entity.characterId);
    if (presence) presence.entity = entity;
  }

  /** Live NPC entity by characterId, or null if unknown. */
  npc(characterId: string): WorldEntity | null {
    return this.npcRuntimes.get(characterId)?.entity ?? null;
  }

  /**
   * Pauses patrol for a few sim ticks after a greet so the NPC holds still.
   * No-op for unknown characterIds.
   */
  pauseNpcInteract(characterId: string, ticks: number): void {
    const runtime = this.npcRuntimes.get(characterId);
    if (!runtime) return;
    this.npcRuntimes.set(characterId, {
      ...runtime,
      interactPauseTicksRemaining: Math.max(0, Math.floor(ticks)),
    });
  }

  /** Advances zone NPC patrols; returns entities that changed position. */
  advanceNpcs(): WorldEntity[] {
    return tickNpcPatrols(this.npcRuntimes);
  }

  /** Sichtbare Entities der Zone inkl. live NPC-Positionen. */
  entities(): WorldEntity[] {
    const live = [...this.presences.values()].map(({ entity }) => entity);
    const npcs = [...this.npcRuntimes.values()].map(({ entity }) => entity);
    return mergeZoneNpcEntities(WORLD_ZONE_ID, [...live, ...npcs]);
  }

  /** Nur spielergebundene Presence-IDs (für Simulationsticks). */
  characterIds(): string[] {
    return [...this.presences.keys()].sort();
  }
}
