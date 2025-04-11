// Define the mock function *first*
const mockGenerateContent = jest.fn();

// Mock the *entire* library
jest.mock('@google/generative-ai', () => ({
    // Return a factory function that creates the mock structure
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        getGenerativeModel: jest.fn().mockReturnValue({
            generateContent: mockGenerateContent // Now use the defined mock function
        })
    })),
    // Mock HarmCategory and HarmBlockThreshold if needed for specific tests, 
    // otherwise they are just used as arguments and might not need explicit mocking
    HarmCategory: {
        HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
        HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
        HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
    },
    HarmBlockThreshold: {
        BLOCK_MEDIUM_AND_ABOVE: 'BLOCK_MEDIUM_AND_ABOVE'
    }
}));

// Mock dotenv config (optional, but good practice if module relies on process.env)
jest.mock('dotenv', () => ({
    config: jest.fn()
}));

// Set the environment variable *before* requiring the module
const originalApiKey = process.env.GOOGLE_API_KEY;
process.env.GOOGLE_API_KEY = 'test-key-global';

// NOW require the module under test, *after* mocks and env var are set up
const { extractTransactionsWithAI } = require('./aiProcessor');

// Restore original API key after all tests are defined and run
afterAll(() => {
    process.env.GOOGLE_API_KEY = originalApiKey;
});

describe('extractTransactionsWithAI', () => {
    const sampleTextContent = "Sample bank statement text...";

    beforeEach(() => {
        // Reset only the mock function calls before each test
        mockGenerateContent.mockReset();
    });

    test('should return parsed transactions on successful API call with valid JSON', async () => {
        const mockApiResponse = {
            response: {
                text: () => JSON.stringify([
                    { date: '2024-01-15', description: 'Test A', amount: -10, type: 'debit' },
                    { date: '2024-01-16', description: 'Test B', amount: 100, type: 'credit' }
                ])
            }
        };
        mockGenerateContent.mockResolvedValue(mockApiResponse);

        const transactions = await extractTransactionsWithAI(sampleTextContent);

        expect(transactions).toEqual([
            { date: '2024-01-15', description: 'Test A', amount: -10, type: 'debit' },
            { date: '2024-01-16', description: 'Test B', amount: 100, type: 'credit' }
        ]);
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    test('should clean markdown fences and parse valid JSON', async () => {
        const mockApiResponse = {
            response: {
                text: () => "```json\n" + JSON.stringify([
                    { date: '2024-01-17', description: 'Test C', amount: -25.5, type: 'debit' }
                ]) + "\n```"
            }
        };
        mockGenerateContent.mockResolvedValue(mockApiResponse);

        const transactions = await extractTransactionsWithAI(sampleTextContent);
        expect(transactions).toEqual([
            { date: '2024-01-17', description: 'Test C', amount: -25.5, type: 'debit' }
        ]);
        expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    test('should throw an error if API response is not valid JSON', async () => {
        const mockApiResponse = {
            response: {
                text: () => "This is not JSON"
            }
        };
        mockGenerateContent.mockResolvedValue(mockApiResponse);

        await expect(extractTransactionsWithAI(sampleTextContent))
            .rejects
            .toThrow(/^Failed to process transactions with AI: Unexpected token 'T', "This is not JSON" is not valid JSON$/);
    });

    test('should throw an error if API response JSON is not an array', async () => {
        const mockApiResponse = {
            response: {
                text: () => JSON.stringify({ message: "I am an object, not an array" })
            }
        };
        mockGenerateContent.mockResolvedValue(mockApiResponse);

        await expect(extractTransactionsWithAI(sampleTextContent))
            .rejects
            .toThrow('AI response was not in the expected JSON array format.');
    });

    test('should filter out invalid transaction objects from the array', async () => {
        const mockApiResponse = {
            response: {
                text: () => JSON.stringify([
                    { date: '2024-01-18', description: 'Valid Tx', amount: 50, type: 'credit' },
                    { date: '2024-01-19', description: 'Missing Amount' }, // Invalid
                    { date: '2024-01-20', description: 'Valid Tx 2', amount: -30, type: 'debit' }
                ])
            }
        };
        mockGenerateContent.mockResolvedValue(mockApiResponse);

        const transactions = await extractTransactionsWithAI(sampleTextContent);
        expect(transactions).toEqual([
            { date: '2024-01-18', description: 'Valid Tx', amount: 50, type: 'credit' },
            { date: '2024-01-20', description: 'Valid Tx 2', amount: -30, type: 'debit' }
        ]);
        expect(transactions.length).toBe(2);
    });

    test('should throw an error if the API call itself fails', async () => {
        const apiError = new Error('API network error');
        mockGenerateContent.mockRejectedValue(apiError);

        await expect(extractTransactionsWithAI(sampleTextContent))
            .rejects
            .toThrow(`Failed to process transactions with AI: ${apiError.message}`);
    });

    test('should throw an error if GOOGLE_API_KEY is not set', async () => {
        // Temporarily unset the key
        const currentKey = process.env.GOOGLE_API_KEY;
        process.env.GOOGLE_API_KEY = '';

        // Reset modules to force re-evaluation of the initial check in aiProcessor
        jest.resetModules();
        const { extractTransactionsWithAI: extractFnRequiresCheck } = require('./aiProcessor');

        // Perform the test
        await expect(extractFnRequiresCheck(sampleTextContent))
            .rejects
            .toThrow('Google API Key not configured.');

        // Restore the key *immediately* after the test
        process.env.GOOGLE_API_KEY = currentKey;
        // Re-require the original module for subsequent tests if needed (or ensure this test runs last)
        jest.resetModules(); 
    });
}); 