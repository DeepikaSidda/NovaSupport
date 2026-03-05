/**
 * S3 client utilities for NovaSupport
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const client = new S3Client({});
export const BUCKET_NAME = process.env.ATTACHMENTS_BUCKET_NAME || 'novasupport-attachments';

/**
 * Upload a file to S3
 */
export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

/**
 * Get a file from S3
 */
export async function getFile(key: string): Promise<Buffer> {
  const response = await client.send(new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));
  
  const stream = response.Body as any;
  const chunks: Uint8Array[] = [];
  
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  
  return Buffer.concat(chunks);
}

/**
 * Generate a presigned URL for file upload
 */
export async function getUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  
  return await getSignedUrl(client, command, { expiresIn: 3600 }); // 1 hour
}

/**
 * Generate a presigned URL for file download
 */
export async function getDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  
  return await getSignedUrl(client, command, { expiresIn: 3600 }); // 1 hour
}

/**
 * Delete a file from S3
 */
export async function deleteFile(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  }));
}
