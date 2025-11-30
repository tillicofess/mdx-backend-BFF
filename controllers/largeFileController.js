import path from 'path';
import { fileURLToPath } from "url";
import fse from 'fs-extra';
import pool from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

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
        const { fileHash, fileName, fileSize, parentId } = req.body;

        if (!fileHash || !fileName || !fileSize || fileSize === undefined) {
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

        await saveFileMetadata(req, res, { fileHash, fileName, fileSize, parentId, completeFilePath });
    } catch (err) {
        console.error("mergeChunks error:", err);
        res.status(500).json({ status: false, message: "服务器错误" });
    }
}

// 保存文件元数据到数据库
const saveFileMetadata = async (req, res, { fileHash, fileName, fileSize, parentId, completeFilePath }) => {
    const userId = req.user.claims.sub;
    console.log('DEBUG: userId:', userId);
    const newFileId = uuidv4();
    const currentTimestamp = new Date();

    let connection;
    try {
        connection = await pool.getConnection();

        // 检查数据库中是否已存在相同用户、相同父目录、相同名称的文件（防止重复添加）
        // 或者，你可能希望检查是否存在相同 fileHash 的文件（秒传的场景）
        const [existingFile] = await connection.query(
            `SELECT id FROM files_metadata WHERE user_id = ? AND parent_id <=> ? AND name = ? AND is_directory = FALSE`,
            [userId, parentId, fileName]
        );

        if (existingFile.length > 0) {
            // 如果文件已存在，则可能需要更新其信息或者直接返回成功
            // 在这里，我们选择直接返回成功，表示文件已被处理过。
            // 注意：这只是一个简单的处理，实际业务可能需要更复杂的逻辑，例如版本管理、覆盖等
            console.log(`文件 ${fileName} (ID: ${existingFile[0].id}) 已存在于数据库，跳过插入。`);
            return res.json({ status: true, message: "文件已存在，无需重复上传及记录。" });
        }


        const insertQuery = `
            INSERT INTO files_metadata
                (id, name, is_directory, parent_id, user_id, size, file_hash, storage_path, created_at, updated_at)
            VALUES
                (?, ?, FALSE, ?, ?, ?, ?, ?, ?, ?);
        `;

        const params = [
            newFileId,
            fileName,
            parentId,
            userId,
            fileSize,
            fileHash,
            completeFilePath, // 物理存储路径
            currentTimestamp,
            currentTimestamp
        ];

        await connection.query(insertQuery, params);

        res.json({ status: true, message: "文件合并成功并已记录元数据。", fileId: newFileId });

    } catch (error) {
        console.error("保存文件元数据到数据库失败:", error);
        // 如果是数据库操作失败，需要回滚之前的物理文件操作（可选，复杂）
        // 或者至少删除已合并的文件，以免留下脏数据
        if (fse.existsSync(completeFilePath)) {
            await fse.remove(completeFilePath);
            console.log(`由于数据库写入失败，已删除物理文件: ${completeFilePath}`);
        }
        throw error; // 抛出错误，让上层 mergeChunks catch
    } finally {
        if (connection) connection.release();
    }
};

/**
 * 
 * @param {string | null} parentId 父目录ID，null表示根目录
 */
export const getFileList = async (req, res) => {
    let connection;
    try {
        // 1. 获取用户 ID
        const userId = req.user?.claims?.sub;
        const parentId = req.query.parentId || null;

        if (!userId) {
            return res.status(401).json({ status: false, message: "无法获取用户身份信息" });
        }

        connection = await pool.getConnection();

        // 2. 构建 SQL 查询
        // 查询当前用户的文件元数据，is_directory = FALSE 表示只查文件
        // 假设您只查询根目录下的文件 (parentId IS NULL)，如果需要查询特定目录，请根据 parentId 进行过滤
        const query = `
            SELECT
                id,
                name,
                is_directory AS isDir,
                size,
                created_at AS uploadTime
            FROM
                files_metadata
            WHERE
                user_id = ? AND parent_id <=> ?
            ORDER BY
                is_directory DESC, name ASC; -- 文件夹优先，然后按名称排序
        `;

        // 3. 执行查询
        const [rows] = await connection.query(query, [userId, parentId]);

        // 4. 格式化数据并返回
        const files = rows.map(row => ({
            id: row.id,
            name: row.name,
            size: row.size,
            uploadTime: row.uploadTime,
            isDir: row.isDir,
        }));

        res.json({
            status: true,
            data: files,
        });

    } catch (err) {
        console.error("getFileList error (Database):", err);
        // 如果是数据库错误，应返回 500
        res.status(500).json({ status: false, message: "查询文件列表失败" });
    } finally {
        if (connection) connection.release();
    }
}

/**
 * @description 创建文件夹
 * @param {string} name 文件夹名称
 * @param {string | null} parentId 父目录ID，null表示根目录
 */
