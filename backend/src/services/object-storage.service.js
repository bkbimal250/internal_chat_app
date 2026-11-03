import { createHash, randomBytes } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../utils/app-error.js';

export function createStorageKey() {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `att/${stamp}/${randomBytes(32).toString('hex')}`;
}

export function objectStorage(config, logger) {
  const enabled = Boolean(config.s3Endpoint && config.s3AccessKey && config.s3SecretKey);
  const shared = {
    region: config.s3Region,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: enabled
      ? { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey }
      : undefined,
  };
  const internal = enabled
    ? new S3Client({ ...shared, endpoint: config.s3Endpoint })
    : null;
  const publicClient = enabled
    ? new S3Client({ ...shared, endpoint: config.s3PublicEndpoint || config.s3Endpoint })
    : null;
  const bucket = config.s3Bucket;
  const requireEnabled = () => {
    if (!enabled) throw new AppError('File storage is unavailable', 503, 'STORAGE_UNAVAILABLE');
  };

  return {
    enabled,
    async ready() {
      if (!enabled) return 'unconfigured';
      try {
        await internal.send(new HeadBucketCommand({ Bucket: bucket }));
        return 'connected';
      } catch {
        return 'disconnected';
      }
    },
    async ensureBucket() {
      if (!enabled) return;
      try {
        await internal.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (!config.s3CreateBucket) {
          logger?.warn(
            { err: error, code: 'STORAGE_BUCKET_MISSING' },
            'S3 bucket is missing and S3_CREATE_BUCKET is disabled',
          );
          return;
        }
        await internal.send(new CreateBucketCommand({ Bucket: bucket }));
      }
      const origins = config.corsOrigins.length
        ? config.corsOrigins
        : config.nodeEnv === 'production'
          ? []
          : ['http://127.0.0.1:5173'];
      if (origins.length) {
        await internal.send(
          new PutBucketCorsCommand({
            Bucket: bucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedOrigins: origins,
                  AllowedMethods: ['GET', 'PUT', 'HEAD'],
                  AllowedHeaders: ['*'],
                  ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type'],
                  MaxAgeSeconds: 3600,
                },
              ],
            },
          }),
        );
      }
      await internal
        .send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: bucket,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'abort-abandoned-multipart',
                  Status: 'Enabled',
                  Filter: { Prefix: 'att/' },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
                },
              ],
            },
          }),
        )
        .catch((error) => {
          logger?.warn({ err: error, code: 'STORAGE_LIFECYCLE_FAILED' }, 'Unable to apply S3 lifecycle rules');
        });
    },
    async presignUpload(key, mimeType, expiresIn) {
      requireEnabled();
      return getSignedUrl(
        publicClient,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType }),
        { expiresIn },
      );
    },
    async presignDownload(key, { mimeType, fileName, inline, expiresIn }) {
      requireEnabled();
      const disposition = `${inline ? 'inline' : 'attachment'}; filename="${fileName.replace(/"/g, '')}"`;
      return getSignedUrl(
        publicClient,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentType: mimeType,
          ResponseContentDisposition: disposition,
        }),
        { expiresIn },
      );
    },
    async head(key) {
      requireEnabled();
      try {
        return await internal.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null;
        throw error;
      }
    },
    async getObjectBuffer(key, maxBytes) {
      requireEnabled();
      const object = await internal.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks = [];
      let size = 0;
      for await (const chunk of object.Body) {
        size += chunk.length;
        if (size > maxBytes) throw new AppError('File is too large', 413, 'PAYLOAD_TOO_LARGE');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
    async putObject(key, body, mimeType) {
      requireEnabled();
      await internal.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mimeType }),
      );
    },
    async copyObject(sourceKey, destinationKey) {
      requireEnabled();
      await internal.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: destinationKey,
          CopySource: `${bucket}/${sourceKey}`,
        }),
      );
    },
    async remove(key) {
      if (!enabled || !key) return;
      try {
        await internal.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        logger?.warn({ code: 'STORAGE_DELETE_FAILED' }, 'Unable to delete object');
        throw error;
      }
    },
    sha256(buffer) {
      return createHash('sha256').update(buffer).digest('hex');
    },
    async getObjectRange(key, start, end) {
      requireEnabled();
      const object = await internal.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=${start}-${end}`,
        }),
      );
      const chunks = [];
      let size = 0;
      const max = Math.max(0, end - start + 1);
      for await (const chunk of object.Body) {
        size += chunk.length;
        chunks.push(chunk);
        if (size >= max) break;
      }
      const buffer = Buffer.concat(chunks);
      return buffer.subarray(0, max);
    },
    async hashObject(key) {
      requireEnabled();
      const object = await internal.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const hash = createHash('sha256');
      for await (const chunk of object.Body) {
        hash.update(chunk);
      }
      return hash.digest('hex');
    },
    async createMultipartUpload(key, mimeType) {
      requireEnabled();
      const result = await internal.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: mimeType,
        }),
      );
      if (!result.UploadId) throw new AppError('Unable to start multipart upload', 503, 'STORAGE_UNAVAILABLE');
      return result.UploadId;
    },
    async presignUploadPart(key, uploadId, partNumber, expiresIn) {
      requireEnabled();
      return getSignedUrl(
        publicClient,
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn },
      );
    },
    async listParts(key, uploadId) {
      requireEnabled();
      const parts = [];
      let marker;
      for (;;) {
        const page = await internal.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        );
        for (const part of page.Parts ?? []) {
          parts.push({
            partNumber: part.PartNumber,
            etag: part.ETag,
            sizeBytes: Number(part.Size ?? 0),
          });
        }
        if (!page.IsTruncated) break;
        marker = page.NextPartNumberMarker;
      }
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },
    async completeMultipart(key, uploadId, parts) {
      requireEnabled();
      await internal.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({ ETag: part.etag, PartNumber: part.partNumber })),
          },
        }),
      );
    },
    async abortMultipart(key, uploadId) {
      if (!enabled || !key || !uploadId) return;
      try {
        await internal.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
          }),
        );
      } catch {
        logger?.warn({ code: 'STORAGE_ABORT_FAILED' }, 'Unable to abort multipart upload');
      }
    },
  };
}
