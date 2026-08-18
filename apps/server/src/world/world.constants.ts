import { WORLD_ZONE_ID } from '@city/game-protocol';

/** Socket.IO-Raum der einzigen statischen Zone dieses Vertical Slices. */
export const WORLD_ROOM = `zone:${WORLD_ZONE_ID}`;

/** Serververwalteter Weltkontext einer authentifizierten Socket-Verbindung. */
export interface EnteredWorldContext {
  characterId: string;
  zoneId: typeof WORLD_ZONE_ID;
}
