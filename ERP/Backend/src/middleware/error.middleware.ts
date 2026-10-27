import type { Request, Response, NextFunction } from "express"
import { error } from "../utils/apiResponse"

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("[Error]:", err)

  const statusCode = err.statusCode || 500
  const message = err.message || "Internal Server Error"
  const details = process.env.NODE_ENV === "development" ? err.stack : undefined

  res.status(statusCode).json(error(message, undefined, details))
}
