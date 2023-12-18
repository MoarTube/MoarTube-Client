const express = require('express');

const { captcha_GET } = require('../controllers/alias');

const router = express.Router();

// Retrieve and serve a captcha
router.get('/captcha', (req, res) => {
    captcha_GET(req, res);
});

module.exports = router;