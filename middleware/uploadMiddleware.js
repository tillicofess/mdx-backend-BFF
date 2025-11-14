import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 临时目录（Multer 会先把上传文件放在这里）
export const TEMP_DIR = path.resolve(__dirname, "../temp");

// Multer 配置：单文件字段名为 "chunk"
const storage = multer.diskStorage({
    // 所有上传的文件都暂时保存到 temp/ 目录
    destination: (req, file, cb) => {
        cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => {
        // 保持 multer 生成的临时文件名（也可以自定义）
        cb(null, file.originalname || `${Date.now()}-${file.fieldname}`);
    }
});

const upload = multer({ dest: TEMP_DIR }); // 简单写法，也可以用 storage

// 导出作为中间件（单文件，字段名为 chunk）
export const uploadMiddleware = upload.single("chunk");
