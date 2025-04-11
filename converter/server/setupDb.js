const db = require('./db');

// Define Prompts
const defaultPromptText = `
Analyze the following bank statement text and extract all transaction details.
Focus ONLY on rows representing individual transactions.
Include the initial "Opening Balance" row if it appears as the first entry, even if Debit/Credit are zero or null.
Ignore other summary lines, repeated headers, footers, or text outside the main transaction list.
Format the output as a JSON array of objects. Each object MUST represent a single transaction
and MUST contain the following keys EXACTLY:
- "Serial no.": The transaction serial number or sequence identifier (string or null if not present).
- "Date": The date of the transaction (YYYY-MM-DD format preferred, but keep original if ambiguous).
- "Transaction details": The full description of the transaction (string).
- "Debit": The amount debited (positive number or null if it's a credit).
- "Credit": The amount credited (positive number or null if it's a debit).
- "Balance": The account balance *after* this transaction (number).

Example object:
{
  "Serial no.": "123",
  "Date": "2024-07-15",
  "Transaction details": "Grocery Store Purchase",
  "Debit": 55.20,
  "Credit": null,
  "Balance": 1450.75
}

IMPORTANT RULES:
- Ensure all monetary values are represented as numbers (e.g., 123.45, not "$123.45").
- If a transaction is clearly a credit, the "Debit" value should be null.
- If a transaction is clearly a debit, the "Credit" value should be null.
- ONLY include rows that are clearly individual transactions. Do not include summaries.
- Do NOT include any introductory text, explanations, or markdown fences (like \`\`\`json) in your response.
Provide ONLY the JSON array.

Bank Statement Text:
--- START ---
\${textContent}
--- END ---
`;

const iciciPromptText = `
Analyze the following bank statement text and extract all transaction details.
Focus ONLY on rows representing individual transactions.
Include the initial "Opening Balance" row if it appears as the first entry, even if Withdrawal/Deposit are zero or null.
Ignore other summary lines, repeated headers, footers, or text outside the main transaction list.
Format the output as a JSON array of objects. Each object MUST represent a single transaction
and MUST contain the following keys EXACTLY, matching the structure of the target CSV:
- "Sl No": The transaction serial number or sequence identifier (string or number, or null if not present).
- "Tran Id": The transaction ID string (string or null if not present).
- "Value Date": The value date of the transaction (use DD/Mon/YYYY format if possible, otherwise keep original string).
- "Transaction Date": The transaction date (use DD/Mon/YYYY format if possible, otherwise keep original string).
- "Transaction Posted": The date and time the transaction was posted (string or null).
- "Cheque no /": The cheque number if applicable (string or null).
- "Ref No": The reference number if applicable (string or null).
- "Transaction Remarks": The full description/remarks of the transaction (string).
- "Withdrawal (Dr)": The withdrawal amount as a positive number (number or null if it's a deposit).
- "Deposit(Cr)": The deposit amount as a positive number (number or null if it's a withdrawal).
- "Balance": The account balance *after* this transaction (number).

Example object based on the target CSV structure:
{
  "Sl No": 2,
  "Tran Id": "S8016 8647",
  "Value Date": "19/Jan/2025",
  "Transaction Date": "19/Jan/2025",
  "Transaction Posted": "19/01/2025 11:07:48 PM",
  "Cheque no /": null,
  "Ref No": null,
  "Transaction Remarks": "UPI/291860937631/ Payment from Ph/abhishek.kurve./E QUITAS SMALL F/YBLd4b5d1bcf102 4fc7ae142b37fe4d9 91d",
  "Withdrawal (Dr)": null,
  "Deposit(Cr)": 2200,
  "Balance": 2391.35
}

IMPORTANT RULES:
- Ensure all monetary values ("Withdrawal (Dr)", "Deposit(Cr)", "Balance") are represented strictly as numbers (e.g., 1234.56, not "1,234.56" or "$123.45"). Remove any commas or currency symbols.
- If a transaction is a withdrawal, the "Deposit(Cr)" value MUST be null and "Withdrawal (Dr)" MUST be a positive number.
- If a transaction is a deposit, the "Withdrawal (Dr)" value MUST be null and "Deposit(Cr)" MUST be a positive number.
- Extract the data as accurately as possible from the text.
- ONLY include rows that are clearly individual transactions. Do not include summaries.
- Do NOT include any introductory text, explanations, or markdown fences (like \`\`\`json) in your response.
- Provide ONLY the JSON array.

Bank Statement Text:
--- START ---
\${textContent}
--- END ---
`;

