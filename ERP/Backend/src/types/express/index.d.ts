import { User } from '@prisma/client';

declare global {
  namespace Express {
    export interface Request {
      user?: {
        userId: string;
        email: string;
        name: string;
        organizationId: string;
        role: string;
      };
      rawBody?: any; // For webhook verification
    }
  }
}