export const createFolder = async (req, res) => {
    const userId = req.user.claims.sub;
    const { name, parentId } = req.body; // 文件夹名称和父级ID
    if (!name || name.trim() === '') {
        return res.status(400).json({ code: 1, message: 'Folder name cannot be empty.' });
    }

    // 安全检查：如果 parentId 不是 null，则检查父目录是否存在且为目录，且属于当前用户
    if (parentId !== null) {
        let parentFolderConnection;
        try {
            parentFolderConnection = await pool.getConnection();
            const [parentRows] = await parentFolderConnection.query(
                `SELECT id, is_directory FROM files_metadata WHERE id = ? AND user_id = ? AND is_directory = TRUE`,
                [parentId, userId]
            );
            if (parentRows.length === 0) {
                return res.status(404).json({ code: 1, message: 'Parent folder not found or not a directory or does not belong to the user.' });
            }
        } catch (error) {
            console.error('Error checking parent folder:', error);
            return res.status(500).json({ code: 1, message: 'Failed to check parent folder.' });
        } finally {
            if (parentFolderConnection) parentFolderConnection.release();
        }
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const newFolderId = uuidv4(); // 生成新的 UUID
        const currentTimestamp = new Date();
        const insertQuery = `
            INSERT INTO files_metadata
                (id, name, is_directory, parent_id, user_id, size, created_at, updated_at)
            VALUES
                (?, ?, TRUE, ?, ?, 0, ?, ?);
        `;
        const params = [
            newFolderId,
            name.trim(),
            parentId,
            userId,
            currentTimestamp,
            currentTimestamp
        ];

        await connection.query(insertQuery, params);

        res.status(201).json({
            code: 0,
            message: 'Folder created successfully.',
            data: {
                id: newFolderId,
                name: name.trim(),
                isDir: true,
                size: 0,
                uploadTime: currentTimestamp.toISOString() // 返回 ISO 格式给前端
            }
        });
    } catch (error) {
        console.error('Error creating folder:', error);
        // 考虑更细致的错误处理，例如名称重复 (通过唯一索引可以防止)
        if (error.code === 'ER_DUP_ENTRY') { // MySQL 唯一约束冲突错误码
            return res.status(409).json({ code: 1, message: 'A folder with this name already exists in the current directory.' });
        }
        res.status(500).json({ code: 1, message: 'Failed to create folder.' });
    } finally {
        if (connection) connection.release();
    }
}

/**
 * @description 重命名文件或文件夹
 * @param {string} id - 文件或文件夹的ID
 * @param {string} name - 新的名称
 */
