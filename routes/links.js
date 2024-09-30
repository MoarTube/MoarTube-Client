const express = require('express');

const { root_GET, linksAll_GET, linksAdd_POST, linksDelete_POST } = require('../controllers/links');

const router = express.Router();

router.get('/', async (req, res) => {
    root_GET(req, res);
});

router.get('/all', async (req, res) => {
    linksAll_GET(req, res);
});

router.post('/add', async (req, res) => {
    linksAdd_POST(req, res);
});

router.post('/delete', async (req, res) => {
    linksDelete_POST(req, res);
});

module.exports = router;