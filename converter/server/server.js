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
const { extractTransactionsWithAI, identifyBankWithAI } = require('./aiProcessor');
// Import CSV generation logic
const { generateCsv, csvExportsDir } = require('./csvGenerator'); // Import generateCsv
// Import pattern extraction logic
const { extractTransactionsWithPatterns } = require('./patternExtractor');

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

// --- API Routes ---

// Basic health check route
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'Server is running' });
});

// PDF Upload Route (Task 8)
app.post('/api/upload', upload.single('bankStatement'), async (req, res, next) => { // Make the handler async
    if (!req.file) {
        // This case should ideally be caught by Multer's error handler below,
        // but we keep it as a safeguard.
        return res.status(400).json({ error: 'No file uploaded or file type invalid.' });
    }
    console.log('File uploaded:', req.file.path);
    console.log('Original filename:', req.file.originalname);

    let allTransactions = [];
    let extractionMethod = 'ai';
    let pagesTextArray = [];
    let identifiedBank = null; // Variable to store identified bank
    let promptIdUsed = null; // Variable to store prompt ID used

    try {
        const dataBuffer = fs.readFileSync(req.file.path);
        pagesTextArray = await getTextPerPage(dataBuffer);

        if (!pagesTextArray || pagesTextArray.length === 0) {
             console.error('Failed to extract any text from PDF pages.');
             return res.status(500).json({ error: 'Could not extract text from PDF.' });
        }

        // --- Identify Bank using First Page --- 
        if (pagesTextArray[0]) {
            identifiedBank = await identifyBankWithAI(pagesTextArray[0]);
            console.log(`Identified Bank (or null): ${identifiedBank}`);
        }

        console.log(`Processing ${pagesTextArray.length} pages with AI (Bank: ${identifiedBank || 'Default'})...`);

        // --- Process each page with AI ---        
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
                // Pass identified bank to extraction function
                const transactionsFromPage = await extractTransactionsWithAI(pageText, identifiedBank); 
                
                // Store promptId if available (needs modification in extractTransactionsWithAI to return it - FUTURE)
                // if (transactionsFromPage.length > 0 && transactionsFromPage[0]._promptIdUsed && !promptIdUsed) {
                //     promptIdUsed = transactionsFromPage[0]._promptIdUsed; 
                // }

                if (transactionsFromPage && transactionsFromPage.length > 0) {
                    // Remove internal _promptIdUsed before concatenating if added
                    // const cleanedTransactions = transactionsFromPage.map(({ _promptIdUsed, ...rest }) => rest);
                    // allTransactions.push(...cleanedTransactions);
                    allTransactions.push(...transactionsFromPage);
                    console.log(`  -> Received ${transactionsFromPage.length} transactions from Page ${i + 1}. Total now: ${allTransactions.length}`);
                } else {
                    console.log(`  -> No transactions returned from Page ${i + 1}.`);
                }
            } catch (aiPageError) {
                console.error(`AI processing failed for Page ${i + 1}:`, aiPageError.message);
                // Decide how to handle page-level failure: continue, stop, use fallback?
                // For now, let's log and continue, attempting fallback later if needed.
                extractionMethod = 'partial_ai_fallback_needed'; // Mark that AI failed on some pages
            }
        }
        
        console.log(`Finished AI processing. Total transactions found: ${allTransactions.length}`);

        // --- Fallback to Pattern Extraction (Optional: If AI failed completely or partially) ---
        // Consider if fallback should run on *all* text if *any* AI page fails, or only on failed pages.
        // Current simple approach: If AI produced *zero* results overall, try pattern on full text.
        if (allTransactions.length === 0) {
             console.warn('AI extraction yielded zero transactions across all pages. Attempting pattern fallback on full text...');
             // Reread full text for fallback (consider efficiency later)
             let fullPdfData = await pdf(dataBuffer); 
             let fullPdfText = fullPdfData.text;
             try {
                allTransactions = extractTransactionsWithPatterns(fullPdfText);
                if (allTransactions && allTransactions.length > 0) {
                    extractionMethod = 'pattern_fallback';
                    console.log(`Successfully extracted ${allTransactions.length} transactions using pattern fallback.`);
                } else {
                    console.warn('Pattern extraction fallback also returned no transactions.');
                }
             } catch (patternError) {
                console.error('Pattern extraction fallback failed:', patternError.message);
             }
        }

        // --- Handle No Transactions Found --- 
        if (allTransactions.length === 0) {
             console.error('Failed to extract transactions using AI (chunked) and pattern fallback.');
             return res.status(400).json({ error: 'Could not extract transactions from the document after all attempts.' });
        }

        // --- Store result and get run ID --- 
        let runId = null;
        if (allTransactions.length > 0) {
            try {
                // Separate flags from data for clarity in DB
                const flagsRaised = allTransactions.map((tx, index) => ({
                    index: index,
                    balanceMismatch: tx.balanceMismatch || false,
                    correctedType: tx.correctedType || false,
                    invalidStructure: tx.invalidStructure || false
                })).filter(f => f.balanceMismatch || f.correctedType || f.invalidStructure);

                const insertQuery = `
                    INSERT INTO ProcessingResults 
                    (original_pdf_name, initial_ai_result_json, flags_raised_json, ai_model_used, prompt_used_id)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id;
                `;
                const values = [
                    req.file.originalname, 
                    JSON.stringify(allTransactions),
                    JSON.stringify(flagsRaised),
                    'gemini-1.5-pro', // Hardcode model for now, could get from aiProcessor later
                    promptIdUsed // Store the ID of the prompt used (Needs to be passed back from extract) - currently null
                ];
                
                console.log('Storing processing result in database...');
                const dbResult = await db.query(insertQuery, values);
                runId = dbResult.rows[0].id;
                console.log(`Stored result with run_id: ${runId}`);

            } catch (dbError) {
                console.error('Error saving processing result to database:', dbError);
                // Decide if this should be a fatal error for the request
                // For now, log it but allow CSV generation/download to proceed
            }
        }

        // --- CSV Generation (Task 11) ---
        // Use a portion of the original PDF filename for the CSV ID
        const baseFileId = path.basename(req.file.filename, path.extname(req.file.filename));
        const csvFilePath = await generateCsv(allTransactions, baseFileId);
        const downloadId = path.basename(csvFilePath);

        // --- Response --- 
        // Send back the full list and the preview
        res.status(200).json({
            message: `File processed successfully (using ${extractionMethod}). Processed ${pagesTextArray.length} pages.`,
            transactions: allTransactions.slice(0, 5), // Keep preview for potential UI element
            fullTransactions: allTransactions, // Send the complete data
            totalTransactions: allTransactions.length,
            downloadId: downloadId,
            runId: runId // Include the run ID in the response
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