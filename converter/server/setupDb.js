const db = require('./db');

// Define Prompts
const newDefaultPromptText = `
# Robust Gemini Prompt for Universal Bank Statement Processing

## Task Description
You are a specialized financial data extraction system. Extract all banking transactions from the provided bank statement text, handling various formats, edge cases, and irregularities. Also identify opening and closing balances as separate entities. Output in structured JSON format.

## Output Format
Return a JSON object with two arrays:
\`\`\`
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",          // Standardized ISO date format
      "description": "String",        // Full transaction description
      "amount": 123.45,             // Numeric value without currency symbols (always positive)
      "type": "credit|debit",       // Transaction type
      "running_balance": 9876.54    // Numeric running balance *after* this transaction
    },
    // Additional transactions...
  ],
  "balances": [
    {
      "date": "YYYY-MM-DD",
      "description": "String",        // E.g. "Opening Balance", "Closing Balance"
      "amount": 123.45,
      "balance_type": "opening|closing"
    },
    // Additional balance entries...
  ]
}
\`\`\`

## Processing Instructions

### Transaction and Balance Identification
1. Identify transactions by their distinctive patterns: date + description + monetary amount
2. Identify opening/closing balances, usually at the beginning or end of statement
3. Separate actual transactions (money in/out) from balance information
4. Ensure each entry represents a SINGLE financial transaction or balance item

### Date Handling
1. Convert all dates to ISO format (YYYY-MM-DD)
2. If dates use numeric formats (MM/DD/YYYY, DD-MM-YYYY, etc.), determine the format based on context
3. For ambiguous dates, prefer the local date format convention inferred from other statement elements

### Amount Processing
1. Extract numeric values without currency symbols
2. Represent amounts as positive numbers
3. Use the "type" field to indicate debit (money out) or credit (money in)
4. For records with amount in only one column (debit OR credit), determine the type accordingly
5. For balance entries, include the full amount value
6. For each entry in the "transactions" array, include the account's running balance *after* that specific transaction in the "running_balance" field. Ensure this is a numeric value.

### Transaction Type Determination
1. Mark "debit" for withdrawals, purchases, payments, fees, transfers out
2. Mark "credit" for deposits, refunds, interest earned, transfers in
3. Infer type from column positioning when not explicitly stated (left column often debits, right column often credits)
4. Check for symbols (-, +) or terms ("DR", "CR") that may indicate transaction type
5. For balance entries, use "opening" or "closing" as appropriate

### Description Handling
1. Capture the complete transaction description, including reference numbers
2. Preserve merchant names, transaction IDs, and references
3. Remove redundant information already captured in other fields
4. Consolidate descriptions that span multiple lines or are split by formatting
5. For balance entries, use clear descriptors like "Opening Balance" or "Closing Balance"

## Edge Case Handling

### Balance Entries
1. INCLUDE account opening and closing balance records in "balances" array
2. Associate each balance with appropriate type (opening/closing)
3. Handle cases where balance information may not have a date
4. Include running balance information in the "balances" array when present (Note: This conflicts slightly with point 6 under Amount Processing which asks for running balance *in* transactions. Transactions array is preferred for running balance).

### Statement Structure Issues
1. Ignore headers, footers, page numbers, and marketing content
2. Properly reconnect transactions split across page breaks
3. Treat account information sections correctly

### Duplicate/Similar Transactions
1. Include all transactions even if they share the same date and similar details
2. Retain any distinguishing information in the description field
3. For identical-looking transactions, include all distinct entries

### Format Variations
1. Handle tables with headers in different positions or formats
2. Process both tabular and list-format statements
3. Accommodate varying column orders across different statement styles

### Character and Text Issues
1. Handle special characters and symbols properly
2. Account for OCR errors in scanned statements (common substitutions: O/0, l/I/1)
3. Properly join hyphenated words split across lines

## Final Verification
Before returning results:
1. Verify each transaction/balance has all required fields
2. Confirm all dates are in valid ISO format
3. Ensure amounts are numeric values
4. Verify each transaction has exactly one type: "credit" or "debit"
5. Verify each balance entry has a valid balance_type: "opening" or "closing"
6. Remove any non-transaction, non-balance data

## Important
- Return ONLY the JSON object with the structure specified above
- Do not include explanations, notes, or descriptions in your response
- Focus on high-precision rather than recall - it's better to miss a transaction than include incorrect data

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

// Example of handling separate transactions with the same reference:
// If you see:
// 18/Mar/2025 | REF999 | Interest Credit | null   | 50.00 | 10050.00
// 18/Mar/2025 | REF999 | Tax Recovered   | 5.00   | null  | 10045.00
// Output BOTH as separate objects:
// {"Transaction Date": "18/Mar/2025", ..., "Narration": "Interest Credit", "Debit": null, "Credit": 50.00, "Balance": 10050.00},
// {"Transaction Date": "18/Mar/2025", ..., "Narration": "Tax Recovered", "Debit": 5.00, "Credit": null, "Balance": 10045.00}

IMPORTANT RULES:
- Ensure all monetary values ("Debit", "Credit", "Balance") are represented strictly as numbers (e.g., 1234.56, not "1,234.56"). Remove any commas or currency symbols.
- If a transaction is clearly a credit (money coming INTO the account, e.g., deposit, refund, received payment), the "Debit" value MUST be null.
- If a transaction is clearly a debit (money going OUT of the account, e.g., purchase, withdrawal, payment sent), the "Credit" value MUST be null.
- **PAYMENT CLARIFICATION:** Pay close attention to narrations containing "PAYMENT FROM...". If the narration indicates a "PAYMENT FROM" another person or entity (like PhonePe, Google Pay, another bank), it generally means *money received* by this account, so it should be a **CREDIT** (Debit is null). However, if the narration says "PAYMENT FROM" the *account holder's own name* or app associated with the account holder (e.g., "PAYMENT FROM PHONEPE" where PhonePe is linked to this account), it often means money *sent* from this account, making it a **DEBIT** (Credit is null). Analyze the context carefully.
- **CRITICAL:** Pay close attention to lines with the same date and reference number. If the narration AND balance change indicate distinct events (like an interest credit followed immediately by a tax debit), you MUST treat them as **separate transactions** in the JSON output, even if the reference number is identical. Check the example above.
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
    ON CONFLICT (bank_identifier) WHERE bank_identifier IS NULL DO UPDATE SET
      prompt_text = EXCLUDED.prompt_text,
      version = Prompts.version + 1,
      is_active = true,
      created_at = NOW();
  `; // Use ON CONFLICT...DO UPDATE to ensure the default prompt text is updated

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
    ON CONFLICT (bank_identifier) DO UPDATE SET 
      prompt_text = EXCLUDED.prompt_text,
      version = Prompts.version + 1, 
      created_at = NOW();
  `; // Modified ON CONFLICT to UPDATE

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