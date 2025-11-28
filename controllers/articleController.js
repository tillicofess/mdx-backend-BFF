import pool from "../config/db.js";
import matter from "gray-matter";

// --- 辅助函数：从 Markdown 内容中提取第一个图片 URL ---
function extractFirstImageUrl(content) {
    const markdownImageRegex = /!\[.*?\]\((https?:\/\/[^\s)]+|\/largeFile\/download\/[a-f0-9-]+)\)/i;
    const htmlImageRegex = /<img.*?src=["'](https?:\/\/[^"']+|\/largeFile\/download\/[a-f0-9-]+)["'].*?>/i;

    let match = content.match(markdownImageRegex);
    if (match && match[1]) {
        return match[1];
    }

    match = content.match(htmlImageRegex);
    if (match && match[1]) {
        return match[1];
    }

    // 如果没有找到图片，返回一个默认的封面图 URL
    // TODO: 替换为你的默认封面图 URL
    return 'https://picsum.photos/200/300';
}

/**
 * @description 获取文章详情（通过 slug）
 * @param {string} slug - 文章 slug
 * @returns {object} 文章详情
 */
export const getArticleBySlug = async (req, res) => {
    const { slug } = req.params;

    let connection;

    try {
        connection = await pool.getConnection();
        const [rows] = await connection.query(
            "SELECT * FROM articles WHERE slug = ?",
            [slug]
        );
        if (rows.length === 0) {
            res.json({
                code: 404,
                message: "article not found",
                data: null,
            })
            return;
        }

        const article = rows[0];
        res.json({
            code: 200,
            message: "success",
            data: article,
        })
    } catch (error) {
        console.error(error);
        res.json({
            code: 500,
            message: "internal server error",
            data: null,
        })
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

/**
 * @description 发布文章
 * @param {string} title - 文章标题
 * @param {string} content - 文章内容（Markdown 格式）
 * @returns {object} 发布结果
 */
export const publishArticle = async (req, res) => {
    const { title, content } = req.body;

    if (!title || !content) {
        return res.status(400).json({ code: 1, message: 'Title and content are required.' });
    }
    if (title.length > 255) {
        return res.status(400).json({ code: 1, message: 'Title cannot exceed 255 characters.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        const { data: frontMatterObj, content: contentBody } = matter(content);

        const frontMatterJson = JSON.stringify(frontMatterObj);

        // 提取封面图片 URL
        const coverImage = extractFirstImageUrl(contentBody);

        // 插入文章到 articles 表
        const insertQuery = `
            INSERT INTO articles
                (title, content, content_body, front_matter, cover_image) 
            VALUES
                (?, ?, ?, ?, ?);
        `;
        const [result] = await connection.query(insertQuery, [title, content, contentBody, frontMatterJson, coverImage]);

        res.json({ code: 0, message: '文章发布成功', articleId: result.insertId });

    } catch (error) {
        console.error('发布文章失败:', error);
        res.status(500).json({ code: 1, message: '发布文章失败' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * @description 获取博客文章列表
 * @param {number} page - 当前页码，默认值为 1
 * @param {number} pageSize - 每页数量，默认值为 10
 * @returns {object} 文章列表
 */
export const getBlogList = async (req, res) => {
    // 获取分页参数，如果没有提供则使用默认值
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10; // 每页数量
    const offset = (page - 1) * pageSize;

    let connection;
    try {
        connection = await pool.getConnection();

        // 查询文章列表
        const selectQuery = `
            SELECT
                id,
                title,
                LEFT(content_body, 100) AS summary, -- 截取部分内容作为摘要
                cover_image,
                created_at,
                updated_at
            FROM
                articles
            ORDER BY
                created_at DESC
            LIMIT ?, ?;
        `;
        const [articles] = await connection.query(selectQuery, [offset, pageSize]);

        res.json({
            code: 0,
            message: '获取文章列表成功',
            data: articles
        });

    } catch (error) {
        console.error('获取文章列表失败:', error);
        res.status(500).json({ code: 1, message: '获取文章列表失败' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * @description 获取文章详情
 * @param {string} id - 文章 ID
 * @returns {object} 文章详情
 */
export const getArticleById = async (req, res) => {
    const { id } = req.params; // 从 URL 参数中获取文章 ID

    if (!id) {
        return res.status(400).json({ code: 1, message: 'Article ID is required.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        const [articleRows] = await connection.query(
            `SELECT id, title, content, cover_image, created_at, updated_at FROM articles WHERE id = ?`,
            [id]
        );

        if (articleRows.length === 0) {
            return res.status(404).json({ code: 1, message: 'Article not found.' });
        }

        res.json({ code: 0, message: '获取文章详情成功', data: articleRows[0] });

    } catch (error) {
        console.error(`获取文章 ID ${id} 详情失败:`, error);
        res.status(500).json({ code: 1, message: '获取文章详情失败' });
    } finally {
        if (connection) connection.release();
    }
};


/**
 * @description 更新文章
 * @param {string} id - 文章 ID
 * @param {string} title - 文章标题
 * @param {string} content - 文章内容（Markdown 格式）
 * @returns {object} 更新结果
 */
export const updateArticle = async (req, res) => {
    const { id } = req.params;
    const { title, content } = req.body;

    if (!id || !title || !content) {
        return res.status(400).json({ code: 1, message: 'Article ID, title, and content are required.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        const [existingArticle] = await connection.query(
            `SELECT id FROM articles WHERE id = ?`,
            [id]
        );
        if (existingArticle.length === 0) {
            return res.status(404).json({ code: 1, message: 'Article not found.' });
        }

        const { data: frontMatterObj, content: contentBody } = matter(content);
        const frontMatterJson = JSON.stringify(frontMatterObj);

        // 2. 提取新的封面图片 URL
        const newCoverImage = extractFirstImageUrl(contentBody);

        // 3. 更新文章到 articles 表
        const updateQuery = `
            UPDATE articles
            SET
                title = ?,
                content = ?,
                content_body = ?,
                front_matter = ?,
                cover_image = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE
                id = ?;
        `;
        const [result] = await connection.query(updateQuery, [title, content, contentBody, frontMatterJson, newCoverImage, id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ code: 1, message: 'Article not found or no changes made.' });
        }

        res.json({ code: 0, message: '文章修改成功', articleId: id });

    } catch (error) {
        console.error(`修改文章 ID ${id} 失败:`, error);
        res.status(500).json({ code: 1, message: '修改文章失败' });
    } finally {
        if (connection) connection.release();
    }
};

/**
 * @description 删除文章
 * @param {string} id - 文章 ID
 * @returns {object} 删除结果
 */
export const deleteArticle = async (req, res) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ code: 1, message: 'Article ID is required.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();

        const [existingArticle] = await connection.query(
            `SELECT id FROM articles WHERE id = ?`,
            [id]
        );
        if (existingArticle.length === 0) {
            return res.status(404).json({ code: 1, message: 'Article not found.' });
        }

        const deleteQuery = `
            DELETE FROM articles
            WHERE
                id = ?;
        `;
        const [result] = await connection.query(deleteQuery, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ code: 1, message: 'Article not found or no changes made.' });
        }

        res.json({ code: 0, message: '文章删除成功', articleId: id });

    } catch (error) {
        console.error(`删除文章 ID ${id} 失败:`, error);
        res.status(500).json({ code: 1, message: '删除文章失败' });
    } finally {
        if (connection) connection.release();
    }
}