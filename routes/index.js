const express = require('express');

const { 
    logDebugMessageToConsole
} = require('../utils/helpers');
const { 
    node_isAuthenticated, node_getIndexerCaptcha
} = require('../utils/node-communications');

const router = express.Router();

// Retrieve and serve a captcha
router.get('/captcha', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            res.send({isError: true, message: 'error communicating with the MoarTube node'});
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                node_getIndexerCaptcha(jwtToken)
                .then(nodeResponseData => {
                    /*
                    the node's response will be either JSON or a PNG image
                    JSON if there's an error to report (namely an unconfigured node)
                    PNG image is captcha if node has been configured
                    */
                    if(nodeResponseData.headers['content-type'].includes('application/json')) {
                        let data = '';
                        
                        nodeResponseData.on('data', function(chunk) {
                            data += chunk;
                        });
                        
                        nodeResponseData.on('end', function() {
                            try {
                                const jsonData = JSON.parse(data);
                                res.send(jsonData);
                            }
                            catch (error) {
                                res.send({isError: true, message: 'error communicating with the MoarTube node'});
                            }
                        });
                    }
                    else {
                        res.setHeader('Content-Type', 'image/png');
                        nodeResponseData.pipe(res);
                    }
                })
                .catch(error => {
                    logDebugMessageToConsole(null, error, new Error().stack, true);
                    
                    res.send({isError: true, message: 'error communicating with the MoarTube node'});
                });
            }
            else {
                logDebugMessageToConsole('unauthenticated communication was rejected', null, new Error().stack, true);

                res.send({isError: true, message: 'you are not logged in'});
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);
        
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
});

module.exports = router;