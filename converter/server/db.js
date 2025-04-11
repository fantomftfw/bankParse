const { Pool } = require('pg');
require('dotenv').config(); // Ensure env vars are loaded

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable not set.');
  // In a real app, you might throw an error or exit gracefully depending on the context
  // For Render, it will likely be set, but this is good practice for local dev
}

// Conditionally set SSL based on environment
const sslConfig = process.env.NODE_ENV === 'production' 
  ? undefined // No SSL for internal connections in production
  : { rejectUnauthorized: false }; // Enable SSL for local dev (non-production)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig,
});

console.log(`Database connection pool created.${sslConfig ? ' (SSL enabled for non-production)' : ' (SSL disabled for production)'}`);

// Optional: Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Database connected successfully at:', res.rows[0].now);
  }
});

module.exports = {
  query: (text, params, callback) => {
    return pool.query(text, params, callback);
  },
  pool: pool // Export pool if direct access needed elsewhere
}; 