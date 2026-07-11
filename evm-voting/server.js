const express = require('express');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bodyParser = require('body-parser');
const cors = require('cors');

const adapter = new FileSync('db.json');
const db = low(adapter);

// Set some defaults if the DB is empty
db.defaults({
  config: {
    schoolName : "Greenwood Public School",
    adminPassword : "admin123",
    positions : []
  },
  votes: []
}).write();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const port = 3000;

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

// API routes

// Get config
app.get('/api/config', (req, res) => {
  const config = db.get('config').value();
  res.json(config);
});

// Update config
app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  db.set('config', newConfig).write();
  res.json({ success: true });
});

// Cast a vote
app.post('/api/vote', (req, res) => {
  const { positionId, round, candidateId } = req.body;
  if (!positionId || !round || !candidateId) {
    return res.status(400).json({ error: 'Missing vote data' });
  }
  const vote = {
    id: `vote:${positionId}:r${round}:${Date.now()}-${uid()}`,
    positionId,
    round,
    candidateId,
    ts: new Date().toISOString()
  };
  db.get('votes').push(vote).write();
  res.json({ success: true });
});

// Tally results for all positions
app.get('/api/results', (req, res) => {
  const config = db.get('config').value();
  const votes = db.get('votes').value();
  
  let totalVoters = 0;
  let totalVotesCast = 0;

  const perPosition = config.positions.map(pos => {
    const counts = {};
    pos.candidates.forEach(c => counts[c.id] = 0);
    
    const positionVotes = votes.filter(v => v.positionId === pos.id && v.round == pos.round);
    
    positionVotes.forEach(vote => {
      if (counts.hasOwnProperty(vote.candidateId)) {
        counts[vote.candidateId]++;
        totalVotesCast++;
      }
    });
    
    const tv = positionVotes.length;
    totalVoters += tv;
    
    return { pos, counts, tv };
  });

  res.json({
    totalVoters,
    totalVotesCast,
    positionsConfigured: config.positions.length,
    perPosition
  });
});


app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
