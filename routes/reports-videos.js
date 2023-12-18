const express = require('express');

const { root_GET, all_GET, archiveAll_GET, archive_POST, delete_POST, archiveDelete_POST } = require('../controllers/reports-videos');

const router = express.Router();

router.get('/', (req, res) => {
    root_GET(req, res);
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