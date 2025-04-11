require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdf = require('pdf-parse'); // Require pdf-parse at the top

// Import AI processing logic
const { extractTransactionsWithAI } = require('./aiProcessor');
// Import CSV generation logic
const { generateCsv, csvExportsDir } = require('./csvGenerator'); // Import generateCsv
// Import pattern extraction logic
const { extractTransactionsWithPatterns } = require('./patternExtractor');

// TODO: Import processing logic controllers
// TODO: Import Gemini AI client

const app = express();
const port = process.env.PORT || 5001; // Use 5001 to avoid potential conflicts with React's default 3000

// Middleware
app.use(cors()); // Allow requests from the React frontend
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
        await pdf(dataBuffer, {
            pagerender: function(pageData) {
                // The intent is to capture text per page.
                // pdf-parse's pagerender gives page data; we process it.
                return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
                    .then(function(textContent) {
                        let lastY, text = '';
                        // Simple line joining logic (may need refinement for complex layouts)
                        for (let item of textContent.items) {
                            if (lastY == item.transform[5] || !lastY){
                                text += item.str + ' ';
                            } else {
                                text += '\n' + item.str;
                            }
                            lastY = item.transform[5];
                        }
                        pagesText.push(text); // Add extracted text for the current page
                    });
            }
        });
        console.log(`Extracted text from ${pagesText.length} pages.`);
        return pagesText; // Return array of strings, one per page
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

    let allTransactions = []; // Array to hold transactions from all pages
    let extractionMethod = 'ai'; // Assume AI first

    try {
        const dataBuffer = fs.readFileSync(req.file.path);

        // Extract text page by page
        const pagesTextArray = await getTextPerPage(dataBuffer);

        if (!pagesTextArray || pagesTextArray.length === 0) {
             console.error('Failed to extract any text from PDF pages.');
             return res.status(500).json({ error: 'Could not extract text from PDF.' });
        }

        console.log(`Processing ${pagesTextArray.length} pages with AI...`);

        // --- Process each page with AI ---        
        for (let i = 0; i < pagesTextArray.length; i++) {
            const pageText = pagesTextArray[i];
            console.log(`Sending Page ${i + 1}/${pagesTextArray.length} text to AI (length: ${pageText.length})...`);
            
            if (!pageText || pageText.trim().length === 0) {
                console.log(`Skipping empty Page ${i + 1}`);
                continue;
            }

            try {
                const transactionsFromPage = await extractTransactionsWithAI(pageText);
                if (transactionsFromPage && transactionsFromPage.length > 0) {
                    allTransactions.push(...transactionsFromPage); // Append results
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

        // --- CSV Generation (Task 11) ---
        // Use a portion of the original PDF filename for the CSV ID
        const baseFileId = path.basename(req.file.filename, path.extname(req.file.filename));
        const csvFilePath = await generateCsv(allTransactions, baseFileId);
        const downloadId = path.basename(csvFilePath); // Just the filename e.g., file-123.csv

        // Send back preview and total count (as per PRD)
        res.status(200).json({
            message: `File processed successfully (using ${extractionMethod}). Processed ${pagesTextArray.length} pages.`,
            transactions: allTransactions.slice(0, 5), // Preview first 5 of combined list
            totalTransactions: allTransactions.length,
            downloadId: downloadId // Provide ID for download endpoint
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