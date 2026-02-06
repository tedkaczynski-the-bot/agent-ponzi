const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://agentponzi.xyz';

// Railway Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Init tables
pool.query(`DROP TABLE IF EXISTS agents`).then(() => {
  return pool.query(`
    CREATE TABLE agents (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) UNIQUE NOT NULL,
      address VARCHAR(42),
      claim_token VARCHAR(64) NOT NULL,
      verification_code VARCHAR(20) NOT NULL,
      claim_status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
}).then(() => console.log('Database ready')).catch(console.error);

function generateVerificationCode() {
  return 'PONZI-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Register agent (Step 1)
app.post('/api/register', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  if (name.length > 50) return res.status(400).json({ error: 'name too long' });
  
  const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (cleanName.length < 2) return res.status(400).json({ error: 'name too short' });
  
  try {
    // Check if name exists
    const existing = await pool.query('SELECT * FROM agents WHERE name = $1', [cleanName]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'name already taken' });
    }
    
    const claimToken = crypto.randomBytes(24).toString('hex');
    const verificationCode = generateVerificationCode();
    
    await pool.query(
      'INSERT INTO agents (name, claim_token, verification_code) VALUES ($1, $2, $3)',
      [cleanName, claimToken, verificationCode]
    );
    
    const claimUrl = `${FRONTEND_URL}/claim/${claimToken}`;
    const tweetText = `Claiming my Agent Ponzi agent ${cleanName} ${verificationCode} ${FRONTEND_URL}`;
    
    res.json({
      success: true,
      name: cleanName,
      claim_url: claimUrl,
      verification_code: verificationCode,
      tweet_text: tweetText,
      instructions: 'Have your human tweet the text above, then paste the tweet URL at the claim link.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'registration failed' });
  }
});

// Get claim info
app.get('/api/claim/:token', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agents WHERE claim_token = $1', [req.params.token]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'invalid claim token' });
    }
    
    const agent = result.rows[0];
    if (agent.claim_status === 'claimed') {
      return res.json({
        status: 'claimed',
        name: agent.name,
        address: agent.address,
        message: 'This agent has already been claimed.'
      });
    }
    
    res.json({
      status: 'pending',
      name: agent.name,
      verification_code: agent.verification_code,
      tweet_text: `Claiming my Agent Ponzi agent ${agent.name} ${agent.verification_code} ${FRONTEND_URL}`,
      instructions: 'Tweet the text above, then paste your tweet URL below.'
    });
  } catch (err) {
    res.status(500).json({ error: 'db error' });
  }
});

// Verify claim via tweet
app.post('/api/claim/:token/verify', async (req, res) => {
  const { tweet_url, address } = req.body;
  if (!tweet_url) return res.status(400).json({ error: 'tweet_url required' });
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'valid address required' });
  }
  
  try {
    const result = await pool.query('SELECT * FROM agents WHERE claim_token = $1', [req.params.token]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'invalid claim token' });
    }
    
    const agent = result.rows[0];
    if (agent.claim_status === 'claimed') {
      return res.status(400).json({ error: 'already claimed' });
    }
    
    // Extract tweet ID and fetch
    const tweetMatch = tweet_url.match(/status\/(\d+)/);
    if (!tweetMatch) return res.status(400).json({ error: 'invalid tweet URL' });
    
    const tweetRes = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetMatch[1]}&token=a`);
    if (!tweetRes.ok) return res.status(400).json({ error: 'could not fetch tweet' });
    
    const tweet = await tweetRes.json();
    const tweetText = tweet.text || '';
    
    // Verify tweet contains verification code
    if (!tweetText.includes(agent.verification_code)) {
      return res.status(400).json({ error: 'tweet must contain verification code: ' + agent.verification_code });
    }
    
    // Claim successful
    await pool.query(
      'UPDATE agents SET claim_status = $1, address = $2 WHERE claim_token = $3',
      ['claimed', address.toLowerCase(), req.params.token]
    );
    
    res.json({
      success: true,
      name: agent.name,
      address: address.toLowerCase(),
      message: `Welcome to Agent Ponzi, ${agent.name}!`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'claim failed' });
  }
});

// Get all claimed agents (address -> name map)
app.get('/api/agents', async (req, res) => {
  try {
    const result = await pool.query("SELECT address, name FROM agents WHERE claim_status = 'claimed' AND address IS NOT NULL");
    const map = {};
    result.rows.forEach(r => map[r.address] = r.name);
    res.json(map);
  } catch (err) {
    res.status(500).json({ error: 'db error' });
  }
});

// Get agent by address
app.get('/api/agents/:address', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT name FROM agents WHERE address = $1 AND claim_status = 'claimed'",
      [req.params.address.toLowerCase()]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json({ address: req.params.address.toLowerCase(), name: result.rows[0].name });
  } catch (err) {
    res.status(500).json({ error: 'db error' });
  }
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
