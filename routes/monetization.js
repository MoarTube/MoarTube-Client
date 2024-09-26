const express = require('express');

const { root_GET, walletAddressAll_GET, walletAddressAdd_POST, walletAddressDelete_POST } = require('../controllers/monetization');

const router = express.Router();

router.get('/', async (req, res) => {
    root_GET(req, res);
});

router.get('/walletAddress/all', async (req, res) => {
    walletAddressAll_GET(req, res);
});

router.post('/walletAddress/add', async (req, res) => {
    walletAddressAdd_POST(req, res);
});

router.post('/walletAddress/delete', async (req, res) => {
    walletAddressDelete_POST(req, res);
});

module.exports = router;