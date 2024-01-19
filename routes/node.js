const express = require('express');

const { search_GET, newContentCounts_GET, contentChecked_POST } = require('../controllers/node');

const router = express.Router();

router.get('/search', (req, res) => {
    search_GET(req, res);
});

router.get('/newContentCounts', (req, res) => {
    newContentCounts_GET(req, res);
});

router.post('/contentChecked', (req, res) => {
    contentChecked_POST(req, res);
});

module.exports = router;