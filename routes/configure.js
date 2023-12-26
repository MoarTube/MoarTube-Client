const express = require('express');

const { root_GET, root_POST } = require('../controllers/configure');

const router = express.Router();

router.get('/', (req, res) => {
    root_GET(req, res);
});

router.post('/', (req, res) => {
    root_POST(req, res);
});

module.exports = router;