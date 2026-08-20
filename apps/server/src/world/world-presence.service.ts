import { Injectable } from '@nestjs/common';
import type { WorldEntity } from '@city/game-protocol';

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
 */
@Injectable()
export class WorldPresenceService {
  private readonly presences = new Map<string, CharacterPresence>();
  private readonly characterBySocket = new Map<string, string>();

  enter(socketId: string, entity: WorldEntity): boolean {
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
    const presence = this.presences.get(entity.characterId);
    if (presence) presence.entity = entity;
  }

  entities(): WorldEntity[] {
    return [...this.presences.values()]
      .map(({ entity }) => entity)
      .sort((left, right) => left.characterId.localeCompare(right.characterId));
  }
}
