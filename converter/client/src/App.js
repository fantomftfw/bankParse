import React, { useState } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import TransactionPreview from './components/TransactionPreview';
import DownloadButton from './components/DownloadButton';
import StatusMessage from './components/StatusMessage';

function App() {
  const [, setFile] = useState(null); // Keep setFile if needed elsewhere, or remove entirely if not
  const [transactions, setTransactions] = useState([]); // Store preview transactions
  const [totalCount, setTotalCount] = useState(0); // Total transactions found
  const [downloadId, setDownloadId] = useState(null); // ID for downloading CSV
  const [isProcessing, setIsProcessing] = useState(false); // Loading state
  const [status, setStatus] = useState({ message: '', type: 'info' }); // { message: string, type: 'info' | 'error' | 'success' | 'loading' }

  const handleFileUpload = async (selectedFile) => {
    if (isProcessing) return;

    setTransactions([]);
    setTotalCount(0);
    setDownloadId(null);
    setStatus({ message: `Selected: ${selectedFile.name}`, type: 'info' });
    setIsProcessing(true);

    const formData = new FormData();
    formData.append('bankStatement', selectedFile);

    try {
      setStatus({ message: 'Uploading and processing file...', type: 'loading' });

      // Define base URL from environment variable
      const API_BASE_URL = process.env.REACT_APP_API_URL || ''; 

      // Make API call using fetch (or Axios if installed)
      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        // Handle API errors (e.g., 400, 500)
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      // Success
      setStatus({ message: result.message || 'Processing complete!', type: 'success' });
      setTransactions(result.transactions || []);
      setTotalCount(result.totalTransactions || 0);
      setDownloadId(result.downloadId || null);

    } catch (error) {
      console.error('Upload/Processing Error:', error);
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
      // Clear results on error
      setTransactions([]);
      setTotalCount(0);
      setDownloadId(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="App">
      <h1>Bank Statement to CSV Converter</h1>

      {/* Pass state and handlers to components */}
      <FileUpload onFileUpload={handleFileUpload} isProcessing={isProcessing} />

      <StatusMessage message={status.message} type={status.type} />

      <TransactionPreview transactions={transactions} totalCount={totalCount} />

      <DownloadButton downloadId={downloadId} isProcessing={isProcessing} />

    </div>
  );
}

export default App;
