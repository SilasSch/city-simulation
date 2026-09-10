import { worldRoomName, type WorldZoneId } from '@city/game-protocol';

/** Socket.IO-Raumname für eine Zone (`zone:<id>`). */
export function worldRoom(zoneId: WorldZoneId): string {
  return worldRoomName(zoneId);
}

/** Serververwalteter Weltkontext einer authentifizierten Socket-Verbindung. */
export interface EnteredWorldContext {
  characterId: string;
  zoneId: WorldZoneId;
}
