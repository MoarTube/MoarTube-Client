const path = require('path');
const fs = require('fs');

const { 
    logDebugMessageToConsole, getPublicDirectoryPath
} = require('../utils/helpers');
const { 
    node_isAuthenticated, node_doSignout, node_SocialsSocialMediaAll, node_SocialsSocialMediaAdd, node_SocialsSocialMediaDelete
} = require('../utils/node-communications');


function root_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/socials.html');
                const fileStream = fs.createReadStream(pagePath);
                res.setHeader('Content-Type', 'text/html');
                fileStream.pipe(res);
            }
            else {
                res.redirect('/account/signin');
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        node_doSignout(req, res);
    });
}

function socialMediaAll_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            node_SocialsSocialMediaAll()
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    res.send({isError: true, message: nodeResponseData.message});
                }
                else {
                    const socialMedias = nodeResponseData.socialMedias;

                    res.send({isError: false, socialMedias: socialMedias});
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function socialMediaAdd_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const link = req.body.link;
            const svgGraphic = req.body.svgGraphic;

            node_SocialsSocialMediaAdd(jwtToken, link, svgGraphic)
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    res.send({isError: true, message: nodeResponseData.message});
                }
                else {
                    const socialmedias = nodeResponseData.socialmedias;

                    res.send({isError: false, socialmedias: socialmedias});
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function socialMediaDelete_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);

            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const socialMediaId = req.body.socialMediaId;

            node_SocialsSocialMediaDelete(jwtToken, socialMediaId)
            .then(nodeResponseData => {
                if(nodeResponseData.isError) {
                    logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                    
                    res.send({isError: true, message: nodeResponseData.message});
                }
                else {
                    res.send({isError: false});
                }
            })
            .catch(error => {
                logDebugMessageToConsole(null, error, new Error().stack, true);
                
                res.send({isError: true, message: 'error communicating with the MoarTube node'});
            });
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

module.exports = {
    root_GET,
    socialMediaAll_GET,
    socialMediaAdd_POST,
    socialMediaDelete_POST
}