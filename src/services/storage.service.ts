import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

class StorageService {
  private s3Client: S3Client | null = null;
  private bucketName: string | null = null;
  private publicUrl: string | null = null;

  constructor() {
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    this.bucketName = process.env.S3_BUCKET_NAME || null;
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || 'auto';
    this.publicUrl = process.env.S3_PUBLIC_URL || null;

    if (accessKeyId && secretAccessKey && this.bucketName) {
      console.log('Initializing S3-compatible Cloud Storage Client...');
      this.s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });
    } else {
      console.log('Cloud Storage credentials not fully set. Falling back to local disk storage.');
    }
  }

  /**
   * Uploads a file buffer to S3 or saves locally as fallback
   */
  async uploadFile(file: Express.Multer.File, folder: string = 'resumes'): Promise<string> {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileName = `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`;
    const key = `${folder}/${fileName}`;

    if (this.s3Client && this.bucketName) {
      try {
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
          })
        );

        console.log(`Successfully uploaded ${fileName} to Cloud Storage (${folder})`);

        // Construct public URL
        if (this.publicUrl) {
          return `${this.publicUrl.replace(/\/$/, '')}/${key}`;
        }

        const endpointUrl = process.env.S3_ENDPOINT;
        if (endpointUrl) {
          return `${endpointUrl.replace(/\/$/, '')}/${this.bucketName}/${key}`;
        }
        return `https://${this.bucketName}.s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com/${key}`;
      } catch (error) {
        console.error('Failed to upload file to Cloud Storage. Saving locally as fallback:', error);
      }
    }

    // Local Disk Fallback
    const localDir = path.join(__dirname, `../../uploads/${folder}`);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    const localFilePath = path.join(localDir, fileName);
    fs.writeFileSync(localFilePath, file.buffer);
    console.log(`Saved ${fileName} locally to disk storage (${folder})`);
    return `/uploads/${folder}/${fileName}`;
  }
}

export const storageService = new StorageService();
