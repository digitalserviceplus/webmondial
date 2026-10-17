ALTER TABLE "UserSettings" ALTER COLUMN "theme" SET DEFAULT 'dark';

UPDATE "UserSettings" SET "theme" = 'dark' WHERE "theme" = 'system';
