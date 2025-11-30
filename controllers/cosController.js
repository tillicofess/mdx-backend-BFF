import COS from 'cos-nodejs-sdk-v5';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

// 配置腾讯云COS
const cos = new COS({
  SecretId: process.env.COS_SECRET_ID || '',
  SecretKey: process.env.COS_SECRET_KEY || ''
});

// 计算文件的MD5哈希值
const calculateFileHash = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
};

// 检查文件是否已存在于COS
const checkFileExists = (bucket, region, key) => {
  return new Promise((resolve) => {
    cos.headObject({
      Bucket: bucket,
      Region: region,
      Key: key
    }, (err) => {
      if (err) {
        // 文件不存在或其他错误，返回false
        resolve(false);
      } else {
        // 文件存在，返回true
        resolve(true);
      }
    });
  });
};

// 上传图片到COS
export const uploadImage = async (req, res) => {
  try {
    // 1. 检查是否有上传的文件（中间件已处理）
    if (!req.file) {
      return res.status(400).json({ error: '未找到上传的文件' });
    }

    const { originalname, path: tempPath, mimetype } = req.file;
    const bucket = process.env.COS_BUCKET || '';
    const region = process.env.COS_REGION || '';

    // 2. 验证COS配置
    if (!bucket || !region) {
      throw new Error('COS配置不完整，请检查环境变量');
    }

    // 3. 计算文件MD5哈希值（核心去重逻辑）
    const fileHash = await calculateFileHash(tempPath);
    const ext = path.extname(originalname);
    // 使用哈希值作为COS对象Key，实现内容去重
    const cosKey = `images/${fileHash}${ext}`;

    // 4. 检查文件是否已存在于COS
    const fileExists = await checkFileExists(bucket, region, cosKey);
    if (fileExists) {
      // 文件已存在，直接返回URL，跳过上传
      await fs.unlink(tempPath); // 清理临时文件
      const imageUrl = `https://${bucket}.cos.${region}.myqcloud.com/${cosKey}`;
      return res.status(200).json({
        url: imageUrl,
        success: true,
        message: '文件已存在，直接返回URL'
      });
    }

    // 5. 上传文件到COS
    const uploadResult = await new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: bucket,
        Region: region,
        Key: cosKey,
        Body: fs.createReadStream(tempPath), // 读取临时文件
        ContentType: mimetype // 设置文件MIME类型
      }, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    // 5. 删除临时文件（清理资源）
    await fs.unlink(tempPath);

    // 6. 生成访问URL
    const imageUrl = `https://${bucket}.cos.${region}.myqcloud.com/${cosKey}`;

    res.status(200).json({
      url: imageUrl,
      success: true,
      message: '文件上传成功'
    });
  } catch (error) {
    // 8. 错误处理：确保临时文件被删除
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(() => { });
    }

    // 9. 返回错误响应
    res.status(500).json({
      error: '上传到COS失败',
      details: error.message,
      success: false
    });
  }
};
