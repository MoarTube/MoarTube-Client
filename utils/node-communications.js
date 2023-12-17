const axios = require('axios');
const { getMoarTubeNodeUrl } = require('./helpers');


let websocketClient;


function node_getWebsocketClient() {
    return websocketClient;
}

function node_setWebsocketClient(ws) {
    // only one websocket connection needs to be maintained between MoarTube Client and MoarTube Node at any given time
    if(websocketClient != null) {
        websocketClient.close();
    }

    websocketClient = ws;
}

function node_broadcastMessage_websocket(message) {
    if(websocketClient != null) {
        websocketClient.send(JSON.stringify(message));
    }
}

function node_isAuthenticated(jwtToken) {
    return new Promise(function(resolve, reject) {
        if(jwtToken == null || jwtToken === '') {
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

function node_doSignout(req, res) {
    delete req.session.jwtToken;
    
    res.redirect('/account/signin');
}

function node_getSettings(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/node/settings', {
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
        axios.get(getMoarTubeNodeUrl() + '/settings/node/avatar', {
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
        axios.post(getMoarTubeNodeUrl() + '/settings/node/private', {
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
        axios.post(getMoarTubeNodeUrl() + '/settings/node/network/external', {
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
        axios.get(getMoarTubeNodeUrl() + '/node/reports/count', {
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
        axios.post(getMoarTubeNodeUrl() + '/video/import', {
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
        axios.post(getMoarTubeNodeUrl() + '/video/error', {
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
        axios.post(getMoarTubeNodeUrl() + '/video/imported', {
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
        axios.post(getMoarTubeNodeUrl() + '/video/publishing', {
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
        axios.post(getMoarTubeNodeUrl() + '/video/published', {
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
        axios.get(getMoarTubeNodeUrl() + '/node/videos/comments/all', {
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

function node_getVideoReportsArchive(jwtToken) {
    return new Promise(function(resolve, reject) {
        axios.get(getMoarTubeNodeUrl() + '/node/reports/archive/videos', {
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
        axios.get(getMoarTubeNodeUrl() + '/node/reports/comments', {
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
        axios.get(getMoarTubeNodeUrl() + '/node/reports/archive/comments', {
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


module.exports = {
    node_isAuthenticated,
    node_doHeartBeat,
    node_setWebsocketClient,
    node_getWebsocketClient,
    node_broadcastMessage_websocket,
    node_doSignin,
    node_doSignout,
    node_getSettings,
    node_getAvatar,
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
    node_removeComment
};