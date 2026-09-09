import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CharacterWorldState, SimulationClock } from '@prisma/client';
import {
  WORLD_INTERACTION_OBJECTS,
  type SimulationClockPayload,
  type WorldEntity,
  type WorldInteractionObjectId,
} from '@city/game-protocol';
import type { AppConfig } from '../core/config';
import { PrismaService } from '../persistence/prisma.service';
import { ApplicationError } from '../shared/application-error';
import {
  SIMULATION_TIME_SOURCE,
  type SimulationTimeSource,
} from './simulation-time';

const CLOCK_ID = 'world';
export const ENERGY_MIN = 0;
export const ENERGY_MAX = 100;
export const ENERGY_DECAY_PER_SIMULATION_HOUR = 5;
export const MONEY_MIN = 0;
export const MONEY_START = 0;

interface ClockAnchor {
  simulatedAt: Date;
  realAt: Date;
  speed: number;
}

type StoredSimulationState = CharacterWorldState & {
  character: { name: string };
};

export function deriveSimulationTime(anchor: ClockAnchor, realNow: Date): Date {
  const elapsedRealMilliseconds = Math.max(
    0,
    realNow.getTime() - anchor.realAt.getTime(),
  );
  return new Date(
    anchor.simulatedAt.getTime() + elapsedRealMilliseconds * anchor.speed,
  );
}

export function energyAt(
  energy: number,
  energyUpdatedAt: Date,
  simulatedNow: Date,
): number {
  const elapsedHours =
    Math.max(0, simulatedNow.getTime() - energyUpdatedAt.getTime()) / 3_600_000;
  return Math.max(
    ENERGY_MIN,
    Math.min(
      ENERGY_MAX,
      energy - elapsedHours * ENERGY_DECAY_PER_SIMULATION_HOUR,
    ),
  );
}

