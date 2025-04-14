require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse'); // Require pdf-parse at the top
const db = require('./db'); // Import the db utility
const { compareResults } = require('./feedbackAnalyzer'); // Import the analyzer

// Import AI processing logic
const { extractTransactionsWithAI, identifyBankWithAI } = require('./aiProcessor'); // Removed normalize & validate
// Import CSV generation logic
const { generateCsv, csvExportsDir } = require('./csvGenerator'); // Import generateCsv
// Import pattern extraction logic
const { extractTransactionsWithPatterns } = require('./patternExtractor'); // Keep for fallback?

// TODO: Import processing logic controllers
// TODO: Import Gemini AI client

const app = express();
const port = process.env.PORT || 5001; // Use 5001 to avoid potential conflicts with React's default 3000

// --- CORS Configuration ---
const allowedOrigins = ['http://localhost:3000', 'https://bankparser.netlify.app']; // Add your Netlify URL

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};

// Middleware
app.use(cors(corsOptions)); // Use configured options
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// --- File Upload Setup (Multer) ---
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir); // Store files in the 'uploads' directory
    },
    filename: function (req, file, cb) {
        // Use original filename + timestamp to avoid collisions
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true); // Accept PDF files
    } else {
        cb(new Error('Invalid file type. Only PDF files are allowed.'), false); // Reject other file types
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit (as per PRD)
    fileFilter: fileFilter
});

// --- Helper Function for Page-by-Page Text Extraction ---
async function getTextPerPage(dataBuffer) {
    const pagesText = [];
    try {
        const data = await pdf(dataBuffer, {
            pagerender: function(pageData) {
                return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
                    .then(function(textContent) {
                        let text = '';
                        if (!textContent || !textContent.items || textContent.items.length === 0) {
                            return ''; // Return empty string if no items
                        }

                        let lastY = null;
                        // Sort items primarily by Y coordinate, then X, to ensure correct reading order
                        const sortedItems = textContent.items.sort((a, b) => {
                            if (a.transform[5] < b.transform[5]) return -1; // Y coordinate (transform index 5)
                            if (a.transform[5] > b.transform[5]) return 1;
                            if (a.transform[4] < b.transform[4]) return -1; // X coordinate (transform index 4)
                            if (a.transform[4] > b.transform[4]) return 1;
                            return 0;
                        });

                        for (let item of sortedItems) {
                            if (lastY !== null && item.transform[5] !== lastY) {
                                // New line detected (Y coordinate changed)
                                text += '\n' + item.str; 
                            } else {
                                // Same line or first item, add with space separator if not the very first char
                                text += (text.length > 0 ? ' ' : '') + item.str;
                            }
                            lastY = item.transform[5];
                        }
                        return text; // Return the constructed text for this page
                    });
            }
        });
        // pdf() with pagerender doesn't directly return pagesText, we need data.text
        // The pagerender function is called for each page, but the final result needs assembly.
        // Let's rethink this - pdf-parse documentation is key here.
        // A simpler approach might be needed if pagerender isn't accumulating correctly.

        // Alternative: Process page by page using max argument (less reliable?)
        /*
        const numPages = data.numpages;
        for (let i = 1; i <= numPages; i++) {
            const pageData = await pdf(dataBuffer, { max: i }); // Get text up to page i
            const prevPageData = await pdf(dataBuffer, { max: i - 1 }); // Get text up to page i-1
            const pageText = pageData.text.substring(prevPageData.text.length);
            pagesText.push(pageText);
        }
        */

        // Let's stick with the idea of pagerender but ensure it collects properly.
        // The previous implementation likely failed because pagerender promises weren't collected.
        // We need to process data.metadata or data.info if available, or use a different strategy.
        
        // --- Corrected pagerender approach (Conceptual) ---
        // This often requires a library structure or careful promise handling.
        // For simplicity, let's try the less elegant page-by-page subtraction method.
        console.log(`Attempting page text extraction for ${data.numpages} pages...`);
        let previousText = '';
        for (let i = 1; i <= data.numpages; i++) {
             console.log(`  Extracting page ${i}...`);
             // Rerun pdf-parse limiting pages - this is inefficient but simpler
             let currentPageData = await pdf(dataBuffer, { max: i });
             let pageText = currentPageData.text.substring(previousText.length);
             pagesText.push(pageText);
             previousText = currentPageData.text; // Update text processed so far
        }
        // --- End page-by-page subtraction ---

        console.log(`Extracted text from ${pagesText.length} pages successfully.`);
        return pagesText; 
    } catch (error) {
        console.error('Error during page-by-page PDF parsing:', error);
        throw new Error('Failed to parse PDF page by page.');
    }
}

