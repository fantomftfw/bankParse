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
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    generationConfig: { responseMimeType: "application/json" }, // Request JSON output directly
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


        // Ensure numeric types, defaulting null/undefined debit/credit to 0
        const prevBalance = parseFloat(prevTx.Balance);
        const currentBalance = parseFloat(currentTxProcessed.Balance); // Use the potentially modified currentTx
        const deposit = parseFloat(currentTxProcessed['Deposit(Cr)']) || 0;
        const withdrawal = parseFloat(currentTxProcessed['Withdrawal (Dr)']) || 0;

        if (isNaN(prevBalance) || isNaN(currentBalance) || isNaN(deposit) || isNaN(withdrawal)) {
            console.warn(`Skipping balance validation for transaction at index ${i} due to non-numeric values. Marking as potential mismatch:`, currentTx);
            currentTxProcessed.balanceMismatch = true; // Mark as problematic due to data issue
            processedTransactions.push(currentTxProcessed);
            mismatchCount++;
            continue; // Move to next transaction
        }

        const expectedBalance = prevBalance + deposit - withdrawal;

        // Check if the current balance matches the expected balance within tolerance
        if (Math.abs(currentBalance - expectedBalance) <= BALANCE_TOLERANCE) {
            // Balance matches, push as is (balanceMismatch is already false)
            processedTransactions.push(currentTxProcessed);
        } else {
            // --- Attempt Correction for Type Misclassification ---
            let corrected = false;
            // Check if it was reported as only deposit or only withdrawal
            const isOnlyDeposit = deposit > 0 && withdrawal === 0;
            const isOnlyWithdrawal = withdrawal > 0 && deposit === 0;

            if (isOnlyDeposit || isOnlyWithdrawal) {
                let hypotheticalExpectedBalance;
                if (isOnlyDeposit) {
                    // What if the deposit was actually a withdrawal?
                    hypotheticalExpectedBalance = prevBalance + 0 - deposit;
                } else { // isOnlyWithdrawal
                    // What if the withdrawal was actually a deposit?
                    hypotheticalExpectedBalance = prevBalance + withdrawal - 0;
                }

                // Does the swapped type match the actual balance?
                if (Math.abs(currentBalance - hypotheticalExpectedBalance) <= BALANCE_TOLERANCE) {
                    console.warn(`Correcting type misclassification at index ${i}: Prev Bal: ${prevBalance}, Original Deposit: ${deposit}, Original Withdrawal: ${withdrawal}, Actual Bal: ${currentBalance}. Assuming swapped type.`);
                    // Apply the correction
                    if (isOnlyDeposit) {
                        currentTxProcessed['Withdrawal (Dr)'] = deposit;
                        currentTxProcessed['Deposit(Cr)'] = null;
                    } else { // isOnlyWithdrawal
                        currentTxProcessed['Deposit(Cr)'] = withdrawal;
                        currentTxProcessed['Withdrawal (Dr)'] = null;
                    }
                    currentTxProcessed.balanceMismatch = false; // Resolved the mismatch
                    currentTxProcessed.correctedType = true; // Add flag indicating correction
                    processedTransactions.push(currentTxProcessed);
                    corrected = true;
                    // Note: mismatchCount is NOT incremented if corrected
                }
            }

            // --- If Not Corrected, Flag as Mismatch ---
            if (!corrected) {
                console.warn(`Balance mismatch at index ${i}: Prev Bal: ${prevBalance}, Deposit: ${deposit}, Withdrawal: ${withdrawal}, Expected: ${expectedBalance.toFixed(2)}, Actual: ${currentBalance}. Flagging transaction:`, currentTx);
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
    // Check for the essential fields needed for balance validation.
    // Allow rows with Remarks and Balance even if Dr/Cr are null/0 (for Opening Balance).
    const hasWithdrawal = tx['Withdrawal (Dr)'] !== null && tx['Withdrawal (Dr)'] !== undefined;
    const hasDeposit = tx['Deposit(Cr)'] !== null && tx['Deposit(Cr)'] !== undefined;
    const withdrawalAmount = parseFloat(tx['Withdrawal (Dr)']) || 0;
    const depositAmount = parseFloat(tx['Deposit(Cr)']) || 0;

    return tx &&
           tx['Transaction Remarks'] !== undefined &&
           tx.Balance !== undefined &&
           ( (hasWithdrawal && withdrawalAmount !== 0) || (hasDeposit && depositAmount !== 0) || (!hasWithdrawal && !hasDeposit) || (withdrawalAmount === 0 && depositAmount === 0) ); // Either Dr or Cr has a non-zero value OR both are absent/zero (like opening balance)
 }

/**
 * Extracts transactions from bank statement text using the Gemini AI API.
 * @param {string} textContent The text content extracted from the PDF bank statement.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of transaction objects.
 * @throws {Error} If AI processing fails or the response format is invalid.
 */
async function extractTransactionsWithAI(textContent) {
    if (!textContent) {
        console.warn("AI Processor: Received empty text content.");
        return [];
    }

    // Updated prompt asking for specific columns and JSON format based on correct.csv
    const prompt = `
        Analyze the following bank statement text and extract all transaction details.
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
        - Do NOT include any introductory text, explanations, or markdown fences (like \`\`\`json) in your response.
        - Provide ONLY the JSON array.

        Bank Statement Text:
        --- START ---
        ${textContent}
        --- END ---
    `;

    try {
        console.log("Sending request to Gemini AI...");
        const result = await model.generateContent(prompt);
        const response = result.response;
        const jsonText = response.text();

        console.log("Received response from Gemini AI.");
        // Basic check for empty response
        if (!jsonText) {
             console.error("AI response text is empty.");
             throw new Error("AI returned an empty response.");
        }

        let parsedTransactions;
        try {
            // Note: The 'application/json' mime type should mean we don't need manual cleaning,
            // but we keep the try-catch just in case.
            parsedTransactions = JSON.parse(jsonText);
        } catch (parseError) {
             console.error("Failed to parse AI JSON response:", parseError);
             console.error("Raw AI response text:", jsonText); // Log raw response for debugging
            throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
        }

        // Validate the structure - should be an array
        if (!Array.isArray(parsedTransactions)) {
             console.error("AI response was not a JSON array. Response:", parsedTransactions);
            throw new Error('AI response was not in the expected JSON array format.');
        }

        console.log(`AI successfully parsed ${parsedTransactions.length} potential transactions.`);

        // Validate transaction structure and balances, flagging inconsistencies
        const validatedTransactions = validateTransactionBalances(parsedTransactions);

        // Log based on flags instead of filtering
        const consistentTransactions = validatedTransactions.filter(tx => !tx.balanceMismatch);
        const correctedCount = validatedTransactions.filter(tx => tx.correctedType).length;
        console.log(`Processed ${validatedTransactions.length} transactions. ${consistentTransactions.length} appear consistent. ${correctedCount} type misclassifications corrected.`);

        return validatedTransactions; // Return all processed transactions

    } catch (error) {
        // Log the specific error from the API call or parsing/validation
        console.error("Error during AI transaction processing:", error);
        // Re-throw a more specific error for the caller
        throw new Error(`Failed to process transactions with AI: ${error.message}`);
    }
}

module.exports = { extractTransactionsWithAI }; 