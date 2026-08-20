import type { WorldDirection } from '@city/game-protocol';

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
