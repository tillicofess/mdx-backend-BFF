import express from 'express';
const router = express.Router();

import * as articleController from '../controllers/articleController.js';

// publish article
router.post('/publish', articleController.publishArticle);
// get article list
router.get('/list', articleController.getBlogList);
// get article detail
router.get('/detail/:id', articleController.getArticleById);
// update article
router.put('/update/:id', articleController.updateArticle);
// delete article
router.delete('/delete/:id', articleController.deleteArticle);



export default router;