import { z } from 'zod';

export const createPaymentSchema = z.object({
  subscriptionId: z.string().uuid('Invalid subscription ID'),
  amount: z.number().positive('Amount must be a positive number'),
  currency: z.string().default('USD'),
  description: z.string().min(5, 'Description must be at least 5 characters'),
  customerEmail: z.string().email('Invalid email address'),
  customerFirstName: z.string().min(2, 'First name is required'),
  customerLastName: z.string().min(2, 'Last name is required'),
  customerPhone: z.string().optional(),
  reference: z.string().optional(),
  redirectUrl: z.string().url('Invalid URL').optional(),
  backUrl: z.string().url('Invalid URL').optional(),
  metadata: z.any().optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
