import type { Response } from "express"
import { prisma } from "../lib/prisma"
import type { BranchAuthRequest } from "../middleware/branchAuth.middleware"
import { buildBranchFilter } from "../middleware/branchAuth.middleware"
import { success, error as apiError } from "../utils/apiResponse"
import { emitToBranch, emitToOrganization } from "../utils/socket"

const STALE_PRINTING_MS = 5 * 60 * 1000

function parsePositiveInt(value: unknown): number | null {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

async function requeueStalePrintingJobs(organizationId: number, branchFilter: object) {
  const cutoff = new Date(Date.now() - STALE_PRINTING_MS)
  await prisma.posPrintJob.updateMany({
    where: {
      organizationId,
      status: "PRINTING",
      claimedAt: { lt: cutoff },
      ...branchFilter,
    },
    data: {
      status: "PENDING",
      claimedById: null,
      claimedAt: null,
      lastError: "Re-queued after stale PRINTING claim",
    },
  })
}

/** Dashboard/API: queue an 80mm receipt print on a logged-in POS for this branch. */
export const enqueuePosPrintJob = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parsePositiveInt(req.params.organizationId)
    const saleId = parsePositiveInt(req.params.saleId)
    if (!organizationId || !saleId) {
      return res.status(400).json(apiError("Invalid organization or sale id"))
    }

    const copiesRaw = Number(req.body?.copies ?? 1)
    const copies = Number.isFinite(copiesRaw) ? Math.min(3, Math.max(1, Math.floor(copiesRaw))) : 1

    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId, ...buildBranchFilter(req) },
      select: {
        id: true,
        branchId: true,
        invoiceNumber: true,
        saleNumber: true,
        status: true,
      },
    })
    if (!sale) return res.status(404).json(apiError("Sale not found"))

    const existing = await prisma.posPrintJob.findFirst({
      where: {
        organizationId,
        saleId,
        status: { in: ["PENDING", "PRINTING"] },
      },
      select: { id: true, status: true },
    })
    if (existing) {
      return res.status(200).json(
        success(
          {
            id: existing.id,
            status: existing.status,
            saleId,
            branchId: sale.branchId,
            copies,
            invoiceNumber: sale.invoiceNumber,
            saleNumber: sale.saleNumber,
            alreadyQueued: true,
          },
          "A print job for this sale is already queued",
        ),
      )
    }

    const requestedById = req.user?.userId ? Number(req.user.userId) : null
    const job = await prisma.posPrintJob.create({
      data: {
        organizationId,
        branchId: sale.branchId,
        saleId: sale.id,
        copies,
        requestedById: Number.isFinite(requestedById) ? requestedById : null,
      },
      select: {
        id: true,
        status: true,
        saleId: true,
        branchId: true,
        copies: true,
        createdAt: true,
      },
    })

    const payload = {
      ...job,
      invoiceNumber: sale.invoiceNumber,
      saleNumber: sale.saleNumber,
    }

    emitToOrganization(organizationId, "posPrintJob", payload)
    emitToBranch(organizationId, sale.branchId, "posPrintJob", payload)

    return res.status(201).json(success(payload, "Print job queued for POS"))
  } catch (err: any) {
    console.error("enqueuePosPrintJob:", err)
    return res.status(500).json(apiError(err?.message ?? "Failed to queue print job"))
  }
}

/**
 * POS app: atomically claim the next pending job for this branch.
 * Returns null data when the queue is empty.
 */
export const claimNextPosPrintJob = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parsePositiveInt(req.params.organizationId)
    if (!organizationId) {
      return res.status(400).json(apiError("Invalid organization id"))
    }

    const branchFilter = buildBranchFilter(req)
    await requeueStalePrintingJobs(organizationId, branchFilter)

    const next = await prisma.posPrintJob.findFirst({
      where: {
        organizationId,
        status: "PENDING",
        ...branchFilter,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        saleId: true,
        branchId: true,
        copies: true,
        createdAt: true,
        sale: { select: { invoiceNumber: true, saleNumber: true } },
      },
    })

    if (!next) {
      return res.status(200).json(success(null, "No pending print jobs"))
    }

    const claimedById = req.user?.userId ? Number(req.user.userId) : null
    const claimed = await prisma.posPrintJob.updateMany({
      where: { id: next.id, status: "PENDING" },
      data: {
        status: "PRINTING",
        claimedById: Number.isFinite(claimedById) ? claimedById : null,
        claimedAt: new Date(),
      },
    })

    if (claimed.count === 0) {
      return res.status(200).json(success(null, "Job already claimed"))
    }

    return res.status(200).json(
      success({
        id: next.id,
        saleId: next.saleId,
        branchId: next.branchId,
        copies: next.copies,
        invoiceNumber: next.sale.invoiceNumber,
        saleNumber: next.sale.saleNumber,
        createdAt: next.createdAt,
      }),
    )
  } catch (err: any) {
    console.error("claimNextPosPrintJob:", err)
    return res.status(500).json(apiError(err?.message ?? "Failed to claim print job"))
  }
}

/** POS app: mark a claimed job as PRINTED or FAILED. */
export const completePosPrintJob = async (req: BranchAuthRequest, res: Response) => {
  try {
    const organizationId = parsePositiveInt(req.params.organizationId)
    const jobId = parsePositiveInt(req.params.jobId)
    if (!organizationId || !jobId) {
      return res.status(400).json(apiError("Invalid organization or job id"))
    }

    const statusRaw = String(req.body?.status ?? "").toUpperCase()
    if (statusRaw !== "PRINTED" && statusRaw !== "FAILED") {
      return res.status(400).json(apiError("status must be PRINTED or FAILED"))
    }

    const lastError =
      statusRaw === "FAILED"
        ? String(req.body?.error ?? "Print failed").slice(0, 500)
        : null

    const existing = await prisma.posPrintJob.findFirst({
      where: {
        id: jobId,
        organizationId,
        ...buildBranchFilter(req),
      },
      select: { id: true, status: true },
    })
    if (!existing) return res.status(404).json(apiError("Print job not found"))

    if (existing.status === "PRINTED" || existing.status === "FAILED" || existing.status === "CANCELLED") {
      return res.status(200).json(success({ id: existing.id, status: existing.status }, "Already completed"))
    }

    const updated = await prisma.posPrintJob.update({
      where: { id: jobId },
      data: {
        status: statusRaw as "PRINTED" | "FAILED",
        finishedAt: new Date(),
        lastError,
      },
      select: { id: true, status: true, saleId: true, finishedAt: true, lastError: true },
    })

    emitToOrganization(organizationId, "posPrintJobCompleted", updated)
    return res.status(200).json(success(updated))
  } catch (err: any) {
    console.error("completePosPrintJob:", err)
    return res.status(500).json(apiError(err?.message ?? "Failed to complete print job"))
  }
}
