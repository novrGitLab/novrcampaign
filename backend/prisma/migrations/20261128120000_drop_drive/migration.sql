-- DropTables
-- Removes the abandoned "Encrypted file drive" feature. The tables are empty
-- (feature never shipped); children are dropped before parents. CASCADE clears
-- any dependent constraints defensively.
DROP TABLE IF EXISTS "DriveFileChunk" CASCADE;
DROP TABLE IF EXISTS "DriveFile" CASCADE;
DROP TABLE IF EXISTS "DriveSession" CASCADE;
DROP TABLE IF EXISTS "DriveAuditLog" CASCADE;
DROP TABLE IF EXISTS "DriveUser" CASCADE;