// Tolerance for balance comparisons
const BALANCE_TOLERANCE = 0.01; // Use a small tolerance for floating point comparisons

/**
 * Safely parses a currency string (potentially with commas) into a float.
 * Returns NaN if parsing fails.
 * @param {string|number|null|undefined} value The value to parse.
 * @returns {number} The parsed float or NaN.
 */
function parseCurrency(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === 'number') return value; // Already a number
    if (typeof value !== 'string') return NaN;

    const cleanedValue = value.replace(/[,]/g, ''); // Remove commas
    // Add removal for currency symbols if needed: .replace(/[$,₹]/g, '')
    
    const number = parseFloat(cleanedValue);
    return isNaN(number) ? NaN : number;
}

/**
 * Cleans keys in transaction objects by removing newline characters and trimming whitespace.
 * @param {Array<object>} transactions Raw transactions from AI.
 * @returns {Array<object>} Transactions with cleaned keys.
 */
function cleanTransactionKeys(transactions) {
    if (!transactions || transactions.length === 0) return [];

    return transactions.map(tx => {
        if (typeof tx !== 'object' || tx === null) return tx; // Return non-objects as is

        const cleanedTx = {};
        for (const key in tx) {
            if (Object.hasOwnProperty.call(tx, key)) {
                const cleanedKey = key.replace(/\r?\n|\r/g, ' ').replace(/\s+/g, ' ').trim(); // Replace newlines/tabs with space, collapse multi-space, trim
                cleanedTx[cleanedKey] = tx[key];
            }
        }
        return cleanedTx;
    });
}

/**
 * Corrects Debit/Credit classification based on running balance changes.
 * Directly checks for common key variants.
 * Adds flags: `balanceCorrectedType` and `balanceMismatch`.
 * Assumes transactions are chronologically sorted.
 * @param {Array<object>} transactions Raw transactions from AI (with cleaned keys).
 * @returns {Array<object>} Transactions with corrected types and flags.
 */
