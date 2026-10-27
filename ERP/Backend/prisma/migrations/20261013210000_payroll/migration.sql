-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollPaymentMethod" AS ENUM ('BANK', 'CASH', 'MOBILE_MONEY');

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "branchId" INTEGER,
    "employeeNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationalId" TEXT,
    "rssbNumber" TEXT,
    "jobTitle" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "hireDate" TIMESTAMP(3),
    "basicSalary" DECIMAL(15,2) NOT NULL,
    "housingAllowance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "transportAllowance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "otherAllowance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paymentMethod" "PayrollPaymentMethod" NOT NULL DEFAULT 'BANK',
    "bankName" TEXT,
    "bankAccount" TEXT,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "grossPay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "paye" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employeeRssb" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employerRssb" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "cbhi" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netPay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employerCost" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "rulesVersion" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "paidById" INTEGER,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" "PayrollPaymentMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" SERIAL NOT NULL,
    "payrollRunId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "basicSalary" DECIMAL(15,2) NOT NULL,
    "housingAllowance" DECIMAL(15,2) NOT NULL,
    "transportAllowance" DECIMAL(15,2) NOT NULL,
    "otherAllowance" DECIMAL(15,2) NOT NULL,
    "grossPay" DECIMAL(15,2) NOT NULL,
    "contributionBase" DECIMAL(15,2) NOT NULL,
    "paye" DECIMAL(15,2) NOT NULL,
    "employeePension" DECIMAL(15,2) NOT NULL,
    "employerPension" DECIMAL(15,2) NOT NULL,
    "occupationalHazard" DECIMAL(15,2) NOT NULL,
    "employeeMaternity" DECIMAL(15,2) NOT NULL,
    "employerMaternity" DECIMAL(15,2) NOT NULL,
    "cbhi" DECIMAL(15,2) NOT NULL,
    "netPay" DECIMAL(15,2) NOT NULL,
    "employerCost" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_organizationId_status_idx" ON "employees"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_organizationId_employeeNumber_key" ON "employees"("organizationId", "employeeNumber");

-- CreateIndex
CREATE INDEX "payroll_runs_organizationId_periodYear_periodMonth_idx" ON "payroll_runs"("organizationId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_payrollRunId_employeeId_key" ON "payslips"("payrollRunId", "employeeId");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

