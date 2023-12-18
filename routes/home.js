const express = require('express');

const { root_GET, node_GET, network_GET, heartbeat_GET } = require('../controllers/home');

const router = express.Router();

router.get('/', (req, res) => {
    root_GET(req, res);
});

router.get('/node', (req, res) => {
    node_GET(req, res);
});

router.get('/network', (req, res) => {
    network_GET(req, res);
});

router.get('/heartbeat', (req, res) => {
    heartbeat_GET(req, res);
});

module.exports = router;