function correctTransactionTypesByBalance(transactions) {
    if (!transactions || transactions.length < 2) {
        return transactions.map(tx => ({ ...tx, balanceCorrectedType: false, balanceMismatch: false }));
    }

    console.log('[Balance Check] Starting balance correction (Simplified Key Check)...');
    const correctedTransactions = [];
    let correctionsMade = 0;
    let mismatchesFound = 0;

    // Add the first transaction
    correctedTransactions.push({ ...transactions[0], balanceCorrectedType: false, balanceMismatch: false });

    for (let i = 1; i < transactions.length; i++) {
        const prevTx = correctedTransactions[i - 1]; 
        const currentTx = { ...transactions[i], balanceCorrectedType: false, balanceMismatch: false }; 

        // --- >>> Add Log to Inspect Keys <<< ---
        console.log(`[Balance Check] Inspecting keys for row ${i + 1}:`, Object.keys(currentTx));
        // --- >>> End Log <<< ---

        // --- Get values by checking known key variants --- 
        const balanceValuePrev = prevTx.Balance; // Assume 'Balance' is consistent
        const balanceValueCurrent = currentTx.Balance;
        
        let debitValue = currentTx.Debit !== undefined ? currentTx.Debit : currentTx['Withdra wal (Dr)'];
        let creditValue = currentTx.Credit !== undefined ? currentTx.Credit : currentTx['Deposit (Cr)'];
        
        // Determine which keys were ACTUALLY used for debit/credit in this specific transaction
        const actualDebitKey = currentTx.Debit !== undefined ? 'Debit' : (currentTx['Withdra wal (Dr)'] !== undefined ? 'Withdra wal (Dr)' : null);
        const actualCreditKey = currentTx.Credit !== undefined ? 'Credit' : (currentTx['Deposit (Cr)'] !== undefined ? 'Deposit (Cr)' : null);
        // --- End Get values ---

        // Determine the ACTUAL non-null amount value reported by AI FIRST
        let rawReportedValue = null;
        if (debitValue !== null && debitValue !== undefined) {
            rawReportedValue = debitValue;
        } else if (creditValue !== null && creditValue !== undefined) {
            rawReportedValue = creditValue;
        } else {
            // Check if *any* debit or credit key exists for this TX, even if value is null/undefined
             if (actualDebitKey || actualCreditKey) { 
                 rawReportedValue = '0'; 
             }
        }
        
        // Parse balances and the identified reported amount
        const prevBalance = parseCurrency(balanceValuePrev);
        const currentBalance = parseCurrency(balanceValueCurrent);
        const reportedAmount = parseCurrency(rawReportedValue);

        // Parse actual debit/credit values for inner check
        const parsedDebitAmount = parseCurrency(debitValue);
        const parsedCreditAmount = parseCurrency(creditValue);

        if (isNaN(prevBalance) || isNaN(currentBalance) || isNaN(reportedAmount)) {
            console.warn(`[Balance Check] Skipping check for row ${i + 1}: Unparseable numbers. PrevBal: ${balanceValuePrev}, CurrBal: ${balanceValueCurrent}, RawDebit: ${debitValue}, RawCredit: ${creditValue}, RawReported: ${rawReportedValue}`);
            currentTx.balanceMismatch = true; 
            mismatchesFound++;
            correctedTransactions.push(currentTx);
            continue;
        }

        const balanceDiff = currentBalance - prevBalance;
        let corrected = false;

        // Determine preferred keys for setting values
        const preferredDebitKey = 'Debit'; 
        const preferredCreditKey = 'Credit';
        
        if (Math.abs(balanceDiff - reportedAmount) <= BALANCE_TOLERANCE) {
            // Balance increased - Should be CREDIT
            if (debitValue !== null || isNaN(parsedCreditAmount)) { 
                console.log(`[Balance Check] Correcting row ${i + 1} to CREDIT. Balance increased.`); 
                currentTx[preferredCreditKey] = reportedAmount; 
                // Nullify ALL potential debit keys found in *this* transaction
                if(actualDebitKey) currentTx[actualDebitKey] = null; 
                // Also ensure preferred debit key is null if it wasn't the actual one
                if(preferredDebitKey !== actualDebitKey) currentTx[preferredDebitKey] = null;
                currentTx.balanceCorrectedType = true;
                correctionsMade++;
                corrected = true;
            }
        } else if (Math.abs(balanceDiff + reportedAmount) <= BALANCE_TOLERANCE) {
            // Balance decreased - Should be DEBIT
            if (creditValue !== null || isNaN(parsedDebitAmount)) { 
                console.log(`[Balance Check] Correcting row ${i + 1} to DEBIT. Balance decreased.`); 
                currentTx[preferredDebitKey] = reportedAmount; 
                // Nullify ALL potential credit keys found in *this* transaction
                if(actualCreditKey) currentTx[actualCreditKey] = null; 
                 // Also ensure preferred credit key is null if it wasn't the actual one
                if(preferredCreditKey !== actualCreditKey) currentTx[preferredCreditKey] = null;
                currentTx.balanceCorrectedType = true;
                correctionsMade++;
                corrected = true;
            }
        } 
        
        // Mismatch / Zero handling (Keep simple for now)
        if (!corrected) {
            // Only flag mismatch if the balance difference doesn't match
             if (Math.abs(Math.abs(balanceDiff) - Math.abs(reportedAmount)) > BALANCE_TOLERANCE){
                console.warn(`[Balance Check] Mismatch for row ${i + 1}. PrevBal: ${prevBalance.toFixed(2)}, CurrBal: ${currentBalance.toFixed(2)}, Diff: ${balanceDiff.toFixed(2)}, Amount: ${reportedAmount.toFixed(2)}`);
                currentTx.balanceMismatch = true;
                mismatchesFound++;
             }
             // If amounts matched but no correction was needed, flags remain false (which is correct)
        }

        correctedTransactions.push(currentTx);
    }

    console.log(`[Balance Check] Finished. Corrections made: ${correctionsMade}, Mismatches found: ${mismatchesFound}.`);
    return correctedTransactions;
}

