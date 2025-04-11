const db = require('./db');

const createTables = async () => {
  const createProcessingResultsTable = `
    CREATE TABLE IF NOT EXISTS ProcessingResults (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Use UUID if available, otherwise use SERIAL
      original_pdf_name TEXT,
      processing_timestamp TIMESTAMPTZ DEFAULT NOW(),
      ai_model_used TEXT,
      prompt_used_id INTEGER, -- Assuming prompt ID is integer for now
      initial_ai_result_json JSONB, 
      flags_raised_json JSONB
    );
  `;

  const createFeedbackSubmissionsTable = `
    CREATE TABLE IF NOT EXISTS FeedbackSubmissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES ProcessingResults(id) ON DELETE CASCADE, -- Link to the processing run
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      corrected_data_json JSONB
    );
  `;

  const createPromptsTable = `
    CREATE TABLE IF NOT EXISTS Prompts (
      id SERIAL PRIMARY KEY,
      bank_identifier TEXT UNIQUE, -- Can be null for default, unique otherwise
      prompt_text TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      is_default BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true
    );
  `;
  
  // Ensure UUID extension is available if using UUIDs
  const enableUuidExtension = `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`; // Or pgcrypto for gen_random_uuid()

  try {
    console.log('Creating uuid-ossp extension if not exists...');
    await db.query(enableUuidExtension);
    console.log('Creating ProcessingResults table if not exists...');
    await db.query(createProcessingResultsTable);
    console.log('Creating FeedbackSubmissions table if not exists...');
    await db.query(createFeedbackSubmissionsTable);
    console.log('Creating Prompts table if not exists...');
    await db.query(createPromptsTable);
    console.log('Database tables checked/created successfully.');
  } catch (err) {
    console.error('Error creating database tables:', err);
  } finally {
    // End the pool connection if this script is run standalone
    // Only do this if you run `node setupDb.js` directly
    // db.pool.end(); 
  }
};

// Check if the script is run directly
if (require.main === module) {
  createTables().then(() => {
    console.log('DB setup script finished.');
    db.pool.end(); // Close connection when run directly
  }).catch(err => {
     console.error('DB setup script failed:', err);
     db.pool.end();
  });
} else {
  // If required as a module, just export the function
  module.exports = createTables;
} 