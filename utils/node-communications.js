const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

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
        axios.get(moarTubeNodeHttpProtocol + '://' + moarTubeNodeIp + ':' + moarTubeNodePort + '/heartbeat')
        .then(response => {
            const data = response.data;
            
            resolve(data);
        })
        .catch(error => {
            reject(error);
        });
    });
}

function node_doSignin(username, password, rememberMe) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/account/signin', {
            username: username,
            password: password,
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

function node_getAvatar(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/settings/avatar', {
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

function node_setPrivate(jwtToken, isNodePrivate) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/private', {
            isNodePrivate: isNodePrivate
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

function node_getReportCount(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/reports/count', {
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

function node_getVideoInformation(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/information', {
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

function node_getVideoData(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/data', {
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

function node_getThumbnail(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/thumbnail', {
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

function node_setThumbnail(jwtToken, videoId, thumbnailPath) {
    return new Promise(function(resolve, reject) {
        const thumbnailFileStream = fs.createReadStream(thumbnailPath);
        
        const formData = new FormData();
        formData.append('thumbnailFile', thumbnailFileStream, 'thumbnail.jpg');
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/thumbnail', formData, {
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

function node_getPreview(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/preview', {
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

function node_setPreview(jwtToken, videoId, previewPath) {
    return new Promise(function(resolve, reject) {
        const previewFileStream = fs.createReadStream(previewPath);
        
        const formData = new FormData();
        formData.append('previewFile', previewFileStream, 'preview.jpg');
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/preview', formData, {
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

function node_getPoster(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/' + videoId + '/poster', {
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

function node_setPoster(jwtToken, videoId, posterPath) {
    return new Promise(function(resolve, reject) {
        const posterFileStream = fs.createReadStream(posterPath);
        
        const formData = new FormData();
        formData.append('posterFile', posterFileStream, 'poster.jpg');
        
        const headers = formData.getHeaders();
        headers.Authorization = jwtToken;
        
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/poster', formData, {
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

function node_getAllComments(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/videos/comments/all', {
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

function node_streamVideo(jwtToken, title, description, tags, rtmpPort, uuid, isRecordingStreamRemotely, isRecordingStreamLocally, networkAddress) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/streams/start', {
            title: title,
            description: description,
            tags: tags,
            rtmpPort: rtmpPort,
            uuid: uuid,
            isRecordingStreamRemotely: isRecordingStreamRemotely,
            isRecordingStreamLocally: isRecordingStreamLocally,
            networkAddress: networkAddress
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

function node_doVideosSearchAll(jwtToken, searchTerm, sortTerm, tagTerm, tagLimit, timestamp) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/channel/search', {
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

function node_setVideoInformation(jwtToken, videoId, title, description, tags) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/information', {
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

function node_deleteVideos(jwtToken, videoIdsJson) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/delete', {
            videoIdsJson: videoIdsJson
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

function node_finalizeVideos(jwtToken, videoIdsJson) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/finalize', {
            videoIdsJson: videoIdsJson
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

function node_addVideoToIndex(jwtToken, videoId, captchaResponse, containsAdultContent, termsOfServiceAgreed) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/index/add', {
            captchaResponse: captchaResponse,
            containsAdultContent: containsAdultContent,
            termsOfServiceAgreed: termsOfServiceAgreed
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

function node_removeVideoFromIndex(jwtToken, videoId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/index/remove', {
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

function node_aliasVideo(jwtToken, videoId, captchaResponse) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/alias', {
            captchaResponse: captchaResponse
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

function node_setNodeName(jwtToken, nodeName, nodeAbout, nodeId) {
    return new Promise(function(resolve, reject) {
        axios.post(getMoarTubeNodeUrl() + '/settings/personalize', {
            nodeName: nodeName,
            nodeAbout: nodeAbout,
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

function node_getIndexerCaptcha(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/captcha/index', {
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

function node_getAliaserCaptcha(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/captcha/alias', {
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

function node_uploadVideo(jwtToken, videoId, format, resolution, directoryPaths) {
    return new Promise(function(resolve, reject) {
        const formData = new FormData();
        
        for (directoryPath of directoryPaths) {
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

function node_getNextExpectedSegmentIndex(jwtToken, videoId, format, resolution) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/streams/' + videoId + '/adaptive/' + format + '/' + resolution + '/segments/nextExpectedSegmentIndex', {
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

function node_uploadStream(jwtToken, videoId, format, resolution, directoryPaths) {
    return new Promise(function(resolve, reject) {
        const formData = new FormData();
        for (directoryPath of directoryPaths) {
            const fileName = directoryPath.fileName;
            const filePath = directoryPath.filePath;
            const fileStream = fs.createReadStream(filePath);
            
            formData.append('video_files', fileStream, fileName);
        }

        axios.post(getMoarTubeNodeUrl() + '/videos/' + videoId + '/stream', formData, {
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

module.exports = {
    node_isAuthenticated,
    node_doHeartBeat,
    node_doSignin,
    node_doSignout,
    node_getSettings,
    node_setPrivate,
    node_setExternalNetwork,
    node_getReportCount,
    node_stopVideoImporting,
    node_getVideoInformation,
    node_doVideosSearch,
    node_getThumbnail,
    node_setThumbnail,
    node_getPreview,
    node_setPreview,
    node_getPoster,
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
    node_getAllComments,
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
    node_setVideoInformation,
    node_deleteVideos,
    node_finalizeVideos,
    node_addVideoToIndex,
    node_removeVideoFromIndex,
    node_aliasVideo,
    node_getVideoAlias,
    node_getAvatar,
    node_setAvatar,
    node_getBanner,
    node_setBanner,
    node_setNodeName,
    node_setSecureConnection,
    node_setNetworkInternal,
    node_setAccountCredentials,
    node_getIndexerCaptcha,
    node_getAliaserCaptcha,
    node_uploadVideo,
    node_setVideoChatSettings,
    node_getNextExpectedSegmentIndex,
    node_getVideoBandwidth,
    node_uploadStream,
    node_removeAdaptiveStreamSegment
};