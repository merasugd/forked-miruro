import express from 'express';
import axios from 'axios';
import path from 'path';
import os from 'os';
import bodyParser from 'body-parser';
import node_url from 'node:url'
import { search } from './anilist/advanceSearch';

import rate_limitter from 'express-rate-limit'

// Rate limiting middleware for /cors route
const limiter = rate_limitter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again after 15 minutes'
});

const app = express();

// Environment Configuration
const PORT = process.env.VITE_PORT || 5173;
const CORS_DEBUG = process.env.CORS_DEBUG ? true : false;
const RATE_LIMIT = process.env.CORS_RATE_LIMIT ? limiter : function(req, res, next) {return next()};

const {
  VITE_CLIENT_ID: CLIENT_ID,
  VITE_CLIENT_SECRET: CLIENT_SECRET,
  VITE_REDIRECT_URI: REDIRECT_URI,
} = process.env;

// Directory paths for static assets
const DIST_DIR = path.join(__dirname, '../dist');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');

// Middleware for static assets and JSON parsing
app.use(express.static(DIST_DIR));
app.use(express.json());
app.use(bodyParser.json());

// API Endpoint for exchanging authorization token
const apiEndpoint = '/api/exchange-token';
app.post(apiEndpoint, async (req, res) => {
  const { code } = req.body;
  if (!code) {
    console.error('Authorization code is missing');
    return res.status(400).send('Authorization code is required');
  }

  const payload = {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  };
  const url = 'https://anilist.co/api/v2/oauth/token';

  // Logging the request details
  console.log('Sending request to AniList API');
  console.log('URL:', url);
  console.log('Payload:', payload);

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'identity',
      },
    });

    // Logging the response details
    console.log('Received response from AniList API');
    console.log('Response Status:', response.status);
    console.log('Response Data:', response.data);

    if (response.data.access_token) {
      res.json({ accessToken: response.data.access_token });
    } else {
      throw new Error('Access token not found in the response');
    }
  } catch (error) {
    console.error('Error during token exchange:', error.message);
    if (error.response) {
      console.error('Error Status:', error.response.status);
      console.error('Error Details:', error.response.data);
    }
    res.status(500).json({
      error: 'Failed to exchange token',
      details: error.response?.data || error.message,
    });
  }
});

app.get('/api/list/:route', async function (req, res) {
  let route = req.params.route;

  if(route === 'advance') {
    let advanceParams = req.query;

    try {
      advanceParams.sort = advanceParams.sort && typeof advanceParams.sort === 'string' ? JSON.parse(advanceParams.sort) : ["POPULARITY_DESC"];
      advanceParams.genres = advanceParams.genres && typeof advanceParams.genres === 'string' ? JSON.parse(advanceParams.genres) : 'NONE_OF_YA_BUSINESS';

      if(advanceParams.genres === 'NONE_OF_YA_BUSINESS') delete advanceParams.genres   

      let searched = await search(advanceParams);

      return res.status(200).json(searched);
    } catch (e) {
      if(CORS_DEBUG) console.error({ error: JSON.stringify(e) });

      return res.status(500).json({ error: JSON.stringify(e) });
    }
  } else return res.status(404).json({ error: 'API NOT FOUND!' })
})

app.get('/cors', RATE_LIMIT, async function (req, res) {

  // Set CORS headers: allow all origins, methods, and headers: you may want to lock this down in a production environment
  res.header("Access-Control-Allow-Origin", );
  res.header("Access-Control-Allow-Methods", "GET, PUT, PATCH, POST, DELETE");
  res.header("Access-Control-Allow-Headers", req.header('access-control-request-headers'));

  if (req.method === 'OPTIONS') {
      // CORS Preflight
      res.send();
  } else {
    try {
      const targetURL = String(req.header('Target-URL') || req.params.url || req.query.url);
      if (!targetURL) {
        if(CORS_DEBUG) console.error("400: Target-URL header or url query parameter is missing")

        return res.status(400).json({ error: 'Target-URL header or url query parameter is missing' });
      }
  
      let requestUrl = decodeURIComponent(targetURL)
      let cors_redirect = new node_url.URL(requestUrl).href

      if(CORS_DEBUG) console.log(cors_redirect)

      const response = await axios({
        url: cors_redirect,
        method: req.method,
        headers: Object.assign({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        }),
        responseType: 'json',
      });

      if(response.status !== 200) {
        if(CORS_DEBUG) console.error("500: BAD REQUEST");
      };
  
      return res.status(response.status).json(response.data);
    } catch (error) {
      if(CORS_DEBUG) console.error({ error: JSON.stringify(error) })

      if (error.response) {
        // The request was made and the server responded with a status code
        // that falls out of the range of 2xx
        res.status(error.response.status).json(error.response.data);
      } else if (error.request) {
        // The request was made but no response was received
        res.status(500).json({ error: 'No response received from target URL' });
      } else {
        // Something happened in setting up the request that triggered an Error
        res.status(500).json({ error: 'Error in setting up the request' });
      }
    }
  }
});

// Serve the main index.html for any non-API requests
app.get('*', (req, res) => {
  res.sendFile(INDEX_FILE, (err) => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).send('An error occurred while serving the application');
    }
  });
});

// Utility to get the first non-internal IPv4 address
function getLocalIpAddress() {
  const networkInterfaces = os.networkInterfaces();
  for (const networkInterface of Object.values(networkInterfaces)) {
    const found = networkInterface?.find(
      (net) => net.family === 'IPv4' && !net.internal,
    );
    if (found) return found.address;
  }
  return 'localhost';
}

// Starting the server
app.listen(PORT, () => {
  const ipAddress = getLocalIpAddress();
  console.log(
    `Server is running at:\n- Localhost: http://localhost:${PORT}\n- Local IP: http://${ipAddress}:${PORT}`,
  );
});
