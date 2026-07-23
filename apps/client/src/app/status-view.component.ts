import { Component, OnInit, inject, signal } from '@angular/core';
import { HealthResponseDto } from '@city/shared-types';
import { ApiService } from './api.service';
import { RealtimeService } from './realtime.service';

/**
 * Technische Statusansicht: REST-Health, WebSocket-Status und letzte
 * Protokollmeldung. Keine Geschäftslogik — nur Anzeige von Service-Zuständen.
 */
@Component({
  selector: 'app-status-view',
  template: `
    <section class="status-card">
      <h2>Technischer Status</h2>
      <dl>
        <dt>REST-Health</dt>
        <dd data-testid="rest-health">{{ restHealthText() }}</dd>
        <dt>WebSocket</dt>
        <dd data-testid="ws-state">{{ realtime.connectionState() }}</dd>
        <dt>Connection-ID</dt>
        <dd>{{ realtime.connectionId() ?? '—' }}</dd>
        <dt>Letzte Protokollmeldung</dt>
        <dd data-testid="last-message">
          {{ realtime.lastMessageType() ?? '—' }}
        </dd>
        @if (realtime.protocolError(); as error) {
          <dt>Protokollfehler</dt>
          <dd data-testid="protocol-error" class="error">
            {{ error.code }} (unterstützt: {{ error.supportedVersion }},
            empfangen: {{ error.receivedVersion }})
          </dd>
        }
      </dl>
    </section>
  `,
})
export class StatusViewComponent implements OnInit {
  protected readonly realtime = inject(RealtimeService);
  protected readonly restHealth = signal<HealthResponseDto | null>(null);
  protected readonly restFailed = signal(false);

  private readonly api = inject(ApiService);

  ngOnInit(): void {
    this.api.getHealth().subscribe({
      next: (health) => this.restHealth.set(health),
      error: () => this.restFailed.set(true),
    });
    // Der WebSocket-Aufbau wird seit ADR 0007 zentral in der App-Komponente
    // gesteuert: erst nach erfolgreicher Session-Prüfung.
  }

  protected restHealthText(): string {
    if (this.restFailed()) return 'nicht erreichbar';
    const health = this.restHealth();
    if (!health) return 'lädt…';
    return `${health.status} (Datenbank: ${health.database})`;
  }
}
