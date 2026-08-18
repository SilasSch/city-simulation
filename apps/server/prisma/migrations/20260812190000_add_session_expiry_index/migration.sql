-- Expired-session cleanup filters exclusively by this timestamp.
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
