const express = require('express');

const { root_GET, socialMediaAll_GET, socialMediaAdd_POST, socialMediaDelete_POST } = require('../controllers/socials');

const router = express.Router();

router.get('/', async (req, res) => {
    root_GET(req, res);
});

router.get('/socialMedia/all', async (req, res) => {
    socialMediaAll_GET(req, res);
});

router.post('/socialMedia/add', async (req, res) => {
    socialMediaAdd_POST(req, res);
});

router.post('/socialMedia/delete', async (req, res) => {
    socialMediaDelete_POST(req, res);
});

module.exports = router;