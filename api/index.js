const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Railway Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Init table
pool.query(`
  CREATE TABLE IF NOT EXISTS agents (
    address VARCHAR(42) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )
`).catch(console.error);

// Register agent
app.post('/api/register', async (req, res) => {
  const { address, name } = req.body;
  if (!address || !name) return res.status(400).json({ error: 'address and name required' });
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'invalid address' });
  if (name.length > 50) return res.status(400).json({ error: 'name too long' });
  
  try {
    await pool.query(
      'INSERT INTO agents (address, name) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET name = $2',
      [address.toLowerCase(), name.trim()]
    );
    res.json({ ok: true, address: address.toLowerCase(), name: name.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db error' });
  }
});

// Get all agents
app.get('/api/agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT address, name FROM agents');
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
    const result = await pool.query('SELECT name FROM agents WHERE address = $1', [req.params.address.toLowerCase()]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json({ address: req.params.address.toLowerCase(), name: result.rows[0].name });
  } catch (err) {
    res.status(500).json({ error: 'db error' });
  }
});

// Claim via tweet
app.post('/api/claim', async (req, res) => {
  const { tweetUrl, address } = req.body;
  if (!tweetUrl || !address) return res.status(400).json({ error: 'tweetUrl and address required' });
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'invalid address' });
  
  // Extract tweet ID from URL
  const tweetMatch = tweetUrl.match(/status\/(\d+)/);
  if (!tweetMatch) return res.status(400).json({ error: 'invalid tweet URL' });
  const tweetId = tweetMatch[1];
  
  try {
    // Fetch tweet using syndication API (no auth needed)
    const tweetRes = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=a`);
    if (!tweetRes.ok) return res.status(400).json({ error: 'could not fetch tweet' });
    
    const tweet = await tweetRes.json();
    const tweetText = tweet.text || '';
    
    // Verify tweet contains the address
    if (!tweetText.toLowerCase().includes(address.toLowerCase().slice(0, 10))) {
      return res.status(400).json({ error: 'tweet must contain your wallet address' });
    }
    
    // Extract agent name from tweet: "I am registering my agent [NAME] to Agent Ponzi"
    const nameMatch = tweetText.match(/(?:registering|register)\s+(?:my\s+)?agent\s+([^\s]+)/i);
    if (!nameMatch) {
      return res.status(400).json({ error: 'tweet must include "registering my agent [NAME]"' });
    }
    const agentName = nameMatch[1].replace(/[^a-zA-Z0-9_-]/g, '');
    
    if (!agentName || agentName.length < 2) {
      return res.status(400).json({ error: 'could not extract agent name from tweet' });
    }
    
    // Register with agent name from tweet
    await pool.query(
      'INSERT INTO agents (address, name) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET name = $2',
      [address.toLowerCase(), agentName]
    );
    
    res.json({ ok: true, address: address.toLowerCase(), name: agentName, tweetId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'claim failed' });
  }
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
