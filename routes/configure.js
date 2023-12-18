const express = require('express');

const { root_GET } = require('../controllers/configure');

const router = express.Router();

router.get('/', (req, res) => {
    root_GET(req, res);
});

module.exports = router;