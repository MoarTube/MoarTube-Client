const express = require('express');

const { signIn_GET, signIn_POST, signOut_GET} = require('../controllers/account');

const router = express.Router();

router.get('/signin', async (req, res) => {
    signIn_GET(req, res);
});

router.post('/signin', (req, res) => {
    signIn_POST(req, res);
});

router.get('/signout', (req, res) => {
    signOut_GET(req, res);
});

module.exports = router;