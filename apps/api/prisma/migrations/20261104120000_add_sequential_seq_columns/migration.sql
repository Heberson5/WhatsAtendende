-- Hybrid IDs: every table keeps its UUID "id" primary key (used by the API,
-- URLs and all foreign keys) and gains a human-friendly sequential "seq"
-- column (1, 2, 3...) just for looking rows up by hand, e.g.:
--   SELECT * FROM "Conversation" WHERE seq = 152;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "PasswordResetToken" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "WhatsAppConnection" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ManagerConnectionAccess" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "QuickReply" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ConversationAssignment" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ConversationTransfer" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ConversationEvent" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "MessageAttachment" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "MessageReaction" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "RolePermission" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Holiday" ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "HolidaySyncCursor" ADD COLUMN     "seq" SERIAL NOT NULL;

-- Backfill: ADD COLUMN ... SERIAL numbers existing rows in arbitrary
-- (physical) order. Renumber them chronologically instead, so seq 1 is the
-- oldest record of each table, then point each sequence right after the
-- highest value so new rows continue from there. Runs before the unique
-- indexes below are created, so the renumbering can't collide midway.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      ('User', 'createdAt'),
      ('PasswordResetToken', 'createdAt'),
      ('RefreshToken', 'createdAt'),
      ('WhatsAppConnection', 'createdAt'),
      ('ManagerConnectionAccess', 'createdAt'),
      ('QuickReply', 'createdAt'),
      ('Contact', 'firstConversationAt'),
      ('Conversation', 'createdAt'),
      ('ConversationAssignment', 'createdAt'),
      ('ConversationTransfer', 'createdAt'),
      ('ConversationEvent', 'createdAt'),
      ('Message', 'createdAt'),
      ('MessageAttachment', 'createdAt'),
      ('MessageReaction', 'createdAt'),
      ('AuditLog', 'createdAt'),
      ('Notification', 'createdAt'),
      ('RolePermission', 'updatedAt'),
      ('Holiday', 'createdAt'),
      ('HolidaySyncCursor', 'syncedAt')
    ) AS v(tbl, ord)
  LOOP
    EXECUTE format(
      'UPDATE %1$I AS x SET seq = r.rn
         FROM (SELECT id, row_number() OVER (ORDER BY %2$I, id) AS rn FROM %1$I) AS r
        WHERE x.id = r.id',
      t.tbl, t.ord);
    EXECUTE format(
      'SELECT setval(pg_get_serial_sequence(%1$L, ''seq''), COALESCE((SELECT max(seq) FROM %2$I), 0) + 1, false)',
      format('%I', t.tbl), t.tbl);
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "User_seq_key" ON "User"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_seq_key" ON "PasswordResetToken"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_seq_key" ON "RefreshToken"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_seq_key" ON "WhatsAppConnection"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerConnectionAccess_seq_key" ON "ManagerConnectionAccess"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_seq_key" ON "QuickReply"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_seq_key" ON "Contact"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_seq_key" ON "Conversation"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationAssignment_seq_key" ON "ConversationAssignment"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTransfer_seq_key" ON "ConversationTransfer"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationEvent_seq_key" ON "ConversationEvent"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Message_seq_key" ON "Message"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "MessageAttachment_seq_key" ON "MessageAttachment"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_seq_key" ON "MessageReaction"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_seq_key" ON "Notification"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_seq_key" ON "RolePermission"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_seq_key" ON "Holiday"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "HolidaySyncCursor_seq_key" ON "HolidaySyncCursor"("seq");


