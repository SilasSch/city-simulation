-- The composite owner constraint remains intact. Restrict avoids PostgreSQL
-- trying to null PlayerProfile.id; the delete use case clears the nullable
-- selectedCharacterId in the same transaction before deleting a selection.
ALTER TABLE "PlayerProfile"
DROP CONSTRAINT "PlayerProfile_selectedCharacterId_id_fkey";

ALTER TABLE "PlayerProfile"
ADD CONSTRAINT "PlayerProfile_selectedCharacterId_id_fkey"
FOREIGN KEY ("selectedCharacterId", "id")
REFERENCES "Character"("id", "playerProfileId")
ON DELETE RESTRICT
ON UPDATE CASCADE;
