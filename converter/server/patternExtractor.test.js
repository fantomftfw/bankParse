const { extractTransactionsWithPatterns } = require('./patternExtractor');

describe('extractTransactionsWithPatterns', () => {

    // Test case 1: Basic text matching the simple pattern
    test('should extract transactions from simple pattern format', () => {
        const textContent = `
            Some introductory text.
            01/04/2024 PURCHASE AT STORE A       100.50   1234.56
            02-04-2024 Direct Debit Utility Co       55.00    1179.56
            Ignore this line completely
            03/04/2025 TRANSFER FROM SOMEONE   ABCDE    99.99   9999.99 This shouldn't match fully
            04/04/2024 Another Purchase     12.34     1167.22
            Ending line.
        `;

        const expectedTransactions = [
            {
                date: '01/04/2024',
                description: 'PURCHASE AT STORE A',
                amount: 100.50,
                type: 'unknown' // Pattern cannot reliably determine type yet
            },
            {
                date: '02-04-2024',
                description: 'Direct Debit Utility Co',
                amount: 55.00,
                type: 'unknown'
            },
            // Note: 03/04/2025 has extra text after amount, so the simple regex won't match the line end ($)
            {
                date: '04/04/2024',
                description: 'Another Purchase',
                amount: 12.34,
                type: 'unknown'
            }
        ];

        const result = extractTransactionsWithPatterns(textContent);
        expect(result).toEqual(expectedTransactions);
        expect(result.length).toBe(3);
    });

    // Test case 2: Text with no matching lines
    test('should return an empty array when no lines match the pattern', () => {
        const textContent = `
            BANK STATEMENT
            Account Balance: 500.00
            No transactions listed in the expected format.
            Another line.
        `;
        const result = extractTransactionsWithPatterns(textContent);
        expect(result).toEqual([]);
        expect(result.length).toBe(0);
    });

    // Test case 3: Empty input text
    test('should return an empty array for empty input text', () => {
        const textContent = '';
        const result = extractTransactionsWithPatterns(textContent);
        expect(result).toEqual([]);
        expect(result.length).toBe(0);
    });
    
    // Test case 4: Text with amounts but no clear date start (should not match simple pattern)
    test('should not extract lines without the expected date start format', () => {
        const textContent = `
            Transaction description 50.00 100.00
            Another one here 25.50 74.50 
        `;
        const result = extractTransactionsWithPatterns(textContent);
        expect(result).toEqual([]);
    });

    // TODO: Add more tests for variations:
    // - Different date formats (if regex is enhanced)
    // - Different amount formats (commas, currency symbols if handled)
    // - Lines with only one amount (e.g., no balance column)
    // - Cases where debit/credit can be identified (if pattern improves)
}); 