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
const BALANCE_TOLERANCE = 0.05; 

// --- Helper Functions ---

/**
 * Validates the sequence of transactions based on balance changes.
 * Filters out transactions that result in inconsistent balances.
 * @param {Array<object>} transactions - Array of transaction objects from AI.
 * @returns {Array<object>} Filtered array of transactions with valid balance progression.
 */
function validateTransactionBalances(transactions) {
    if (!transactions || transactions.length === 0) {
        return [];
    }

    const processedTransactions = [];
    let mismatchCount = 0; // Count mismatches

    // Process the first transaction
    const firstTx = transactions[0];
    if (isValidTransaction(firstTx)) {
         // Add balanceMismatch flag, default to false
         processedTransactions.push({...firstTx, balanceMismatch: false});
    } else {
         console.warn("First transaction object is invalid:", firstTx);
         // Optionally, push even invalid ones if needed, flagged
         // processedTransactions.push({...firstTx, balanceMismatch: true, invalidStructure: true });
    }


    for (let i = 1; i < transactions.length; i++) {
        // Compare against the *previous VALID transaction from the PROCESSED list*
        const prevProcessedTx = processedTransactions[processedTransactions.length - 1]; // Get the last valid processed tx
        const currentTx = transactions[i];
        let currentTxProcessed = {...currentTx, balanceMismatch: false}; // Assume valid first

        if (!isValidTransaction(currentTx)) {
             console.warn(`Transaction at original index ${i} has invalid structure:`, currentTx);
             // Don't push invalid ones to processed list if they break validation flow
             // currentTxProcessed.balanceMismatch = true; // Mark as problematic
             // currentTxProcessed.invalidStructure = true;
             // processedTransactions.push(currentTxProcessed);
             mismatchCount++; // Count structure issues as mismatches for logging
             continue; // Move to next transaction
        }

        // Ensure we have a valid previous transaction structure to compare against
        if (!prevProcessedTx || !isValidTransaction(prevProcessedTx)) {
            console.warn(`Cannot validate balance for transaction at original index ${i} because no valid previous transaction exists. Marking current as potential mismatch.`, currentTx);
            currentTxProcessed.balanceMismatch = true;
            processedTransactions.push(currentTxProcessed); // Push even if prev invalid, but flag it
            mismatchCount++;
            continue;
        }

        // USE NEW FIELD NAMES
        const prevBalance = parseFloat(prevProcessedTx.running_balance); 
        const currentBalance = parseFloat(currentTxProcessed.running_balance);
        const amount = parseFloat(currentTxProcessed.amount); // Amount is always positive
        const type = currentTxProcessed.type; // "credit" or "debit"

        if (isNaN(prevBalance) || isNaN(currentBalance) || isNaN(amount) || (type !== 'credit' && type !== 'debit')) {
            console.warn(`Skipping balance validation for transaction at original index ${i} due to non-numeric values or invalid type. Marking as potential mismatch:`, currentTx);
            currentTxProcessed.balanceMismatch = true; // Mark as problematic due to data issue
            processedTransactions.push(currentTxProcessed);
            mismatchCount++;
            continue; // Move to next transaction
        }

        // CALCULATE EXPECTED BALANCE USING NEW FIELDS
        let expectedBalance;
        if (type === 'credit') {
            expectedBalance = prevBalance + amount;
        } else { // type === 'debit'
            expectedBalance = prevBalance - amount;
        }

        // Check if the current balance matches the expected balance within tolerance
        if (Math.abs(currentBalance - expectedBalance) <= BALANCE_TOLERANCE) {
            processedTransactions.push(currentTxProcessed);
        } else {
            // Balance mismatch - Log and flag
            console.warn(`Balance mismatch at original index ${i}: Prev Bal: ${prevBalance}, Amount: ${amount}, Type: ${type}, Expected: ${expectedBalance.toFixed(2)}, Actual: ${currentBalance}. Flagging transaction:`, currentTx);
                currentTxProcessed.balanceMismatch = true; // Set flag
            // No correction attempt needed with this simpler structure
                processedTransactions.push(currentTxProcessed);
                mismatchCount++;
        }
    }

    if (mismatchCount > 0) {
         console.warn(`Flagged ${mismatchCount} transactions due to balance mismatches or structural issues (out of ${transactions.length} total received).`);
    }

    return processedTransactions; // Return all transactions, with flags
}

/**
 * Basic check if a transaction object has the required fields for validation.
 * @param {object} tx Transaction object
 * @returns {boolean} True if required fields are present, false otherwise.
 */
