import { clampWorldInput, type WorldPoint } from '@city/game-protocol';

/** Prüft, ob ein Event-Target oder der aktive Fokus ein editierbares Formularelement ist. */
export function isEditableTarget(
  target: EventTarget | null,
  activeElement: Element | null = typeof document !== 'undefined'
    ? document.activeElement
    : null,
): boolean {
  return isEditableElement(target) || isEditableElement(activeElement);
}

function isEditableElement(
  element: EventTarget | Element | null | undefined,
): boolean {
  if (!element || typeof element !== 'object') {
    return false;
  }

  if (
    'isContentEditable' in element &&
    Boolean((element as HTMLElement).isContentEditable)
  ) {
    return true;
  }

  if (
    'tagName' in element &&
    typeof (element as Element).tagName === 'string'
  ) {
    const tagName = (element as Element).tagName.toUpperCase();
    return (
      tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
    );
  }

  return false;
}

export type MovementKey = 'forward' | 'back' | 'left' | 'right';

/** Pure Tastaturabbildung von WASD und Pfeiltasten auf Bewegungsrichtungen. */
export function movementKeyFor(key: string): MovementKey | null {
  switch (key.toLowerCase()) {
    case 'w':
    case 'arrowup':
      return 'forward';
    case 's':
    case 'arrowdown':
      return 'back';
    case 'a':
    case 'arrowleft':
      return 'left';
    case 'd':
    case 'arrowright':
      return 'right';
    default:
      return null;
  }
}

/**
 * Übersetzt gehaltene Tasten in einen Richtungsvektor in logischen
 * Bodenkoordinaten, relativ zur Kamera: „vorwärts“ zeigt immer vom
 * Bildschirm weg. `azimuth` ist der Orbit-Winkel um die Hochachse (0 =
 * Kamera im Süden, Blick nach Norden).
 */
export function worldInputFromKeys(
  pressed: ReadonlySet<MovementKey>,
  azimuth: number,
): WorldPoint {
  const strafe = (pressed.has('right') ? 1 : 0) - (pressed.has('left') ? 1 : 0);
  const advance =
    (pressed.has('forward') ? 1 : 0) - (pressed.has('back') ? 1 : 0);
  if (strafe === 0 && advance === 0) return { x: 0, y: 0 };

  const sin = Math.sin(azimuth);
  const cos = Math.cos(azimuth);
  // Szene: x = logisch x, z = logisch y. Vorwärts = (-sin, -cos), rechts = (cos, -sin).
  return clampWorldInput({
    x: strafe * cos - advance * sin,
    y: -strafe * sin - advance * cos,
  });
}
