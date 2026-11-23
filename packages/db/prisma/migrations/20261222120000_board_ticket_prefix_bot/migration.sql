-- New boards number their tickets BOT-1, BOT-2 and so on. Existing boards keep their prefix.
ALTER TABLE "boards" ALTER COLUMN "ticketPrefix" SET DEFAULT 'BOT';
