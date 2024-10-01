const express = require('express');
const path = require('path');
const fs = require('fs');

const { all_GET, archiveAll_GET, archive_POST, delete_POST, archiveDelete_POST } = require('../controllers/reports-comments');
const { node_isAuthenticated, node_doSignout } = require('../utils/node-communications');
const { logDebugMessageToConsole, getPublicDirectoryPath } = require('../utils/helpers');

const router = express.Router();

router.get('/', (req, res) => {
    const jwtToken = req.session.jwtToken;
    
    node_isAuthenticated(jwtToken)
    .then(nodeResponseData => {
        if(nodeResponseData.isError) {
            logDebugMessageToConsole(nodeResponseData.message, null, new Error().stack, true);
            
            node_doSignout(req, res);
        }
        else {
            if(nodeResponseData.isAuthenticated) {
                const pagePath = path.join(getPublicDirectoryPath(), 'pages/reports-comments.html');
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
});

router.get('/all', (req, res) => {
    all_GET(req, res);
});

router.get('/archive/all', (req, res) => {
    archiveAll_GET(req, res);
});

router.post('/archive', (req, res) => {
    archive_POST(req, res);
});

router.post('/delete', (req, res) => {
    delete_POST(req, res);
});

router.post('/archive/delete', (req, res) => {
    archiveDelete_POST(req, res);
});

module.exports = router;