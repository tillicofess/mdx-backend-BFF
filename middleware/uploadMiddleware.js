import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 临时目录（Multer 会先把上传文件放在这里）
export const TEMP_DIR = path.resolve(__dirname, "../temp");

// 通用 Multer 存储配置
export const createStorage = (filenameStrategy = null) => {
    return multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, TEMP_DIR);
        },
        filename: (req, file, cb) => {
            if (filenameStrategy) {
                return filenameStrategy(req, file, cb);
            }
            // 默认文件名策略
            cb(null, file.originalname || `${Date.now()}-${file.fieldname}`);
        }
    });
};

// 创建通用上传中间件的工厂函数
export const createUploadMiddleware = (fieldName, filenameStrategy = null) => {
    const storage = createStorage(filenameStrategy);
    const upload = multer({ storage });
    return upload.single(fieldName);
};

// 导出作为中间件（单文件，字段名为 chunk）
export const uploadMiddleware = createUploadMiddleware("chunk");

export const cosUploadMiddleware = createUploadMiddleware('image', (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
});
