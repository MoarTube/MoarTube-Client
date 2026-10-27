import { BaseService } from './base.js';
import { uploadPool } from '@/utils/work-pool.js';
import type { Logger } from '@/utils/logger.js';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  ListBucketsCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketOwnershipControlsCommand,
  PutBucketPolicyCommand,
  PutBucketCorsCommand,
} from '@aws-sdk/client-s3';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import type { STSClientConfig } from '@aws-sdk/client-sts';
import { Readable } from 'node:stream';
import { transformManifest } from '@/utils/manifest-transform.js';
import * as fs from 'node:fs';
import type { S3ProviderClientConfig as S3ProviderClientConfigType } from '@/types/node-api.js';

/**
 * Service for S3 Operations
 * Replaces _src/utils/s3-communications.js
 */

export interface S3ValidationConfig {
  bucketName: string;
  s3ProviderClientConfig: S3ProviderClientConfigType;
}

export interface VideoForManifestUpdate {
  videoId: string;
  isPublished?: boolean;
  outputs?: {
    m3u8?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class S3Service extends BaseService {
  private client: S3Client | undefined;
  private clientKey = '';
  public close(): void {
    this.client?.destroy();
    this.client = undefined;
    this.clientKey = '';
  }

  constructor(logger: Logger) {
    super('s3Service', logger);
  }

  private createClientFromConfig(s3ProviderClientConfig: S3ProviderClientConfigType): S3Client {
    const key = JSON.stringify(s3ProviderClientConfig);
    if (this.client && key === this.clientKey) {
      return this.client;
    }
    this.close();
    const config: S3ClientConfig = {
      region: s3ProviderClientConfig.region ?? 'us-east-1',
      credentials: {
        accessKeyId: s3ProviderClientConfig.credentials.accessKeyId,
        secretAccessKey: s3ProviderClientConfig.credentials.secretAccessKey,
        ...(s3ProviderClientConfig.credentials.sessionToken !== undefined &&
        s3ProviderClientConfig.credentials.sessionToken !== ''
          ? { sessionToken: s3ProviderClientConfig.credentials.sessionToken }
          : {}),
      },
      forcePathStyle: s3ProviderClientConfig.forcePathStyle ?? true,
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000 },
    };
    if (s3ProviderClientConfig.endpoint !== undefined && s3ProviderClientConfig.endpoint !== '') {
      config.endpoint = s3ProviderClientConfig.endpoint;
    }

    this.clientKey = key;
    this.client = new S3Client(config);
    return this.client;
  }

  public async validateS3Config(s3Config: S3ValidationConfig): Promise<void> {
    const { bucketName, s3ProviderClientConfig } = s3Config;
    this.logger.debug(`Validating S3 config for bucket: ${bucketName}`);
    const s3Client = this.createClientFromConfig(s3ProviderClientConfig);

    // Check if bucket exists
    const buckets = (await s3Client.send(new ListBucketsCommand({}))).Buckets ?? [];
    const bucketExists = buckets.some((b) => b.Name === bucketName);

    if (bucketExists) {
      this.logger.debug('Bucket exists');
    } else {
      this.logger.debug(`Creating bucket: ${bucketName}`);
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));

      // Configure Public Access
      try {
        await s3Client.send(
          new PutPublicAccessBlockCommand({
            Bucket: bucketName,
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: false,
              IgnorePublicAcls: false,
              BlockPublicPolicy: false,
              RestrictPublicBuckets: false,
            },
          })
        );
      } catch {
        /* Ignore */
      }

      // Disable ACLs
      try {
        await s3Client.send(
          new PutBucketOwnershipControlsCommand({
            Bucket: bucketName,
            OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
          })
        );
      } catch {
        /* Ignore */
      }

      // Set Policy
      try {
        const { endpoint, region, credentials } = s3ProviderClientConfig;

        const stsConfig: STSClientConfig = {
          credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            ...(credentials.sessionToken !== undefined && credentials.sessionToken !== ''
              ? { sessionToken: credentials.sessionToken }
              : {}),
          },
          region: region ?? 'us-east-1',
        };
        if (endpoint !== undefined && endpoint !== '') {
          stsConfig.endpoint = endpoint;
        }

