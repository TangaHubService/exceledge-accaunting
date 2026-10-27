import { Router } from 'express';
import { upload, uploadImage } from '../controllers/upload.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Image upload endpoint
router.post('/image', authenticate, upload.single('image'), uploadImage);

export default router;