@Injectable()
export class SimulationService implements OnModuleInit {
  private anchor: ClockAnchor | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(SIMULATION_TIME_SOURCE)
    private readonly time: SimulationTimeSource,
  ) {}

  async onModuleInit(): Promise<void> {
    const realNow = this.time.now();
    const configuredSpeed = this.config.get('SIMULATION_SPEED', {
      infer: true,
    });
    const existing = await this.prisma.simulationClock.findUnique({
      where: { id: CLOCK_ID },
    });

    let clock: SimulationClock;
    if (!existing) {
      clock = await this.prisma.simulationClock.create({
        data: {
          id: CLOCK_ID,
          simulatedAt: realNow,
          realAt: realNow,
          speed: configuredSpeed,
        },
      });
    } else if (existing.speed !== configuredSpeed) {
      clock = await this.prisma.simulationClock.update({
        where: { id: CLOCK_ID },
        data: {
          simulatedAt: deriveSimulationTime(existing, realNow),
          realAt: realNow,
          speed: configuredSpeed,
        },
      });
    } else {
      clock = existing;
    }

    this.anchor = {
      simulatedAt: clock.simulatedAt,
      realAt: clock.realAt,
      speed: clock.speed,
    };
  }

  clockSnapshot(): SimulationClockPayload {
    if (!this.anchor) {
      throw new Error('Simulation clock has not been initialized');
    }
    return {
      simulatedTime: deriveSimulationTime(
        this.anchor,
        this.time.now(),
      ).toISOString(),
      speed: this.anchor.speed,
    };
  }

  async entitiesInZone(zoneId: string): Promise<WorldEntity[]> {
    const states = await this.prisma.characterWorldState.findMany({
      where: { zoneId },
      orderBy: { characterId: 'asc' },
      include: { character: { select: { name: true } } },
    });
    return Promise.all(states.map((state) => this.projectState(state)));
  }

  async entity(characterId: string): Promise<WorldEntity> {
    const state = await this.prisma.characterWorldState.findUnique({
      where: { characterId },
      include: { character: { select: { name: true } } },
    });
    if (!state) {
      throw new ApplicationError(
        'WORLD_NOT_ENTERED',
        409,
        'Enter the world before interacting',
      );
    }
    return this.projectState(state);
  }

  async tick(characterIds: readonly string[]): Promise<{
    clock: SimulationClockPayload;
    entities: WorldEntity[];
  }> {
    const uniqueIds = [...new Set(characterIds)];
    return {
      clock: this.clockSnapshot(),
      entities: await Promise.all(uniqueIds.map((id) => this.entity(id))),
    };
  }

  async startInteraction(
    characterId: string,
    objectId: WorldInteractionObjectId,
  ): Promise<WorldEntity> {
    const object = WORLD_INTERACTION_OBJECTS.find(
      (candidate) => candidate.id === objectId,
    );
    if (!object) {
      throw new ApplicationError(
        'INTERACTION_OBJECT_NOT_FOUND',
        404,
        'Interaction object not found',
      );
    }

    await this.materializeCompletedInteraction(characterId);
    const simulatedNow = new Date(this.clockSnapshot().simulatedTime);
    const state = await this.prisma.characterWorldState.findUnique({
      where: { characterId },
    });
    if (!state) {
      throw new ApplicationError(
        'WORLD_NOT_ENTERED',
        409,
        'Enter the world before interacting',
      );
    }
    if (state.interactionObjectId) {
      throw new ApplicationError(
        'INTERACTION_ALREADY_ACTIVE',
        409,
        'An interaction is already active',
      );
    }

    const distance = Math.hypot(state.x - object.x, state.y - object.y);
    if (distance > object.interactionRange) {
      throw new ApplicationError(
        'INTERACTION_OUT_OF_RANGE',
        409,
        'Move closer to the bench before resting',
      );
    }

    const currentEnergy = energyAt(
      state.energy,
      state.energyUpdatedAt,
      simulatedNow,
    );
    const endsAt = new Date(
      simulatedNow.getTime() + object.durationSimulationSeconds * 1000,
    );
    const result = await this.prisma.characterWorldState.updateMany({
      where: { characterId, interactionObjectId: null },
      data: {
        energy: currentEnergy,
        energyUpdatedAt: simulatedNow,
        interactionObjectId: object.id,
        interactionStartedAt: simulatedNow,
        interactionEndsAt: endsAt,
      },
    });
    if (result.count !== 1) {
      throw new ApplicationError(
        'INTERACTION_ALREADY_ACTIVE',
        409,
        'An interaction is already active',
      );
    }

    return this.entity(characterId);
  }

  async abortInteraction(characterId: string): Promise<void> {
    await this.prisma.characterWorldState.updateMany({
      where: { characterId, interactionObjectId: { not: null } },
      data: {
        interactionObjectId: null,
        interactionStartedAt: null,
        interactionEndsAt: null,
      },
    });
  }

  private async projectState(
    initial: StoredSimulationState,
  ): Promise<WorldEntity> {
    const state = await this.materializeCompletedInteraction(
      initial.characterId,
      initial,
    );
    const simulatedNow = new Date(this.clockSnapshot().simulatedTime);
    const currentEnergy = energyAt(
      state.energy,
      state.energyUpdatedAt,
      simulatedNow,
    );

    let interaction = null;
    if (
      state.interactionObjectId === 'bench-south' &&
      state.interactionStartedAt &&
      state.interactionEndsAt
    ) {
      const duration =
        state.interactionEndsAt.getTime() -
        state.interactionStartedAt.getTime();
      interaction = {
        objectId: state.interactionObjectId,
        startedAt: state.interactionStartedAt.toISOString(),
        endsAt: state.interactionEndsAt.toISOString(),
        progress: Math.max(
          0,
          Math.min(
            1,
            (simulatedNow.getTime() - state.interactionStartedAt.getTime()) /
              duration,
          ),
        ),
      } as const;
    }

    return {
      characterId: state.characterId,
      name: state.character.name,
      x: state.x,
      y: state.y,
      energy: currentEnergy,
      money: Math.max(MONEY_MIN, state.money),
      interaction,
    };
  }

  private async materializeCompletedInteraction(
    characterId: string,
    knownState?: StoredSimulationState,
  ): Promise<StoredSimulationState> {
    let state =
      knownState ??
      (await this.prisma.characterWorldState.findUnique({
        where: { characterId },
        include: { character: { select: { name: true } } },
      }));
    if (!state) {
      throw new ApplicationError(
        'WORLD_NOT_ENTERED',
        409,
        'Enter the world before interacting',
      );
    }

    const simulatedNow = new Date(this.clockSnapshot().simulatedTime);
    if (
      !state.interactionObjectId ||
      !state.interactionEndsAt ||
      state.interactionEndsAt > simulatedNow
    ) {
      return state;
    }

    const interactionObjectId = state.interactionObjectId;
    const object = WORLD_INTERACTION_OBJECTS.find(
      (candidate) => candidate.id === interactionObjectId,
    );
    const energyAtCompletion = energyAt(
      state.energy,
      state.energyUpdatedAt,
      state.interactionEndsAt,
    );
    const completedEnergy = Math.min(
      ENERGY_MAX,
      energyAtCompletion + (object?.energyGain ?? 0),
    );
    const currentEnergy = energyAt(
      completedEnergy,
      state.interactionEndsAt,
      simulatedNow,
    );

    await this.prisma.characterWorldState.updateMany({
      where: {
        characterId,
        interactionObjectId: state.interactionObjectId,
        interactionEndsAt: state.interactionEndsAt,
      },
      data: {
        energy: currentEnergy,
        energyUpdatedAt: simulatedNow,
        interactionObjectId: null,
        interactionStartedAt: null,
        interactionEndsAt: null,
      },
    });
    state = await this.prisma.characterWorldState.findUniqueOrThrow({
      where: { characterId },
      include: { character: { select: { name: true } } },
    });
    return state;
  }
}