// --- API Routes ---

// Basic health check route
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'Server is running' });
});

// PDF Upload Route
app.post('/api/upload', upload.single('bankStatement'), async (req, res, next) => {
    if (!req.file) {
        // This case should ideally be caught by Multer's error handler below,
        // but we keep it as a safeguard.
        return res.status(400).json({ error: 'No file uploaded or file type invalid.' });
    }
    console.log('File uploaded:', req.file.path);
    console.log('Original filename:', req.file.originalname);

    let allRawTransactions = []; // This will now hold the final data
    let extractionMethod = 'ai';
    let pagesTextArray = [];
    let identifiedBank = null;
    let promptIdUsed = null; // Still potentially useful metadata

    try {
        const dataBuffer = fs.readFileSync(req.file.path);
        pagesTextArray = await getTextPerPage(dataBuffer);

        if (!pagesTextArray || pagesTextArray.length === 0) {
             console.error('Failed to extract any text from PDF pages.');
             return res.status(500).json({ error: 'Could not extract text from PDF.' });
        }

        // --- Identify Bank (Still useful for context/logging) ---
        if (pagesTextArray[0]) {
            identifiedBank = await identifyBankWithAI(pagesTextArray[0]);
            console.log(`Identified Bank (or null): ${identifiedBank}`);
        }

        console.log(`Processing ${pagesTextArray.length} pages with AI (using dynamic schema prompt)...`);

        // --- Process each page with AI (using default dynamic prompt) ---
        for (let i = 0; i < pagesTextArray.length; i++) {
            const pageText = pagesTextArray[i];
            // --- Add logging for Page 1 Text Input ---
            if (i === 0) {
                console.log(`\n--- Page 1 Text Sent to AI (Length: ${pageText.length}) ---\n${pageText.substring(0, 1500)} ... (truncated) ...\n------------------------------------------\n`);
            }
            // --- End logging ---
            console.log(`Sending Page ${i + 1}/${pagesTextArray.length} text to AI (length: ${pageText.length})...`);
            
            if (!pageText || pageText.trim().length === 0) {
                console.log(`Skipping empty Page ${i + 1}`);
                continue;
            }

            try {
                const rawTransactionsFromPage = await extractTransactionsWithAI(pageText, identifiedBank);
                
                if (rawTransactionsFromPage && rawTransactionsFromPage.length > 0) {
                    // --- >>> CLEAN KEYS immediately after extraction <<< ---
                    const cleanedTransactionsFromPage = cleanTransactionKeys(rawTransactionsFromPage);
                    allRawTransactions.push(...cleanedTransactionsFromPage);
                    console.log(`  -> Received ${cleanedTransactionsFromPage.length} cleaned transactions from Page ${i + 1}. Total raw now: ${allRawTransactions.length}`);
                    // --- >>> END KEY CLEANING <<< ---
                } else {
                    console.log(`  -> No raw transactions returned from Page ${i + 1}.`);
                }
            } catch (aiPageError) {
                console.error(`AI processing failed for Page ${i + 1}:`, aiPageError.message);
                extractionMethod = 'partial_ai_fallback_needed';
            }
        }
        
        console.log(`Finished AI processing. Total raw transactions found: ${allRawTransactions.length}`);

        // --- >>> BALANCE CORRECTION STEP (operates on cleaned keys) <<< ---
        let finalTransactionData = [];
        if (allRawTransactions.length > 0) {
            finalTransactionData = correctTransactionTypesByBalance(allRawTransactions);
        } else {
            finalTransactionData = allRawTransactions; // Pass empty array if no raw txns
        }
        // --- >>> END BALANCE CORRECTION STEP <<< ---

        // --- >>> LOG FINAL DATA BEFORE CSV <<< ---
        console.log('[Pre-CSV Log] Final data being sent to CSV generator:', JSON.stringify(finalTransactionData, null, 2));
        // --- >>> END LOG <<< ---

        // --- Handle No Transactions Found --- 
        if (finalTransactionData.length === 0) {
             console.error('No transactions extracted after AI and fallback attempts.');
             // Clean up uploaded file before sending error
             if (req.file && req.file.path) {
                 fs.unlink(req.file.path, (err) => { if (err) console.error('Error deleting file on no results:', err); });
             }
             return res.status(400).json({ error: 'Could not extract any transactions from the document.' });
        }

        console.log(`Proceeding with ${finalTransactionData.length} raw transactions for DB/CSV.`);

        // --- Store result and get run ID --- 
        let runId = null;
        if (finalTransactionData.length > 0) {
            try {
                const insertQuery = `
                    INSERT INTO ProcessingResults 
                    (original_pdf_name, initial_ai_result_json, flags_raised_json, ai_model_used, prompt_used_id)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id;
                `;
                // Store the RAW AI result directly
                // No flags are generated anymore by validation
                const values = [
                    req.file.originalname, 
                    JSON.stringify(finalTransactionData), // Store RAW AI output
                    JSON.stringify([]), // No flags generated
                    'gemini-1.5-pro', 
                    promptIdUsed // ID of the default prompt used
                ];
                
                console.log('Storing raw AI processing result in database...');
                const dbResult = await db.query(insertQuery, values);
                runId = dbResult.rows[0].id;
                console.log(`Stored raw result with run_id: ${runId}`);

            } catch (dbError) {
                console.error('Error saving processing result to database:', dbError);
                // Don't halt execution, just log the error
            }
        }

        // --- CSV Generation (handles dynamic headers) ---
        const baseFileId = path.basename(req.file.filename, path.extname(req.file.filename));
        const csvFilePath = await generateCsv(finalTransactionData, baseFileId); 
        const downloadId = path.basename(csvFilePath);

        // --- Response --- 
        res.status(200).json({
            message: `File processed successfully using dynamic schema prompt. Extracted ${finalTransactionData.length} raw transactions.`, // Updated message
            transactions: finalTransactionData.slice(0, 5), // Preview raw data
            fullTransactions: finalTransactionData, // Send raw data
            totalTransactions: finalTransactionData.length, 
            downloadId: downloadId,
            runId: runId 
        });

    } catch (processingError) {
        console.error('Error during PDF processing or downstream tasks:', processingError);
        // Forward the error to the global error handler
        // File cleanup should happen regardless
        next(processingError);
    } finally {
        // --- File Cleanup (Task 8) ---
        // Ensure cleanup happens even if CSV generation fails after extraction
        if (req.file && req.file.path) {
            fs.unlink(req.file.path, (err) => {
                if (err) {
                    console.error('Error deleting uploaded file:', err);
                } else {
                    console.log('Uploaded file deleted:', req.file.path);
                }
            });
        }
    }

}, (error, req, res, next) => { // This is the Multer error handler
    // Multer error handling
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
             return res.status(400).json({ error: 'File size limit exceeded (Max 25MB).' });
        }
         return res.status(400).json({ error: `File upload error: ${error.message}` });
    } else if (error) {
        // Handle custom file filter error or other errors
         return res.status(400).json({ error: error.message });
    }
    next();
});

