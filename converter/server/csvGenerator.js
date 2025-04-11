const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');

const csvExportsDir = path.join(__dirname, 'csv_exports');
if (!fs.existsSync(csvExportsDir)) {
    fs.mkdirSync(csvExportsDir);
    console.log(`Created directory: ${csvExportsDir}`);
}

/**
 * Generates a CSV file from an array of transaction objects.
 * @param {Array<object>} transactions - Array of transaction objects {date, description, amount, type}.
 * @param {string} fileId - A unique identifier for the CSV file (without extension).
 * @returns {Promise<string>} A promise that resolves to the absolute path of the generated CSV file.
 */
async function generateCsv(transactions, fileId) {
    const filePath = path.join(csvExportsDir, `${fileId}.csv`);
    console.log(`Generating CSV at: ${filePath}`);

    const csvWriter = createCsvWriter({
        path: filePath,
        header: [
            { id: 'Sl No', title: 'Sl No' },
            { id: 'Tran Id', title: 'Tran Id' },
            { id: 'Value Date', title: 'Value Date' },
            { id: 'Transaction Date', title: 'Transaction Date' },
            { id: 'Transaction Posted', title: 'Transaction Posted' },
            { id: 'Cheque no /', title: 'Cheque no /' },
            { id: 'Ref No', title: 'Ref No' },
            { id: 'Transaction Remarks', title: 'Transaction Remarks' },
            { id: 'Withdrawal (Dr)', title: 'Withdrawal (Dr)' },
            { id: 'Deposit(Cr)', title: 'Deposit(Cr)' },
            { id: 'Balance', title: 'Balance' },
            { id: 'balanceMismatch', title: 'Balance Mismatch' },
            { id: 'correctedType', title: 'Type Corrected' }
        ]
    });

    try {
        const records = transactions.map(tx => ({
            'Sl No': tx['Sl No'] !== undefined ? tx['Sl No'] : null,
            'Tran Id': tx['Tran Id'] !== undefined ? tx['Tran Id'] : null,
            'Value Date': tx['Value Date'] !== undefined ? tx['Value Date'] : null,
            'Transaction Date': tx['Transaction Date'] !== undefined ? tx['Transaction Date'] : null,
            'Transaction Posted': tx['Transaction Posted'] !== undefined ? tx['Transaction Posted'] : null,
            'Cheque no /': tx['Cheque no /'] !== undefined ? tx['Cheque no /'] : null,
            'Ref No': tx['Ref No'] !== undefined ? tx['Ref No'] : null,
            'Transaction Remarks': tx['Transaction Remarks'] !== undefined ? tx['Transaction Remarks'] : null,
            'Withdrawal (Dr)': tx['Withdrawal (Dr)'] !== undefined ? tx['Withdrawal (Dr)'] : null,
            'Deposit(Cr)': tx['Deposit(Cr)'] !== undefined ? tx['Deposit(Cr)'] : null,
            'Balance': tx.Balance,
            'balanceMismatch': tx.balanceMismatch || false,
            'correctedType': tx.correctedType || false
        }));

        await csvWriter.writeRecords(records);
        console.log(`CSV file written successfully: ${filePath}`);
        return filePath;
    } catch (error) {
        console.error(`Error writing CSV file ${filePath}:`, error);
        throw new Error(`Failed to generate CSV file: ${error.message}`);
    }
}

module.exports = { generateCsv, csvExportsDir }; 