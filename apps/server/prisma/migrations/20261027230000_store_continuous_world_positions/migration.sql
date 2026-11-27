-- Continuous movement (v0.10, ADR 0015): world positions are no longer
-- restricted to the 5-unit step grid.
ALTER TABLE "CharacterWorldState"
ALTER COLUMN "x" SET DATA TYPE DOUBLE PRECISION,
ALTER COLUMN "y" SET DATA TYPE DOUBLE PRECISION;
