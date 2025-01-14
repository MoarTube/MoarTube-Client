const fs = require('fs');
const axios = require('axios').default;
const FormData = require('form-data');
const http = require('http');
const https = require('https');

const { getMoarTubeNodeUrl } = require('./helpers');

function node_doSignout(req, res) {
    delete req.session.jwtToken;
    
    res.redirect('/account/signin');
}

function node_isAuthenticated(jwtToken) {
    return new Promise(function(resolve, reject) {
        if(jwtToken == null) {
            resolve({isError: false, isAuthenticated: false});
        }
        else {
            axios.get(getMoarTubeNodeUrl() + '/account/authenticated', {
              headers: {
                Authorization: jwtToken
              }
            })
            .then(response => {
                const data = response.data;
                
                resolve(data);
            })
            .catch(error => {
                reject(error);
            });
        }
    });
}

function node_doHeartBeat(moarTubeNodeHttpProtocol, moarTubeNodeIp, moarTubeNodePort) {
    return new Promise(function(resolve, reject) {
        axios.get(moarTubeNodeHttpProtocol + '://' + moarTubeNodeIp + ':' + moarTubeNodePort + '/status/heartbeat')
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_doSignin(username, password, moarTubeNodeHttpProtocol, moarTubeNodeIp, moarTubeNodePort, rememberMe) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/account/signin', {
            username: username,
            password: password,
            moarTubeNodeHttpProtocol: moarTubeNodeHttpProtocol,
            moarTubeNodeIp: moarTubeNodeIp,
            moarTubeNodePort: moarTubeNodePort,
            rememberMe: rememberMe
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getSettings(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/settings', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getAvatar() {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/settings/avatar', {
          responseType: 'stream'
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setExternalNetwork(jwtToken, publicNodeProtocol, publicNodeAddress, publicNodePort) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/network/external', {
            publicNodeProtocol: publicNodeProtocol,
            publicNodeAddress: publicNodeAddress,
            publicNodePort: publicNodePort
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_stopVideoImporting(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/importing/stop', {
            videoId: videoId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_doVideosSearch(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/search', {
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
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideoData(videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/data')
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setThumbnail(jwtToken, videoId, thumbnailBuffer) {
    return new Promise(function(resolve, reject) {
        const formData = new FormData();

        formData.append('thumbnailFile', thumbnailBuffer, 'thumbnail.jpg');
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/images/thumbnail', formData, {
          headers: headers
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setPreview(jwtToken, videoId, previewBuffer) {
    return new Promise(function(resolve, reject) {
        const formData = new FormData();

        formData.append('previewFile', previewBuffer, 'preview.jpg');
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/images/preview', formData, {
          headers: headers
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setPoster(jwtToken, videoId, posterBuffer) {
    return new Promise(function(resolve, reject) {
        const formData = new FormData();

        formData.append('posterFile', posterBuffer, 'poster.jpg');
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/images/poster', formData, {
          headers: headers
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_unpublishVideo(jwtToken, videoId, format, resolution) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/unpublish', {
            format: format,
            resolution: resolution
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_stopVideoPublishing(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/publishing/stop', {
            videoId: videoId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_stopVideoStreaming(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/streams/' + videoId + '/stop', {
            videoId: videoId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_importVideo(jwtToken, title, description, tags) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/import', {
            title: title,
            description: description,
            tags: tags
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setVideoError(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/error', {
            videoId: videoId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setSourceFileExtension(jwtToken, videoId, sourceFileExtension) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/sourceFileExtension', {
            sourceFileExtension: sourceFileExtension
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setVideoLengths(jwtToken, videoId, lengthSeconds, lengthTimestamp) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/lengths', {
            lengthSeconds: lengthSeconds,
            lengthTimestamp: lengthTimestamp
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setVideoImported(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/imported', {
            videoId: videoId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setVideoPublishing(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/publishing', {
            videoId: videoId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setVideoPublished(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/published', {
            videoId: videoId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setVideoFormatResolutionPublished(jwtToken, videoId, format, resolution) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/' + format + '/' + resolution + '/published', {}, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideoComments(jwtToken, videoId, timestamp, type, sort) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/comments', {
            params: {
                timestamp: timestamp,
                type: type,
                sort: sort
            },
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_searchComments(jwtToken, videoId, searchTerm, limit, timestamp) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/comments/search', {
            params: {
                videoId: videoId,
                searchTerm: searchTerm,
                limit: limit,
                timestamp: timestamp
            },
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideosTags(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/tags', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideoReports(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/reports/videos', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideoReportsArchive(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/reports/archive/videos', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_streamVideo(jwtToken, title, description, tags, rtmpPort, uuid, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress, resolution, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/streams/start', {
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
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getSourceFileExtension(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/sourceFileExtension', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideosTagsAll(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/tags/all', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_doVideosSearchAll(searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/node/search', {
          params: {
              searchTerm: searchTerm,
              sortTerm: sortTerm,
              tagTerm: tagTerm,
              tagLimit: tagLimit,
              timestamp: timestamp
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getNewContentCounts(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/node/newContentCounts', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setContentChecked(jwtToken, contentType) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/node/contentChecked', {
            contentType: contentType
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_archiveVideoReport(jwtToken, reportId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/reports/videos/archive', {
            reportId: reportId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_removeVideoReport(jwtToken, reportId) {
    return new Promise(function(resolve, reject) {
        axios.delete(getMoarTubeNodeUrl() + '/reports/videos/' + reportId + '/delete', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_removeVideoReportArchive(jwtToken, archiveId) {
    return new Promise(function(resolve, reject) {
        axios.delete(getMoarTubeNodeUrl() + '/reports/archive/videos/' + archiveId + '/delete', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getCommentReports(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/reports/comments', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getCommentReportsArchive(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/reports/archive/comments', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_archiveCommentReport(jwtToken, reportId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/reports/comments/archive', {
            reportId: reportId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_removeCommentReport(jwtToken, reportId) {
    return new Promise(function(resolve, reject) {
        axios.delete(getMoarTubeNodeUrl() + '/reports/comments/' + reportId + '/delete', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_removeCommentReportArchive(jwtToken, archiveId) {
    return new Promise(function(resolve, reject) {
        axios.delete(getMoarTubeNodeUrl() + '/reports/archive/comments/' + archiveId + '/delete', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_removeComment(jwtToken, videoId, commentId, timestamp) {
    return new Promise(function(resolve, reject) {
        axios.delete(getMoarTubeNodeUrl() + '/videos/' + videoId + '/comments/' + commentId + '/delete',  {
          params: {
            timestamp: timestamp
          },
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideoPublishes(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/publishes', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setVideoData(jwtToken, videoId, title, description, tags) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/data', {
            title: title,
            description: description,
            tags: tags
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_deleteVideos(jwtToken, videoIds) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/delete', {
            videoIds: videoIds
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_finalizeVideos(jwtToken, videoIds) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/finalize', {
            videoIds: videoIds
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_addVideoToIndex(jwtToken, videoId, containsAdultContent, termsOfServiceAgreed, cloudflareTurnstileToken) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/index/add', {
            containsAdultContent: containsAdultContent,
            termsOfServiceAgreed: termsOfServiceAgreed,
            cloudflareTurnstileToken: cloudflareTurnstileToken
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_removeVideoFromIndex(jwtToken, videoId, cloudflareTurnstileToken) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/index/remove', {
            cloudflareTurnstileToken: cloudflareTurnstileToken
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideoAlias(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/alias', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setAvatar(jwtToken, iconPath, avatarPath) {
    return new Promise(function(resolve, reject) {
        const iconFileStream = fs.createReadStream(iconPath);
        const avatarFileStream = fs.createReadStream(avatarPath);
        
        const formData = new FormData();
        formData.append('iconFile', iconFileStream, 'icon.png');
        formData.append('avatarFile', avatarFileStream, 'avatar.png');
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/settings/avatar', formData, {
          headers: headers
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getBanner(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/settings/banner', {
          headers: {
            Authorization: jwtToken
          },
          responseType: 'stream'
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setBanner(jwtToken, bannerPath) {
    return new Promise(function(resolve, reject) {
        const bannerFileStream = fs.createReadStream(bannerPath);
        
        const formData = new FormData();
        formData.append('bannerFile', bannerFileStream, 'banner.png');
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/settings/banner', formData, {
          headers: headers
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setNodeName(jwtToken, nodeName) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/personalize/nodeName', {
            nodeName: nodeName
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setNodeAbout(jwtToken, nodeAbout) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/personalize/nodeAbout', {
            nodeAbout: nodeAbout
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setNodeId(jwtToken, nodeId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/personalize/nodeId', {
            nodeId: nodeId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setSecureConnection(jwtToken, isSecure, keyFile, certFile, caFiles) {
    return new Promise(function(resolve, reject) {
        const formData = new FormData();
        
        if(keyFile != null) {
            const keyFileStream = fs.createReadStream(keyFile.path);
            formData.append('keyFile', keyFileStream, 'private_key.pem');
        }
        
        if(certFile != null) {
            const certFileStream = fs.createReadStream(certFile.path);
            formData.append('certFile', certFileStream, 'certificate.pem');
        }
        
        if(caFiles != null) {
            for(const caFile of caFiles) {
                const caFileStream = fs.createReadStream(caFile.path);
                
                formData.append('caFiles', caFileStream, caFile.filename);
            }
        }
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/settings/secure?isSecure=' + isSecure, formData, {
          headers: headers
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setNetworkInternal(jwtToken, listeningNodePort) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/network/internal', {
            listeningNodePort: listeningNodePort
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setCloudflareConfiguration(jwtToken, cloudflareEmailAddress, cloudflareZoneId, cloudflareGlobalApiKey) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/cloudflare/configure', {
            cloudflareEmailAddress: cloudflareEmailAddress,
            cloudflareZoneId: cloudflareZoneId,
            cloudflareGlobalApiKey: cloudflareGlobalApiKey
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setCloudflareTurnstileConfiguration(jwtToken, cloudflareTurnstileSiteKey, cloudflareTurnstileSecretKey) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/cloudflare/turnstile/configure', {
            cloudflareTurnstileSiteKey: cloudflareTurnstileSiteKey,
            cloudflareTurnstileSecretKey: cloudflareTurnstileSecretKey
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_CloudflareTurnstileConfigurationClear(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/cloudflare/turnstile/clear', {}, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_clearCloudflareConfiguration(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/cloudflare/clear', {}, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_databaseConfigToggle(jwtToken, databaseConfig) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/databaseConfig/toggle', {
            databaseConfig: databaseConfig
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_storageConfigToggle(jwtToken, storageConfig, dnsConfig) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/storageConfig/toggle', {
            storageConfig: storageConfig,
            dnsConfig: dnsConfig
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setAccountCredentials(jwtToken, username, password) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/account', {
            username: username,
            password: password
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_uploadVideo(jwtToken, videoId, format, resolution, directoryPaths) {
    return new Promise(function(resolve, reject) {
        const formData = new FormData();
        
        for (const directoryPath of directoryPaths) {
            const fileName = directoryPath.fileName;
            const filePath = directoryPath.filePath;
            const fileStream = fs.createReadStream(filePath);
            
            formData.append('video_files', fileStream, fileName);
        }

        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/upload', formData, {
            params: {
                format: format,
                resolution: resolution
            },
            headers: {
                Authorization: jwtToken
            }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_setVideoChatSettings(jwtToken, videoId, isChatHistoryEnabled, chatHistoryLimit) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/streams/' + videoId + '/chat/settings', {
            isChatHistoryEnabled: isChatHistoryEnabled,
            chatHistoryLimit: chatHistoryLimit
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideoBandwidth(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/streams/' + videoId + '/bandwidth', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getStreamMeta(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/streams/' + videoId + '/meta/', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getVideoSources(videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/watch')
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000 });
function node_uploadStream(jwtToken, videoId, format, resolution, manifestData, segmentData, manifestFileName, segmentFileName) {
    return new Promise(function(resolve, reject) {
        const formData = new FormData();

        formData.append('video_files', manifestData, {
            filename: manifestFileName,
            contentType: 'application/vnd.apple.mpegurl',
        });

        formData.append('video_files', segmentData, {
            filename: segmentFileName,
            contentType: 'video/mp2t',
        });

        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/stream', formData, {
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
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_removeAdaptiveStreamSegment(jwtToken, videoId, format, resolution, segmentName) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/streams/' + videoId + '/adaptive/' + format + '/' + resolution + '/segments/remove', {
            segmentName: segmentName
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_MonetizationAll() {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/monetization/all')
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_MonetizationAdd(jwtToken, walletAddress, chain, currency) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/monetization/add', {
            walletAddress: walletAddress,
            chain: chain,
            currency: currency
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_MonetizationDelete(jwtToken, cryptoWalletAddressId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/monetization/delete', {
            cryptoWalletAddressId: cryptoWalletAddressId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_LinksAll() {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/links/all')
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_LinksAdd(jwtToken, url, svgGraphic) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/links/add', {
            url: url,
            svgGraphic: svgGraphic
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_LinksDelete(jwtToken, linkId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/links/delete', {
            linkId: linkId
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_commentsToggle(jwtToken, isCommentsEnabled) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/comments/toggle', {
            isCommentsEnabled: isCommentsEnabled,
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_likesToggle(jwtToken, isLikesEnabled) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/likes/toggle', {
            isLikesEnabled: isLikesEnabled,
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_dislikesToggle(jwtToken, isDislikesEnabled) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/dislikes/toggle', {
            isDislikesEnabled: isDislikesEnabled,
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_reportsToggle(jwtToken, isReportsEnabled) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/reports/toggle', {
            isReportsEnabled: isReportsEnabled,
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_liveChatToggle(jwtToken, isLiveChatEnabled) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/liveChat/toggle', {
            isLiveChatEnabled: isLiveChatEnabled,
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getExternalVideosBaseUrl(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/external/videos/baseUrl', {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_getManifestFile(videoId, format, type, manifestName) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/external/videos/' + videoId + '/adaptive/' + format + '/' + type + '/manifests/' + manifestName)
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_uploadM3u8MasterManifest(jwtToken, videoId, type, masterManifest) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/adaptive/m3u8/' + type + '/manifests/masterManifest', {
            masterManifest: masterManifest,
        }, {
          headers: {
            Authorization: jwtToken
          }
        })
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
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
    node_storageConfigToggle,
    node_getExternalVideosBaseUrl,
    node_getManifestFile,
    node_uploadM3u8MasterManifest
};