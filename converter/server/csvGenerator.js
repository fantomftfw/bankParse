const fs = require('fs');
const path = require('path');
const { stringify } = require('csv-stringify/sync');

const csvExportsDir = path.join(__dirname, 'csv_exports');

// Ensure the CSV export directory exists
if (!fs.existsSync(csvExportsDir)) {
    fs.mkdirSync(csvExportsDir);
    console.log(`Created CSV export directory: ${csvExportsDir}`);
}

/**
 * Dynamically determines the CSV headers based on the keys of the first transaction object.
 * It ensures a consistent order and includes all unique keys found in the first object.
 * @param {Array<object>} transactions - Array of transaction objects (raw data from AI).
 * @returns {Array<string>} An array of strings representing the headers.
 */
function determineHeaders(transactions) {
    if (!transactions || transactions.length === 0 || typeof transactions[0] !== 'object' || transactions[0] === null) {
        console.warn('Cannot determine headers: Transactions array is empty or first item is not an object.');
        return []; // Return empty if no data or invalid first transaction
    }

    // Get all unique keys from the first transaction object
    const baseHeaders = Object.keys(transactions[0]);

    // Ensure balance correction flags are always included if transactions exist
    const finalHeaders = [...baseHeaders];
    if (!finalHeaders.includes('balanceCorrectedType')) {
        finalHeaders.push('balanceCorrectedType');
    }
    if (!finalHeaders.includes('balanceMismatch')) {
        finalHeaders.push('balanceMismatch');
    }

    console.log('Dynamically determined headers (with flags):', finalHeaders);
    return finalHeaders;
}

/**
 * Generates a CSV file from transaction data using dynamically determined headers.
 * @param {Array<object>} transactions - Array of transaction objects (raw data from AI).
 * @param {string} baseFileId - Unique identifier for the output file.
 * @returns {Promise<string>} Path to the generated CSV file.
 * @throws {Error} If CSV generation fails.
 */
async function generateCsv(transactions, baseFileId) {
    const headers = determineHeaders(transactions);

    if (headers.length === 0) {
        throw new Error('Cannot generate CSV: No headers could be determined.');
    }

    // Map data to the dynamic headers
    const dataForCsv = transactions.map(tx => {
        if (typeof tx !== 'object' || tx === null) {
            console.warn('Skipping non-object item in transactions array during CSV mapping.');
            return headers.map(() => ''); // Return empty cells for invalid row
        }
        // For each header, get the corresponding value from the transaction object
        return headers.map(header => {
            const value = tx[header];
            // Return the value if it exists, otherwise return an empty string
            return (value !== undefined && value !== null) ? String(value) : ''; 
        });
    });

    // Generate CSV string
    let csvString;
    try {
        // Pass ONLY the data rows (array of arrays) 
        // and specify the headers using the 'columns' option
        csvString = stringify(dataForCsv, { 
            header: true, 
            columns: headers // Map the data arrays to these header columns
         }); 
    } catch (stringifyError) {
        console.error("Error during CSV stringification:", stringifyError);
        throw new Error(`Failed to stringify data to CSV: ${stringifyError.message}`);
    }

    // Define file path and write CSV
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFileName = `transactions_${baseFileId}_${timestamp}.csv`;
    const filePath = path.join(csvExportsDir, outputFileName);

    try {
        fs.writeFileSync(filePath, csvString); // Use sync for simplicity in this context
        console.log(`CSV file generated successfully: ${filePath}`);
        return filePath; 
    } catch (writeError) {
        console.error("Error writing CSV file:", writeError);
        throw new Error(`Failed to write CSV file: ${writeError.message}`);
    }
}

// Export the necessary functions
module.exports = { generateCsv, determineHeaders, csvExportsDir }; 