// Define Equitas Prompt
const equitasPromptText = `
Analyze the following bank statement text and extract all transaction details.
Focus ONLY on rows representing individual transactions.
Include the initial "Opening Balance" row if it appears as the first entry, even if Debit/Credit are zero or null.
Ignore other summary lines, repeated headers, footers, or text outside the main transaction list.
Format the output as a JSON array of objects. Each object MUST represent a single transaction
and MUST contain the following keys EXACTLY, matching the structure of the Equitas statement:
- "Transaction Date": The primary date of the transaction.
- "Value Date": The value date if different from Transaction Date.
- "Reference or cheque no": The reference or cheque number associated with the transaction (string or null).
- "Narration": The full description or narration of the transaction (string).
- "Debit": The amount debited (positive number or null if it's a credit).
- "Credit": The amount credited (positive number or null if it's a debit).
- "Balance": The account balance *after* this transaction (number).

Example object (adjust values as needed):
{
  "Transaction Date": "10/Apr/2024",
  "Value Date": "10/Apr/2024",
  "Reference or cheque no": "REF12345",
  "Narration": "Online Purchase Amazon",
  "Debit": 1500.50,
  "Credit": null,
  "Balance": 25000.75
}

IMPORTANT RULES:
- Ensure all monetary values ("Debit", "Credit", "Balance") are represented strictly as numbers (e.g., 1234.56, not "1,234.56"). Remove any commas or currency symbols.
- If a transaction is clearly a credit, the "Debit" value MUST be null.
- If a transaction is clearly a debit, the "Credit" value MUST be null.
- ONLY include rows that are clearly individual transactions. Do not include summaries.
- Do NOT include any introductory text, explanations, or markdown fences (like \`\`\`json) in your response.
- Provide ONLY the JSON array.

Bank Statement Text:
--- START ---
\${textContent}
--- END ---
`;

const createTablesAndPrompts = async () => {
  const createProcessingResultsTable = `
    CREATE TABLE IF NOT EXISTS ProcessingResults (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Use UUID if available, otherwise use SERIAL
      original_pdf_name TEXT,
      processing_timestamp TIMESTAMPTZ DEFAULT NOW(),
      ai_model_used TEXT,
      prompt_used_id INTEGER, -- Assuming prompt ID is integer for now
      initial_ai_result_json JSONB, 
      flags_raised_json JSONB,
      user_confirmed_accuracy BOOLEAN DEFAULT NULL -- Add column for accuracy confirmation
    );
  `;

  const createFeedbackSubmissionsTable = `
    CREATE TABLE IF NOT EXISTS FeedbackSubmissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID REFERENCES ProcessingResults(id) ON DELETE CASCADE, -- Link to the processing run
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      corrected_data_json JSONB,
      analysis_json JSONB DEFAULT NULL -- Add column for analysis results
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

  // --- Add Seed Prompts --- 
  // Insert Default Prompt
  const insertDefaultPrompt = `
    INSERT INTO Prompts (bank_identifier, prompt_text, is_default, is_active, version)
    VALUES (NULL, $1, true, true, 1)
    ON CONFLICT (bank_identifier) WHERE bank_identifier IS NULL DO NOTHING;
  `; // Use ON CONFLICT for default (where identifier is NULL)

  // Insert ICICI Prompt
  const insertIciciPrompt = `
    INSERT INTO Prompts (bank_identifier, prompt_text, is_default, is_active, version)
    VALUES ('ICICI', $1, false, true, 1)
    ON CONFLICT (bank_identifier) DO NOTHING;
  `; // Use ON CONFLICT for ICICI

  // Insert Equitas Prompt
  const insertEquitasPrompt = `
    INSERT INTO Prompts (bank_identifier, prompt_text, is_default, is_active, version)
    VALUES ('EQUITAS', $1, false, true, 1)
    ON CONFLICT (bank_identifier) DO NOTHING;
  `; // Use ON CONFLICT for Equitas

  try {
    console.log('Creating uuid-ossp extension if not exists...');
    await db.query(enableUuidExtension);
    console.log('Creating ProcessingResults table if not exists...');
    await db.query(createProcessingResultsTable);
    
    // --- Add column if it doesn't exist (for existing tables) ---
    // This avoids errors if the table already exists without the column
    const alterProcessingResultsTable = `
      ALTER TABLE ProcessingResults
      ADD COLUMN IF NOT EXISTS user_confirmed_accuracy BOOLEAN DEFAULT NULL;
    `;
    console.log('Ensuring user_confirmed_accuracy column exists...');
    await db.query(alterProcessingResultsTable);
    // --- End Add column --- 
    
    console.log('Creating FeedbackSubmissions table if not exists...');
    await db.query(createFeedbackSubmissionsTable);
    
    // --- Add analysis_json column if it doesn't exist ---
    const alterFeedbackSubmissionsTable = `
      ALTER TABLE FeedbackSubmissions
      ADD COLUMN IF NOT EXISTS analysis_json JSONB DEFAULT NULL;
    `;
    console.log('Ensuring analysis_json column exists in FeedbackSubmissions...');
    await db.query(alterFeedbackSubmissionsTable);
    // --- End Add column ---
    
    console.log('Creating Prompts table if not exists...');
    await db.query(createPromptsTable);
    
    console.log('Seeding default prompt...');
    await db.query(insertDefaultPrompt, [defaultPromptText]);
    console.log('Seeding ICICI prompt...');
    await db.query(insertIciciPrompt, [iciciPromptText]);
    console.log('Seeding Equitas prompt...');
    await db.query(insertEquitasPrompt, [equitasPromptText]);

    console.log('Database setup and seeding complete.');
  } catch (err) {
    console.error('Error during database setup or seeding:', err);
  } finally {
    // End the pool connection if this script is run standalone
    // Only do this if you run `node setupDb.js` directly
    // db.pool.end(); 
  }
};

// Check if the script is run directly
if (require.main === module) {
  createTablesAndPrompts().then(() => {
    console.log('DB setup script finished.');
    db.pool.end(); // Close connection when run directly
  }).catch(err => {
     console.error('DB setup script failed:', err);
     db.pool.end();
  });
} else {
  // If required as a module, just export the function
  module.exports = createTablesAndPrompts;
} 