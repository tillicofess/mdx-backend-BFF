import pool from "../config/db.js";

async function testDbConnection() {
  let connection;
  try {
    // 从连接池获取连接
    connection = await pool.getConnection();

    // 测试查询
    const [rows] = await connection.query("SELECT NOW() AS now");
    console.log("✅ Database connection successful. Server time:", rows[0].now);
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
  } finally {
    // 确保释放连接回池
    if (connection) connection.release();
    // 关闭连接池
    await pool.end();
  }
}

// 执行测试
testDbConnection();
