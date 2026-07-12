
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const port = 3000;

// API routes

// Get config
app.get('/api/config', async (req, res) => {
  const { data, error } = await supabase
    .from('config')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching config:', error);
    return res.status(500).json({ error: 'Failed to fetch config' });
  }

  res.json(data[0] || {});
});

// Update config
app.post('/api/config', async (req, res) => {
  const newConfig = req.body;
  
  // Assuming the config table has a single row with id 1
  const { data, error } = await supabase
    .from('config')
    .update(newConfig)
    .eq('id', 1);

  if (error) {
    console.error('Error updating config:', error);
    return res.status(500).json({ error: 'Failed to update config' });
  }

  res.json({ success: true });
});

// Cast a vote
app.post('/api/vote', async (req, res) => {
  const { positionId, round, candidateId } = req.body;
  if (!positionId || !round || !candidateId) {
    return res.status(400).json({ error: 'Missing vote data' });
  }
  const vote = {
    positionId,
    round,
    candidateId,
  };

  const { data, error } = await supabase
    .from('votes')
    .insert([vote]);

  if (error) {
    console.error('Error casting vote:', error);
    return res.status(500).json({ error: 'Failed to cast vote' });
  }

  res.json({ success: true });
});

// Tally results for all positions
app.get('/api/results', async (req, res) => {
  const { data: configData, error: configError } = await supabase
    .from('config')
    .select('*')
    .limit(1);
    
  if (configError) {
    console.error('Error fetching config for results:', configError);
    return res.status(500).json({ error: 'Failed to fetch config for results' });
  }

  const config = configData[0];

  const { data: votes, error: votesError } = await supabase
    .from('votes')
    .select('*');

  if (votesError) {
    console.error('Error fetching votes for results:', votesError);
    return res.status(500).json({ error: 'Failed to fetch votes for results' });
  }
  
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
