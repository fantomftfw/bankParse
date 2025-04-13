const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');

const csvExportsDir = path.join(__dirname, 'csv_exports');
if (!fs.existsSync(csvExportsDir)) {
    fs.mkdirSync(csvExportsDir);
    console.log(`Created directory: ${csvExportsDir}`);
}

/**
 * Determines the CSV headers based on the keys present in the transaction data.
 * @param {Array<object>} transactions - Array of transaction objects.
 * @returns {Array<object>} An array of header objects for csv-writer.
 */
function determineHeaders(transactions) {
    // Always return headers for the default schema + flags
    return [
        { id: 'date', title: 'Date' }, // Default schema key
        { id: 'description', title: 'Description' }, // Default schema key
        { id: 'amount', title: 'Amount' }, // Default schema key
        { id: 'type', title: 'Type' }, // Default schema key
        { id: 'running_balance', title: 'Running Balance' }, // Default schema key
        { id: 'balanceMismatch', title: 'Balance Mismatch' },
        { id: 'typeCorrected', title: 'Type Corrected' },
        { id: 'invalidStructure', title: 'Invalid Structure' } // Added invalid structure flag
    ];
}


/**
 * Generates a CSV file from an array of transaction objects.
 * Assumes transactions follow the default schema.
 * @param {Array<object>} transactions - Array of transaction objects.
 * @param {string} fileId - A unique identifier for the CSV file (without extension).
 * @returns {Promise<string>} A promise that resolves to the absolute path of the generated CSV file.
 */
async function generateCsv(transactions, fileId) {
    const filePath = path.join(csvExportsDir, `${fileId}.csv`);
    console.log(`Generating CSV at: ${filePath}`);

    if (!transactions || transactions.length === 0) {
        console.warn('Attempted to generate CSV with no transaction data.');
        transactions = []; // Ensure it's an array for mapping
    }

    // Use fixed default headers
    const fixedHeaders = determineHeaders(transactions); // Function now returns fixed headers
    console.log('Using Fixed CSV Headers:', fixedHeaders.map(h => h.id));

    const csvWriter = createCsvWriter({
        path: filePath,
        header: fixedHeaders
    });

    try {
        // Map data to the fixed default headers
        const records = transactions.map(tx => {
            const record = {};
            fixedHeaders.forEach(header => {
                // Handle flag fields explicitly, default to false if missing
                if (header.id === 'balanceMismatch') {
                    record[header.id] = tx.balanceMismatch || false;
                } else if (header.id === 'typeCorrected') {
                    record[header.id] = tx.typeCorrected || false;
                } else if (header.id === 'invalidStructure') {
                    record[header.id] = tx.invalidStructure || false; 
                } else {
                    // For other fields (default schema), use the value if present, otherwise null
                    record[header.id] = tx[header.id] !== undefined ? tx[header.id] : null;
                }
            });
            return record;
        });

        await csvWriter.writeRecords(records);
        console.log(`CSV file written successfully: ${filePath}`);
        return filePath;
    } catch (error) {
        console.error(`Error writing CSV file ${filePath}:`, error);
        throw new Error(`Failed to generate CSV file: ${error.message}`);
    }
}

module.exports = { generateCsv, csvExportsDir }; 