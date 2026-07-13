
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

const port = process.env.PORT || 3000;

console.log('Initializing server with Supabase...');
console.log('SUPABASE_URL:', supabaseUrl ? 'configured' : 'MISSING');
console.log('SUPABASE_SECRET_KEY:', supabaseKey ? 'configured' : 'MISSING');
console.log(`Server will run on port: ${port}`);

// API routes

// Get config
app.get('/api/config', async (req, res) => {
  console.log('Fetching config from Supabase...');
  const { data, error } = await supabase
    .from('config')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching config from Supabase:', error);
    return res.status(500).json({ error: 'Failed to fetch config', details: error.message });
  }

  if (!data || data.length === 0) {
    console.log('No config data found in Supabase');
    return res.json({});
  }

  // Normalize field names from database to match frontend expectations
  const config = data[0];
  const normalizedConfig = {
    id: config.id,
    schoolName: config.schoolname || config.schoolName || '',
    adminPassword: config.adminpassword || config.adminPassword || '',
    positions: config.positions || []
  };

  console.log('Config fetched successfully:', normalizedConfig);
  res.json(normalizedConfig);
});

// Update config
app.post('/api/config', async (req, res) => {
  const newConfig = req.body;
  console.log('Updating config:', newConfig);
  
  // Map camelCase to snake_case for database
  const dbUpdate = {
    schoolname: newConfig.schoolName,
    adminpassword: newConfig.adminPassword,
    positions: newConfig.positions
  };
  
  // Assuming the config table has a single row with id 1
  const { data, error } = await supabase
    .from('config')
    .update(dbUpdate)
    .eq('id', 1);

  if (error) {
    console.error('Error updating config:', error);
    return res.status(500).json({ error: 'Failed to update config', details: error.message });
  }

  console.log('Config updated successfully');
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

  console.log('Casting vote:', vote);
  const { data, error } = await supabase
    .from('votes')
    .insert([vote]);

  if (error) {
    console.error('Error casting vote:', error);
    return res.status(500).json({ error: 'Failed to cast vote', details: error.message });
  }

  console.log('Vote recorded successfully');
  res.json({ success: true });
});

// Tally results for all positions
app.get('/api/results', async (req, res) => {
  console.log('Fetching results...');
  const { data: configData, error: configError } = await supabase
    .from('config')
    .select('*')
    .limit(1);
    
  if (configError) {
    console.error('Error fetching config for results:', configError);
    return res.status(500).json({ error: 'Failed to fetch config for results', details: configError.message });
  }

  const config = configData[0];
  console.log('Config loaded for results');

  const { data: votes, error: votesError } = await supabase
    .from('votes')
    .select('*');

  if (votesError) {
    console.error('Error fetching votes for results:', votesError);
    return res.status(500).json({ error: 'Failed to fetch votes for results', details: votesError.message });
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
