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
 * Handles different transaction schemas dynamically.
 * Flags transactions that result in inconsistent balances.
 * @param {Array<object>} transactions - Array of transaction objects from AI.
 * @returns {Array<object>} Array of transactions with added validation flags.
 */
function validateTransactionBalances(transactions) {
    if (!transactions || transactions.length === 0) {
        return [];
    }

    // Find the index of the first transaction considered valid by our schema check
    const firstValidIndex = transactions.findIndex(isValidTransaction);

    if (firstValidIndex === -1) {
        console.warn("No valid transactions found matching known schemas.");
        // Return original transactions, potentially flagging all as invalid structure
        return transactions.map(tx => ({ ...tx, balanceMismatch: true, invalidStructure: true }));
    }

    console.log(`Found first valid transaction at index ${firstValidIndex}. Starting balance validation from the next valid one.`);
    const processedTransactions = [];
    let mismatchCount = 0;

    // Add all transactions up to and including the first valid one, marking them initially as not mismatched
    for (let i = 0; i <= firstValidIndex; i++) {
        processedTransactions.push({ 
            ...transactions[i], 
            balanceMismatch: false, 
            // Flag structure issues only if it failed the initial check
            invalidStructure: !isValidTransaction(transactions[i]) 
        });
        if (!isValidTransaction(transactions[i])) {
            console.warn(`Transaction at original index ${i} (before first valid) marked with invalid structure.`, transactions[i]);
            mismatchCount++; // Count initial invalid structures
        }
    }

    // Start validation loop from the transaction *after* the first valid one
    for (let i = firstValidIndex + 1; i < transactions.length; i++) {
        const currentTx = transactions[i];
        let currentTxProcessed = { ...currentTx, balanceMismatch: false, invalidStructure: false }; // Assume valid first

        // Find the *most recent previously processed transaction that IS valid*
        // Look within the transactions *already added* to processedTransactions
        const prevProcessedValidTx = processedTransactions.slice().reverse().find(tx => isValidTransaction(tx));

        // If current is invalid OR we somehow lost track of a valid previous one, flag and add
        if (!isValidTransaction(currentTx) || !prevProcessedValidTx) {
            currentTxProcessed.invalidStructure = !isValidTransaction(currentTx);
            currentTxProcessed.balanceMismatch = true; // Cannot validate balance
            processedTransactions.push(currentTxProcessed);
            if (currentTxProcessed.invalidStructure) {
                 console.warn(`Transaction at original index ${i} has invalid structure or doesn't match known schemas:`, currentTx);
            } else {
                 console.warn(`Cannot validate balance for transaction at original index ${i} because no valid previous transaction could be found in processed list. Flagging current.`, currentTx);
            }
            mismatchCount++;
            continue; 
        }
        
        // --- Dynamically determine keys based on schema of the PREVIOUS valid transaction ---
        let prevBalance, currentBalance, amount = 0, type = 'unknown'; // Default amount/type
        let isDefaultSchema = prevProcessedValidTx.hasOwnProperty('running_balance');

        if (isDefaultSchema) {
            prevBalance = parseFloat(prevProcessedValidTx.running_balance);
            // Ensure current TX also conforms to default schema to get values
            if (currentTxProcessed.hasOwnProperty('running_balance') && currentTxProcessed.hasOwnProperty('amount') && currentTxProcessed.hasOwnProperty('type')){
                currentBalance = parseFloat(currentTxProcessed.running_balance);
                amount = parseFloat(currentTxProcessed.amount); 
                type = currentTxProcessed.type;
            } else {
                 console.warn(`Schema mismatch between previous (Default) and current transaction at index ${i}. Cannot validate balance reliably.`);
                 currentTxProcessed.balanceMismatch = true;
                 processedTransactions.push(currentTxProcessed);
                 mismatchCount++;
                 continue;
            }
        } else {
            // Assume Bank Schema (Debit/Credit/Balance keys) for previous transaction
            prevBalance = parseFloat(prevProcessedValidTx.Balance);
            // Ensure current TX also conforms to bank schema to get values
            if (currentTxProcessed.hasOwnProperty('Balance') && (currentTxProcessed.hasOwnProperty('Debit') || currentTxProcessed.hasOwnProperty('Credit'))) {
                currentBalance = parseFloat(currentTxProcessed.Balance);
                const debitAmount = parseFloat(currentTxProcessed.Debit);
                const creditAmount = parseFloat(currentTxProcessed.Credit);

                if (!isNaN(debitAmount) && debitAmount > 0) {
                    amount = debitAmount;
                    type = 'debit';
                } else if (!isNaN(creditAmount) && creditAmount > 0) {
                    amount = creditAmount;
                    type = 'credit';
                } else {
                    amount = 0;
                    type = 'credit'; // Or debit, amount is 0
                    console.log(`Transaction at original index ${i} has zero or null Debit/Credit, assuming zero amount.`, currentTx);
                }
            } else {
                 console.warn(`Schema mismatch between previous (Bank) and current transaction at index ${i}. Cannot validate balance reliably.`);
                 currentTxProcessed.balanceMismatch = true;
                 processedTransactions.push(currentTxProcessed);
                 mismatchCount++;
                 continue;
            }
        }
        // --- End dynamic key determination ---

        if (isNaN(prevBalance) || isNaN(currentBalance) || isNaN(amount) || (type !== 'credit' && type !== 'debit')) {
            console.warn(`Skipping balance validation for transaction at original index ${i} due to non-numeric values or invalid type derived. Marking as mismatch. Values: prevBal=${prevBalance}, currentBal=${currentBalance}, amount=${amount}, type=${type}`, currentTx);
            currentTxProcessed.balanceMismatch = true; 
            processedTransactions.push(currentTxProcessed);
            mismatchCount++;
            continue; 
        }

        // Calculate expected balance
        let expectedBalance;
        if (type === 'credit') {
            expectedBalance = prevBalance + amount;
        } else { // type === 'debit'
            expectedBalance = prevBalance - amount;
        }

        // Check if the current balance matches the expected balance within tolerance
        const difference = Math.abs(currentBalance - expectedBalance);
        if (difference <= BALANCE_TOLERANCE) {
            currentTxProcessed.balanceMismatch = false; 
            processedTransactions.push(currentTxProcessed);
        } else {
            // Balance mismatch - Log and flag
            console.warn(`---> Balance mismatch detected at original index ${i}:
  Prev Balance: ${prevBalance.toFixed(2)}
  Current Tx:   Amount=${amount.toFixed(2)}, Type=${type}
  Expected Bal: ${expectedBalance.toFixed(2)} (Diff: ${difference.toFixed(2)})
  Actual Bal:   ${currentBalance.toFixed(2)}
  Flagging transaction:`, currentTx);
            currentTxProcessed.balanceMismatch = true; // Set flag
            processedTransactions.push(currentTxProcessed);
            mismatchCount++;
        }
    }

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

    // Check for default schema keys
    const hasDefaultDate = typeof tx.date === 'string' && tx.date.length > 0;
    const hasDefaultDescription = typeof tx.description === 'string'; // Allow empty description
    const hasDefaultAmount = typeof tx.amount === 'number' && !isNaN(tx.amount);
    const hasDefaultType = tx.type === 'credit' || tx.type === 'debit';
    const hasDefaultRunningBalance = typeof tx.running_balance === 'number' && !isNaN(tx.running_balance);
    const isDefaultSchema = hasDefaultDate && hasDefaultDescription && hasDefaultAmount && hasDefaultType && hasDefaultRunningBalance;

    // Check for specific bank schema keys (e.g., Equitas/ICICI)
    // Allow date to be potentially null if Value Date exists, but one must be string
    const hasBankTxDate = typeof tx['Transaction Date'] === 'string' && tx['Transaction Date'].length > 0;
    const hasBankValueDate = typeof tx['Value Date'] === 'string' && tx['Value Date'].length > 0;
    const hasBankDate = hasBankTxDate || hasBankValueDate;
    const hasBankNarration = typeof tx.Narration === 'string' || typeof tx['Transaction Remarks'] === 'string'; // Allow empty description
    // Debit/Credit can be null, but not both for a real transaction (unless opening balance)
    const hasBankDebit = typeof tx.Debit === 'number' || tx.Debit === null;
    const hasBankCredit = typeof tx.Credit === 'number' || tx.Credit === null;
    const hasBankBalance = typeof tx.Balance === 'number' && !isNaN(tx.Balance);
    // Check if it's likely an opening balance row which might lack Debit/Credit values initially
    const isLikelyOpeningBalance = (tx.Narration?.toUpperCase() === 'OPENING BALANCE' || tx['Transaction Remarks']?.toUpperCase() === 'OPENING BALANCE');
    // A valid bank transaction row has date, narration, balance, and *either* a debit or credit value (or is opening balance)
    const isValidBankTransaction = hasBankDate && hasBankNarration && hasBankBalance && (typeof tx.Debit === 'number' || typeof tx.Credit === 'number' || isLikelyOpeningBalance) && hasBankDebit && hasBankCredit;

    // Return true if it matches either schema
    return isDefaultSchema || isValidBankTransaction;
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