function isValidTransaction(tx) {
    if (!tx || typeof tx !== 'object') return false;

    const hasDate = typeof tx.date === 'string' && tx.date.length > 0; // Basic check
    const hasDescription = typeof tx.description === 'string' && tx.description.length > 0;
    const hasAmount = typeof tx.amount === 'number' && !isNaN(tx.amount);
    const hasType = tx.type === 'credit' || tx.type === 'debit';
    const hasRunningBalance = typeof tx.running_balance === 'number' && !isNaN(tx.running_balance);

    return hasDate && hasDescription && hasAmount && hasType && hasRunningBalance;
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
 * It now fetches the appropriate prompt based on the identified bank.
 * @param {string} textContent The text content extracted from the PDF bank statement page.
 * @param {string|null} bankIdentifier The identified bank (e.g., 'ICICI', 'SBI') or null.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of transaction objects.
 * @throws {Error} If AI processing fails or the response format is invalid.
 */
async function extractTransactionsWithAI(textContent, bankIdentifier) {
    const db = require('./db'); // Require db here as needed
    let promptToUse = '';
    let promptId = null;

    try {
        // Fetch the appropriate prompt from the database
        let promptResult;
        if (bankIdentifier) {
            console.log(`[AI Extract] Attempting to find prompt for bank: ${bankIdentifier}`);
            promptResult = await db.query(
                'SELECT id, prompt_text FROM Prompts WHERE bank_identifier = $1 AND is_active = true ORDER BY version DESC LIMIT 1',
                [bankIdentifier]
            );
        }

        // If no bank-specific prompt found, get the default
        if (!promptResult || promptResult.rows.length === 0) {
            console.log(`[AI Extract] No specific prompt found for ${bankIdentifier || 'N/A'}. Using default.`);
            promptResult = await db.query(
                'SELECT id, prompt_text FROM Prompts WHERE is_default = true AND is_active = true ORDER BY version DESC LIMIT 1'
            );
        }

        if (promptResult.rows.length > 0) {
            promptToUse = promptResult.rows[0].prompt_text;
            promptId = promptResult.rows[0].id;
            console.log(`[AI Extract] Using prompt ID: ${promptId}`);
            // Inject the textContent into the prompt template
            promptToUse = promptToUse.replace('\${textContent}', textContent); 
        } else {
            console.error('[AI Extract] CRITICAL: No active default prompt found in database!');
            throw new Error('No suitable extraction prompt found.');
        }

    } catch (dbError) {
        console.error('[AI Extract] Error fetching prompt from database:', dbError);
        throw new Error('Failed to retrieve extraction prompt.');
    }
    
    if (!textContent) {
        console.warn("AI Processor: Received empty text content.");
        return []; // Return empty array for transactions
    }

    try {
        console.log('[AI Extract] Sending request to Gemini AI...');
        const result = await extractionModel.generateContent(promptToUse); 
        const response = result.response;
        const jsonText = response.text();

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
             console.error("Failed to parse AI JSON response:", parseError);
             console.error("\n--- Raw AI response text (Failed Parse) ---\n", jsonText, "\n---");
            throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
        }

        // VALIDATE THE NEW TOP-LEVEL STRUCTURE -- MODIFIED TO BE FLEXIBLE
        let transactions = [];
        if (Array.isArray(parsedData)) {
            // Handle direct array response (Equitas/ICICI prompt format)
            console.log("AI response is a direct array. Assuming it contains transactions.");
            transactions = parsedData;
        } else if (typeof parsedData === 'object' && parsedData !== null && Array.isArray(parsedData.transactions)) {
             // Handle object response with 'transactions' key (Default prompt format)
             console.log("AI response is an object. Extracting 'transactions' array.");
             transactions = parsedData.transactions;
             // const balances = parsedData.balances; // Balances array is available if needed later
        } else {
            // If it's neither, it's an invalid structure
             console.error("AI response was neither a direct array nor the expected JSON object with a 'transactions' array. Response:", parsedData);
             console.error("\n--- Raw AI response text (Invalid Structure) ---\n", jsonText, "\n---");
             throw new Error('AI response did not match any expected structure (Array or {transactions: [...]}).');
        }
        // --- End Flexible Validation ---

        console.log(`AI successfully parsed ${transactions.length} potential transactions.`);

        // Pass only the transactions array to the validation function - REMAINS THE SAME
        return transactions; 

    } catch (error) {
        console.error("Error during AI transaction processing:", error);
        throw new Error(`Failed to process transactions with AI: ${error.message}`);
    }
}

// Export the necessary functions
module.exports = { identifyBankWithAI, extractTransactionsWithAI, validateTransactionBalances }; 