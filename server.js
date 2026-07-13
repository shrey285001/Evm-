
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

async function getPositionsWithCandidates() {
  const { data: positions, error: posError } = await supabase
    .from('positions')
    .select('*')
    .order('round', { ascending: true })
    .order('id', { ascending: true });

  if (posError) {
    console.error('Error fetching positions from Supabase:', posError);
    return null;
  }

  const { data: candidates, error: candError } = await supabase
    .from('candidates')
    .select('*')
    .order('position_id', { ascending: true })
    .order('id', { ascending: true });

  if (candError) {
    console.error('Error fetching candidates from Supabase:', candError);
    return null;
  }

  return positions.map(pos => ({
    ...pos,
    candidates: (candidates || [])
      .filter(c => c.position_id === pos.id)
      .map(c => ({
        id: c.id,
        name: c.name || '',
        house: c.house || '',
        symbol: c.symbol || '',
        avatar: c.avatar || '',
      })),
  }));
}

async function upsertPositionsAndCandidates(positions) {
  if (!Array.isArray(positions) || positions.length === 0) {
    return;
  }

  const positionRows = positions.map(pos => ({
    id: pos.id,
    title: pos.title,
    round: pos.round,
    active: pos.active,
  }));

  const { error: posError } = await supabase
    .from('positions')
    .upsert(positionRows, { onConflict: 'id' });

  if (posError) {
    console.error('Error upserting positions:', posError);
    throw posError;
  }

  const candidateRows = positions.flatMap(pos => {
    return (Array.isArray(pos.candidates) ? pos.candidates : []).map(c => ({
      id: c.id,
      position_id: pos.id,
      name: c.name,
      house: c.house || '',
      symbol: c.symbol || '',
      avatar: c.avatar || '',
    }));
  });

  if (candidateRows.length > 0) {
    const { error: candError } = await supabase
      .from('candidates')
      .upsert(candidateRows, { onConflict: 'id' });

    if (candError) {
      console.error('Error upserting candidates:', candError);
      throw candError;
    }
  }
}

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

  const config = data[0];
  const normalizedConfig = {
    id: config.id,
    schoolName: config.schoolname || config.schoolName || '',
    adminPassword: config.adminpassword || config.adminPassword || '',
    positions: config.positions || []
  };

  const positionsFromTables = await getPositionsWithCandidates();
  if (Array.isArray(positionsFromTables) && positionsFromTables.length > 0) {
    normalizedConfig.positions = positionsFromTables;
  }

  console.log('Config fetched successfully:', normalizedConfig);
  res.json(normalizedConfig);
});

// Update config
app.post('/api/config', async (req, res) => {
  const newConfig = req.body;
  console.log('Updating config:', newConfig);
  
  const dbUpdate = {
    id: 1,
    schoolname: newConfig.schoolName,
    adminpassword: newConfig.adminPassword,
    positions: newConfig.positions
  };
  
  const { data, error } = await supabase
    .from('config')
    .upsert([dbUpdate], { onConflict: 'id' });

  if (error) {
    console.error('Error updating config:', error);
    return res.status(500).json({ error: 'Failed to update config', details: error.message });
  }

  try {
    await upsertPositionsAndCandidates(newConfig.positions);
  } catch (upsertError) {
    return res.status(500).json({ error: 'Failed to save positions/candidates', details: upsertError.message });
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

  const positions = await getPositionsWithCandidates();
  const { data: votes, error: votesError } = await supabase
    .from('votes')
    .select('*');

  const resultsPositions = Array.isArray(positions) && positions.length > 0 ? positions : config.positions || [];

  if (votesError) {
    console.error('Error fetching votes for results:', votesError);
    return res.status(500).json({ error: 'Failed to fetch votes for results', details: votesError.message });
  }
  
  let totalVoters = 0;
  let totalVotesCast = 0;

  const perPosition = resultsPositions.map(pos => {
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
