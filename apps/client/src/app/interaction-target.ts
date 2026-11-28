import {
  NPC_INTERACTION_RANGE,
  worldInteractionObjectsIn,
  worldZonePortalsIn,
} from '@city/game-protocol';
import type {
  WorldEntity,
  WorldInteractionObject,
  WorldInteractionObjectId,
  WorldPoint,
  WorldZoneId,
  WorldZonePortalId,
} from '@city/game-protocol';

/** Ziel einer Interaktion per `E` oder Klick, samt Aktionslabel. */
export type InteractionTarget =
  | {
      readonly kind: 'object';
      readonly id: WorldInteractionObjectId;
      readonly label: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: 'npc';
      readonly id: string;
      readonly label: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: 'portal';
      readonly id: WorldZonePortalId;
      readonly label: string;
      readonly x: number;
      readonly y: number;
    };

function objectLabel(object: WorldInteractionObject): string {
  switch (object.id) {
    case 'bench-south':
      return 'E – Ausruhen';
    case 'kiosk-north':
      return `E – Arbeiten (+${object.moneyGain})`;
    case 'snack-east':
      return `E – Snack (−${object.price})`;
    case 'stall-north':
      return `E – Am Stand helfen (+${object.moneyGain})`;
    case 'street-food-east':
      return `E – Straßenessen (−${object.price})`;
  }
}

/**
 * Nächstes Interaktionsziel in Reichweite: Objekte und Portale der Zone sowie
 * NPCs. Die Reichweite prüft der Server erneut; hier geht es nur um Anzeige
 * und Auswahl.
 */
export function nearestInteraction(
  self: WorldPoint,
  zoneId: WorldZoneId,
  entities: readonly WorldEntity[],
): InteractionTarget | null {
  let best: InteractionTarget | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (target: InteractionTarget, range: number): void => {
    const distance = Math.hypot(self.x - target.x, self.y - target.y);
    if (distance <= range && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  };

  for (const object of worldInteractionObjectsIn(zoneId)) {
    consider(
      {
        kind: 'object',
        id: object.id,
        label: objectLabel(object),
        x: object.x,
        y: object.y,
      },
      object.interactionRange,
    );
  }
  for (const portal of worldZonePortalsIn(zoneId)) {
    consider(
      {
        kind: 'portal',
        id: portal.id,
        label: `E – ${portal.label}`,
        x: portal.x,
        y: portal.y,
      },
      portal.interactionRange,
    );
  }
  for (const entity of entities) {
    if (entity.kind !== 'npc') continue;
    consider(
      {
        kind: 'npc',
        id: entity.characterId,
        label: 'E – Sprechen',
        x: entity.x,
        y: entity.y,
      },
      NPC_INTERACTION_RANGE,
    );
  }
  return best;
}
