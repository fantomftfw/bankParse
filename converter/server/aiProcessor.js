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

    // Process the first transaction - assume it's valid or has no prior to check against
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
        // Compare against the *previous transaction from the AI's list*
        const prevTx = transactions[i-1];
        const currentTx = transactions[i];
        let currentTxProcessed = {...currentTx, balanceMismatch: false}; // Assume valid first

        if (!isValidTransaction(currentTx)) {
             console.warn(`Transaction at index ${i} has invalid structure:`, currentTx);
             currentTxProcessed.balanceMismatch = true; // Mark as problematic
             currentTxProcessed.invalidStructure = true;
             processedTransactions.push(currentTxProcessed);
             mismatchCount++; // Count structure issues as mismatches for logging
             continue; // Move to next transaction
        }

        // Ensure we have a valid previous transaction structure to compare against
        if (!isValidTransaction(prevTx)) {
            console.warn(`Cannot validate balance for transaction at index ${i} because previous transaction (index ${i-1}) was invalid. Marking as potential mismatch.`, currentTx);
            currentTxProcessed.balanceMismatch = true;
            processedTransactions.push(currentTxProcessed);
            mismatchCount++;
            continue;
        }

        const prevBalance = parseFloat(prevTx.Balance);
        const currentBalance = parseFloat(currentTxProcessed.Balance); 
        
        // Determine which set of keys to use for credit/debit
        let credit = 0;
        let debit = 0;
        if (currentTxProcessed['Deposit(Cr)'] !== undefined || currentTxProcessed['Withdrawal (Dr)'] !== undefined) {
            // Use Dr/Cr schema
            credit = parseFloat(currentTxProcessed['Deposit(Cr)']) || 0;
            debit = parseFloat(currentTxProcessed['Withdrawal (Dr)']) || 0;
            // console.log(`  -> Using Dr/Cr keys for index ${i}`);
        } else if (currentTxProcessed['Credit'] !== undefined || currentTxProcessed['Debit'] !== undefined) {
            // Use Debit/Credit schema
            credit = parseFloat(currentTxProcessed['Credit']) || 0;
            debit = parseFloat(currentTxProcessed['Debit']) || 0;
            // console.log(`  -> Using Debit/Credit keys for index ${i}`);
        } else {
            // Likely Opening Balance or row with no monetary change - values default to 0
            // console.log(`  -> No Debit/Credit/Dr/Cr keys found for index ${i}`);
        }

        // Check for NaN *after* attempting to parse potential keys
        if (isNaN(prevBalance) || isNaN(currentBalance) || isNaN(credit) || isNaN(debit)) {
            console.warn(`Skipping balance validation for transaction at index ${i} due to non-numeric values. Marking as potential mismatch:`, currentTx);
            currentTxProcessed.balanceMismatch = true; // Mark as problematic due to data issue
            processedTransactions.push(currentTxProcessed);
            mismatchCount++;
            continue; // Move to next transaction
        }

        const expectedBalance = prevBalance + credit - debit;

        // --- Add Detailed Logging for i=1 --- 
        if (i === 1) {
            console.log(`[Debug i=1] PrevTx:`, JSON.stringify(prevTx));
            console.log(`[Debug i=1] CurrentTx Raw:`, JSON.stringify(currentTx));
            console.log(`[Debug i=1] Values: prevBalance=${prevBalance}, currentBalance=${currentBalance}, credit=${credit}, debit=${debit}, expectedBalance=${expectedBalance.toFixed(2)}`);
        }
        // --- End Detailed Logging --- 

        // Check if the current balance matches the expected balance within tolerance
        if (Math.abs(currentBalance - expectedBalance) <= BALANCE_TOLERANCE) {
            if (i === 1) console.log(`[Debug i=1] Initial balance check PASSED.`);
            // Balance matches, push as is (balanceMismatch is already false)
            processedTransactions.push(currentTxProcessed);
        } else {
            if (i === 1) console.log(`[Debug i=1] Initial balance check FAILED.`);
            // --- Attempt Correction for Type Misclassification ---
            let corrected = false;
            // Check if it was reported as only deposit or only withdrawal *using the detected keys*
            const isOnlyDeposit = credit > 0 && debit === 0;
            const isOnlyWithdrawal = debit > 0 && credit === 0;

            if (isOnlyDeposit || isOnlyWithdrawal) {
                let hypotheticalExpectedBalance;
                if (isOnlyDeposit) { // What if Credit was Debit?
                    hypotheticalExpectedBalance = prevBalance + 0 - credit;
                } else { // What if Debit was Credit?
                    hypotheticalExpectedBalance = prevBalance + debit - 0;
                }

                if (i === 1) console.log(`[Debug i=1] Checking correction: hypotheticalExpectedBalance=${hypotheticalExpectedBalance.toFixed(2)}`);
                
                if (Math.abs(currentBalance - hypotheticalExpectedBalance) <= BALANCE_TOLERANCE) {
                    if (i === 1) console.log(`[Debug i=1] Correction SUCCEEDED. Swapping type.`);
                    console.warn(`Correcting type misclassification at index ${i}: Prev Bal: ${prevBalance}, Original Credit: ${credit}, Original Debit: ${debit}, Actual Bal: ${currentBalance}. Assuming swapped type.`);
                    // Apply the correction
                    if (isOnlyDeposit) {
                        // Check which schema was used to apply correctly
                        if (currentTxProcessed['Deposit(Cr)'] !== undefined) {
                             currentTxProcessed['Withdrawal (Dr)'] = credit;
                             currentTxProcessed['Deposit(Cr)'] = null;
                        } else {
                             currentTxProcessed['Debit'] = credit;
                             currentTxProcessed['Credit'] = null;
                        }
                    } else { // isOnlyWithdrawal
                        if (currentTxProcessed['Withdrawal (Dr)'] !== undefined) {
                             currentTxProcessed['Deposit(Cr)'] = debit;
                             currentTxProcessed['Withdrawal (Dr)'] = null;
                        } else {
                             currentTxProcessed['Credit'] = debit;
                             currentTxProcessed['Debit'] = null;
                        }
                    }
                    currentTxProcessed.balanceMismatch = false; // Resolved the mismatch
                    currentTxProcessed.correctedType = true; // Add flag indicating correction
                    processedTransactions.push(currentTxProcessed);
                    corrected = true;
                    // Note: mismatchCount is NOT incremented if corrected
                } else {
                    if (i === 1) console.log(`[Debug i=1] Correction FAILED. Balance mismatch remains.`);
                }
            } else {
                 if (i === 1) console.log(`[Debug i=1] Correction not attempted (not solely deposit/withdrawal).`);
            }
            // --- End Correction Attempt ---
            
            if (!corrected) {
                console.warn(`Balance mismatch at index ${i}: Prev Bal: ${prevBalance}, Credit: ${credit}, Debit: ${debit}, Expected: ${expectedBalance.toFixed(2)}, Actual: ${currentBalance}. Flagging transaction:`, currentTx);
                currentTxProcessed.balanceMismatch = true; // Set flag
                currentTxProcessed.correctedType = false; // Explicitly false
                processedTransactions.push(currentTxProcessed);
                mismatchCount++;
            }
        }
    }

    if (mismatchCount > 0) {
         console.warn(`Flagged ${mismatchCount} transactions due to balance mismatches or structural issues.`);
    }

    return processedTransactions; // Return all transactions, with flags
}

