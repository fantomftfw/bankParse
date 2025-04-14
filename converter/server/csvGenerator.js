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
 * Dynamically determines the CSV headers by finding all unique keys across ALL transactions.
 * @param {Array<object>} transactions - Array of transaction objects.
 * @returns {Array<string>} An array of strings representing the headers.
 */
function determineHeaders(transactions) {
    if (!transactions || transactions.length === 0) {
        console.warn('Cannot determine headers: Transactions array is empty.');
        return [];
    }

    const headerSet = new Set();
    transactions.forEach(tx => {
        if (typeof tx === 'object' && tx !== null) {
            Object.keys(tx).forEach(key => headerSet.add(key));
        }
    });

    // Ensure balance correction flags are always included if transactions exist
    // (They should be added during the loop above if present, but double-check)
    if (!headerSet.has('balanceCorrectedType')) {
        headerSet.add('balanceCorrectedType');
    }
    if (!headerSet.has('balanceMismatch')) {
        headerSet.add('balanceMismatch');
    }

    const finalHeaders = [...headerSet]; // Convert Set to Array
    console.log('Dynamically determined headers (superset):', finalHeaders);
    return finalHeaders;
}

/**
 * Generates a CSV file from transaction data using dynamically determined headers (superset).
 * Passes the array of objects directly to csv-stringify.
 * @param {Array<object>} transactions - Array of transaction objects (corrected data).
 * @param {string} baseFileId - Unique identifier for the output file.
 * @returns {Promise<string>} Path to the generated CSV file.
 * @throws {Error} If CSV generation fails.
 */
async function generateCsv(transactions, baseFileId) {
    const headers = determineHeaders(transactions); // Get superset of headers

    if (headers.length === 0) {
        // If transactions existed but no headers (e.g., array of nulls), create default headers
        if (transactions && transactions.length > 0){
             console.warn("No headers determined from transaction objects, using default flags.");
             headers.push('balanceCorrectedType', 'balanceMismatch');
        } else {
            throw new Error('Cannot generate CSV: No headers could be determined and no transactions.');
        } 
    }

    // Generate CSV string directly from the array of objects
    let csvString;
    try {
        csvString = stringify(transactions, { // Pass array of objects
            header: true, 
            columns: headers // Use the determined superset of columns
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
        fs.writeFileSync(filePath, csvString); 
        console.log(`CSV file generated successfully: ${filePath}`);
        return filePath; 
    } catch (writeError) {
        console.error("Error writing CSV file:", writeError);
        throw new Error(`Failed to write CSV file: ${writeError.message}`);
    }
}

// Export the necessary functions
module.exports = { generateCsv, determineHeaders, csvExportsDir }; 