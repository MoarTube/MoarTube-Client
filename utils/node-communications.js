const fs = require('fs');
const axios = require('axios').default;
const FormData = require('form-data');
const http = require('http');
const https = require('https');

const { getMoarTubeNodeUrl } = require('./helpers');

async function node_doSignout(req, res) {
    delete req.session.jwtToken;

    res.redirect('/account/signin');
}

async function node_isAuthenticated(jwtToken) {
    let result;

    if (jwtToken == null) {
        result = { isError: false, isAuthenticated: false };
    }
    else {
        const response = await axios.get(getMoarTubeNodeUrl() + '/account/authenticated', {
            headers: {
                Authorization: jwtToken
            }
        });

        result = response.data;
    }

    return result;
}

async function node_doHeartBeat(moarTubeNodeHttpProtocol, moarTubeNodeIp, moarTubeNodePort) {
    const response = await axios.get(moarTubeNodeHttpProtocol + '://' + moarTubeNodeIp + ':' + moarTubeNodePort + '/status/heartbeat');

    return response.data;
}

async function node_doSignin(username, password, moarTubeNodeHttpProtocol, moarTubeNodeIp, moarTubeNodePort, rememberMe) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/account/signin', {
        username: username,
        password: password,
        moarTubeNodeHttpProtocol: moarTubeNodeHttpProtocol,
        moarTubeNodeIp: moarTubeNodeIp,
        moarTubeNodePort: moarTubeNodePort,
        rememberMe: rememberMe
    });

    return response.data;
}

async function node_getSettings(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/settings', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getAvatar() {
    const response = await axios.get(getMoarTubeNodeUrl() + '/settings/avatar', {
        responseType: 'stream'
    });

    return response.data;
}

async function node_setExternalNetwork(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/network/external', {
        publicNodeProtocol: publicNodeProtocol,
        publicNodeAddress: publicNodeAddress,
        publicNodePort: publicNodePort
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_stopVideoImporting(jwtToken, videoId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/importing/stop', {
        videoId: videoId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_doVideosSearch(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/search', {
        params: {
            searchTerm: searchTerm,
            sortTerm: sortTerm,
            tagTerm: tagTerm,
            tagLimit: tagLimit,
            timestamp: timestamp
        },
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideoData(videoId) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/data');

    return response.data;
}

async function node_getVideoDataAll(videoId) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/data/all');

    return response.data;
}

async function node_setThumbnail(jwtToken, videoId, thumbnailBuffer) {
    const formData = new FormData();
    formData.append('thumbnailFile', thumbnailBuffer, 'thumbnail.jpg');

    const headers = formData.getHeaders();
    headers.Authorization = jwtToken;

    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/images/thumbnail', formData, {
        headers: headers
    });

    return response.data;
}

async function node_setPreview(jwtToken, videoId, previewBuffer) {
    const formData = new FormData();
    formData.append('previewFile', previewBuffer, 'preview.jpg');

    const headers = formData.getHeaders();
    headers.Authorization = jwtToken;

    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/images/preview', formData, {
        headers: headers
    });

    return response.data;
}

async function node_setPoster(jwtToken, videoId, posterBuffer) {
    const formData = new FormData();
    formData.append('posterFile', posterBuffer, 'poster.jpg');

    const headers = formData.getHeaders();
    headers.Authorization = jwtToken;

    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/images/poster', formData, {
        headers: headers
    });

    return response.data;
}

