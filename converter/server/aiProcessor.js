require('dotenv').config(); // Ensure environment variables are loaded
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
    console.error('ERROR: GOOGLE_API_KEY environment variable not set.');
    // In a real app, you might want to throw an error or exit
    // process.exit(1);
}

// Initialize the Generative AI client
const genAI = new GoogleGenerativeAI(API_KEY);

// Model for main transaction extraction (Pro recommended for accuracy)
const extractionModel = genAI.getGenerativeModel({
    model: "gemini-1.5-pro", // Revert back to the stable Pro model
    generationConfig: { responseMimeType: "application/json" },
    safetySettings: [ // Configure safety settings
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ]
});

// Separate, faster model for bank identification
const identificationModel = genAI.getGenerativeModel({
    model: "gemini-1.5-flash", // Use flash for speed
    // No specific responseMimeType needed, expect simple text
    safetySettings: [ // Configure safety settings
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ]
});

// Define safety settings to minimize blocking legitimate financial data
const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
    },
];

// --- Constants ---
// Floating point tolerance for balance validation
const BALANCE_TOLERANCE = 0.10; // Increased tolerance to 10 cents

// --- Helper Functions ---

/**
 * Validates the sequence of transactions based on balance changes.
 * Assumes the default schema: { date, description, amount, type, running_balance }
 * Flags transactions that result in inconsistent balances and attempts type correction.
 * @param {Array<object>} transactions - Array of transaction objects from AI (expected default schema).
 * @returns {Array<object>} Array of transactions with added validation flags.
 */
function validateTransactionBalances(transactions) {
    // Keep initial checks for empty transactions array
    if (!transactions || transactions.length === 0) {
        return [];
    }

    // Find the index of the first transaction considered valid by the default schema check
    const firstValidIndex = transactions.findIndex(isValidTransaction);

    // Keep checks if no valid transactions found
    if (firstValidIndex === -1) {
        console.warn("No valid transactions found matching the default schema.");
        return transactions.map(tx => ({ ...tx, balanceMismatch: true, invalidStructure: true }));
    }

    console.log(`Found first valid transaction (default schema) at index ${firstValidIndex}. Starting balance validation from the next valid one.`);
    const processedTransactions = [];
    let mismatchCount = 0;

    // Add all transactions up to and including the first valid one
    for (let i = 0; i <= firstValidIndex; i++) {
        processedTransactions.push({ 
            ...transactions[i], 
            balanceMismatch: false, 
            invalidStructure: !isValidTransaction(transactions[i]) 
        });
        if (!isValidTransaction(transactions[i])) {
            console.warn(`Transaction at original index ${i} (before first valid) marked with invalid structure (doesn't match default schema).`, transactions[i]);
            mismatchCount++;
        }
    }

    // Start validation loop from the transaction *after* the first valid one
    for (let i = firstValidIndex + 1; i < transactions.length; i++) {
        const currentTx = transactions[i];
        let currentTxProcessed = { ...currentTx, balanceMismatch: false, invalidStructure: false };

        // Find the *most recent previously processed transaction that IS valid*
        const prevProcessedValidTx = processedTransactions.slice().reverse().find(tx => isValidTransaction(tx));

        // If current is invalid OR we lost track of a valid previous one, flag and add
        if (!isValidTransaction(currentTx) || !prevProcessedValidTx) {
            currentTxProcessed.invalidStructure = !isValidTransaction(currentTx);
            currentTxProcessed.balanceMismatch = true; 
            processedTransactions.push(currentTxProcessed);
             if (currentTxProcessed.invalidStructure) {
                 console.warn(`Transaction at original index ${i} has invalid structure (doesn't match default schema):`, currentTx);
            } else {
                 console.warn(`Cannot validate balance for transaction at original index ${i} because no valid previous transaction could be found. Flagging current.`, currentTx);
            }
            mismatchCount++;
            continue; 
        }
        
        // --- Extract values using ONLY the default schema keys ---
        let prevBalance, currentBalance, amount = 0, type = 'unknown';

        prevBalance = parseFloat(prevProcessedValidTx.running_balance);
        currentBalance = parseFloat(currentTxProcessed.running_balance);
        amount = parseFloat(currentTxProcessed.amount); 
        type = currentTxProcessed.type;
        // --- End value extraction ---

        // Keep the NaN checks and balance calculation logic
        if (isNaN(prevBalance) || isNaN(currentBalance) || isNaN(amount) || (type !== 'credit' && type !== 'debit')) {
            console.warn(`Skipping balance validation for transaction at original index ${i} due to non-numeric values or invalid type derived. Marking as mismatch. Values: prevBal=${prevBalance}, currentBal=${currentBalance}, amount=${amount}, type=${type}`, currentTx);
            currentTxProcessed.balanceMismatch = true; 
            processedTransactions.push(currentTxProcessed);
            mismatchCount++;
            continue; 
        }

        let expectedBalance;
        if (type === 'credit') {
            expectedBalance = prevBalance + amount;
        } else { 
            expectedBalance = prevBalance - amount;
        }

        const difference = Math.abs(currentBalance - expectedBalance);

        if (difference <= BALANCE_TOLERANCE) {
            currentTxProcessed.balanceMismatch = false;
            currentTxProcessed.typeCorrected = false; 
            processedTransactions.push(currentTxProcessed);
        } else {
            // Keep the type-flipping check logic
            const flippedType = (type === 'credit') ? 'debit' : 'credit';
            let expectedBalanceIfTypeFlipped;
            if (flippedType === 'credit') {
                expectedBalanceIfTypeFlipped = prevBalance + amount;
            } else { 
                expectedBalanceIfTypeFlipped = prevBalance - amount;
            }

            const differenceIfFlipped = Math.abs(currentBalance - expectedBalanceIfTypeFlipped);

            if (differenceIfFlipped <= BALANCE_TOLERANCE) {
                console.warn(`---> Correcting type at original index ${i}. Balance mismatch with reported type '${type}', but matches flipped type '${flippedType}'.\n  Prev Balance: ${prevBalance.toFixed(2)}, Amount: ${amount.toFixed(2)}, Actual Bal: ${currentBalance.toFixed(2)}`);
                
                currentTxProcessed.balanceMismatch = false;
                currentTxProcessed.typeCorrected = true;
                // Update the 'type' field itself
                currentTxProcessed.type = flippedType;
                processedTransactions.push(currentTxProcessed);

            } else {
                 console.warn(`---> Balance mismatch detected at original index ${i} (Flip doesn't help):
  Prev Balance: ${prevBalance.toFixed(2)}
  Current Tx:   Amount=${amount.toFixed(2)}, Type=${type} (Reported by AI)
  Expected Bal: ${expectedBalance.toFixed(2)} (Diff: ${difference.toFixed(2)})
  Actual Bal:   ${currentBalance.toFixed(2)}
  Flagging transaction:`, currentTx);
                currentTxProcessed.balanceMismatch = true; 
                currentTxProcessed.typeCorrected = false; 
                processedTransactions.push(currentTxProcessed);
                mismatchCount++;
            }
        }
    }
    // Keep remaining logging and return statement
    if (mismatchCount > 0) {
        console.warn(`Validation complete. Flagged ${mismatchCount} transactions due to balance mismatches or structural issues (out of ${transactions.length} total received).`);
    }
    return processedTransactions;
}

