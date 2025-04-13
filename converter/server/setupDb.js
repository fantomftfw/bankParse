const db = require('./db');

// Define Prompts
// Updated Default Prompt v3 (Stronger exclusion for summaries)
const newDefaultPromptText = `
Analyze the following bank statement text and extract data ONLY from the main, detailed transaction table.
This table typically contains columns like "Date", "Value Date", "Transaction Details", "Narration", "Description", "Debit", "Withdrawal", "Credit", "Deposit", and "Balance", and often spans multiple pages or contains numerous rows.

**CRITICAL INSTRUCTIONS:**
1.  **Identify the Primary Transaction Table:** Locate the main table listing individual transaction events. This is usually the **largest table**, often spanning multiple pages, containing many rows detailing specific debits and credits.
2.  **Extract ONLY Transaction Rows:** Extract data *exclusively* from the rows *within* this identified primary transaction table.
3.  **IGNORE Other Data & Summaries:** Explicitly IGNORE summary sections or tables (like those titled "Account Summary", "Summary for Statement period", or any sections containing aggregated totals like "Other Debits", "Other Credits", "Total Debits/Credits"), page headers, page footers, account holder details, bank addresses, disclaimers, or any text clearly outside the main transaction table rows. If a section looks like a short summary with just a few aggregated totals, DO NOT extract from it.
4.  **Match Column Headers Exactly:** Determine the exact column headers present *at the top of the identified primary transaction table*.
5.  **Format as JSON Array:** Output the extracted data as a JSON array of objects.
6.  **JSON Keys = Column Headers:** Each object in the array represents one transaction row from the main table. The keys within each JSON object MUST precisely match the column headers identified in step 4. Include all columns found in that specific table.
7.  **Handle Multi-line Descriptions:** Combine multi-line descriptions or narrations within a single transaction row into a single string value for the relevant transaction detail key.
8.  **Include Opening Balance Row:** If an "Opening Balance" entry exists as the first data row *within the structure* of the main transaction table (often having only a balance value), include it as the first object in the JSON array. Do *not* extract "Opening Balance" if it appears in a separate summary section.

Text Content:
--- START ---
\${textContent}
--- END ---

JSON Output (Array of objects matching ONLY the main transaction table columns):
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

// Define Equitas Prompt (Updated to target main table, dynamic Equitas schema)
const equitasPromptText = `
Analyze the following Equitas bank statement text and extract data ONLY from the main, detailed transaction table.
This table typically contains columns like "Transaction Date", "Value Date", "Reference or cheque no", "Narration", "Debit", "Credit", and "Balance".

**CRITICAL INSTRUCTIONS:**
1.  **Identify the Primary Transaction Table:** Locate the main table listing individual transaction events with corresponding dates, amounts, and balances. This is usually the largest table spanning multiple pages.
2.  **Extract ONLY Transaction Rows:** Extract data *exclusively* from the rows within this identified primary transaction table.
3.  **IGNORE Other Data:** Explicitly IGNORE summary tables (like "Account Summary", opening/closing balance summaries unless they are *rows within* the main table, "Other Debits/Credits" summaries), page headers, page footers, account holder details, bank addresses, disclaimers, or any text clearly outside the main transaction table rows.
4.  **Match Column Headers Exactly:** Determine the exact column headers present *at the top of the identified primary transaction table* (likely "Transaction Date", "Value Date", "Reference or cheque no", "Narration", "Debit", "Credit", "Balance").
5.  **Format as JSON Array:** Output the extracted data as a JSON array of objects.
6.  **JSON Keys = Column Headers:** Each object in the array represents one transaction row from the main table. The keys within each JSON object MUST precisely match the column headers identified in step 4.
7.  **Handle Multi-line Narrations:** Combine multi-line narrations within a single transaction row into a single string value for the "Narration" key.
8.  **Include Opening Balance Row:** If an "Opening Balance" entry exists as the first data row *within* the main transaction table structure (often having only a balance value), include it as the first object in the JSON array.
9.  **Numeric Values:** Ensure all monetary values ("Debit", "Credit", "Balance") are represented strictly as numbers (e.g., 1234.56, not "1,234.56"). Remove commas.
10. **Credit/Debit Exclusivity:** If "Debit" has a value, "Credit" MUST be null. If "Credit" has a value, "Debit" MUST be null.
11. **CRITICAL Handling of Shared Refs:** Pay close attention to lines with the same date and "Reference or cheque no". If the "Narration" AND "Balance" change indicate distinct events (like interest credit followed by tax debit), treat them as **separate transactions** in the JSON output.

Text Content:
--- START ---
\${textContent}
--- END ---

JSON Output (Array of objects matching ONLY the main transaction table columns):
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
    ON CONFLICT (bank_identifier) WHERE bank_identifier IS NULL DO UPDATE SET
      prompt_text = EXCLUDED.prompt_text,
      version = Prompts.version + 1,
      is_active = true,
      created_at = NOW();
  `; // Use ON CONFLICT...DO UPDATE to ensure the default prompt text is updated

  // Insert ICICI Prompt (Inactive)
  const insertIciciPrompt = `
    INSERT INTO Prompts (bank_identifier, prompt_text, is_default, is_active, version)
    VALUES ('ICICI', $1, false, false, 1) -- Set is_active = false
    ON CONFLICT (bank_identifier) DO UPDATE SET
      prompt_text = EXCLUDED.prompt_text,
      is_active = false, -- Ensure it stays inactive on update
      version = Prompts.version + 1,
      created_at = NOW();
  `;

  // Insert Equitas Prompt (Inactive)
  const insertEquitasPrompt = `
    INSERT INTO Prompts (bank_identifier, prompt_text, is_default, is_active, version)
    VALUES ('EQUITAS', $1, false, false, 1) -- Set is_active = false
    ON CONFLICT (bank_identifier) DO UPDATE SET 
      prompt_text = EXCLUDED.prompt_text,
      is_active = false, -- Ensure it stays inactive on update
      version = Prompts.version + 1, 
      created_at = NOW();
  `;

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
    await db.query(insertDefaultPrompt, [newDefaultPromptText]);
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