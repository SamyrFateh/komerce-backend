'use strict';

const express = require('express');
const router = express.Router();

const VERIFY_TOKEN = process.env.META_WA_VERIFY_TOKEN || 'komerce_meta_verify_token';

router.get('/webhook/meta-whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

router.post('/webhook/meta-whatsapp', async (req, res) => {
  try {
    const body = req.body || {};

    console.log('[META-WA][WEBHOOK]', JSON.stringify(body));

    // Ici plus tard:
    // - status sent/delivered/read/failed
    // - mapping wamid -> order_ref / event
    // - messages entrants client -> support

    return res.sendStatus(200);
  } catch (e) {
    console.error('[META-WA][WEBHOOK][ERROR]', e.message);
    return res.sendStatus(500);
  }
});

module.exports = router;