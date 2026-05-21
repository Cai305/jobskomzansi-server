import { put } from '@vercel/blob';
import fs from 'fs';
import path from 'path';

class StorageService {
  private blobToken: string | null = null;

  constructor() {
    this.blobToken = process.env.BLOB_READ_WRITE_TOKEN || null;

    if (this.blobToken) {
      console.log('Vercel Blob Storage configured and ready.');
    } else {
      console.log('BLOB_READ_WRITE_TOKEN not set. Falling back to local disk storage.');
    }
  }

  /**
   * Uploads a file buffer to Vercel Blob or saves locally as fallback
   */
  async uploadFile(file: Express.Multer.File, folder: string = 'resumes'): Promise<string> {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileName = `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`;
    const key = `${folder}/${fileName}`;

    if (this.blobToken) {
      try {
        const blob = await put(key, file.buffer, {
          access: 'public',
          token: this.blobToken,
          contentType: file.mimetype,
        });

        console.log(`Successfully uploaded ${fileName} to Vercel Blob (${folder})`);
        return blob.url;
      } catch (error) {
        console.error('Failed to upload file to Vercel Blob. Saving locally as fallback:', error);
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
