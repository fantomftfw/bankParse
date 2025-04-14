const fs = require('fs');
const path = require('path');
const { stringify } = require('csv-stringify/sync');

const csvExportsDir = path.join(__dirname, 'csv_exports');

// Ensure the CSV export directory exists
if (!fs.existsSync(csvExportsDir)) {
    fs.mkdirSync(csvExportsDir);
    console.log(`Created CSV export directory: ${csvExportsDir}`);
}

// Define the desired canonical headers for the final CSV output
const CANONICAL_HEADERS = [
    'Sl No', 
    'Tran Id', 
    'Value Date', 
    'Transaction Date', 
    'Transaction Posted Date', 
    'Cheque no / Ref No', 
    'Transaction Remarks', // Preferred Description Key 
    'Debit', // Preferred Debit Key
    'Credit', // Preferred Credit Key
    'Balance', 
    'balanceCorrectedType', 
    'balanceMismatch'
];

// Mapping from canonical headers to potential keys found in data
// (Case-insensitive matching will be used in retrieval)
const KEY_MAPPINGS = {
    'Sl No': ['Sl No'],
    'Tran Id': ['Tran Id'],
    'Value Date': ['Value Date'],
    'Transaction Date': ['Transaction Date', 'Date'], // Add 'Date' as fallback
    'Transaction Posted Date': ['Transaction Posted Date'],
    'Cheque no / Ref No': ['Cheque no / Ref No', 'Reference or cheque no'], // Add Equitas variant
    'Transaction Remarks': ['Transaction Remarks', 'Narration', 'Transaction details', 'Transaction Details/Narration/Description'], // Add variants
    'Debit': ['Debit', 'Withdra wal (Dr)'], // Add ICICI variant (cleaned)
    'Credit': ['Credit', 'Deposit (Cr)'], // Add ICICI variant (cleaned)
    'Balance': ['Balance'],
    'balanceCorrectedType': ['balanceCorrectedType'],
    'balanceMismatch': ['balanceMismatch'],
};

/**
 * Gets the value from a transaction object for a canonical header concept,
 * trying a predefined list of potential keys.
 * Returns the value of the first matching key found, or empty string.
 * @param {object} tx - The transaction object.
 * @param {string} canonicalHeader - The desired header concept (e.g., 'Debit').
 * @returns {string}
 */
function getValueForCanonicalHeader(tx, canonicalHeader) {
    const potentialKeys = KEY_MAPPINGS[canonicalHeader] || [canonicalHeader]; // Fallback to header itself
    for (const key of potentialKeys) {
        // Check if the key exists in the object (case-sensitive for direct access)
        if (tx[key] !== undefined && tx[key] !== null) {
            return String(tx[key]); // Convert to string for CSV
        }
    }
    return ''; // Return empty string if no key matched or value was null/undefined
}

/**
 * Generates a CSV file from transaction data using canonical headers.
 * Maps data to a consistent array structure before stringifying.
 * @param {Array<object>} transactions - Array of transaction objects (corrected data).
 * @param {string} baseFileId - Unique identifier for the output file.
 * @returns {Promise<string>} Path to the generated CSV file.
 * @throws {Error} If CSV generation fails.
 */
async function generateCsv(transactions, baseFileId) {
    
    const headers = CANONICAL_HEADERS; // Use the predefined canonical headers
    console.log('Using Canonical Headers for CSV:', headers);

    if (!transactions) {
        console.warn('generateCsv called with null/undefined transactions array.');
        transactions = []; // Ensure it's an array
    }

    // Map transaction objects to arrays matching canonical header order
    const dataForCsv = transactions.map(tx => {
        if (typeof tx !== 'object' || tx === null) {
            console.warn('Skipping non-object item in transactions array during CSV mapping.');
            return headers.map(() => ''); // Return empty cells for invalid row
        }
        return headers.map(header => getValueForCanonicalHeader(tx, header));
    });

    console.log('Mapped data for CSV (Array of Arrays):\n', JSON.stringify(dataForCsv, null, 2));

    // Generate CSV string from the array of arrays
    let csvString;
    try {
        csvString = stringify(dataForCsv, { // Pass array of arrays
            header: true, 
            columns: headers // Specify the headers explicitly
         }); 
        console.log('Generated CSV String (before write):\n', csvString);
    } catch (stringifyError) {
        console.error("Error during CSV stringification:", stringifyError);
        throw new Error(`Failed to stringify data to CSV: ${stringifyError.message}`);
    }

    // Define file path and write CSV
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFileName = `transactions_${baseFileId}_${timestamp}.csv`;
    const filePath = path.join(csvExportsDir, outputFileName);

    try {
        fs.writeFileSync(filePath, csvString); 
        console.log(`CSV file generated successfully: ${filePath}`);
        return filePath; 
    } catch (writeError) {
        console.error("Error writing CSV file:", writeError);
        throw new Error(`Failed to write CSV file: ${writeError.message}`);
    }
}

// Export only generateCsv and the directory path
// determineHeaders is no longer needed externally with this approach
module.exports = { generateCsv, csvExportsDir }; 