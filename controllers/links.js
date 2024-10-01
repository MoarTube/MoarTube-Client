const { logDebugMessageToConsole } = require('../utils/helpers');
const { node_LinksAll, node_LinksAdd, node_LinksDelete} = require('../utils/node-communications');

function linksAll_GET() {
    return new Promise(function(resolve, reject) {
        node_LinksAll()
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const links = nodeResponseData.links;

                resolve({isError: false, links: links});
            }
        })
        .catch(error => {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            resolve({isError: true, message: 'error communicating with the MoarTube node'});
        });
    });
}

function linksAdd_POST(jwtToken, url, svgGraphic) {
    return new Promise(function(resolve, reject) {
        node_LinksAdd(jwtToken, url, svgGraphic)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                const link = nodeResponseData.link;

                resolve({isError: false, link: link});
            }
        })
        .catch(error => {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            resolve({isError: true, message: 'error communicating with the MoarTube node'});
        });
    });
}

function linksDelete_POST(jwtToken, linkId) {
    return new Promise(function(resolve, reject) {
        node_LinksDelete(jwtToken, linkId)
        .then(nodeResponseData => {
            if(nodeResponseData.isError) {
                logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
                
                resolve({isError: true, message: nodeResponseData.message});
            }
            else {
                resolve({isError: false});
            }
        })
        .catch(error => {
            logDebugMessageToConsole(null, error, new Error().stack, true);
            
            resolve({isError: true, message: 'error communicating with the MoarTube node'});
        });
    });
}

module.exports = {
    linksAll_GET,
    linksAdd_POST,
    linksDelete_POST
}