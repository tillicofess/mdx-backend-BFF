import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// 创建连接池，而不是每次请求都创建连接
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10, // 连接池大小
    queueLimit: 0,
});

export default pool;