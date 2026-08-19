-- Persistent world clock: simulated time is derived from these anchors and
-- therefore continues deterministically while the server is offline.
CREATE TABLE "SimulationClock" (
    "id" TEXT NOT NULL,
    "simulatedAt" TIMESTAMP(3) NOT NULL,
    "realAt" TIMESTAMP(3) NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SimulationClock_pkey" PRIMARY KEY ("id")
);

-- First persistent need and the currently active object interaction.
ALTER TABLE "CharacterWorldState"
ADD COLUMN "energy" DOUBLE PRECISION NOT NULL DEFAULT 100,
ADD COLUMN "energyUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "interactionObjectId" TEXT,
ADD COLUMN "interactionStartedAt" TIMESTAMP(3),
ADD COLUMN "interactionEndsAt" TIMESTAMP(3);

CREATE INDEX "CharacterWorldState_interactionEndsAt_idx"
ON "CharacterWorldState"("interactionEndsAt");