        const stsClient = new STSClient(stsConfig);
        const principalArn = (await stsClient.send(new GetCallerIdentityCommand({}))).Arn;

        await s3Client.send(
          new PutBucketPolicyCommand({
            Bucket: bucketName,
            Policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Sid: 'PublicGetObject',
                  Effect: 'Allow',
                  Principal: '*',
                  Action: 's3:GetObject',
                  Resource: `arn:aws:s3:::${bucketName}/*`,
                },
                {
                  Sid: 'PrivateDeleteObject',
                  Effect: 'Allow',
                  Principal: { AWS: principalArn },
                  Action: 's3:DeleteObject',
                  Resource: `arn:aws:s3:::${bucketName}/*`,
                },
                {
                  Sid: 'PrivatePutObject',
                  Effect: 'Allow',
                  Principal: { AWS: principalArn },
                  Action: 's3:PutObject',
                  Resource: `arn:aws:s3:::${bucketName}/*`,
                },
              ],
            }),
          })
        );
      } catch {
        // Fallback policy: some non-AWS S3-compatible providers (e.g. DigitalOcean
        // Spaces, Minio) don't support STS GetCallerIdentity, so we can't scope
        // delete/put to a specific principal. Grant only public read in that case -
        // never public write/delete - matching the legacy security posture.
        await s3Client.send(
          new PutBucketPolicyCommand({
            Bucket: bucketName,
            Policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Sid: 'PublicFullAccess',
                  Effect: 'Allow',
                  Principal: '*',
                  Action: 's3:GetObject',
                  Resource: `arn:aws:s3:::${bucketName}/*`,
                },
              ],
            }),
          })
        );
      }

      // Configure CORS so browsers can fetch video segments/manifests directly
      // from the bucket when served cross-origin.
      try {
        await s3Client.send(
          new PutBucketCorsCommand({
            Bucket: bucketName,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedHeaders: ['*'],
                  AllowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'],
                  AllowedOrigins: ['*'],
                  ExposeHeaders: [],
                },
              ],
            },
          })
        );
      } catch {
        /* Ignore */
      }
    }

    // Verify the supplied credentials actually have read/write/delete access by
    // round-tripping a test object. Run this unconditionally (not just for newly
    // created buckets) so misconfigured credentials are caught immediately here
    // rather than later during video publishing/uploading.
    this.logger.debug('Verifying MoarTube Client can put/get/delete a test object in the bucket');
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: 'Moartube-Client-Test',
        Body: 'testing',
        ContentType: 'text/plain; charset=utf-8',
      })
    );
    await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: 'Moartube-Client-Test' }));
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: bucketName, Key: 'Moartube-Client-Test' })
    );
    this.logger.debug('S3 provider credentials validated');
  }

  public async updateM3u8ManifestsWithExternalVideosBaseUrl(
    s3Config: S3ValidationConfig,
    videosData: VideoForManifestUpdate[],
    externalVideosBaseUrl: string
  ): Promise<void> {
    const { bucketName, s3ProviderClientConfig } = s3Config;
    const s3Client = this.createClientFromConfig(s3ProviderClientConfig);

    const performUpdate = async (manifestKey: string): Promise<void> => {
      try {
        const response = await s3Client.send(
          new GetObjectCommand({ Bucket: bucketName, Key: manifestKey })
        );
        if (!response.Body) {
          return;
        }

        const body = response.Body as Readable;
        try {
          const rewritten = Readable.from(
            transformManifest(body, (line) =>
              line.replaceAll(/(https?:\/\/).*?(\/external\/)/g, externalVideosBaseUrl + '$2')
            )
          );
          await this.putObjectFromData(
            s3Config,
            manifestKey,
            rewritten,
            'application/vnd.apple.mpegurl'
          );
        } finally {
          body.destroy();
        }
      } catch {
        // Ignore errors as per legacy
      }
    };

    for (const videoData of videosData) {
      if (videoData.isPublished === true && (videoData.outputs?.m3u8?.length ?? 0) > 0) {
        const masterManifestKey = `external/videos/${videoData.videoId}/adaptive/m3u8/static/manifests/manifest-master.m3u8`;
        await performUpdate(masterManifestKey);

        for (const resolution of videoData.outputs?.m3u8 ?? []) {
          const manifestKey = `external/videos/${videoData.videoId}/adaptive/m3u8/static/manifests/manifest-${resolution}.m3u8`;
          await performUpdate(manifestKey);
        }
      }
    }
  }

  /**
   * Upload data directly
   */
  public async putObjectFromData(
    s3Config: S3ValidationConfig,
    key: string,
    data: Buffer | string | Readable | Blob | Uint8Array,
    contentType: string,
    signal?: AbortSignal
  ): Promise<void> {
    const { bucketName, s3ProviderClientConfig } = s3Config;
    const client = this.createClientFromConfig(s3ProviderClientConfig);

    const release = await uploadPool.acquire();
    try {
      signal?.throwIfAborted();
      const upload = new Upload({
        client,
        queueSize: 1,
        partSize: 5 * 1024 ** 2,
        params: {
          Bucket: bucketName,
          Key: key,
          Body: data,
          ContentType: contentType,
        },
      });

      const abort = (): void => {
        void upload.abort().catch(() => {});
      };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        await upload.done();
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    } catch (error) {
      this.logger.error(`Failed to put object ${key}`, error as Error);
      throw error;
    } finally {
      release();
    }
  }

  public async uploadFilesWithProgress(
    s3Config: S3ValidationConfig,
    files: Array<{ key: string; filePath: string; contentType: string }>,
    onProgress: (percent: number) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const { bucketName, s3ProviderClientConfig } = s3Config;
    const client = this.createClientFromConfig(s3ProviderClientConfig);

    // Calculate total size
    let totalSize = 0;
    for (const file of files) {
      const stats = await fs.promises.stat(file.filePath);
      totalSize += stats.size;
    }

    if (totalSize === 0) {
      onProgress(100);
      return;
    }

    let nextIndex = 0,
      completedBytes = 0,
      failed = false;
    const pending = new Set<Upload>();
    const workers = Array.from({ length: 2 }, async () => {
      while (!failed) {
        const file = files[nextIndex++];
        if (!file) {
          break;
        }
        await uploadPool.run(async () => {
          signal?.throwIfAborted();
          if (failed) {
            return;
          }
          const size = (await fs.promises.stat(file.filePath)).size;
          const input = fs.createReadStream(file.filePath);
          const upload = new Upload({
            client,
            queueSize: 1,
            partSize: 5 * 1024 ** 2,
            params: {
              Bucket: bucketName,
              Key: file.key,
              Body: input,
              ContentType: file.contentType,
            },
          });
          pending.add(upload);
          let loaded = 0;
          upload.on('httpUploadProgress', (progress) => {
            const next = Math.max(loaded, Math.min(size, progress.loaded ?? 0));
            completedBytes += next - loaded;
            loaded = next;
            onProgress(Math.min(99, Math.floor((completedBytes / totalSize) * 100)));
          });
          const abort = (): void => {
            void upload.abort().catch(() => {});
          };
          signal?.addEventListener('abort', abort, { once: true });
          try {
            await upload.done();
            completedBytes += size - loaded;
            onProgress(Math.min(99, Math.floor((completedBytes / totalSize) * 100)));
          } catch (error) {
            failed = true;
            await Promise.allSettled([...pending].map((other) => other.abort()));
            throw error;
          } finally {
            signal?.removeEventListener('abort', abort);
            pending.delete(upload);
            input.destroy();
          }
        });
      }
    });
    const results = await Promise.allSettled(workers);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      throw failure.reason;
    }
    onProgress(100);
  }

  public async deleteObjectsWithPrefix(
    s3Config: S3ValidationConfig,
    prefix: string
  ): Promise<void> {
    const { bucketName: bucket, s3ProviderClientConfig } = s3Config;
    const client = this.createClientFromConfig(s3ProviderClientConfig);

    try {
      // ListObjectsV2 returns at most 1000 keys per page, so we must page through
      // the full listing (via ContinuationToken) before we can be sure everything
      // under this prefix has been deleted.
      let continuationToken: string | undefined;

      do {
        const listResponse = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        const contents = listResponse.Contents ?? [];

        if (contents.length > 0) {
          // DeleteObjectsCommand also accepts at most 1000 keys per call, which
          // matches the page size returned above, so one delete call per page suffices.
          const objectsToDelete = contents.map((obj) => ({ Key: obj.Key }));

          await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: {
                Objects: objectsToDelete,
                Quiet: true,
              },
            })
          );
        }

        continuationToken =
          listResponse.IsTruncated === true ? listResponse.NextContinuationToken : undefined;
      } while (continuationToken !== undefined);
    } catch (error) {
      this.logger.error(`Failed to delete prefix ${prefix}`, error as Error);
      throw error;
    }
  }

  /**
   * Delete "directory" (objects with prefix) in S3
   */
  public async deleteDirectoryRecursive(
    s3Config: S3ValidationConfig,
    prefix: string
  ): Promise<void> {
    await this.deleteObjectsWithPrefix(s3Config, prefix);
  }

  /**
   * Delete a single object with specific key
   */
  public async deleteObjectWithKey(s3Config: S3ValidationConfig, key: string): Promise<void> {
    const { bucketName, s3ProviderClientConfig } = s3Config;
    const client = this.createClientFromConfig(s3ProviderClientConfig);

    try {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });

      await client.send(deleteCommand);
    } catch (error) {
      this.logger.error(`Failed to delete object with key ${key}`, error as Error);
      throw error;
    }
  }

  /**
   * Convert dynamic HLS manifests to static VOD manifests
   */
  public async convertM3u8DynamicManifestsToStatic(
    s3Config: S3ValidationConfig,
    videoId: string,
    resolutions: string[]
  ): Promise<void> {
    const { bucketName, s3ProviderClientConfig } = s3Config;
    const client = this.createClientFromConfig(s3ProviderClientConfig);

    const performConversion = async (dynamicKey: string, staticKey: string): Promise<void> => {
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: bucketName, Key: dynamicKey })
        );

        if (!response.Body) {
          throw new Error('Empty response body');
        }

        const body = response.Body as Readable;
        try {
          const master = dynamicKey.includes('manifest-master.m3u8');
          const rewritten = Readable.from(
            transformManifest(
              body,
              (line) => (master ? line.replaceAll('/dynamic/', '/static/') : line),
              !master
            )
          );
          await this.putObjectFromData(
            s3Config,
            staticKey,
            rewritten,
            'application/vnd.apple.mpegurl'
          );
        } finally {
          body.destroy();
        }

        this.logger.debug(`Deleting dynamic manifest: ${dynamicKey}`);
        await client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: dynamicKey }));
      } catch (error) {
        // Log but continue
        this.logger.error(
          `Error converting manifest ${dynamicKey} to ${staticKey}`,
          error as Error
        );
      }
    };

    await performConversion(
      'external/videos/' + videoId + '/adaptive/m3u8/dynamic/manifests/manifest-master.m3u8',
      'external/videos/' + videoId + '/adaptive/m3u8/static/manifests/manifest-master.m3u8'
    );
    for (const resolution of resolutions) {
      const dynamicManifestKey = `external/videos/${videoId}/adaptive/m3u8/dynamic/manifests/manifest-${resolution}.m3u8`;
      const staticManifestKey = `external/videos/${videoId}/adaptive/m3u8/static/manifests/manifest-${resolution}.m3u8`;

      await performConversion(dynamicManifestKey, staticManifestKey);
    }
  }
}
