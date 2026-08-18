-- Persistente Position des ausgewählten Characters in der statischen Zone.
CREATE TABLE "CharacterWorldState" (
    "characterId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterWorldState_pkey" PRIMARY KEY ("characterId"),
    CONSTRAINT "CharacterWorldState_x_bounds" CHECK ("x" BETWEEN 0 AND 100),
    CONSTRAINT "CharacterWorldState_y_bounds" CHECK ("y" BETWEEN 0 AND 100),
    CONSTRAINT "CharacterWorldState_revision_nonnegative" CHECK ("revision" >= 0)
);

CREATE INDEX "CharacterWorldState_zoneId_idx" ON "CharacterWorldState"("zoneId");

ALTER TABLE "CharacterWorldState"
ADD CONSTRAINT "CharacterWorldState_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
