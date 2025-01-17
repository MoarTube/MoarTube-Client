const fs = require('fs');
const { 
    S3Client, PutObjectCommand, ListBucketsCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command,
    GetObjectCommand, CreateBucketCommand, PutBucketOwnershipControlsCommand, PutBucketCorsCommand, PutBucketPolicyCommand,
    PutPublicAccessBlockCommand
} = require('@aws-sdk/client-s3');
const { 
    STSClient, GetCallerIdentityCommand 
} = require('@aws-sdk/client-sts');
const { 
    Upload 
} = require("@aws-sdk/lib-storage");


const { 
    logDebugMessageToConsole
 } = require('./helpers');

function s3_putObjectsFromFilePaths(s3Config, paths) {
    return new Promise(async function(resolve, reject) {
        const bucket = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        try {
            const s3Client = new S3Client(s3ProviderClientConfig);

            const responses = [];
            for(const path of paths) {
                const key = path.key;
                const fileStream = fs.createReadStream(path.filePath);

                const response = await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: fileStream }));

                responses.push(response);
            }

            resolve(responses);
        }
        catch (error) {
            reject(error);
        }
    });
}

function s3_putObjectsFromFilePathsWithProgress(s3Config, jwtToken, paths, videoId, format, resolution) {
    return new Promise(async function(resolve, reject) {
        const bucket = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        const { 
            websocketClientBroadcast
        } = require('../utils/helpers');

        const s3Client = new S3Client(s3ProviderClientConfig);

        try {
            const overallTotal = await paths.reduce(async (accPromise, path) => {
                const acc = await accPromise;
                const stats = await fs.promises.stat(path.filePath);

                return acc + stats.size;
            }, Promise.resolve(0));

            const progressMap = new Map();

            const responses = await Promise.all(paths.map(async (path) => {
                const key = path.key;
                const fileStream = fs.createReadStream(path.filePath);

                progressMap.set(key, 0);

                const upload = new Upload({client: s3Client, params: { Bucket: bucket, Key: key, Body: fileStream}});

                upload.on("httpUploadProgress", (progress) => {
                    if (progress.loaded) {
                        progressMap.set(key, progress.loaded);

                        const totalLoaded = Array.from(progressMap.values()).reduce((sum, loaded) => sum + loaded, 0);
                        const uploadProgress = Math.floor(((totalLoaded / overallTotal) * 100) / 2) + 50;

                        websocketClientBroadcast({eventName: "echo", jwtToken, data: {eventName: "video_status", payload: {type: "publishing", videoId, format, resolution, progress: uploadProgress}}});
                    }
                });

                return upload.done();
            }));

            resolve(responses);
        }
        catch (error) {
            console.error("Error during upload:", error.message);
            reject(error);
        }
    });
}

function s3_putObjectFromData(s3Config, key, data) {
    return new Promise(async function(resolve, reject) {
        const bucket = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        try {
            const s3Client = new S3Client(s3ProviderClientConfig);

            const response = await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));

            resolve(response);
        }
        catch (error) {
            reject(error);
        }
    });
}

function s3_deleteObjectWithKey(s3Config, key) {
    return new Promise(async function(resolve, reject) {
        const bucket = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        try {
            const s3Client = new S3Client(s3ProviderClientConfig);

            const response = await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

            resolve(response);
        }
        catch (error) {
            reject(error);
        }
    });
}

function s3_deleteObjectsWithPrefix(s3Config, prefix) {
    return new Promise(async function(resolve, reject) {
        const bucketName = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        try {
            const s3Client = new S3Client(s3ProviderClientConfig);

            let isTruncated = true;
            let continuationToken = null;
            while (isTruncated) {
                const listResponse = await s3Client.send(new ListObjectsV2Command({Bucket: bucketName, Prefix: prefix, ContinuationToken: continuationToken}));

                let objectsToDelete;
                if(listResponse.Contents != null) {
                    objectsToDelete = listResponse.Contents.map((object) => ({Key: object.Key}));
                }

                if (objectsToDelete != null) {
                    await s3Client.send(new DeleteObjectsCommand({Bucket: bucketName, Delete: { Objects: objectsToDelete}}));
                }

                isTruncated = listResponse.IsTruncated;
                continuationToken = listResponse.NextContinuationToken;
            }

            resolve();
        }
        catch(error) {
            reject(error);
        }
    });
}