// --- Feedback Submission Route ---
app.post('/api/feedback', async (req, res) => {
  console.log('[Feedback Received] Received feedback data:');
  const { runId, correctedData } = req.body;

  // Validate input
  if (!runId) {
      console.error('[Feedback Received] Missing runId.');
      return res.status(400).json({ error: 'Missing runId in feedback data.' });
  }
  if (!correctedData || !Array.isArray(correctedData)) {
    console.error('[Feedback Received] Invalid or missing correctedData.');
    return res.status(400).json({ error: 'Invalid feedback data format.' });
  }
  
  console.log(`  -> Received ${correctedData.length} rows for runId: ${runId}`);
  
  try {
      // 1. Fetch the initial result associated with runId
      const initialResultQuery = `SELECT initial_ai_result_json FROM ProcessingResults WHERE id = $1`;
      const initialResult = await db.query(initialResultQuery, [runId]);

      if (initialResult.rows.length === 0) {
          console.error(`[Feedback Received] Original processing run not found for runId: ${runId}`);
          return res.status(404).json({ error: 'Original processing run not found.' });
      }
      const initialData = initialResult.rows[0].initial_ai_result_json;

      // 2. Compare initialData with correctedData
      const analysis = compareResults(initialData, correctedData);
      console.log('[Feedback Received] Analysis Result:', analysis);

      // 3. Store feedback linked to the runId, including analysis
      const insertQuery = `
          INSERT INTO FeedbackSubmissions (run_id, corrected_data_json, analysis_json)
          VALUES ($1, $2, $3)
          RETURNING id;
      `;
      const values = [
          runId, 
          JSON.stringify(correctedData),
          JSON.stringify(analysis) // Store the analysis object
      ];

      console.log('Storing feedback submission in database...');
      const dbResult = await db.query(insertQuery, values);
      const feedbackId = dbResult.rows[0].id;
      console.log(`Stored feedback with id: ${feedbackId}`);

      res.status(200).json({ message: 'Feedback received and analysis stored.'}); // Update message

  } catch (dbError) {
      console.error('Error saving feedback submission to database:', dbError);
      // Check for foreign key constraint violation (invalid runId)
      if (dbError.code === '23503') { // PostgreSQL foreign key violation code
          return res.status(400).json({ error: `Invalid runId: ${runId}` });
      }
      res.status(500).json({ error: 'Failed to store feedback.' });
  }
});

