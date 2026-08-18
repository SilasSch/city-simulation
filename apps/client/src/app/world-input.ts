import type { WorldDirection } from '@city/game-protocol';

/** Pure Tastaturabbildung; Wiederholungs-Events erzeugen keine Command-Flut. */
export function worldDirectionForKey(
  key: string,
  repeat = false,
): WorldDirection | null {
  if (repeat) return null;

  switch (key.toLowerCase()) {
    case 'w':
    case 'arrowup':
      return 'N';
    case 'd':
    case 'arrowright':
      return 'E';
    case 's':
    case 'arrowdown':
      return 'S';
    case 'a':
    case 'arrowleft':
      return 'W';
    default:
      return null;
  }
}