/**
 * Basic check if a transaction object has the required fields for validation.
 * @param {object} tx Transaction object
 * @returns {boolean} True if required fields are present, false otherwise.
 */
function isValidTransaction(tx) {
    if (!tx || typeof tx !== 'object') return false;

    // Check ONLY for default schema keys
    const hasDate = typeof tx.date === 'string' && tx.date.length > 0;
    const hasDescription = typeof tx.description === 'string'; // Allow empty description
    const hasAmount = typeof tx.amount === 'number' && !isNaN(tx.amount);
    const hasType = tx.type === 'credit' || tx.type === 'debit';
    const hasRunningBalance = typeof tx.running_balance === 'number' && !isNaN(tx.running_balance);
    
    const isDefaultSchema = hasDate && hasDescription && hasAmount && hasType && hasRunningBalance;
    
    // Consider Opening Balance from default prompt (might lack type/amount initially?)
    // Let's assume the default prompt correctly formats opening balance according to its schema
    // const isLikelyOpeningBalance = (tx.description?.toUpperCase().includes('OPENING BALANCE'));

    // Return true ONLY if it matches the default schema
    return isDefaultSchema;
}

/**
 * Attempts to identify the bank name from text using AI.
 * @param {string} textContent Text from the first page (or relevant part) of the statement.
 * @returns {Promise<string|null>} A promise resolving to the identified bank name (e.g., "ICICI", "HDFC") or null if identification fails.
 */
