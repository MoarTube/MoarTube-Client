const express = require('express');
const path = require('path');
const fs = require('fs');

const { signIn_POST, signOut_GET} = require('../controllers/account');
const { node_isAuthenticated } = require('../utils/node-communications');
const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');

const router = express.Router();

router.get('/signin', async (req, res) => {
    try {
        const jwtToken = req.session.jwtToken;

        const isAuthenticated = (await node_isAuthenticated(jwtToken)).isAuthenticated;

        if(isAuthenticated) {
            res.redirect('/videos');
        }
        else {
            res.render('signin', {

            });
        }
    }
    catch(error) {
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
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
        logDebugMessageToConsole(null, error, new Error().stack);

        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }
});

router.get('/signout', (req, res) => {
    try {
        signOut_GET(req, res);
    }
    catch(error) {
        res.send({isError: true, message: 'error communicating with the MoarTube node'});
    }  
});

module.exports = router;