// --- Accuracy Confirmation Route ---
app.post('/api/confirm-accuracy', async (req, res) => {
  const { runId, isAccurate } = req.body;

  console.log(`[Accuracy Confirm] Received confirmation for runId: ${runId}, Accurate: ${isAccurate}`);

  // Validate input
  if (!runId || typeof isAccurate !== 'boolean') {
    console.error('[Accuracy Confirm] Invalid input.', { runId, isAccurate });
    return res.status(400).json({ error: 'Missing runId or invalid isAccurate flag.' });
  }

  try {
    const updateQuery = `
      UPDATE ProcessingResults
      SET user_confirmed_accuracy = $1
      WHERE id = $2
      RETURNING id;
    `;
    const values = [isAccurate, runId];

    console.log('Updating accuracy confirmation in database...');
    const dbResult = await db.query(updateQuery, values);

    if (dbResult.rowCount === 0) {
      console.warn(`[Accuracy Confirm] No ProcessingResult found for runId: ${runId}`);
      return res.status(404).json({ error: `Processing run not found for runId: ${runId}` });
    }

    console.log(`Stored accuracy confirmation for runId: ${dbResult.rows[0].id}`);
    res.status(200).json({ message: 'Accuracy confirmation received.' });

  } catch (dbError) {
    console.error('[Accuracy Confirm] Error updating accuracy confirmation:', dbError);
    res.status(500).json({ error: 'Failed to store accuracy confirmation.' });
  }
});

// --- Prompt Management API (Basic) ---

