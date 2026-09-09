-- Persistent character currency for the first economy loop (v0.5).
ALTER TABLE "CharacterWorldState"
ADD COLUMN "money" INTEGER NOT NULL DEFAULT 0;
