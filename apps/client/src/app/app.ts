import { Component, OnInit, effect, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { AuthViewComponent } from './auth-view.component';
import { CharacterService } from './character.service';
import { CharacterViewComponent } from './character-view.component';
import { GameHostComponent } from './game-host.component';
import { RealtimeService } from './realtime.service';
import { StatusViewComponent } from './status-view.component';

@Component({
  imports: [
    StatusViewComponent,
    AuthViewComponent,
    CharacterViewComponent,
    GameHostComponent,
  ],
  selector: 'app-root',
  template: `
    <main>
      <h1>City Simulation</h1>
      <app-status-view />
      @if (auth.state() === 'unknown') {
        <p data-testid="session-loading">Session wird geprüft…</p>
      } @else {
        <app-auth-view />
        @if (auth.state() === 'authenticated') {
          <app-character-view />
        }
      }
      <app-game-host />
    </main>
  `,
})
export class App implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly characters = inject(CharacterService);

  constructor() {
    // WebSocket nur mit gültiger Session: der Server lehnt den Handshake
    // ohne Session-Cookie ab (ADR 0007). Bei Logout wird getrennt und der
    // lokale Character-Zustand aufgeräumt.
    effect(() => {
      if (this.auth.state() === 'authenticated') {
        this.realtime.connect('angular-client');
      } else {
        this.realtime.disconnect();
        this.characters.clear();
      }
    });
  }

  ngOnInit(): void {
    this.auth.refreshSession();
  }
}
