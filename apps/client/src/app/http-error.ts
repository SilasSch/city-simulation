import { HttpErrorResponse } from '@angular/common/http';

/**
 * Liest den stabilen maschinenlesbaren Fehlercode aus einer
 * Server-Fehlerantwort (Struktur des globalen Exception-Filters).
 */
export function extractErrorCode(error: unknown): string | null {
  if (error instanceof HttpErrorResponse) {
    const body: unknown = error.error;
    if (
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof (body as { code: unknown }).code === 'string'
    ) {
      return (body as { code: string }).code;
    }
  }
  return null;
}
