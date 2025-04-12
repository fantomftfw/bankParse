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
    if (!transactions || transactions.length === 0) {
        // Default headers if no data, adjust as needed
        return [
            { id: 'Transaction Date', title: 'Transaction Date' },
            { id: 'Value Date', title: 'Value Date' },
            { id: 'Narration', title: 'Narration' }, // Default description key
            { id: 'Debit', title: 'Debit' },
            { id: 'Credit', title: 'Credit' },
            { id: 'Balance', title: 'Balance' },
            { id: 'balanceMismatch', title: 'Balance Mismatch' },
            { id: 'correctedType', title: 'Type Corrected' }
        ];
    }

    const sampleTx = transactions.find(tx => tx); // Find first non-null transaction
    if (!sampleTx) return []; // Return empty if somehow all are null/undefined

    const headers = [];
    const keys = Object.keys(sampleTx);

    // Common fields first (order matters)
    if (keys.includes('Sl No')) headers.push({ id: 'Sl No', title: 'Sl No' });
    if (keys.includes('Tran Id')) headers.push({ id: 'Tran Id', title: 'Tran Id' });
    if (keys.includes('Value Date')) headers.push({ id: 'Value Date', title: 'Value Date' });
    if (keys.includes('Transaction Date')) headers.push({ id: 'Transaction Date', title: 'Transaction Date' });
    if (keys.includes('Transaction Posted')) headers.push({ id: 'Transaction Posted', title: 'Transaction Posted' });
    if (keys.includes('Cheque no /')) headers.push({ id: 'Cheque no /', title: 'Cheque no /' });
    if (keys.includes('Ref No')) headers.push({ id: 'Ref No', title: 'Ref No' });

    // Description field (choose whichever exists)
    if (keys.includes('Transaction Remarks')) headers.push({ id: 'Transaction Remarks', title: 'Transaction Remarks' });
    else if (keys.includes('Narration')) headers.push({ id: 'Narration', title: 'Narration' });
    else if (keys.includes('Transaction details')) headers.push({ id: 'Transaction details', title: 'Transaction details' });

    // Monetary fields (choose schema)
    if (keys.includes('Withdrawal (Dr)') || keys.includes('Deposit(Cr)')) {
        headers.push({ id: 'Withdrawal (Dr)', title: 'Withdrawal (Dr)' });
        headers.push({ id: 'Deposit(Cr)', title: 'Deposit(Cr)' });
    } else if (keys.includes('Debit') || keys.includes('Credit')) {
        headers.push({ id: 'Debit', title: 'Debit' });
        headers.push({ id: 'Credit', title: 'Credit' });
    }

    // Balance
    if (keys.includes('Balance')) headers.push({ id: 'Balance', title: 'Balance' });

    // Flag fields (always add)
    headers.push({ id: 'balanceMismatch', title: 'Balance Mismatch' });
    headers.push({ id: 'correctedType', title: 'Type Corrected' });

    return headers;
}


/**
 * Generates a CSV file from an array of transaction objects.
 * Handles different transaction key schemas dynamically.
 * @param {Array<object>} transactions - Array of transaction objects.
 * @param {string} fileId - A unique identifier for the CSV file (without extension).
 * @returns {Promise<string>} A promise that resolves to the absolute path of the generated CSV file.
 */
async function generateCsv(transactions, fileId) {
    const filePath = path.join(csvExportsDir, `${fileId}.csv`);
    console.log(`Generating CSV at: ${filePath}`);

    if (!transactions || transactions.length === 0) {
        console.warn('Attempted to generate CSV with no transaction data.');
        // Create an empty file or throw error?
        // For now, let's create an empty file with default headers to avoid breaking the flow
        transactions = [];
    }

    // Dynamically determine headers based on actual data
    const dynamicHeaders = determineHeaders(transactions);
    console.log('Dynamic Headers:', dynamicHeaders.map(h => h.id));

    const csvWriter = createCsvWriter({
        path: filePath,
        header: dynamicHeaders
    });

    try {
        // Map data dynamically based on the headers being used
        const records = transactions.map(tx => {
            const record = {};
            dynamicHeaders.forEach(header => {
                // Handle the flag fields explicitly, default to false if missing
                if (header.id === 'balanceMismatch') {
                    record[header.id] = tx.balanceMismatch || false;
                } else if (header.id === 'correctedType') {
                    record[header.id] = tx.correctedType || false;
                } else {
                    // For other fields, use the value if present, otherwise null
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