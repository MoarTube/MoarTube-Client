const path = require('path');
const fs = require('fs');

const { 
    logDebugMessageToConsole, getPublicDirectoryPath
} = require('../utils/helpers');
const { 
    node_isAuthenticated, node_doSignout, node_LinksAll, node_LinksAdd, node_LinksDelete
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
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/links.html');
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

function linksAll_GET(req, res) {
    node_LinksAll()
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const links = nodeResponseData.links;

            res.send({isError: false, links: links});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function linksAdd_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    const url = req.body.url;
    const svgGraphic = req.body.svgGraphic;

    node_LinksAdd(jwtToken, url, svgGraphic)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: nodeResponseData.message});
        }
        else {
            const link = nodeResponseData.link;

            res.send({isError: false, link: link});
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
}

function linksDelete_POST(req, res) {
    const jwtToken = req.session.jwtToken;
    
    const linkId = req.body.linkId;

    node_LinksDelete(jwtToken, linkId)
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

module.exports = {
    root_GET,
    linksAll_GET,
    linksAdd_POST,
    linksDelete_POST
}