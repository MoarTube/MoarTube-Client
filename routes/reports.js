const express = require('express');

const { count_GET } = require('../controllers/reports');

const router = express.Router();

router.get('/count', (req, res) => {
    count_GET(req, res);
});

module.exports = router;