/**
 * Cloudflare Workers API for EVM Voting System
 * This version works with Cloudflare Workers runtime
 */

import { createClient } from '@supabase/supabase-js';

let supabase;

// Helper function to send JSON responses
const jsonResponse = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
};

// Get config
const getConfig = async (request) => {
  try {
    console.log('[API] Fetching config from Supabase...');
    const { data, error } = await supabase
      .from('config')
      .select('*')
      .limit(1);

    if (error) {
      console.error('[API] Error fetching config:', error);
      return jsonResponse({ error: 'Failed to fetch config', details: error.message }, 500);
    }

    if (!data || data.length === 0) {
      console.log('[API] No config found');
      return jsonResponse({});
    }

    // Normalize field names
    const config = data[0];
    const normalizedConfig = {
      id: config.id,
      schoolName: config.schoolname || config.schoolName || '',
      adminPassword: config.adminpassword || config.adminPassword || '',
      positions: config.positions || []
    };

    console.log('[API] Config fetched successfully');
    return jsonResponse(normalizedConfig);
  } catch (err) {
    console.error('[API] Exception in getConfig:', err);
    return jsonResponse({ error: 'Server error', details: err.message }, 500);
  }
};

// Update config
const updateConfig = async (request) => {
  try {
    const newConfig = await request.json();
    console.log('[API] Updating config...');

    const dbUpdate = {
      schoolname: newConfig.schoolName,
      adminpassword: newConfig.adminPassword,
      positions: newConfig.positions
    };

    const { data, error } = await supabase
      .from('config')
      .update(dbUpdate)
      .eq('id', 1);

    if (error) {
      console.error('[API] Error updating config:', error);
      return jsonResponse({ error: 'Failed to update config', details: error.message }, 500);
    }

    console.log('[API] Config updated successfully');
    return jsonResponse({ success: true });
  } catch (err) {
    console.error('[API] Exception in updateConfig:', err);
    return jsonResponse({ error: 'Server error', details: err.message }, 500);
  }
};

// Cast vote
const castVote = async (request) => {
  try {
    const { positionId, round, candidateId } = await request.json();

    if (!positionId || !round || !candidateId) {
      return jsonResponse({ error: 'Missing vote data' }, 400);
    }

    const vote = { positionId, round, candidateId };
    console.log('[API] Casting vote:', vote);

    const { data, error } = await supabase
      .from('votes')
      .insert([vote]);

    if (error) {
      console.error('[API] Error casting vote:', error);
      return jsonResponse({ error: 'Failed to cast vote', details: error.message }, 500);
    }

    console.log('[API] Vote recorded successfully');
    return jsonResponse({ success: true });
  } catch (err) {
    console.error('[API] Exception in castVote:', err);
    return jsonResponse({ error: 'Server error', details: err.message }, 500);
  }
};

// Get results
const getResults = async (request) => {
  try {
    console.log('[API] Fetching results...');

    const { data: configData, error: configError } = await supabase
      .from('config')
      .select('*')
      .limit(1);

    if (configError) {
      console.error('[API] Error fetching config for results:', configError);
      return jsonResponse({ error: 'Failed to fetch config', details: configError.message }, 500);
    }

    const config = configData[0];
    const { data: votes, error: votesError } = await supabase
      .from('votes')
      .select('*');

    if (votesError) {
      console.error('[API] Error fetching votes:', votesError);
      return jsonResponse({ error: 'Failed to fetch votes', details: votesError.message }, 500);
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

    console.log('[API] Results compiled');
    return jsonResponse({
      totalVoters,
      totalVotesCast,
      positionsConfigured: config.positions.length,
      perPosition
    });
  } catch (err) {
    console.error('[API] Exception in getResults:', err);
    return jsonResponse({ error: 'Server error', details: err.message }, 500);
  }
};

// Serve static files
const serveStatic = async (path) => {
  try {
    // Map to public folder
    const filePath = path.startsWith('/') ? path.slice(1) : path;
    
    // Try to fetch from public folder
    const assetPath = `/public/${filePath}`;
    
    // This would need a static file serving mechanism
    // For now, return 404 for non-API routes
    return new Response('Not Found', { status: 404 });
  } catch (err) {
    return new Response('Server Error', { status: 500 });
  }
};

// Router
export default {
  async fetch(request, env, ctx) {
    // Initialize Supabase on first request using Worker environment bindings
    if (!supabase) {
      const url = (env && env.SUPABASE_URL) || '';
      const key = (env && (env.SUPABASE_SECRET || env.SUPABASE_SECRET_KEY)) || '';
      if (!url || !key) {
        return jsonResponse({ error: 'Supabase credentials not configured in Worker environment' }, 500);
      }
      supabase = createClient(url, key);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return jsonResponse({}, 200);
    }

    console.log(`[${method}] ${path}`);

    // API Routes
    if (path === '/api/config' && method === 'GET') {
      return getConfig(request);
    }
    if (path === '/api/config' && method === 'POST') {
      return updateConfig(request);
    }
    if (path === '/api/vote' && method === 'POST') {
      return castVote(request);
    }
    if (path === '/api/results' && method === 'GET') {
      return getResults(request);
    }

    // If a frontend URL is configured in environment, redirect root requests there
    if ((path === '/' || path === '') && env && env.FRONTEND_URL) {
      return Response.redirect(env.FRONTEND_URL, 302);
    }

    // If a frontend API base is provided, let client be served elsewhere; otherwise 404
    return jsonResponse({ error: 'Not Found - Use /api/* endpoints' }, 404);
  }
};
