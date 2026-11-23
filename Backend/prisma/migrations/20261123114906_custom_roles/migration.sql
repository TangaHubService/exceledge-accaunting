-- CreateTable
CREATE TABLE "custom_roles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capabilities" TEXT[],
    "erpRole" TEXT NOT NULL DEFAULT 'ACCOUNTANT',
    "createdByErpUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "erpUserId" INTEGER NOT NULL,
    "customRoleId" TEXT NOT NULL,
    "assignedByErpUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_role_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "customRoleId" TEXT NOT NULL,
    "createdByErpUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_firms" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "firmName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedByErpUserId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_firms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_roles_companyId_name_key" ON "custom_roles"("companyId", "name");

-- CreateIndex
CREATE INDEX "user_role_assignments_customRoleId_idx" ON "user_role_assignments"("customRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_assignments_companyId_erpUserId_key" ON "user_role_assignments"("companyId", "erpUserId");

-- CreateIndex
CREATE UNIQUE INDEX "invite_role_assignments_companyId_email_key" ON "invite_role_assignments"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_firms_companyId_email_key" ON "accounting_firms"("companyId", "email");

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_role_assignments" ADD CONSTRAINT "invite_role_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_role_assignments" ADD CONSTRAINT "invite_role_assignments_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_firms" ADD CONSTRAINT "accounting_firms_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

