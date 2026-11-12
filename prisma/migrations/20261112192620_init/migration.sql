-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUBMITTED', 'TRIAGING', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'TRIAGE_FAILED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "Request" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requesterEmail" TEXT,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "category" TEXT,
    "priority" "Priority",
    "team" TEXT,
    "proposal" JSONB,
    "proposalModel" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Request_status_createdAt_idx" ON "Request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Request_requesterId_createdAt_idx" ON "Request"("requesterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Request_requesterId_idempotencyKey_key" ON "Request"("requesterId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditEvent_requestId_createdAt_idx" ON "AuditEvent"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