async function identifyBankWithAI(textContent) {
    if (!textContent || textContent.trim().length < 50) { // Need some text to identify
        console.warn('[Bank ID] Text content too short for reliable bank identification.');
        return null;
    }

    // Limit text length to avoid excessive token usage for simple identification
    const truncatedText = textContent.substring(0, 2000); // Use first 2000 chars

    const prompt = `
        Analyze the following text snippet from a bank statement.
        Identify the primary bank name mentioned.
        Respond with ONLY the common abbreviation or name of the bank (e.g., "ICICI", "HDFC", "SBI", "Bank of America", "Chase").
        If you are unsure, respond with "Unknown".
        Do not include any explanations or introductory text.

        Text Snippet:
        --- START ---
        ${truncatedText}
        --- END ---
    `;

    try {
        console.log('[Bank ID] Sending request to Gemini AI for bank identification...');
        const result = await identificationModel.generateContent(prompt);
        const response = result.response;
        const bankName = response.text().trim();

        console.log(`[Bank ID] Received bank name guess: "${bankName}"`);

        if (!bankName || bankName.toLowerCase() === 'unknown' || bankName.length > 50) { // Basic sanity checks
            console.warn('[Bank ID] AI returned Unknown or invalid bank name.');
            return null;
        }

        // Simple standardization (can be expanded)
        if (bankName.toUpperCase().includes('ICICI')) return 'ICICI';
        if (bankName.toUpperCase().includes('HDFC')) return 'HDFC';
        if (bankName.toUpperCase().includes('SBI') || bankName.toUpperCase().includes('STATE BANK')) return 'SBI';
        if (bankName.toUpperCase().includes('EQUITAS')) return 'EQUITAS'; // Add Equitas check
        // Add more specific bank standardizations here if needed
        
        // Return the cleaned name if it passed checks
        return bankName; 

    } catch (error) {
        console.error('[Bank ID] Error during AI bank identification:', error.message);
        return null; // Return null on error
    }
}

/**
 * Extracts transactions from bank statement text using the Gemini AI API.
 * ALWAYS uses the default prompt.
 * @param {string} textContent The text content extracted from the PDF bank statement page.
 * @param {string|null} bankIdentifier The identified bank (IGNORED for prompt selection, used for logging only).
 * @returns {Promise<Array<object>>} A promise that resolves to an array of transaction objects.
 * @throws {Error} If AI processing fails or the response format is invalid.
 */
async function extractTransactionsWithAI(textContent, bankIdentifier) {
    const db = require('./db'); 
    let promptToUse = '';
    let promptId = null;

    try {
        // Fetch the DEFAULT prompt from the database
        console.log(`[AI Extract] Fetching default prompt (Bank ID ${bankIdentifier || 'N/A'} ignored for prompt selection).`);
        const promptResult = await db.query(
            'SELECT id, prompt_text FROM Prompts WHERE is_default = true AND is_active = true ORDER BY version DESC LIMIT 1'
        );

        if (promptResult.rows.length > 0) {
            promptToUse = promptResult.rows[0].prompt_text;
            promptId = promptResult.rows[0].id;
            console.log(`[AI Extract] Using default prompt ID: ${promptId}`);
            promptToUse = promptToUse.replace('\${textContent}', textContent); 
        } else {
            console.error('[AI Extract] CRITICAL: No active default prompt found in database!');
            throw new Error('No suitable extraction prompt found.');
        }

    } catch (dbError) {
        console.error('[AI Extract] Error fetching default prompt from database:', dbError);
        throw new Error('Failed to retrieve extraction prompt.');
    }
    
    // Keep textContent check
    if (!textContent) {
        console.warn("AI Processor: Received empty text content.");
        return []; 
    }

    try {
        console.log('[AI Extract] Sending request to Gemini AI (using default prompt)...');
        const result = await extractionModel.generateContent(promptToUse); 
        const response = result.response;
        const jsonText = response.text();

        // Keep logging of raw response
        console.log("Received response from Gemini AI.");
        console.log(`\n--- Raw AI Response (Length: ${jsonText?.length}) ---\n${jsonText}\n---\n`);
        
        if (!jsonText) {
             console.error("AI response text is empty.");
             throw new Error("AI returned an empty response.");
        }

        let parsedData;
        try {
            parsedData = JSON.parse(jsonText);
        } catch (parseError) {
             // Keep parse error logging
             console.error("Failed to parse AI JSON response:", parseError);
             console.error("\n--- Raw AI response text (Failed Parse) ---\n", jsonText, "\n---");
            throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
        }

        // --- Expect ONLY the structure from the DEFAULT prompt --- 
        let transactions = [];
        // The default prompt expects: { transactions: [], balances: [] }
        if (typeof parsedData === 'object' && parsedData !== null && Array.isArray(parsedData.transactions)) {
             console.log("AI response is an object. Extracting 'transactions' array (Default Schema Expected).");
             transactions = parsedData.transactions;
             // const balances = parsedData.balances; // Balances array is available if needed
        } else {
            // If it's not the expected object structure, it's an error
             console.error("AI response was not the expected JSON object structure {transactions: [...], balances: [...]}. Response:", parsedData);
             console.error("\n--- Raw AI response text (Invalid Structure) ---\n", jsonText, "\n---");
             throw new Error('AI response did not match the expected default structure: {transactions: [...], balances: [...]}.');
        }
        // --- End Default Schema Validation ---

        console.log(`AI successfully parsed ${transactions.length} potential transactions.`);

        return transactions; 

    } catch (error) {
        console.error("Error during AI transaction processing:", error);
        throw new Error(`Failed to process transactions with AI: ${error.message}`);
    }
}

// Export the necessary functions
module.exports = { identifyBankWithAI, extractTransactionsWithAI, validateTransactionBalances }; 