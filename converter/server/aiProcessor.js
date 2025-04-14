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

// Main model configuration (JSON output is preferred, but AI might override)
const extractionModel = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    // Request JSON, but be prepared to handle plain text/arrays if AI ignores
    generationConfig: { responseMimeType: "application/json" }, 
    safetySettings: [ 
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ]
});

// Model for bank identification (remains the same)
const identificationModel = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    safetySettings: [ 
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

// --- Hardcoded Universal Prompt ---
const UNIVERSAL_EXTRACTION_PROMPT = `
Analyze the following bank statement text and extract data ONLY from the main, detailed transaction table.
This table typically contains columns representing: Date, Transaction Details/Narration/Description, Debit/Withdrawal/Money Out, Credit/Deposit/Money In, and Balance. Column names may vary; identify them based on context and content. The table often spans multiple pages or contains numerous rows.

**CRITICAL INSTRUCTIONS:**
1.  **Identify the Primary Transaction Table:** Locate the main table listing individual transaction events. This is usually the **largest table**, often spanning multiple pages, containing many rows detailing specific debits and credits.
2.  **Extract ONLY Transaction Rows:** Extract data *exclusively* from the rows *within* this identified primary transaction table.
3.  **IGNORE Other Data & Summaries:** Explicitly IGNORE summary sections or tables (like those titled "Account Summary", "Summary for Statement period", or any sections containing aggregated totals like "Other Debits", "Other Credits", "Total Debits/Credits"), page headers, page footers, account holder details, bank addresses, disclaimers, or any text clearly outside the main transaction table rows. If a section looks like a short summary with just a few aggregated totals, DO NOT extract from it.
4.  **Match Column Headers Exactly:** Determine the exact column headers present *at the top of the identified primary transaction table*.
5.  **Format as JSON Array:** Output the extracted data as a JSON array of objects.
6.  **JSON Keys = Column Headers:** Each object in the array represents one transaction row from the main table. The keys within each JSON object MUST precisely match the column headers identified in step 4. Include all columns found in that specific table.
7.  **Handle Multi-line Descriptions:** Combine multi-line descriptions, narrations, or transaction details within a single transaction row into a single string value for the relevant key.
8.  **Include Opening Balance Row:** If an "Opening Balance" entry exists as the first data row *within the structure* of the main transaction table (often having only a balance value), include it as the first object in the JSON array. Do *not* extract "Opening Balance" if it appears in a separate summary section.
9.  **Synonym Awareness:** Be aware that headers for debit amounts might be "Debit", "Withdrawal", "Ausgabe", "Money Out", etc. Headers for credit amounts might be "Credit", "Deposit", "Eingang", "Money In", etc. Use the actual header from the table as the JSON key.

Text Content:
--- START ---
\${textContent}
--- END ---

JSON Output (Array of objects matching ONLY the main transaction table columns):
`;
// --- End Hardcoded Prompt ---

// --- Helper Functions ---

/**
 * Normalizes transaction data from various AI output formats into the standard default schema.
 * Default Schema: { date, description, amount, type, running_balance }
 * @param {Array<object>} rawTransactions - Array of transactions from AI.
 * @returns {Array<object>} Array of transactions conforming to the default schema.
 */
function normalizeTransactionData(rawTransactions) {
    if (!rawTransactions || rawTransactions.length === 0) {
        return [];
    }
    console.log(`Normalizing ${rawTransactions.length} raw transactions...`);
    const normalizedTransactions = [];

    for (const tx of rawTransactions) {
        if (!tx || typeof tx !== 'object') continue; // Skip invalid entries

        const normalizedTx = { // Changed type to 'any' implicitly
            date: null,
            description: null,
            amount: null,
            type: null,
            running_balance: null,
            // Keep original flags if they somehow exist, though unlikely at this stage
            balanceMismatch: tx.balanceMismatch || false,
            typeCorrected: tx.typeCorrected || false,
            invalidStructure: tx.invalidStructure || false,
        };

        // 1. Date (Prefer 'date', fallback to 'Transaction Date', then 'Value Date', then 'Date')
        if (typeof tx.date === 'string' && tx.date.length > 0) {
            normalizedTx.date = tx.date; // Default schema key
        } else if (typeof tx['Transaction Date'] === 'string' && tx['Transaction Date'].length > 0) {
            normalizedTx.date = tx['Transaction Date']; // Equitas style
        } else if (typeof tx['Value Date'] === 'string' && tx['Value Date'].length > 0) {
            normalizedTx.date = tx['Value Date']; // Equitas/ICICI style
        } else if (typeof tx.Date === 'string' && tx.Date.length > 0) { // Added check for ICICI style (capital D)
            normalizedTx.date = tx.Date;
        }
        // TODO: Add robust date parsing/formatting to YYYY-MM-DD here, regardless of input format

        // 2. Description (Prefer 'description', fallback to others)
        if (typeof tx.description === 'string') {
            normalizedTx.description = tx.description;
        } else if (typeof tx['Transaction Remarks'] === 'string') {
            normalizedTx.description = tx['Transaction Remarks'];
        } else if (typeof tx.Narration === 'string') {
            normalizedTx.description = tx.Narration;
        } else if (typeof tx['Transaction details'] === 'string') {
            normalizedTx.description = tx['Transaction details'];
        } else {
             normalizedTx.description = ''; // Default to empty string if none found
        }
         if (normalizedTx.description) { // Added check for null description before replace
             normalizedTx.description = normalizedTx.description.replace(/\n/g, ' ').trim(); // Clean up newlines
         }

        // 3. Amount and Type (Check default first, then Debit/Credit, then Withdrawal/Deposit)
        if (typeof tx.amount === 'number' && !isNaN(tx.amount) && (tx.type === 'credit' || tx.type === 'debit')) {
            normalizedTx.amount = Math.abs(tx.amount); // Ensure positive
            normalizedTx.type = tx.type;
        } else {
            // Handle potential string amounts with commas before parsing
            const debitStr = String(tx.Debit || tx['Withdrawal (Dr)'] || '').replace(/,/g, '');
            const creditStr = String(tx.Credit || tx['Deposit(Cr)'] || '').replace(/,/g, '');
            const debit = parseFloat(debitStr);
            const credit = parseFloat(creditStr);


            if (!isNaN(debit) && debit > 0) {
                normalizedTx.amount = debit;
                normalizedTx.type = 'debit';
            } else if (!isNaN(credit) && credit > 0) {
                normalizedTx.amount = credit;
                normalizedTx.type = 'credit';
            } else if (isLikelyOpeningBalance(normalizedTx.description)) {
                // Allow opening balance with zero amount/null type initially
                normalizedTx.amount = 0;
                normalizedTx.type = null; // Mark type explicitly if opening balance
            } else {
                // If not opening balance and no valid debit/credit, keep amount null
                // console.warn("Could not determine amount/type for raw transaction:", tx);
            }
        }

        // 4. Running Balance (Prefer 'running_balance', fallback to 'Balance')
         // Handle potential string amounts with commas
         const balanceStr = String(tx.running_balance ?? tx.Balance ?? '').replace(/,/g, '');
         const runningBalance = parseFloat(balanceStr);
         if (!isNaN(runningBalance)) {
             normalizedTx.running_balance = runningBalance;
         }

        // Add the normalized transaction if it looks minimally valid
        // (Requires at least date, description, balance, and either amount/type or it's opening)
        if (normalizedTx.date && normalizedTx.description !== null && normalizedTx.running_balance !== null && (normalizedTx.amount !== null || isLikelyOpeningBalance(normalizedTx.description))) {
             // Ensure essential fields for validation are present before adding
             if (normalizedTx.amount === null && !isLikelyOpeningBalance(normalizedTx.description)){
                 console.warn("Skipping normalization for row, missing amount/type and not Opening Balance:", tx);
             } else {
                normalizedTransactions.push(normalizedTx);
             }
        } else {
            console.warn("Skipping normalization for row, missing essential fields (date, desc, balance):", tx)
        }
    }
    console.log(`Normalization resulted in ${normalizedTransactions.length} transactions.`);
    return normalizedTransactions;
}

// Helper for normalization
function isLikelyOpeningBalance(description) { // Removed type annotation
    return !!description && description.toUpperCase().includes('OPENING BALANCE');
}

/**
 * Basic check if a transaction object conforms to the **normalized default schema**.
 * @param {object} tx Transaction object (normalized).
 * @returns {boolean} True if required fields are present, false otherwise.
 */
function isValidTransaction(tx) { // Removed type annotation
    if (!tx || typeof tx !== 'object') return false;

    // Check ONLY for default schema keys post-normalization
    const hasDate = typeof tx.date === 'string' && tx.date.length > 0;
    const hasDescription = typeof tx.description === 'string'; // Allow empty
    // Allow null amount/type ONLY for opening balance row after normalization
    const hasAmount = typeof tx.amount === 'number' && !isNaN(tx.amount);
    const hasType = tx.type === 'credit' || tx.type === 'debit';
    const hasRunningBalance = typeof tx.running_balance === 'number' && !isNaN(tx.running_balance);

    const isValidCore = hasDate && hasDescription && hasRunningBalance;
    // Either it has a valid amount AND type, OR it's the opening balance row (where type might be null)
    const hasValidAmountTypeOrIsOpening = (hasAmount && hasType) || (isLikelyOpeningBalance(tx.description) && tx.type === null && tx.amount === 0); // Opening balance must have 0 amount

    return isValidCore && hasValidAmountTypeOrIsOpening;
}

/**
 * Validates the sequence of transactions based on balance changes.
 * Assumes the input `transactions` array conforms to the **normalized default schema**.
 * Flags transactions that result in inconsistent balances and attempts type correction.
 * @param {Array<object>} transactions - Array of normalized transaction objects.
 * @returns {Array<object>} Array of transactions with added validation flags.
 */
function validateTransactionBalances(transactions) { // Removed type annotation
     if (!transactions || transactions.length === 0) {
        return [];
    }

    // Find the index of the first transaction considered valid post-normalization
    const firstValidIndex = transactions.findIndex(isValidTransaction);

    if (firstValidIndex === -1) {
        console.warn("No valid transactions found after normalization.");
        // Flag all based on final check - check structure again here
        return transactions.map(tx => ({ ...tx, balanceMismatch: true, invalidStructure: !isValidTransaction(tx) }));
    }

    console.log(`Found first valid normalized transaction at index ${firstValidIndex}. Starting balance validation from the next one.`);
    const processedTransactions = [];
    let mismatchCount = 0;

    // Add all transactions up to and including the first valid one
    for (let i = 0; i <= firstValidIndex; i++) {
        const isValid = isValidTransaction(transactions[i]);
        processedTransactions.push({
            ...transactions[i],
            balanceMismatch: false, // Assume no mismatch initially
            invalidStructure: !isValid // Mark structure based on final check
        });
        if (!isValid) {
            console.warn(`Normalized transaction at original index ${i} (before first valid) marked with invalid structure.`, transactions[i]);
            mismatchCount++;
        }
    }

    // Start validation loop from the transaction *after* the first valid one
    for (let i = firstValidIndex + 1; i < transactions.length; i++) {
        const currentTx = transactions[i];
        // Use a clean copy for processing this iteration
        let currentTxProcessed = { ...currentTx, balanceMismatch: false, invalidStructure: false };

        // If current is invalid structure, flag and skip balance check
        if (!isValidTransaction(currentTx)) {
             currentTxProcessed.invalidStructure = true;
             currentTxProcessed.balanceMismatch = true; // Can't validate balance
             processedTransactions.push(currentTxProcessed);
             console.warn(`Normalized transaction at original index ${i} has invalid structure:`, currentTx);
             mismatchCount++;
             continue;
        }

        // Find the *most recent previously processed transaction that IS valid*
        const prevProcessedValidTx = processedTransactions.slice().reverse().find(tx => isValidTransaction(tx));

        if (!prevProcessedValidTx) {
            // Should ideally not happen if firstValidIndex was found, but handle defensively
            currentTxProcessed.balanceMismatch = true;
            processedTransactions.push(currentTxProcessed);
            console.warn(`Cannot validate balance for tx at index ${i}, no valid previous found. Flagging.`, currentTx);
            mismatchCount++;
            continue;
        }

        // --- Extract values using ONLY the default schema keys ---
        // Ensure previous balance is treated as number
        const prevBalance = parseFloat(prevProcessedValidTx.running_balance);
        // Ensure current balance and amount are numbers
        const currentBalance = parseFloat(currentTxProcessed.running_balance);
        const amount = parseFloat(currentTxProcessed.amount); // Already normalized & checked by isValidTransaction unless opening balance
        let type = currentTxProcessed.type; // Already normalized & checked by isValidTransaction unless opening balance

        // Skip validation if essential values are missing or invalid type
        // (isValidTransaction check above should prevent most issues, but this is defensive)
        if (isNaN(prevBalance) || isNaN(currentBalance) || isNaN(amount) || (type !== 'credit' && type !== 'debit')) {
            // Don't skip if amount is 0 and type is null (opening balance case handled by isValidTransaction)
            if (!(amount === 0 && type === null && isLikelyOpeningBalance(currentTxProcessed.description))){
                console.warn(`Skipping balance validation for tx at index ${i} due to NaN values or invalid type. Values: prevBal=${prevBalance}, currentBal=${currentBalance}, amount=${amount}, type=${type}`, currentTx);
                currentTxProcessed.balanceMismatch = true;
                processedTransactions.push(currentTxProcessed);
                mismatchCount++;
                continue;
            } else {
                // If it's the opening balance row (amount 0, type null), balance check isn't needed, just push
                processedTransactions.push(currentTxProcessed);
                continue;
            }
        }


        // Calculate expected balance based on the normalized type
        let expectedBalance = (type === 'credit') ? (prevBalance + amount) : (prevBalance - amount);
        const difference = Math.abs(currentBalance - expectedBalance);

        if (difference <= BALANCE_TOLERANCE) {
            // Balance matches
            currentTxProcessed.balanceMismatch = false;
            currentTxProcessed.typeCorrected = false;
            processedTransactions.push(currentTxProcessed);
        } else {
            // Balance does NOT match. Try flipping the type.
            const flippedType = (type === 'credit') ? 'debit' : 'credit';
            let expectedBalanceIfTypeFlipped = (flippedType === 'credit') ? (prevBalance + amount) : (prevBalance - amount);
            const differenceIfFlipped = Math.abs(currentBalance - expectedBalanceIfTypeFlipped);

            if (differenceIfFlipped <= BALANCE_TOLERANCE) {
                // Flipping the type *does* match the balance. Correct it.
                 console.warn(`---> Correcting type at index ${i}. Balance mismatch with type '${type}', matches flipped type '${flippedType}'. PrevBal: ${prevBalance.toFixed(2)}, Amt: ${amount.toFixed(2)}, ActualBal: ${currentBalance.toFixed(2)}`);
                currentTxProcessed.balanceMismatch = false;
                currentTxProcessed.typeCorrected = true;
                currentTxProcessed.type = flippedType; // Correct the type
                processedTransactions.push(currentTxProcessed);
            } else {
                // Balance mismatch persists even after flipping type. Flag it.
                 console.warn(`---> Balance mismatch detected at index ${i} (Flip doesn't help). Type: '${type}', Amt: ${amount.toFixed(2)}, PrevBal: ${prevBalance.toFixed(2)}, Expected: ${expectedBalance.toFixed(2)}, Actual: ${currentBalance.toFixed(2)}, Diff: ${difference.toFixed(2)}`);
                currentTxProcessed.balanceMismatch = true;
                currentTxProcessed.typeCorrected = false;
                processedTransactions.push(currentTxProcessed);
                mismatchCount++;
            }
        }
    }

    if (mismatchCount > 0) {
        console.warn(`Validation complete. Flagged ${mismatchCount} transactions due to balance mismatches or structural issues.`);
    }
    return processedTransactions;
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
 * Extracts transactions using the hardcoded universal prompt.
 * The AI is expected to return a JSON array where object keys match PDF columns from the main table.
 * @param {string} textContent The text content from the PDF page.
 * @param {string|null} bankIdentifier The identified bank (logging only, not used for prompt selection).
 * @returns {Promise<Array<object>>} A promise resolving to the array of raw transaction objects.
 */
async function extractTransactionsWithAI(textContent, bankIdentifier) { // bankIdentifier is now ignored for prompt logic
    // Removed database prompt fetching logic
    let promptToUse = '';

    if (!textContent) {
        console.warn("AI Processor: Received empty text content.");
        return [];
    }

    // Use the hardcoded universal prompt
    console.log(`[AI Extract] Using hardcoded universal prompt (Bank ID ${bankIdentifier || 'N/A'} ignored for prompt selection).`);
    promptToUse = UNIVERSAL_EXTRACTION_PROMPT.replace(/\${textContent}/g, textContent);

    // Call the AI
    try {
        console.log('[AI Extract] Sending request to Gemini AI (using hardcoded prompt)...');
        const result = await extractionModel.generateContent(promptToUse);
        const response = result.response;
        const jsonText = response.text();

        console.log("Received response from Gemini AI.");
        console.log(`\n--- Raw AI Response (Dynamic Schema) ---\n${jsonText}\n---\n`);

        if (!jsonText) {
             console.error("AI response text is empty.");
             throw new Error("AI returned an empty response.");
        }

        // Attempt to parse the response as JSON
        let parsedData;
        try {
            const cleanedJsonText = jsonText.replace(/^```json\s*|```$/g, '').trim();
            parsedData = JSON.parse(cleanedJsonText);
        } catch (parseError) {
             console.error("Failed to parse AI JSON response:", parseError);
             console.error("Raw AI response text:", jsonText);
            throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
        }

        // Check if the result is an array (expected output now)
        if (!Array.isArray(parsedData)) {
            console.error("AI response was not the expected direct JSON array. Response type:", typeof parsedData);
            // If it's an object with a 'transactions' key, maybe the *old* default prompt is still cached/active?
            if (typeof parsedData === 'object' && parsedData !== null && Array.isArray(parsedData.transactions)) {
                 console.warn("AI returned the OLD object structure {transactions: [...]}. Using that array, but the prompt might need updating in the DB!");
                 parsedData = parsedData.transactions;
            } else {
                console.error("Raw AI response content:", parsedData);
                throw new Error('AI response was not a JSON array as expected by the dynamic schema prompt.');
            }
        }

        // Ensure all items in the array are objects
        if (!parsedData.every(item => typeof item === 'object' && item !== null)) {
            console.error("AI response array contains non-object items.");
            throw new Error('AI response array contained invalid items.');
        }

        const rawTransactions = parsedData;
        console.log(`AI successfully parsed ${rawTransactions.length} raw transactions (dynamic schema).`);
        return rawTransactions;

    } catch (error) {
         console.error("Error during dynamic AI transaction processing:", error);
         const message = error instanceof Error ? error.message : String(error);
         throw new Error(`Failed to process transactions with dynamic AI: ${message}`);
    }
}

// Export only the necessary functions
module.exports = { identifyBankWithAI, extractTransactionsWithAI }; 