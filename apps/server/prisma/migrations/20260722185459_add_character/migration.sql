/*
  Warnings:

  - A unique constraint covering the columns `[selectedCharacterId,id]` on the table `PlayerProfile` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "PlayerProfile" ADD COLUMN     "selectedCharacterId" TEXT;

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "playerProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Character_playerProfileId_idx" ON "Character"("playerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_id_playerProfileId_key" ON "Character"("id", "playerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_selectedCharacterId_id_key" ON "PlayerProfile"("selectedCharacterId", "id");

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_selectedCharacterId_id_fkey" FOREIGN KEY ("selectedCharacterId", "id") REFERENCES "Character"("id", "playerProfileId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
