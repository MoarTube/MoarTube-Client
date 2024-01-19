const express = require('express');

const { root_GET, videoId_GET, all_GET, delete_POST, search_GET } = require('../controllers/comments');

const router = express.Router();

router.get('/', (req, res) => {
    root_GET(req, res);
});

router.get('/all', (req, res) => {
    all_GET(req, res);
});

router.get('/search', (req, res) => {
    search_GET(req, res);
});

router.get('/:videoId', (req, res) => {
    videoId_GET(req, res);
});

router.post('/delete', (req, res) => {
    delete_POST(req, res);
});

module.exports = router;