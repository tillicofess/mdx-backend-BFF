import express from 'express';
const router = express.Router();

import * as articleController from '../controllers/articleController.js';

// 文章列表
router.get('/:slug', articleController.getArticleBySlug);

export default router;