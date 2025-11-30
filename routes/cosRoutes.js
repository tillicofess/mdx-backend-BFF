import express from 'express';
import { cosUploadMiddleware } from '../middleware/uploadMiddleware.js';
const router = express.Router();

import * as Controller from '../controllers/cosController.js';

router.post('/upload', cosUploadMiddleware, Controller.uploadImage);

export default router;
