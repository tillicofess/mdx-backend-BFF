import express from 'express';
import { uploadMiddleware } from "../middleware/uploadMiddleware.js";
import { requireScope } from '../middleware/requirePermission.js';
const router = express.Router();

import * as largeFileController from '../controllers/largeFileController.js';

router.post('/check', largeFileController.checkFile);
router.post("/upload", requireScope('LargeFile Resource', 'upload'), uploadMiddleware, largeFileController.uploadChunk);
router.post("/merge", largeFileController.mergeChunks);
router.get("/list", largeFileController.getFileList);
router.post("/createFolder", largeFileController.createFolder);
router.delete("/delete/:id", largeFileController.deleteFileOrFolder);
router.post("/rename", largeFileController.renameFolderOrFile);

export default router;