// GET all active prompts
app.get('/api/prompts', async (req, res) => {
    try {
        const result = await db.query('SELECT id, bank_identifier, version, is_default, created_at FROM Prompts WHERE is_active = true ORDER BY bank_identifier NULLS FIRST, version DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error('Error fetching prompts:', err);
        res.status(500).json({ error: 'Failed to fetch prompts' });
    }
});

// GET a specific prompt by ID (including text)
app.get('/api/prompts/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.query('SELECT * FROM Prompts WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Prompt not found' });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error(`Error fetching prompt ${id}:`, err);
        res.status(500).json({ error: 'Failed to fetch prompt' });
    }
});

// POST a new prompt (version 1)
app.post('/api/prompts', async (req, res) => {
    const { bank_identifier, prompt_text, is_default = false } = req.body;
    if (!prompt_text) {
        return res.status(400).json({ error: 'prompt_text is required' });
    }
    // Basic validation for bank_identifier format if needed
    const bankId = bank_identifier ? bank_identifier.toUpperCase() : null;

    try {
        // Ensure only one default exists if setting this as default
        if (is_default === true) {
             await db.query('UPDATE Prompts SET is_default = false WHERE is_default = true');
        }

        const insertQuery = `
            INSERT INTO Prompts (bank_identifier, prompt_text, is_default, is_active, version)
            VALUES ($1, $2, $3, true, 1)
            ON CONFLICT (bank_identifier) DO UPDATE SET 
                prompt_text = EXCLUDED.prompt_text, 
                version = Prompts.version + 1, -- Increment version on update
                is_default = EXCLUDED.is_default,
                is_active = true, -- Ensure it becomes active on update
                created_at = NOW() -- Update timestamp
            RETURNING *;
        `;
        const result = await db.query(insertQuery, [bankId, prompt_text, is_default]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating/updating prompt:', err);
        res.status(500).json({ error: 'Failed to create/update prompt' });
    }
});

// TODO: Add PUT/PATCH for updates, DELETE (or toggle is_active)

// --- CSV Download Route (Task 11) ---
app.get('/api/download/:downloadId', (req, res, next) => {
    const downloadId = req.params.downloadId;
    console.log(`[Download Request] Received request for ID: ${downloadId}`); // Log received ID

    // Basic validation to prevent path traversal
    if (!downloadId || downloadId.includes('..') || !downloadId.endsWith('.csv')) {
        console.warn(`[Download Request] Invalid ID received: ${downloadId}`);
        return res.status(400).json({ error: 'Invalid download ID.' });
    }

    const filePath = path.join(csvExportsDir, downloadId);
    console.log(`[Download Request] Constructed file path: ${filePath}`); // Log constructed path

    // Check if file exists
    fs.access(filePath, fs.constants.R_OK, (err) => { // Use fs.access for better check
      if (err) {
          console.error(`[Download Request] File not found or not readable: ${filePath}`, err);
          return res.status(404).json({ error: 'File not found or has expired.' });
      }

      // File exists and is readable
      console.log(`[Download Request] File exists. Initiating download for: ${filePath}`);
      // Set headers for download
      res.setHeader('Content-Disposition', `attachment; filename="${downloadId}"`);
      res.setHeader('Content-Type', 'text/csv');

      // Send the file
      res.download(filePath, downloadId, (err) => {
          if (err) {
              console.error('[Download Request] Error sending file:', err);
              // Avoid sending another response if headers already sent
              if (!res.headersSent) {
                  next(err); // Pass error to global handler
              }
          } else {
              // TODO: Optional: Implement cleanup of CSV files after download or TTL
              // fs.unlink(filePath, (unlinkErr) => { ... });
              console.log(`[Download Request] Successfully sent file: ${filePath}`);
          }
      });
    });
});


// --- Global Error Handler ---
app.use((err, req, res, next) => {
    console.error('Error in request processing:', err);
    // Send a more structured error response
    res.status(err.status || 500).json({
        error: err.message || 'An internal server error occurred.',
        // Optionally include stack in development
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});

module.exports = app; // Export for potential testing