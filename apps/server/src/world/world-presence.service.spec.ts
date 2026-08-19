import { describe, expect, it } from 'vitest';
import type { WorldEntity } from '@city/game-protocol';
import { WorldPresenceService } from './world-presence.service';

const AYLA: WorldEntity = {
  characterId: '11111111-1111-4111-8111-111111111111',
  name: 'Ayla',
  x: 50,
  y: 70,
  energy: 90,
  interaction: null,
};

describe('WorldPresenceService', () => {
  it('keeps one entity for multiple sockets and leaves after the last socket', () => {
    const presence = new WorldPresenceService();

    expect(presence.enter('socket-a', AYLA)).toBe(true);
    expect(presence.enter('socket-b', AYLA)).toBe(false);
    expect(presence.entities()).toEqual([AYLA]);

    expect(presence.leave('socket-a')).toEqual({
      characterId: AYLA.characterId,
      lastSocket: false,
    });
    expect(presence.entities()).toEqual([AYLA]);

    expect(presence.leave('socket-b')).toEqual({
      characterId: AYLA.characterId,
      lastSocket: true,
    });
    expect(presence.entities()).toEqual([]);
  });

  it('updates the confirmed entity used by later snapshots', () => {
    const presence = new WorldPresenceService();
    presence.enter('socket-a', AYLA);

    presence.update({ ...AYLA, x: 55 });

    expect(presence.entities()).toEqual([{ ...AYLA, x: 55 }]);
  });
});
