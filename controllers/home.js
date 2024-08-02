const { logDebugMessageToConsole, getNetworkAddresses } = require('../utils/helpers');
const { node_isAuthenticated } = require('../utils/node-communications');

function root_GET(req, res) {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send(nodeResponseData.message);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                res.redirect('/videos');
            }
            else {
                res.redirect('/account/signin');
            }
        }
    });
}

function network_GET(req, res) {
    const networkAddresses = getNetworkAddresses();
    
    res.send({isError: false, networkAddresses: networkAddresses});
}

module.exports = {
    root_GET,
    network_GET
}