-- WhatsAtendende: acerto ao trazer o código do WhatsUnivida.
--
-- Aqui, 20261104120000_add_sequential_seq_columns rodou quando o sistema tinha menos tabelas (a versão desta
-- instalação, já aplicada em produção, fica como está). As tabelas criadas pelas migrações que vieram depois do
-- WhatsUnivida — algumas com data anterior a ela — ficaram sem o número sequencial (seq) que todas têm.
-- "IF NOT EXISTS": não faz nada onde a coluna/índice já existir.
-- AlterTable
ALTER TABLE "AgentStatusLog" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "AnnouncementDelivery" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "AnnouncementReaction" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "AnnouncementReceipt" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "AutoMessageBlockLog" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "AutoMessageTemplate" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "BirthdayGreeting" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "BirthdayMessage" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "BoletoInstruction" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "BoletoLayout" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatDeliveryMark" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatMember" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatMessageEdit" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatMessageView" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatPin" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatPoll" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatPollOption" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatPollVote" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatReaction" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatReadMark" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ChatRoom" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ClosingMessage" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ColumnView" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ContactNameChange" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ConversationNote" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ConversationReminder" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "DataSource" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "DataSourceRow" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Flow" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "FlowConnection" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "FlowEdge" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "FlowNode" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "FlowSession" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "MetaConnection" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "PauseReason" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "PendingAutoMessage" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "PollVote" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "QueueWaitMessage" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ReleaseNoteVersion" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ReportSchedule" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ReportScheduleRun" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "SatisfactionQuestion" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "SatisfactionSurvey" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "SatisfactionSurveyConfig" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "ScheduledMessage" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "WorkSchedule" ADD COLUMN IF NOT EXISTS "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentStatusLog_seq_key" ON "AgentStatusLog"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Announcement_seq_key" ON "Announcement"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementDelivery_seq_key" ON "AnnouncementDelivery"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementReaction_seq_key" ON "AnnouncementReaction"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AnnouncementReceipt_seq_key" ON "AnnouncementReceipt"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AutoMessageBlockLog_seq_key" ON "AutoMessageBlockLog"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AutoMessageTemplate_seq_key" ON "AutoMessageTemplate"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BirthdayGreeting_seq_key" ON "BirthdayGreeting"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BirthdayMessage_seq_key" ON "BirthdayMessage"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BoletoInstruction_seq_key" ON "BoletoInstruction"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BoletoLayout_seq_key" ON "BoletoLayout"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatDeliveryMark_seq_key" ON "ChatDeliveryMark"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMember_seq_key" ON "ChatMember"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessage_seq_key" ON "ChatMessage"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessageEdit_seq_key" ON "ChatMessageEdit"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessageView_seq_key" ON "ChatMessageView"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatPin_seq_key" ON "ChatPin"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatPoll_seq_key" ON "ChatPoll"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatPollOption_seq_key" ON "ChatPollOption"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatPollVote_seq_key" ON "ChatPollVote"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatReaction_seq_key" ON "ChatReaction"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatReadMark_seq_key" ON "ChatReadMark"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChatRoom_seq_key" ON "ChatRoom"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClosingMessage_seq_key" ON "ClosingMessage"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ColumnView_seq_key" ON "ColumnView"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ContactNameChange_seq_key" ON "ContactNameChange"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationNote_seq_key" ON "ConversationNote"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationReminder_seq_key" ON "ConversationReminder"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DataSource_seq_key" ON "DataSource"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DataSourceRow_seq_key" ON "DataSourceRow"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Flow_seq_key" ON "Flow"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FlowConnection_seq_key" ON "FlowConnection"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FlowEdge_seq_key" ON "FlowEdge"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FlowNode_seq_key" ON "FlowNode"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "FlowSession_seq_key" ON "FlowSession"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Goal_seq_key" ON "Goal"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MessageTemplate_seq_key" ON "MessageTemplate"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MetaConnection_seq_key" ON "MetaConnection"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PauseReason_seq_key" ON "PauseReason"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PendingAutoMessage_seq_key" ON "PendingAutoMessage"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PollVote_seq_key" ON "PollVote"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "QueueWaitMessage_seq_key" ON "QueueWaitMessage"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReleaseNoteVersion_seq_key" ON "ReleaseNoteVersion"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReportSchedule_seq_key" ON "ReportSchedule"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReportScheduleRun_seq_key" ON "ReportScheduleRun"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SatisfactionQuestion_seq_key" ON "SatisfactionQuestion"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SatisfactionSurvey_seq_key" ON "SatisfactionSurvey"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SatisfactionSurveyConfig_seq_key" ON "SatisfactionSurveyConfig"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledMessage_seq_key" ON "ScheduledMessage"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_seq_key" ON "Tag"("seq");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkSchedule_seq_key" ON "WorkSchedule"("seq");

