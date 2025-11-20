import path from 'path';
import { fileURLToPath } from "url";
import fse from 'fs-extra';

// ----------------------
// 上传文件保存目录
// ----------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.resolve(__dirname, '../uploads');
const TMP_CHUNK_DIR = path.resolve(UPLOAD_DIR, "tmp");

// 确保目录存在
fse.ensureDirSync(UPLOAD_DIR);
fse.ensureDirSync(TMP_CHUNK_DIR);

// 工具：提取文件后缀
const extractExt = (fileName) => path.extname(fileName);

/**
 * 检查文件是否已存在
 * @param {string} fileHash 文件 hash
 * @param {string} fileName 原始文件名（用于后缀）
 */
export const checkFile = async (req, res, next) => {
    const { fileHash, fileName } = req.body;
    const filePath = path.resolve(UPLOAD_DIR, fileHash + path.extname(fileName));

    // 秒传：文件已存在
    if (fse.existsSync(filePath)) {
        return res.json({ status: true, data: { shouldUpload: false } });
    }

    const chunkDir = path.resolve(TMP_CHUNK_DIR, fileHash);
    let uploadedChunks = [];
    if (fse.existsSync(chunkDir)) {
        uploadedChunks = await fse.readdir(chunkDir);
    }

    res.json({
        status: true, data: {
            shouldUpload: true,
            uploadedChunks,
        }
    });
}

/**
 * 上传文件分片接口
 * @param {string} filehash 文件 hash
 * @param {string} chunkhash 分片 hash
 * @param {Buffer} file 分片文件
 */
export const uploadChunk = async (req, res) => {
    try {
        const chunkFile = req.file;
        const { filehash, chunkhash } = req.body;

        if (!filehash || !chunkhash || !chunkFile) {
            return res.status(400).json({
                status: false,
                message: "缺少 filehash / chunkhash 或文件",
            });
        }

        // 创建分片目录 uploads/tmp/<filehash>
        const chunkDir = path.resolve(TMP_CHUNK_DIR, filehash);
        fse.ensureDirSync(chunkDir);

        // 目标路径（例如：uploads/tmp/abc123/abc123-0）
        const chunkPath = path.resolve(chunkDir, chunkhash);

        // 将 multer 的临时文件移动到目标分片目录
        await fse.move(chunkFile.path, chunkPath, { overwrite: true });

        return res.json({ status: true, message: "分片上传成功" });
    } catch (err) {
        console.error("uploadChunk error:", err);
        return res.status(500).json({ status: false, message: "服务器错误" });
    }

}

/**
 * 合并分片接口
 * @param {string} fileHash 文件 hash
 * @param {string} fileName 原始文件名（用于后缀）
 * @param {number} size 分片大小（字节）
 */
export const mergeChunks = async (req, res) => {
    try {
        const { fileHash, fileName, size: CHUNK_SIZE } = req.body;

        if (!fileHash || !fileName || !CHUNK_SIZE) {
            return res.status(400).json({ status: false, message: "缺少参数" });
        }

        const completeFilePath = path.resolve(UPLOAD_DIR, `${fileHash}${extractExt(fileName)}`);
        const chunkDir = path.resolve(TMP_CHUNK_DIR, fileHash);

        if (!fse.existsSync(chunkDir)) {
            return res.status(400).json({ status: false, message: "分片目录不存在" });
        }

        // 1. 读取所有分片并按序号排序
        const chunkFiles = await fse.readdir(chunkDir);
        chunkFiles.sort((a, b) => parseInt(a.split("-")[1]) - parseInt(b.split("-")[1]));

        // 2. 流式合并
        for (let i = 0; i < chunkFiles.length; i++) {
            const chunkPath = path.resolve(chunkDir, chunkFiles[i]);

            // 流式读取 + 追加写入
            await new Promise((resolve, reject) => {
                const readStream = fse.createReadStream(chunkPath);
                const writeStream = fse.createWriteStream(completeFilePath, { flags: "a" }); // a = append

                readStream.pipe(writeStream);

                readStream.on("end", async () => {
                    // 分片写入完成后删除
                    await fse.unlink(chunkPath);
                    resolve();
                });

                readStream.on("error", (err) => reject(err));
                writeStream.on("error", (err) => reject(err));
            });
        }

        // 3. 删除分片目录
        await fse.remove(chunkDir);

        res.json({ status: true, message: "文件合并成功" });
    } catch (err) {
        console.error("mergeChunks error:", err);
        res.status(500).json({ status: false, message: "服务器错误" });
    }
}

export const getFileList = async (req, res) => {
    try {
        const entries = await fse.readdir(UPLOAD_DIR, { withFileTypes: true });
        // 过滤：只保留文件（排除 tmp、目录）
        const files = await Promise.all(
            entries
                .filter(entry => entry.isFile()) // 只要文件
                .map(async entry => {
                    const filePath = path.resolve(UPLOAD_DIR, entry.name);
                    const stats = await fse.stat(filePath); // 获取文件信息（大小、时间等）

                    return {
                        name: entry.name,
                        size: stats.size, // 文件大小（单位：字节）
                        uploadTime: stats.mtime, // 最后修改时间（近似上传时间）
                    };
                })
        );
        // 返回响应
        res.json({
            status: true,
            data: files.sort((a, b) => b.uploadTime - a.uploadTime), // 按时间降序排列（最新在前）
        });
    } catch (err) {
        console.error("getFileList error:", err);
        res.status(500).json({ status: false, message: "服务器错误" });
    }
}