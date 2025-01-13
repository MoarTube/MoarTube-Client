const { 
    S3Client, PutObjectCommand, ListBucketsCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command,
    GetObjectCommand
} = require('@aws-sdk/client-s3');
const fs = require('fs');

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
                const dynamicManifestKey = 'external/videos/' + videoId + '/adaptive/dynamic/m3u8/manifests/manifest-' + resolution + '.m3u8';
                const staticManifestKey = 'external/videos/' + videoId + '/adaptive/static/m3u8/manifests/manifest-' + resolution + '.m3u8';
        
                // Step 1: Retrieve the dynamic manifest
                console.log(`Retrieving: ${dynamicManifestKey}`);
                const response = await s3Client.send(new GetObjectCommand({Bucket: bucketName, Key: dynamicManifestKey}));
        
                // Step 2: Convert stream to string
                const dynamicManifest = await streamToString(response.Body);
        
                // Step 3: Modify the manifest
                const staticManifest = dynamicManifest.trim() + "\n#EXT-X-ENDLIST\n";

                // Step 4: Upload the static manifest
                console.log(`Uploading static manifest: ${staticManifestKey}`);
                await s3Client.send(new PutObjectCommand({Bucket: bucketName, Key: staticManifestKey, Body: staticManifest, ContentType: "application/vnd.apple.mpegurl"}));
        
                // Step 5: Delete the dynamic manifest
                console.log(`Deleting dynamic manifest: ${dynamicManifestKey}`);
                await s3Client.send(new DeleteObjectCommand({Bucket: bucketName, Key: dynamicManifestKey}));
            }

            resolve();
        }
        catch(error) {
            reject(error);
        }
        
        async function streamToString(stream) {
            return new Promise((resolve, reject) => {
              const chunks = [];
              
              stream.on("data", (chunk) => chunks.push(chunk));
              stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
              stream.on("error", reject);
            });
          }
        
    });
}

function s3_validateS3Config(s3Config) {
    return new Promise(async function(resolve, reject) {
        const bucketName = s3Config.bucketName;
        const s3ProviderClientConfig = s3Config.s3ProviderClientConfig;

        try {
            logDebugMessageToConsole('validating the s3 provider configuration: ' + JSON.stringify(s3ProviderClientConfig), null, null);
            
            const s3Client = new S3Client(s3ProviderClientConfig);

            logDebugMessageToConsole('determining if bucket exists: ' + bucketName, null, null);

            s3Client.send(new ListBucketsCommand({}))
            .then(response => {
                let bucketExists = false;

                for(const bucket of response.Buckets) {
                    if(bucket.Name === bucketName) {
                        bucketExists = true;
                        break;
                    }
                }

                if(bucketExists) {
                    logDebugMessageToConsole('bucket exists', null, null);

                    logDebugMessageToConsole('verifying ability for MoarTube Client to put a test object into the bucket', null, null);

                    s3Client.send(new PutObjectCommand({ Bucket: bucketName, Key: 'Moartube-Client-Test', Body: 'testing' }))
                    .then(response => {
                        logDebugMessageToConsole('MoarTube Client successfully put a test object into the bucket', null, null);

                        logDebugMessageToConsole('verifying ability for MoarTube Client to delete a test object from the bucket', null, null);

                        s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: 'Moartube-Client-Test' }))
                        .then(response => {
                            logDebugMessageToConsole('MoarTube Client successfully deleted a test object from the bucket', null, null);

                            logDebugMessageToConsole('s3 provider credentials validated', null, null);

                            resolve({isError: false});
                        })
                        .catch(error => {
                            const message = 'MoarTube Client failed to delete the test object from the bucket';

                            logDebugMessageToConsole(message, error, null);

                            reject(message);
                        });
                    })
                    .catch(error => {
                        const message = 'MoarTube Client failed to put a test object into the bucket';

                        logDebugMessageToConsole(message, error, null);

                        reject(message);
                    });
                }
                else {
                    const message = 'the specified bucket does not exist';

                    logDebugMessageToConsole(message, null, null);

                    reject(message);
                }
            })
            .catch(error => {
                const message = 'an error occured while validating the S3 provider configuration';

                logDebugMessageToConsole(message, error, null);

                reject(message);
            });
        }
        catch (error) {
            const message = 'an error occured while validating the S3 provider configuration';

            logDebugMessageToConsole(message, error, null);

            reject(message);
        }
    });
}

module.exports = {
    s3_putObjectsFromFilePaths,
    s3_putObjectFromData,
    s3_deleteObjectWithKey,
    s3_deleteObjectsWithPrefix,
    s3_convertM3u8DynamicManifestsToStatic,
    s3_validateS3Config
};