function s3_convertM3u8DynamicManifestsToStatic(s3Config, videoId, resolutions) {
    return new Promise(async function(resolve, reject) {
        const bucketName = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        try {
            const s3Client = new S3Client(s3ProviderClientConfig);

            for (const resolution of resolutions) {
                const dynamicMasterManifestKey = 'external/videos/' + videoId + '/adaptive/m3u8/dynamic/manifests/manifest-master.m3u8';
                const staticMasterManifestKey = 'external/videos/' + videoId + '/adaptive/m3u8/static/manifests/manifest-master.m3u8';

                const dynamicManifestKey = 'external/videos/' + videoId + '/adaptive/m3u8/dynamic/manifests/manifest-' + resolution + '.m3u8';
                const staticManifestKey = 'external/videos/' + videoId + '/adaptive/m3u8/static/manifests/manifest-' + resolution + '.m3u8';
        
                await performConversion(dynamicMasterManifestKey, staticMasterManifestKey);
                await performConversion(dynamicManifestKey, staticManifestKey);
            }

            async function performConversion(dynamicKey, staticKey) {
                const response = await s3Client.send(new GetObjectCommand({Bucket: bucketName, Key: dynamicKey}));

                const dynamicManifest = await streamToString(response.Body);
                
                let staticManifest;
                if(!dynamicKey.includes('manifest-master.m3u8')) {
                    staticManifest = dynamicManifest.replace('#EXT-X-PLAYLIST-TYPE:EVENT', '#EXT-X-PLAYLIST-TYPE:VOD');
                    staticManifest = staticManifest.trim() + "\n#EXT-X-ENDLIST\n";
                }
                else {
                    staticManifest = dynamicManifest;
                }
                
                // Step 4: Upload the static manifest
                console.log(`Uploading static manifest: ${staticKey}`);
                await s3Client.send(new PutObjectCommand({Bucket: bucketName, Key: staticKey, Body: staticManifest, ContentType: "application/vnd.apple.mpegurl"}));
        
                // Step 5: Delete the dynamic manifest
                console.log(`Deleting dynamic manifest: ${dynamicKey}`);
                await s3Client.send(new DeleteObjectCommand({Bucket: bucketName, Key: dynamicKey}));
            }

            resolve();
        }
        catch(error) {
            reject(error);
        }
        
    });
}

function s3_updateM3u8ManifestsWithExternalVideosBaseUrl(s3Config, videosData, externalVideosBaseUrl) {
    return new Promise(async function(resolve, reject) {
        const bucketName = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        try {
            const s3Client = new S3Client(s3ProviderClientConfig);

            for (const videoData of videosData) {
                const videoId = videoData.video_id;
                const outputs = JSON.parse(videoData.outputs);

                if(outputs.m3u8.length > 0) {
                    const masterManifestKey = 'external/videos/' + videoId + '/adaptive/m3u8/static/manifests/manifest-master.m3u8';

                    await performUpdate(masterManifestKey);

                    for(const resolution of outputs.m3u8) {
                        const manifestKey = 'external/videos/' + videoId + '/adaptive/m3u8/static/manifests/manifest-' + resolution + '.m3u8';

                        await performUpdate(manifestKey);
                    }
                }
            }

            async function performUpdate(manifestKey) {
                const response = await s3Client.send(new GetObjectCommand({Bucket: bucketName, Key: manifestKey}));

                const oldManifest = await streamToString(response.Body);
                
                const newManifest = oldManifest.replace(/https?:\/\/[^/]+(?=\/external)/g, externalVideosBaseUrl);
                
                await s3Client.send(new PutObjectCommand({Bucket: bucketName, Key: manifestKey, Body: newManifest, ContentType: "application/vnd.apple.mpegurl"}));
            }

            resolve();
        }
        catch(error) {
            reject(error);
        }
    });
}

