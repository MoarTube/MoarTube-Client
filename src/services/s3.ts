import { BaseService } from './base.js';
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
import type { Readable } from 'node:stream';
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
  constructor(logger: Logger) {
    super('s3Service', logger);
  }

  private createClientFromConfig(s3ProviderClientConfig: S3ProviderClientConfigType): S3Client {
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
    };
    if (s3ProviderClientConfig.endpoint !== undefined && s3ProviderClientConfig.endpoint !== '') {
      config.endpoint = s3ProviderClientConfig.endpoint;
    }

    return new S3Client(config);
  }

  // Helper method to convert stream to string
  private async streamToString(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
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

        const oldManifest = await this.streamToString(response.Body as Readable);
        // Regex from legacy code
        const newManifest = oldManifest.replaceAll(
          /(https?:\/\/).*?(\/external\/)/g,
          externalVideosBaseUrl + '$2'
        );

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: manifestKey,
            Body: newManifest,
            ContentType: 'application/vnd.apple.mpegurl',
          })
        );
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
    contentType: string
  ): Promise<void> {
    const { bucketName, s3ProviderClientConfig } = s3Config;
    const client = this.createClientFromConfig(s3ProviderClientConfig);

    try {
      const upload = new Upload({
        client,
        params: {
          Bucket: bucketName,
          Key: key,
          Body: data,
          ContentType: contentType,
        },
      });

      await upload.done();
    } catch (error) {
      this.logger.error(`Failed to put object ${key}`, error as Error);
      throw error;
    }
  }

  public async uploadFilesWithProgress(
    s3Config: S3ValidationConfig,
    files: Array<{ key: string; filePath: string; contentType: string }>,
    onProgress: (percent: number) => void
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

    const CONCURRENCY_LIMIT = 5;
    const fileProgress = new Map<string, number>();

    // Helper to run a single upload
    const uploadFile = async (file: {
      key: string;
      filePath: string;
      contentType: string;
    }): Promise<void> => {
      const fileStream = fs.createReadStream(file.filePath);

      try {
        const upload = new Upload({
          client,
          params: {
            Bucket: bucketName,
            Key: file.key,
            Body: fileStream,
            ContentType: file.contentType,
          },
        });

        upload.on('httpUploadProgress', (progress) => {
          if (progress.loaded !== undefined) {
            fileProgress.set(file.key, progress.loaded);

            let currentTotal = 0;
            for (const size of fileProgress.values()) {
              currentTotal += size;
            }

            const percent = Math.min(100, Math.round((currentTotal / totalSize) * 100));
            onProgress(percent);
          }
        });

        await upload.done();
        // Ensure we mark full size done in case progress didn't fire exactly at end
        const stats = await fs.promises.stat(file.filePath);
        fileProgress.set(file.key, stats.size);
      } catch (error) {
        this.logger.error(`Failed to upload ${file.key}`, error as Error);
        throw error;
      }
    };

    // Worker Queue
    const queue = [...files];
    const workers = [];

    for (let i = 0; i < CONCURRENCY_LIMIT; i++) {
      workers.push(
        (async (): Promise<void> => {
          while (queue.length > 0) {
            const file = queue.shift();
            if (file) {
              await uploadFile(file);
            }
          }
        })()
      );
    }

    await Promise.all(workers);
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

        const dynamicManifest = await response.Body.transformToString('utf-8');

        let staticManifest: string;
        if (dynamicKey.includes('manifest-master.m3u8')) {
          staticManifest = dynamicManifest.replaceAll('/dynamic/', '/static/');
        } else {
          // Convert EVENT to VOD and end list
          staticManifest = dynamicManifest.replace(
            '#EXT-X-PLAYLIST-TYPE:EVENT',
            '#EXT-X-PLAYLIST-TYPE:VOD'
          );
          staticManifest = staticManifest.trim() + '\n#EXT-X-ENDLIST\n';
        }

        this.logger.debug(`Uploading static manifest: ${staticKey}`);
        await client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: staticKey,
            Body: staticManifest,
            ContentType: 'application/vnd.apple.mpegurl',
          })
        );

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

    for (const resolution of resolutions) {
      const dynamicMasterManifestKey = `external/videos/${videoId}/adaptive/m3u8/dynamic/manifests/manifest-master.m3u8`;
      const staticMasterManifestKey = `external/videos/${videoId}/adaptive/m3u8/static/manifests/manifest-master.m3u8`;

      const dynamicManifestKey = `external/videos/${videoId}/adaptive/m3u8/dynamic/manifests/manifest-${resolution}.m3u8`;
      const staticManifestKey = `external/videos/${videoId}/adaptive/m3u8/static/manifests/manifest-${resolution}.m3u8`;

      await performConversion(dynamicMasterManifestKey, staticMasterManifestKey);
      await performConversion(dynamicManifestKey, staticManifestKey);
    }
  }
}
