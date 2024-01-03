const express = require('express');

const { 
    root_GET, client_GET, node_GET, clientGpuAcceleration_POST, nodeAvatar_GET, nodeAvatar_POST, nodeBanner_GET, nodeBanner_POST,
    nodePersonalize_POST, node_Secure_POST, nodeNetworkInternal_POST, nodeNetworkExternal_POST, nodeCloudflare_POST, nodeAccount_POST,
    nodeCloudflareDefault_POST
 } = require('../controllers/settings');

const router = express.Router();

router.get('/', (req, res) => {
    root_GET(req, res);
});

router.get('/client', (req, res) => {
    client_GET(req, res);
});

router.get('/node', (req, res) => {
    node_GET(req, res);
});

router.post('/client/gpuAcceleration', (req, res) => {
    clientGpuAcceleration_POST(req, res);
});

router.get('/node/avatar', (req, res) => {
    nodeAvatar_GET(req, res);
});

router.post('/node/avatar', (req, res) => {
    nodeAvatar_POST(req, res);
});

router.get('/node/banner', (req, res) => {
    nodeBanner_GET(req, res);
});

router.post('/node/banner', (req, res) => {
    nodeBanner_POST(req, res);
});

router.post('/node/personalize', (req, res) => {
    nodePersonalize_POST(req, res);
});

router.post('/node/secure', (req, res) => {
    node_Secure_POST(req, res);
});

router.post('/node/network/internal', (req, res) => {
    nodeNetworkInternal_POST(req, res);
});

router.post('/node/network/external', (req, res) => {
    nodeNetworkExternal_POST(req, res);
});

router.post('/node/cloudflare', (req, res) => {
    nodeCloudflare_POST(req, res);
});

router.post('/node/cloudflare/default', (req, res) => {
    nodeCloudflareDefault_POST(req, res);
});

router.post('/node/account', (req, res) => {
    nodeAccount_POST(req, res);
});

module.exports = router;