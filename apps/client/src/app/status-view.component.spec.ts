import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach } from 'vitest';
import { HealthResponseDto } from '@city/shared-types';
import { ApiService } from './api.service';
import { RealtimeService } from './realtime.service';
import { StatusViewComponent } from './status-view.component';

const HEALTH_OK: HealthResponseDto = {
  status: 'ok',
  server: 'up',
  database: 'up',
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('StatusViewComponent', () => {
  let fixture: ComponentFixture<StatusViewComponent>;

  beforeEach(async () => {
    const realtimeStub = {
      connectionState: signal('connected'),
      connectionId: signal('conn-1'),
      protocolError: signal(null),
      connectionDetail: signal(null),
      lastMessageType: signal('connection-established'),
    };

    await TestBed.configureTestingModule({
      imports: [StatusViewComponent],
      providers: [
        { provide: ApiService, useValue: { getHealth: () => of(HEALTH_OK) } },
        { provide: RealtimeService, useValue: realtimeStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusViewComponent);
    fixture.detectChanges();
  });

  it('shows the REST health status', () => {
    const el: HTMLElement = fixture.nativeElement;
    const health = el.querySelector('[data-testid="rest-health"]');
    expect(health?.textContent).toContain('ok');
    expect(health?.textContent).toContain('up');
  });

  it('shows the websocket connection state', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="ws-state"]')?.textContent).toContain(
      'Verbunden',
    );
    expect(
      el.querySelector('[data-testid="last-message"]')?.textContent,
    ).toContain('connection-established');
  });
});
