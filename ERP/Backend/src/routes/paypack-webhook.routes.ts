import express, { Router } from 'express';
import { handlePaypackWebhook } from '../controllers/paypack-webhook.controller';

const router = Router();

router.post(
    "/paypack",
    express.raw({ type: "application/json" }),
    handlePaypackWebhook
);

export default router;