export const renameFolderOrFile = async (req, res) => {
    const userId = req.user.claims.sub;
    const { id, name } = req.body;
    if (!id || !name || name.trim() === '') {
        return res.status(400).json({ code: 1, message: 'ID and new name are required.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const updateQuery = `
            UPDATE files_metadata
            SET name = ?, updated_at = ?
            WHERE id = ? AND user_id = ?
        `;
        const params = [
            name.trim(),
            new Date(),
            id,
            userId
        ];

        const [result] = await connection.query(updateQuery, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ code: 1, message: 'File or folder not found or does not belong to the user.' });
        }

        res.status(200).json({
            code: 0,
            message: 'File or folder renamed successfully.',
            data: null
        });

    } catch (error) {
        console.error('Error renaming folder or file:', error);
        res.status(500).json({ code: 1, message: 'Failed to rename folder or file.' });
    } finally {
        if (connection) connection.release();
    }
}

/**
 * @description 删除文件或文件夹
 * @param {string} id - 文件或文件夹的ID
 */
export const deleteFileOrFolder = async (req, res) => {
    const userId = req.user.claims.sub;
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ code: 1, message: 'ID is required.' });
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction(); // 开启事务

        const [targetRows] = await connection.query(
            `SELECT id, name, is_directory, storage_path, user_id FROM files_metadata WHERE id = ? AND user_id = ?`,
            [id, userId]
        );

        if (targetRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ code: 1, message: 'File or folder not found or not owned by user.' });
        }

        const targetItem = targetRows[0];

        const itemsToDelete = []; // { id, is_directory, storage_path }

        async function collectItemsToDelete(currentId) {
            const [children] = await connection.query(
                `SELECT id, is_directory, storage_path FROM files_metadata WHERE parent_id <=> ? AND user_id = ?`,
                [currentId, userId]
            );
            for (const child of children) {
                if (child.is_directory) {
                    await collectItemsToDelete(child.id); // 递归
                }
                itemsToDelete.push(child);
            }
        }

        itemsToDelete.push({
            id: targetItem.id,
            is_directory: targetItem.is_directory,
            storage_path: targetItem.storage_path,
        });

        // 如果是文件夹，则递归收集其所有子项
        if (targetItem.is_directory) {
            await collectItemsToDelete(targetItem.id);
        }

        for (const item of itemsToDelete) {
            if (!item.is_directory && item.storage_path) { // 确保是文件且有物理路径
                try {
                    if (fse.existsSync(item.storage_path)) {
                        await fse.remove(item.storage_path);
                        console.log(`Deleted physical file: ${item.storage_path}`);
                    }
                } catch (fileErr) {
                    // 物理文件删除失败，只记录日志，不回滚数据库事务
                    console.error(`Error deleting physical file ${item.storage_path}. Database transaction will proceed:`, fileErr);
                    // 在生产环境中，这里可能需要发送报警通知
                }
            }
        }
        // 4. 从数据库中删除所有相关元数据
        const idsToDelete = itemsToDelete.map(item => item.id);
        if (idsToDelete.length > 0) {
            const deleteMetadataQuery = `DELETE FROM files_metadata WHERE id IN (?) AND user_id = ?`;
            await connection.query(deleteMetadataQuery, [idsToDelete, userId]);
            console.log(`Deleted database metadata for IDs: ${idsToDelete.join(', ')}`);
        }
        await connection.commit();
        res.json({ code: 0, message: 'File(s) and folder(s) deleted successfully.' });

    } catch (error) {
        console.error('Error deleting file or folder:', error);
        await connection.rollback(); // 回滚事务
        // 如果物理文件删除成功但数据库失败，这里需要日志记录或报警
        res.status(500).json({ code: 1, message: 'Failed to delete file(s) or folder(s). Transaction rolled back.' });
    } finally {
        if (connection) connection.release();
    }
}


/**
 * @description 移动文件或文件夹
 * @param {string} draggedId - 被移动的文件或文件夹的ID
 * @param {string} newParentId - 新的父目录ID，若移动到根目录则为 'null'
 */
export const moveFileOrFolder = async (req, res) => {
    const userId = req.user.claims.sub;
    const { draggedId, newParentId } = req.body;

    if (!draggedId || !newParentId) {
        return res.status(400).json({ code: 1, message: 'draggedId and newParentId are required.' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        // 1) 检查被移动的条目是否存在且属于当前用户
        const [draggedRows] = await connection.query(
            `SELECT id, is_directory, parent_id FROM files_metadata WHERE id = ? AND user_id = ?`,
            [draggedId, userId]
        );
        if (draggedRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ code: 1, message: 'Dragged item not found or not owned by user.' });
        }
        const draggedItem = draggedRows[0];

        // 2) 处理 newParentId，标准化为 null 或实际 ID
        const normalizedParentId = newParentId === 'null' ? null : newParentId;

        // 3) 如果目标不是根目录，检查目标目录
        if (normalizedParentId !== null) {
            // 3.1) 检查目标目录是否存在且属于当前用户
            const [targetRows] = await connection.query(
                `SELECT id, is_directory, parent_id, user_id FROM files_metadata WHERE id = ?`,
                [normalizedParentId]
            );
            if (targetRows.length === 0) {
                await connection.rollback();
                return res.status(400).json({ code: 1, message: 'Target folder not found.' });
            }
            const target = targetRows[0];

            if (target.user_id !== userId) {
                await connection.rollback();
                return res.status(403).json({ code: 1, message: 'No permission on target folder.' });
            }

            if (!target.is_directory) {
                await connection.rollback();
                return res.status(400).json({ code: 1, message: 'Target is not a directory.' });
            }

            // 3.2) 不能把自己移动到自己
            if (String(draggedId) === String(normalizedParentId)) {
                await connection.rollback();
                return res.status(400).json({ code: 1, message: 'Cannot move item into itself.' });
            }

            // 3.3) 检查循环引用：不能将目录移动到其子目录下
            if (draggedItem.is_directory) {
                // 检查目标是否是被移动目录的子目录
                const [childCheckRows] = await connection.query(
                    `WITH RECURSIVE cte AS (
                        SELECT id FROM files_metadata WHERE id = ? AND user_id = ?
                        UNION ALL
                        SELECT fm.id FROM files_metadata fm
                        JOIN cte ON fm.parent_id = cte.id
                        WHERE fm.user_id = ?
                    ) SELECT id FROM cte WHERE id = ?`,
                    [draggedId, userId, userId, normalizedParentId]
                );

                if (childCheckRows.length > 0) {
                    await connection.rollback();
                    return res.status(400).json({ code: 1, message: 'Cannot create circular reference by moving directory into its own subdirectory.' });
                }
            }
        }

        // 4) 执行更新 parent_id（支持移动到根目录）
        await connection.query(
            `UPDATE files_metadata SET parent_id = ? WHERE id = ? AND user_id = ?`,
            [normalizedParentId, draggedId, userId]
        );

        await connection.commit();
        return res.json({ code: 0, message: 'Move successful.' });

    } catch (error) {
        console.error('Error moving file/folder:', error);
        if (connection) {
            try { await connection.rollback(); } catch (e) { console.error('Rollback error', e); }
        }
        return res.status(500).json({ code: 1, message: 'Move failed due to server error.', details: error.message });
    } finally {
        if (connection) connection.release();
    }
};
