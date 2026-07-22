import { Component } from '@angular/core';
import { GameHostComponent } from './game-host.component';
import { StatusViewComponent } from './status-view.component';

@Component({
  imports: [StatusViewComponent, GameHostComponent],
  selector: 'app-root',
  template: `
    <main>
      <h1>City Simulation</h1>
      <app-status-view />
      <app-game-host />
    </main>
  `,
})
export class App {}
