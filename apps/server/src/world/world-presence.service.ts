import { Injectable } from '@nestjs/common';
import {
  WORLD_ZONE_ID,
  mergeZoneNpcEntities,
  type WorldEntity,
  type WorldZoneId,
} from '@city/game-protocol';
import {
  createNpcPatrolRuntimes,
  tickNpcPatrols,
  type NpcPatrolRuntime,
} from './npc-patrol';

interface CharacterPresence {
  entity: WorldEntity;
  zoneId: WorldZoneId;
  socketIds: Set<string>;
}

export interface PresenceDeparture {
  characterId: string;
  zoneId: WorldZoneId;
  lastSocket: boolean;
}

/**
 * Prozesslokale Live-Presence für die einzelne Serverinstanz des aktuellen
 * Deployment-Milestones. Persistente Positionen bleiben im Repository; diese
 * Registry entscheidet nur, welche Characters in welcher Zone gerade sichtbar
 * sein sollen. Zonen-NPCs (derzeit nur central-square) sind session-stabil,
 * server-tick-bewegt und immer Teil der sichtbaren Entity-Liste ihrer Zone —
 * Clients können NPC-Positionen nicht setzen.
 */
@Injectable()
export class WorldPresenceService {
  private readonly presences = new Map<string, CharacterPresence>();
  private readonly characterBySocket = new Map<string, string>();
  private readonly npcRuntimes: Map<string, NpcPatrolRuntime> =
    createNpcPatrolRuntimes();

  enter(socketId: string, entity: WorldEntity, zoneId: WorldZoneId): boolean {
    if (entity.kind === 'npc') {
      return false;
    }
    const existing = this.presences.get(entity.characterId);
    if (existing) {
      existing.entity = entity;
      existing.zoneId = zoneId;
      existing.socketIds.add(socketId);
      this.characterBySocket.set(socketId, entity.characterId);
      return false;
    }

    this.presences.set(entity.characterId, {
      entity,
      zoneId,
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
    if (!presence) {
      return { characterId, zoneId: WORLD_ZONE_ID, lastSocket: true };
    }

    const zoneId = presence.zoneId;
    presence.socketIds.delete(socketId);
    if (presence.socketIds.size > 0) {
      return { characterId, zoneId, lastSocket: false };
    }

    this.presences.delete(characterId);
    return { characterId, zoneId, lastSocket: true };
  }

  update(entity: WorldEntity): void {
    // NPC positions are server-tick only — ignore client-origin updates.
    if (entity.kind === 'npc') return;
    const presence = this.presences.get(entity.characterId);
    if (presence) presence.entity = entity;
  }

  /** Last confirmed entity of a present character, or null if offline. */
  entity(characterId: string): WorldEntity | null {
    return this.presences.get(characterId)?.entity ?? null;
  }

  /** Zone of a present character, or null if offline. */
  zoneOf(characterId: string): WorldZoneId | null {
    return this.presences.get(characterId)?.zoneId ?? null;
  }

  /** Live NPC entity by characterId, or null if unknown. */
  npc(characterId: string): WorldEntity | null {
    return this.npcRuntimes.get(characterId)?.entity ?? null;
  }

  /**
   * Hält die Patrouille nach einem Gruß für `seconds` an. Unbekannte IDs
   * werden ignoriert.
   */
  pauseNpcInteract(characterId: string, seconds: number): void {
    const runtime = this.npcRuntimes.get(characterId);
    if (!runtime) return;
    this.npcRuntimes.set(characterId, {
      ...runtime,
      interactPauseSecondsRemaining: Math.max(0, seconds),
    });
  }

  /** Bewegt die Zonen-NPCs um `deltaSeconds`; liefert die bewegten Entities. */
  advanceNpcs(deltaSeconds: number): WorldEntity[] {
    return tickNpcPatrols(this.npcRuntimes, deltaSeconds);
  }

  /** Sichtbare Entities einer Zone inkl. live NPC-Positionen (nur central-square). */
  entities(zoneId: WorldZoneId): WorldEntity[] {
    const live = [...this.presences.values()]
      .filter((presence) => presence.zoneId === zoneId)
      .map(({ entity }) => entity);
    const npcs =
      zoneId === WORLD_ZONE_ID
        ? [...this.npcRuntimes.values()].map(({ entity }) => entity)
        : [];
    return mergeZoneNpcEntities(zoneId, [...live, ...npcs]);
  }

  /** Nur spielergebundene Presence-IDs (für Simulationsticks, alle Zonen). */
  characterIds(): string[] {
    return [...this.presences.keys()].sort();
  }
}
