/**
 * Extracts transactions from text content using predefined regex patterns.
 * NOTE: This is a basic fallback and may need significant refinement based on
 *       the actual formats of bank statements encountered.
 * @param {string} textContent The text content extracted from the PDF bank statement.
 * @returns {Array<object>} An array of transaction objects found by patterns, or an empty array if none match.
 */
function extractTransactionsWithPatterns(textContent) {
    console.log('Attempting extraction with fallback patterns...');
    const transactions = [];

    // --- Example Pattern (Highly Simplified) ---
    // This pattern assumes transactions are on lines starting with a date (DD/MM/YYYY or MM/DD/YYYY),
    // followed by a description, and ending with two numbers (debit/credit and balance).
    // It tries to capture the date, description, and the first amount (assuming it's the transaction amount).
    // IMPORTANT: This WILL need adjustment for real bank statements.
    const transactionPattern = /^\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.*?)\s+([\d,]+\.\d{2})\s*([\d,]+\.\d{2})?$/gm;
    // Explanation:
    // ^                     - Start of the line
    // \s*                   - Optional leading whitespace (NEW)
    // (\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}) - Capture Group 1: Date (e.g., DD/MM/YYYY, MM-DD-YY)
    // \s+                   - One or more spaces
    // (.*?)                 - Capture Group 2: Description (non-greedy match)
    // \s+                   - One or more spaces
    // ([\d,]+\.\d{2})      - Capture Group 3: Transaction Amount (e.g., 1,234.56)
    // \s*                   - Zero or more spaces
    // ([\d,]+\.\d{2})?     - Optional Capture Group 4: Balance (we ignore this for now)
    // $                     - End of the line
    // gm                    - Global (find all matches), Multiline (^$ match line breaks)

    let match;
    while ((match = transactionPattern.exec(textContent)) !== null) {
        try {
            const date = match[1].trim();
            const description = match[2].trim();
            // Remove commas for parsing
            const amountStr = match[3].replace(/,/g, '').trim();
            const amount = parseFloat(amountStr);

            // Determine type (simple assumption: presence of amount means it's a transaction)
            // A more robust pattern would directly identify debit/credit columns or keywords.
            // For this example, we can't reliably determine type without more context/columns.
            // We'll mark amount as positive and type as 'unknown' or derive later.
            // **Let's refine this: We need a way to infer debit/credit.**
            // If bank statements consistently use separate columns, the regex needs to change.
            // If they use signs (+/-) or keywords (DR/CR), the regex/logic needs that.
            // **Assumption:** For now, let's assume the *first* amount is debit/withdrawal (negative)
            // unless specific keywords indicate otherwise (which this simple regex doesn't capture).
            // THIS IS A MAJOR SIMPLIFICATION.
            const transactionType = 'unknown'; // Cannot reliably determine type here.

            if (description && !isNaN(amount)) {
                transactions.push({
                    date: date,       // Keep original format for now
                    description: description,
                    amount: amount,   // Store as positive for now
                    type: transactionType // Needs improvement
                });
            }
        } catch (e) {
            console.warn('Skipping potential pattern match due to error:', e);
        }
    }

    console.log(`Found ${transactions.length} potential transactions via patterns.`);

    // TODO: Add more patterns for different layouts
    // TODO: Improve date normalization
    // TODO: Improve amount parsing (handle different currency symbols, signs)
    // TODO: Reliably determine transaction type (debit/credit)

    return transactions;
}

module.exports = { extractTransactionsWithPatterns }; 