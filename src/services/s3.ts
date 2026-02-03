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
  PutBucketPolicyCommand
} from '@aws-sdk/client-s3';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'node:fs';
import type { S3Config } from '@/types/node-api.js';

/**
 * Service for S3 Operations
 * Replaces _src/utils/s3-communications.js
 */
export class S3Service extends BaseService {
  constructor(logger: Logger) {
    super('s3Service', logger);
  }

  private createClient(endpoint: string | undefined, accessKeyId: string, secretAccessKey: string, sessionToken?: string): S3Client {
    const credentials: any = {
      accessKeyId,
      secretAccessKey
    };
    if (sessionToken) {
      credentials.sessionToken = sessionToken;
    }

    const config: any = {
      region: 'us-east-1', // Placeholder region
      credentials,
      forcePathStyle: true
    };
    if (endpoint) {
        config.endpoint = endpoint;
    }

    return new S3Client(config);
  }

  // Helper method to convert stream to string
  private async streamToString(stream: any): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: any[] = [];
        stream.on('data', (chunk: any) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')); });
    }); 
  }

  public async validateS3Config(s3Config: any): Promise<void> {
      const { bucketName, s3ProviderClientConfig } = s3Config;
      const { endpoint, credentials: { accessKeyId, secretAccessKey, sessionToken } } = s3ProviderClientConfig;

      this.logger.debug(`Validating S3 config for bucket: ${bucketName}`);
      const s3Client = this.createClient(endpoint, accessKeyId, secretAccessKey, sessionToken);

      // Check if bucket exists
      const buckets = (await s3Client.send(new ListBucketsCommand({}))).Buckets || [];
      const bucketExists = buckets.some(b => b.Name === bucketName);

      if (bucketExists) {
           this.logger.debug('Bucket exists');
      } else {
           this.logger.debug(`Creating bucket: ${bucketName}`);
           await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
           
           // Configure Public Access
           try {
              await s3Client.send(new PutPublicAccessBlockCommand({
                  Bucket: bucketName,
                  PublicAccessBlockConfiguration: {
                      BlockPublicAcls: false,
                      IgnorePublicAcls: false,
                      BlockPublicPolicy: false,
                      RestrictPublicBuckets: false
                  }
              }));
           } catch { /* Ignore */ }

           // Disable ACLs
           try {
               await s3Client.send(new PutBucketOwnershipControlsCommand({
                   Bucket: bucketName, 
                   OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] }
               }));
           } catch { /* Ignore */ }

           // Set Policy
            try {
                const stsClient = new STSClient({
                     ...s3ProviderClientConfig,
                     region: 'us-east-1',
                     endpoint
                });
                const principalArn = (await stsClient.send(new GetCallerIdentityCommand({}))).Arn;
                
                await s3Client.send(new PutBucketPolicyCommand({
                    Bucket: bucketName,
                    Policy: JSON.stringify({
                        Version: "2012-10-17",
                        Statement: [
                            { Sid: "PublicGetObject", Effect: "Allow", Principal: "*", Action: "s3:GetObject", Resource: `arn:aws:s3:::${bucketName}/*` },
                            { Sid: "PrivateDeleteObject", Effect: "Allow", Principal: { AWS: principalArn }, Action: "s3:DeleteObject", Resource: `arn:aws:s3:::${bucketName}/*` },
                            { Sid: "PrivatePutObject", Effect: "Allow", Principal: { AWS: principalArn }, Action: "s3:PutObject", Resource: `arn:aws:s3:::${bucketName}/*` }
                        ]
                    })
                }));
            } catch (err) {
                 // Fallback policy
                 await s3Client.send(new PutBucketPolicyCommand({
                    Bucket: bucketName,
                    Policy: JSON.stringify({
                         Version: "2012-10-17",
                         Statement: [
                            { Sid: "PublicFullAccess", Effect: "Allow", Principal: "*", Action: "s3:*", Resource: `arn:aws:s3:::${bucketName}/*` }
                         ]
                    })
                 }));
            }
      }
  }

  public async updateM3u8ManifestsWithExternalVideosBaseUrl(s3Config: any, videosData: any[], externalVideosBaseUrl: string): Promise<void> {
      const { bucketName, s3ProviderClientConfig } = s3Config;
      const { endpoint, credentials: { accessKeyId, secretAccessKey, sessionToken } } = s3ProviderClientConfig; // Assuming passed structure matches what I construct
      // Note: Legacy passed structure might differ slightly. I should assume s3Config matches the legacy structure: 
      // { bucketName, s3ProviderClientConfig: { endpoint, credentials... } }

      const s3Client = this.createClient(endpoint, accessKeyId, secretAccessKey, sessionToken);

      const performUpdate = async (manifestKey: string) => {
          try {
              const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: manifestKey }));
              if (!response.Body) {return;}

              const oldManifest = await this.streamToString(response.Body);
              // Regex from legacy code
              const newManifest = oldManifest.replace(/(https?:\/\/).*?(\/external\/)/g, externalVideosBaseUrl + "$2");
              
              await s3Client.send(new PutObjectCommand({ 
                  Bucket: bucketName, 
                  Key: manifestKey, 
                  Body: newManifest, 
                  ContentType: 'application/vnd.apple.mpegurl' 
              }));
          } catch (error) {
              // Ignore errors as per legacy
          }
      };

      for (const videoData of videosData) {
          if (videoData.isPublished && videoData.outputs?.m3u8?.length > 0) {
              const masterManifestKey = `external/videos/${videoData.videoId}/adaptive/m3u8/static/manifests/manifest-master.m3u8`;
              await performUpdate(masterManifestKey);

              for (const resolution of videoData.outputs.m3u8) {
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
    s3Config: any,
    key: string, data: any, contentType: string
  ): Promise<void> {
    const { endpoint, accessKeyId, secretAccessKey, sessionToken, bucketName } = s3Config;
    const client = this.createClient(endpoint, accessKeyId, secretAccessKey, sessionToken);
    
    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: data,
        ContentType: contentType
      });
      await client.send(command);
    } catch (error) {
      this.logger.error(`Failed to put object ${key}`, error);
      throw error;
    }
  }

  /**
   * Upload file with progress tracking
   */
  public async uploadFile(
    endpoint: string, accessKeyId: string, secretAccessKey: string, sessionToken: string | undefined,
    bucket: string, key: string, filePath: string, contentType: string
  ): Promise<void> {
    const client = this.createClient(endpoint, accessKeyId, secretAccessKey, sessionToken);
    const fileStream = fs.createReadStream(filePath);

    try {
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: fileStream,
          ContentType: contentType
        }
      });

      upload.on('httpUploadProgress', (_progress) => {
        // Logging debug progress might be too verbose, can enable if needed
        // this.logger.debug(`Upload progress ${key}: ${progress.loaded}/${progress.total}`);
      });

      await upload.done();
    } catch (error) {
      this.logger.error(`Failed to upload file ${filePath} to ${key}`, error);
      throw error;
    }
  }

  public async deleteObjectsWithPrefix(
      endpoint: string | undefined, accessKeyId: string, secretAccessKey: string, sessionToken: string | undefined,
      bucket: string, prefix: string
  ): Promise<void> {
      const client = this.createClient(endpoint, accessKeyId, secretAccessKey, sessionToken);

      try {
          // List objects first
          const listCommand = new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix
          });
          const listResponse = await client.send(listCommand);

          if (!listResponse.Contents || listResponse.Contents.length === 0) {return;}

          const objectsToDelete = listResponse.Contents.map(obj => ({ Key: obj.Key }));

          const deleteCommand = new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: {
                  Objects: objectsToDelete,
                  Quiet: true
              }
          });

          await client.send(deleteCommand);
      } catch (error) {
          this.logger.error(`Failed to delete prefix ${prefix}`, error);
          throw error;
      }
  }

  /**
   * Delete "directory" (objects with prefix) in S3
   */
  public async deleteDirectoryRecursive(s3Config: S3Config, prefix: string): Promise<void> {
      // s3Config comes from node settings, extracting credentials
      const { endpoint, accessKeyId, secretAccessKey, sessionToken, bucket, bucketName } = s3Config;
      const actualBucket = (bucket as string) || bucketName; // Support legacy 'bucket' prop if present
      const region = s3Config.region;
      
      await this.deleteObjectsWithPrefix(endpoint as string, accessKeyId, secretAccessKey, sessionToken as string, actualBucket as string, prefix);
  }

  /**
   * Delete a single object with specific key
   */
  public async deleteObjectWithKey(s3Config: S3Config, key: string): Promise<void> {
      const { endpoint, accessKeyId, secretAccessKey, sessionToken, bucket, bucketName } = s3Config;
      const actualBucket = (bucket as string) || bucketName; // Support legacy 'bucket' prop if present
      const region = s3Config.region;

      const config: any = {
          region,
          credentials: {
              accessKeyId,
              secretAccessKey,
              sessionToken: sessionToken as string | undefined
          },
          forcePathStyle: true
      };
      if (endpoint) {
          config.endpoint = endpoint;
      }

      const client = new S3Client(config);

      try {
          const deleteCommand = new DeleteObjectCommand({
              Bucket: actualBucket as string,
              Key: key
          });
          
          await client.send(deleteCommand);
      } catch (error) {
          this.logger.error(`Failed to delete object with key ${key}`, error);
          throw error;
      }
  }

  /**
   * Convert dynamic HLS manifests to static VOD manifests
   */
  public async convertM3u8DynamicManifestsToStatic(
    s3Config: S3Config,
    videoId: string,
    resolutions: string[]
  ): Promise<void> {
    const { endpoint, accessKeyId, secretAccessKey, sessionToken, bucketName, bucket } = s3Config;
    const actualBucket = bucketName || bucket;
    
    const client = this.createClient(endpoint, accessKeyId, secretAccessKey, sessionToken);

    const performConversion = async (dynamicKey: string, staticKey: string) => {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: actualBucket, Key: dynamicKey }));

        if (!response.Body) {
          throw new Error('Empty response body');
        }

        const dynamicManifest = await response.Body.transformToString('utf-8');

        let staticManifest: string;
        if (dynamicKey.includes('manifest-master.m3u8')) {
          staticManifest = dynamicManifest.replace(/\/dynamic\//g, '/static/');
        } else {
          // Convert EVENT to VOD and end list
          staticManifest = dynamicManifest.replace('#EXT-X-PLAYLIST-TYPE:EVENT', '#EXT-X-PLAYLIST-TYPE:VOD');
          staticManifest = staticManifest.trim() + '\n#EXT-X-ENDLIST\n';
        }

        this.logger.debug(`Uploading static manifest: ${staticKey}`);
        await client.send(new PutObjectCommand({
          Bucket: actualBucket,
          Key: staticKey,
          Body: staticManifest,
          ContentType: 'application/vnd.apple.mpegurl'
        }));

        this.logger.debug(`Deleting dynamic manifest: ${dynamicKey}`);
        await client.send(new DeleteObjectCommand({ Bucket: actualBucket, Key: dynamicKey }));

      } catch (error) {
        // Log but continue
        this.logger.error(`Error converting manifest ${dynamicKey} to ${staticKey}`, error);
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
