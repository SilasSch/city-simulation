import { describe, expect, it } from 'vitest';
import {
  ENERGY_DECAY_PER_SIMULATION_HOUR,
  deriveSimulationTime,
  energyAt,
} from './simulation.service';

describe('simulation calculations', () => {
  it('derives restart-safe simulation time from the persisted anchors', () => {
    const simulatedAt = new Date('2035-01-01T08:00:00.000Z');
    const realAt = new Date('2026-01-01T10:00:00.000Z');

    expect(
      deriveSimulationTime(
        { simulatedAt, realAt, speed: 60 },
        new Date('2026-01-01T10:02:00.000Z'),
      ).toISOString(),
    ).toBe('2035-01-01T10:00:00.000Z');
  });

  it('never runs backwards when the host clock moves behind the anchor', () => {
    const anchor = {
      simulatedAt: new Date('2035-01-01T08:00:00.000Z'),
      realAt: new Date('2026-01-01T10:00:00.000Z'),
      speed: 60,
    };

    expect(
      deriveSimulationTime(
        anchor,
        new Date('2026-01-01T09:59:00.000Z'),
      ).toISOString(),
    ).toBe(anchor.simulatedAt.toISOString());
  });

  it('decays energy deterministically and clamps it to its bounds', () => {
    const updatedAt = new Date('2035-01-01T08:00:00.000Z');
    expect(energyAt(100, updatedAt, new Date('2035-01-01T09:00:00.000Z'))).toBe(
      100 - ENERGY_DECAY_PER_SIMULATION_HOUR,
    );
    expect(energyAt(2, updatedAt, new Date('2035-01-03T08:00:00.000Z'))).toBe(
      0,
    );
    expect(energyAt(150, updatedAt, updatedAt)).toBe(100);
  });
});
