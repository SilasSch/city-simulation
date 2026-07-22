import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { HealthResponseDto } from '@city/shared-types';
import { healthResponseSchema } from '@city/game-protocol';

/**
 * REST-Zugang zum Server. Antworten werden an der Systemgrenze mit Zod
 * validiert — TypeScript-Typen allein reichen nicht aus.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  getHealth(): Observable<HealthResponseDto> {
    return this.http
      .get<unknown>('/api/health')
      .pipe(map((raw) => healthResponseSchema.parse(raw)));
  }
}
