const express = require('express');
const path = require('path');
const fs = require('fs');

const { signIn_POST, signOut_GET} = require('../controllers/account');
const { node_isAuthenticated } = require('../utils/node-communications');
const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');

const router = express.Router();

router.get('/signin', (req, res) => {
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
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/signin.html');
                const fileStream = fs.createReadStream(pagePath);
                res.setHeader('Content-Type', 'text/html');
                fileStream.pipe(res);
            }
        }
    })
    .catch(error => {
        logDebugMessageToConsole(null, error, new Error().stack, true);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    });
});

router.post('/signin', async (req, res) => {
    try {
        const username = req.body.username;
        const password = req.body.password;
        const moarTubeNodeIp = req.body.moarTubeNodeIp;
        const moarTubeNodePort = req.body.moarTubeNodePort;
        const rememberMe = req.body.rememberMe;

        const data = await signIn_POST(username, password, moarTubeNodeIp, moarTubeNodePort, rememberMe);

        if(!data.isError && data.isAuthenticated) {
            req.session.jwtToken = data.jwtToken;

            delete data.jwtToken;
        }

        res.send(data);
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack, true);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.get('/signout', (req, res) => {
    signOut_GET(req, res);
});

module.exports = router;