async function node_unpublishVideo(jwtToken, videoId, format, resolution) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/unpublish', {
        format: format,
        resolution: resolution
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_stopVideoPublishing(jwtToken, videoId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/publishing/stop', {
        videoId: videoId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_stopVideoStreaming(jwtToken, videoId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/streams/' + videoId + '/stop', {
        videoId: videoId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_importVideo(jwtToken, title, description, tags) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/import', {
        title: title,
        description: description,
        tags: tags
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setVideoError(jwtToken, videoId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/error', {
        videoId: videoId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setSourceFileExtension(jwtToken, videoId, sourceFileExtension) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/sourceFileExtension', {
        sourceFileExtension: sourceFileExtension
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/lengths', {
        lengthSeconds: lengthSeconds,
        lengthTimestamp: lengthTimestamp
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setVideoImported(jwtToken, videoId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/imported', {
        videoId: videoId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setVideoPublishing(jwtToken, videoId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/publishing', {
        videoId: videoId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setVideoPublished(jwtToken, videoId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/published', {
        videoId: videoId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setVideoFormatResolutionPublished(jwtToken, videoId, format, resolution) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/' + format + '/' + resolution + '/published', {}, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideoComments(jwtToken, videoId, timestamp, type, sort) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/comments', {
        params: {
            timestamp: timestamp,
            type: type,
            sort: sort
        },
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_searchComments(jwtToken, videoId, searchTerm, limit, timestamp) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/comments/search', {
        params: {
            videoId: videoId,
            searchTerm: searchTerm,
            limit: limit,
            timestamp: timestamp
        },
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideosTags(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/tags', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideoReports(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/reports/videos', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideoReportsArchive(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/reports/archive/videos', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_streamVideo(jwtToken, title, description, tags, rtmpPort, uuid, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, resolution, videoId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/streams/start', {
        title: title,
        description: description,
        tags: tags,
        rtmpPort: rtmpPort,
        uuid: uuid,
        isRecordingStreamRemotely: isRecordingStreamRemotely,
        isRecordingStreamLocally: isRecordingStreamLocally,
        networkAddress: networkAddress,
        resolution: resolution,
        videoId: videoId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getSourceFileExtension(jwtToken, videoId) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/sourceFileExtension', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideosTagsAll(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/tags/all', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_doVideosSearchAll(searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/node/search', {
        params: {
            searchTerm: searchTerm,
            sortTerm: sortTerm,
            tagTerm: tagTerm,
            tagLimit: tagLimit,
            timestamp: timestamp
        }
    });

    return response.data;
}

async function node_getNewContentCounts(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/node/newContentCounts', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setContentChecked(jwtToken, contentType) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/node/contentChecked', {
        contentType: contentType
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_archiveVideoReport(jwtToken, reportId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/reports/videos/archive', {
        reportId: reportId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_removeVideoReport(jwtToken, reportId) {
    const response = await axios.delete(getMoarTubeNodeUrl() + '/reports/videos/' + reportId + '/delete', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_removeVideoReportArchive(jwtToken, archiveId) {
    const response = await axios.delete(getMoarTubeNodeUrl() + '/reports/archive/videos/' + archiveId + '/delete', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getCommentReports(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/reports/comments', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getCommentReportsArchive(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/reports/archive/comments', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_archiveCommentReport(jwtToken, reportId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/reports/comments/archive', {
        reportId: reportId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_removeCommentReport(jwtToken, reportId) {
    const response = await axios.delete(getMoarTubeNodeUrl() + '/reports/comments/' + reportId + '/delete', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_removeCommentReportArchive(jwtToken, archiveId) {
    const response = await axios.delete(getMoarTubeNodeUrl() + '/reports/archive/comments/' + archiveId + '/delete', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_removeComment(jwtToken, videoId, commentId, timestamp) {
    const response = await axios.delete(getMoarTubeNodeUrl() + '/videos/' + videoId + '/comments/' + commentId + '/delete', {
        params: {
            timestamp: timestamp
        },
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideoPublishes(jwtToken, videoId) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/publishes', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setVideoData(jwtToken, videoId, title, description, tags) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/data', {
        title: title,
        description: description,
        tags: tags
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_deleteVideos(jwtToken, videoIds) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/delete', {
        videoIds: videoIds
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_finalizeVideos(jwtToken, videoIds) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/finalize', {
        videoIds: videoIds
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_addVideoToIndex(jwtToken, videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/index/add', {
        containsAdultContent: containsAdultContent,
        termsOfServiceAgreed: termsOfServiceAgreed,
        cloudflareTurnstileToken: cloudflareTurnstileToken
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_removeVideoFromIndex(jwtToken, videoId, cloudflareTurnstileToken) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/index/remove', {
        cloudflareTurnstileToken: cloudflareTurnstileToken
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideoAlias(jwtToken, videoId) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/alias', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setAvatar(jwtToken, iconBuffer, avatarBuffer) {
    const formData = new FormData();
    formData.append('iconFile', iconBuffer, 'icon.png');
    formData.append('avatarFile', avatarBuffer, 'avatar.png');

    const headers = formData.getHeaders();
    headers.Authorization = jwtToken;

    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/avatar', formData, {
        headers: headers
    });

    return response.data;
}

async function node_getBanner(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/settings/banner', {
        headers: {
            Authorization: jwtToken
        },
        responseType: 'stream'
    });

    return response.data;
}

async function node_setBanner(jwtToken, bannerBuffer) {
    const formData = new FormData();
    formData.append('bannerFile', bannerBuffer, 'banner.png');

    const headers = formData.getHeaders();
    headers.Authorization = jwtToken;

    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/banner', formData, {
        headers: headers
    });

    return response.data;
}

async function node_setNodeName(jwtToken, nodeName) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/personalize/nodeName', {
        nodeName: nodeName
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setNodeAbout(jwtToken, nodeAbout) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/personalize/nodeAbout', {
        nodeAbout: nodeAbout
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setNodeId(jwtToken, nodeId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/personalize/nodeId', {
        nodeId: nodeId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setSecureConnection(jwtToken, isSecure, keyFile, certFile, caFiles) {
    const formData = new FormData();

    if (keyFile != null) {
        formData.append('keyFile', keyFile.buffer, 'private_key.pem');
    }

    if (certFile != null) {
        formData.append('certFile', certFile.buffer, 'certificate.pem');
    }

    if (caFiles != null) {
        for (const caFile of caFiles) {
            formData.append('caFiles', caFile.buffer, caFile.filename);
        }
    }

    const headers = formData.getHeaders();
    headers.Authorization = jwtToken;

    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/secure?isSecure=' + isSecure, formData, {
        headers: headers
    });

    return response.data;
}

async function node_setNetworkInternal(jwtToken, listeningNodePort) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/network/internal', {
        listeningNodePort: listeningNodePort
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setCloudflareConfiguration(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/cloudflare/configure', {
        cloudflareEmailAddress: cloudflareEmailAddress,
        cloudflareZoneId: cloudflareZoneId,
        cloudflareGlobalApiKey: cloudflareGlobalApiKey
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setCloudflareTurnstileConfiguration(jwtToken, cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/cloudflare/turnstile/configure', {
        cloudflareTurnstileSiteKey: cloudflareTurnstileSiteKey,
        cloudflareTurnstileSecretKey: cloudflareTurnstileSecretKey
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_CloudflareTurnstileConfigurationClear(jwtToken) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/cloudflare/turnstile/clear', {}, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_clearCloudflareConfiguration(jwtToken) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/cloudflare/clear', {}, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_databaseConfigToggle(jwtToken, databaseConfig) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/databaseConfig/toggle', {
        databaseConfig: databaseConfig
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_databaseConfigEmpty(jwtToken) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/databaseConfig/empty', {}, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_storageConfigToggle(jwtToken, storageConfig, dnsConfig) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/storageConfig/toggle', {
        storageConfig: storageConfig,
        dnsConfig: dnsConfig
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_storageConfigEmpty(jwtToken) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/storageConfig/empty', {}, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setAccountCredentials(jwtToken, username, password) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/account', {
        username: username,
        password: password
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_uploadVideo(jwtToken, videoId, format, resolution, directoryPaths) {
    const formData = new FormData();

    for (const directoryPath of directoryPaths) {
        const fileName = directoryPath.fileName;
        const filePath = directoryPath.filePath;
        const contentType = directoryPath.contentType;

        const fileStream = fs.createReadStream(filePath);

        formData.append('video_files', fileStream, { filename: fileName, contentType: contentType });
    }

    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/upload', formData, {
        params: {
            format: format,
            resolution: resolution
        },
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_setVideoChatSettings(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/streams/' + videoId + '/chat/settings', {
        isChatHistoryEnabled: isChatHistoryEnabled,
        chatHistoryLimit: chatHistoryLimit
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideoBandwidth(jwtToken, videoId) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/streams/' + videoId + '/bandwidth', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getStreamMeta(jwtToken, videoId) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/streams/' + videoId + '/meta/', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getVideoSources(videoId) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/watch');

    return response.data;
}

const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000 });
async function node_uploadStream(jwtToken, videoId, format, resolution, manifestData, segmentData, manifestFileName, segmentFileName) {
    const formData = new FormData();

    formData.append('video_files', manifestData, {
        filename: manifestFileName,
        contentType: 'application/vnd.apple.mpegurl',
    });

    formData.append('video_files', segmentData, {
        filename: segmentFileName,
        contentType: 'video/mp2t',
    });

    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/stream', formData, {
        params: {
            format: format,
            resolution: resolution
        },
        headers: {
            Authorization: jwtToken
        },
        timeout: 15000,
        httpAgent: httpAgent,
        httpsAgent: httpsAgent
    });

    return response.data;
}

async function node_removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/streams/' + videoId + '/adaptive/' + format + '/' + resolution + '/segments/remove', {
        segmentName: segmentName
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_MonetizationAll() {
    const response = await axios.get(getMoarTubeNodeUrl() + '/monetization/all');

    return response.data;
}

async function node_MonetizationAdd(jwtToken, walletAddress, chain, currency) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/monetization/add', {
        walletAddress: walletAddress,
        chain: chain,
        currency: currency
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_MonetizationDelete(jwtToken, cryptoWalletAddressId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/monetization/delete', {
        cryptoWalletAddressId: cryptoWalletAddressId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_LinksAll() {
    const response = await axios.get(getMoarTubeNodeUrl() + '/links/all');

    return response.data;
}

async function node_LinksAdd(jwtToken, url, svgGraphic) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/links/add', {
        url: url,
        svgGraphic: svgGraphic
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_LinksDelete(jwtToken, linkId) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/links/delete', {
        linkId: linkId
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_commentsToggle(jwtToken, isCommentsEnabled) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/comments/toggle', {
        isCommentsEnabled: isCommentsEnabled,
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_likesToggle(jwtToken, isLikesEnabled) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/likes/toggle', {
        isLikesEnabled: isLikesEnabled,
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_dislikesToggle(jwtToken, isDislikesEnabled) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/dislikes/toggle', {
        isDislikesEnabled: isDislikesEnabled,
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_reportsToggle(jwtToken, isReportsEnabled) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/reports/toggle', {
        isReportsEnabled: isReportsEnabled,
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_liveChatToggle(jwtToken, isLiveChatEnabled) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/settings/liveChat/toggle', {
        isLiveChatEnabled: isLiveChatEnabled,
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getExternalVideosBaseUrl(jwtToken) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/external/videos/baseUrl', {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

async function node_getManifestFile(videoId, format, type, manifestName) {
    const response = await axios.get(getMoarTubeNodeUrl() + '/external/videos/' + videoId + '/adaptive/' + format + '/' + type + '/manifests/' + manifestName);

    return response.data;
}

async function node_uploadM3u8MasterManifest(jwtToken, videoId, type, masterManifest) {
    const response = await axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/adaptive/m3u8/' + type + '/manifests/masterManifest', {
        masterManifest: masterManifest,
    }, {
        headers: {
            Authorization: jwtToken
        }
    });

    return response.data;
}

module.exports = {
    node_isAuthenticated,
    node_doHeartBeat,
    node_doSignin,
    node_doSignout,
    node_getSettings,
    node_setExternalNetwork,
    node_stopVideoImporting,
    node_doVideosSearch,
    node_setThumbnail,
    node_setPreview,
    node_setPoster,
    node_getVideoData,
    node_getVideoDataAll,
    node_unpublishVideo,
    node_stopVideoPublishing,
    node_stopVideoStreaming,
    node_importVideo,
    node_setVideoError,
    node_setSourceFileExtension,
    node_setVideoLengths,
    node_setVideoImported,
    node_setVideoPublishing,
    node_setVideoPublished,
    node_setVideoFormatResolutionPublished,
    node_getVideoComments,
    node_getVideosTags,
    node_getVideoReports,
    node_getVideoReportsArchive,
    node_streamVideo,
    node_getSourceFileExtension,
    node_getVideosTagsAll,
    node_doVideosSearchAll,
    node_archiveVideoReport,
    node_removeVideoReport,
    node_removeVideoReportArchive,
    node_getCommentReports,
    node_getCommentReportsArchive,
    node_archiveCommentReport,
    node_removeCommentReport,
    node_removeCommentReportArchive,
    node_removeComment,
    node_getVideoPublishes,
    node_setVideoData,
    node_deleteVideos,
    node_finalizeVideos,
    node_addVideoToIndex,
    node_removeVideoFromIndex,
    node_getVideoAlias,
    node_getAvatar,
    node_setAvatar,
    node_getBanner,
    node_setBanner,
    node_setNodeName,
    node_setNodeAbout,
    node_setNodeId,
    node_setSecureConnection,
    node_setNetworkInternal,
    node_setCloudflareConfiguration,
    node_clearCloudflareConfiguration,
    node_setAccountCredentials,
    node_uploadVideo,
    node_setVideoChatSettings,
    node_getVideoBandwidth,
    node_uploadStream,
    node_removeAdaptiveStreamSegment,
    node_setCloudflareTurnstileConfiguration,
    node_CloudflareTurnstileConfigurationClear,
    node_searchComments,
    node_getNewContentCounts,
    node_setContentChecked,
    node_getVideoSources,
    node_getStreamMeta,
    node_MonetizationAll,
    node_MonetizationAdd,
    node_MonetizationDelete,
    node_LinksAll,
    node_LinksAdd,
    node_LinksDelete,
    node_commentsToggle,
    node_likesToggle,
    node_dislikesToggle,
    node_reportsToggle,
    node_liveChatToggle,
    node_databaseConfigToggle,
    node_databaseConfigEmpty,
    node_storageConfigToggle,
    node_storageConfigEmpty,
    node_getExternalVideosBaseUrl,
    node_getManifestFile,
    node_uploadM3u8MasterManifest
};