const express = require('express');

const { root_GET, network_GET } = require('../controllers/home');

const router = express.Router();

router.get('/', (req, res) => {
    root_GET(req, res);
});

router.get('/network', (req, res) => {
    network_GET(req, res);
});

module.exports = router;