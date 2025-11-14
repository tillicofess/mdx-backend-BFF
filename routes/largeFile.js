import express from 'express';
import { uploadMiddleware } from "../middleware/uploadMiddleware.js";
const router = express.Router();

import * as largeFileController from '../controllers/largeFileController.js';

router.post('/check', largeFileController.checkFile);
router.post("/upload", uploadMiddleware, largeFileController.uploadChunk);
router.post("/merge", largeFileController.mergeChunks);
router.get("/list", largeFileController.getFileList);

export default router;