function s3_validateS3Config(s3Config) {
    return new Promise(async function(resolve, reject) {
        const bucketName = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        try {
            logDebugMessageToConsole('validating the s3 provider configuration', null, null);

            logDebugMessageToConsole('determining if bucket exists: ' + bucketName, null, null);

            const s3Client = new S3Client(s3ProviderClientConfig);

            const buckets = (await s3Client.send(new ListBucketsCommand({}))).Buckets;

            let bucketExists = false;
            for(const bucket of buckets) {
                if(bucket.Name === bucketName) {
                    bucketExists = true;
                    break;
                }
            }

            if(bucketExists) {
                logDebugMessageToConsole('bucket exists', null, null);
            }
            else {
                logDebugMessageToConsole('bucket does not exist', null, null);

                logDebugMessageToConsole('creating bucket: ' + bucketName, null, null);
                await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));

                logDebugMessageToConsole('configuring bucket for public access', null, null);
                const publicAccessBlockConfig = {
                    BlockPublicAcls: false,
                    IgnorePublicAcls: false,
                    BlockPublicPolicy: false,
                    RestrictPublicBuckets: false
                };
                await s3Client.send(new PutPublicAccessBlockCommand({Bucket: bucketName, PublicAccessBlockConfiguration: publicAccessBlockConfig}));

                logDebugMessageToConsole('disabling bucket ACLs', null, null);
                await s3Client.send(new PutBucketOwnershipControlsCommand({Bucket: bucketName, OwnershipControls: {Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }]}}));

                logDebugMessageToConsole('retrieving principal ARN', null, null);
                const stsClient = new STSClient(s3ProviderClientConfig);
                const principalArn = (await stsClient.send(new GetCallerIdentityCommand({}))).Arn;

                logDebugMessageToConsole('applying bucket policy', null, null);
                const bucketPolicy = {
                    Version: "2012-10-17",
                    Id: "Policy1551408741789",
                    Statement: [
                        {
                            Sid: "Stmt1551408240542",
                            Effect: "Allow",
                            Principal: "*",
                            Action: "s3:GetObject",
                            Resource: `arn:aws:s3:::${bucketName}/*`
                        },
                        {
                            Sid: "Stmt1551408506061",
                            Effect: "Allow",
                            Principal: {
                                AWS: principalArn
                            },
                            Action: "s3:DeleteObject",
                            Resource: `arn:aws:s3:::${bucketName}/*`
                        },
                        {
                            Sid: "Stmt1551408740505",
                            Effect: "Allow",
                            Principal: {
                                AWS: principalArn
                            },
                            Action: "s3:PutObject",
                            Resource: `arn:aws:s3:::${bucketName}/*`
                        }
                    ]
                };
                await s3Client.send(new PutBucketPolicyCommand({Bucket: bucketName, Policy: JSON.stringify(bucketPolicy)}));

                logDebugMessageToConsole('configuring bucket Cross-origin resource sharing (CORS)', null, null);
                const corsRules = [{AllowedHeaders: ['*'], AllowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'], AllowedOrigins: ['*'], ExposeHeaders: []}];
                await s3Client.send(new PutBucketCorsCommand({Bucket: bucketName, CORSConfiguration: { CORSRules: corsRules }}));
            }

            logDebugMessageToConsole('verifying ability for MoarTube Client to put a test object into the bucket', null, null);
            await s3Client.send(new PutObjectCommand({ Bucket: bucketName, Key: 'Moartube-Client-Test', Body: 'testing' }));
            logDebugMessageToConsole('MoarTube Client successfully put a test object into the bucket', null, null);

            logDebugMessageToConsole('verifying ability for MoarTube Client to delete a test object from the bucket', null, null);
            await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: 'Moartube-Client-Test' }));
            logDebugMessageToConsole('MoarTube Client successfully deleted a test object from the bucket', null, null);

            logDebugMessageToConsole('s3 provider credentials validated', null, null);

            resolve({isError: false});
        }
        catch (error) {
            const message = 'an error occured while validating the S3 provider configuration';

            logDebugMessageToConsole(message, error, null);

            reject(message);
        }
    });
}

async function streamToString(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];

      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      stream.on("error", reject);
    });
  }

module.exports = {
    s3_putObjectsFromFilePaths,
    s3_putObjectFromData,
    s3_putObjectsFromFilePathsWithProgress,
    s3_deleteObjectWithKey,
    s3_deleteObjectsWithPrefix,
    s3_convertM3u8DynamicManifestsToStatic,
    s3_updateM3u8ManifestsWithExternalVideosBaseUrl,
    s3_validateS3Config
};