/**
 * Basic check if a transaction object has the required fields for validation.
 * @param {object} tx Transaction object
 * @returns {boolean} True if required fields are present, false otherwise.
 */
function isValidTransaction(tx) {
    if (!tx || tx.Balance === undefined) {
        return false; // Must have an object and a Balance
    }

    // Check for at least one valid description key
    const hasDescription = tx['Transaction Remarks'] !== undefined || 
                           tx['Transaction details'] !== undefined || 
                           tx['Narration'] !== undefined;

    if (!hasDescription) {
        return false;
    }

    // Check for monetary values OR explicitly allow if both sets are missing/null/zero (Opening Balance case)
    const hasWithdrawalDr = tx['Withdrawal (Dr)'] !== null && tx['Withdrawal (Dr)'] !== undefined;
    const hasDepositCr = tx['Deposit(Cr)'] !== null && tx['Deposit(Cr)'] !== undefined;
    const hasDebit = tx['Debit'] !== null && tx['Debit'] !== undefined;
    const hasCredit = tx['Credit'] !== null && tx['Credit'] !== undefined;

    const withdrawalAmount = parseFloat(tx['Withdrawal (Dr)']) || 0;
    const depositAmount = parseFloat(tx['Deposit(Cr)']) || 0;
    const debitAmount = parseFloat(tx['Debit']) || 0;
    const creditAmount = parseFloat(tx['Credit']) || 0;

    const hasDrCrActivity = (hasWithdrawalDr && withdrawalAmount !== 0) || (hasDepositCr && depositAmount !== 0);
    const hasDebitCreditActivity = (hasDebit && debitAmount !== 0) || (hasCredit && creditAmount !== 0);

    const isOpeningBalance = (!hasWithdrawalDr && !hasDepositCr && !hasDebit && !hasCredit) || 
                             (withdrawalAmount === 0 && depositAmount === 0 && debitAmount === 0 && creditAmount === 0);

    // Valid if it has balance, description, AND (EITHER monetary activity OR it's an opening balance type)
    return (hasDrCrActivity || hasDebitCreditActivity || isOpeningBalance);
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
        return [];
    }

    try {
        console.log('[AI Extract] Sending request to Gemini AI...');
        // Use the PRO model for extraction
        const result = await extractionModel.generateContent(promptToUse); 
        const response = result.response;
        const jsonText = response.text();

        console.log("Received response from Gemini AI.");
        
        // --- Add Logging for Raw Response --- 
        console.log(`\n--- Raw AI Response (Length: ${jsonText?.length}) ---\n${jsonText}\n---\n`);
        // --- End Logging --- 
        
        if (!jsonText) {
             console.error("AI response text is empty.");
             throw new Error("AI returned an empty response.");
        }

        let parsedTransactions;
        try {
            parsedTransactions = JSON.parse(jsonText);
        } catch (parseError) {
             console.error("Failed to parse AI JSON response:", parseError);
             console.error("\n--- Raw AI response text (Failed Parse) ---\n", jsonText, "\n---"); // Log raw response
            throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
        }

        if (!Array.isArray(parsedTransactions)) {
             console.error("AI response was not a JSON array. Response:", parsedTransactions);
             console.error("\n--- Raw AI response text (Not Array) ---\n", jsonText, "\n---"); // Log raw response
            throw new Error('AI response was not in the expected JSON array format.');
        }

        console.log(`AI successfully parsed ${parsedTransactions.length} potential transactions.`);

        // Validate transaction structure and balances, flagging inconsistencies
        const validatedTransactions = validateTransactionBalances(parsedTransactions);

        // Log based on flags instead of filtering
        const consistentTransactions = validatedTransactions.filter(tx => !tx.balanceMismatch);
        const correctedCount = validatedTransactions.filter(tx => tx.correctedType).length;
        console.log(`Processed ${validatedTransactions.length} transactions. ${consistentTransactions.length} appear consistent. ${correctedCount} type misclassifications corrected.`);

        // Attach promptId to the result if needed downstream (e.g., for saving ProcessingResults)
        // validatedTransactions = validatedTransactions.map(tx => ({ ...tx, _promptIdUsed: promptId }));

        return validatedTransactions; 

    } catch (error) {
        // Log the specific error from the API call or parsing/validation
        console.error("Error during AI transaction processing:", error);
        // Re-throw a more specific error for the caller
        throw new Error(`Failed to process transactions with AI: ${error.message}`);
    }
}

module.exports = { identifyBankWithAI, extractTransactionsWithAI }; 