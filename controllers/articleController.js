import pool from "../config/db.js";

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
