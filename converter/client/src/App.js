import React, { useState } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import TransactionPreview from './components/TransactionPreview';
import DownloadButton from './components/DownloadButton';
import StatusMessage from './components/StatusMessage';
// TODO: Import EditableDataTable component later

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  // Store full transaction data for editing/display
  const [fullTransactionData, setFullTransactionData] = useState([]); 
  // Keep preview state for initial feedback?
  const [previewTransactions, setPreviewTransactions] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [downloadId, setDownloadId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState({ message: 'Please select a PDF file.', type: 'info' });

  const handleFileSelected = (file) => {
    setSelectedFile(file);
    setPreviewTransactions([]);
    setFullTransactionData([]); // Reset full data
    setTotalCount(0);
    setDownloadId(null);
    if (file) {
      setStatus({ message: `Selected: ${file.name}. Ready to convert.`, type: 'info' });
    } else {
      setStatus({ message: 'Please select a PDF file.', type: 'info' });
    }
  };

  const handleConvert = async () => {
    if (!selectedFile || isProcessing) return;

    setPreviewTransactions([]);
    setFullTransactionData([]); // Reset full data
    setTotalCount(0);
    setDownloadId(null);
    setStatus({ message: 'Starting conversion...', type: 'loading' });
    setIsProcessing(true);

    const formData = new FormData();
    formData.append('bankStatement', selectedFile);

    try {
      setStatus({ message: 'Uploading and processing file...', type: 'loading' });

      const API_BASE_URL = process.env.REACT_APP_API_URL || ''; 

      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      // Store both preview and full data
      setStatus({ message: result.message || 'Processing complete!', type: 'success' });
      setPreviewTransactions(result.transactions || []); 
      setFullTransactionData(result.fullTransactions || []); // Store the full data
      setTotalCount(result.totalTransactions || 0);
      setDownloadId(result.downloadId || null);

    } catch (error) {
      console.error('Conversion Error:', error);
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
      setPreviewTransactions([]);
      setFullTransactionData([]); // Reset full data
      setTotalCount(0);
      setDownloadId(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="App">
      <h1>Bank Statement to CSV Converter</h1>

      {/* Step 1: File Selection */}
      <FileUpload onFileSelected={handleFileSelected} isProcessing={isProcessing} />

      {/* Step 2: Convert Button (only show if a file is selected) */}
      {selectedFile && (
        <div style={{ marginTop: '20px' }}>
          <h2>2. Convert File</h2>
          <button onClick={handleConvert} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Convert to CSV'}
          </button>
        </div>
      )}

      {/* Step 3: Status & Results */}
      <StatusMessage message={status.message} type={status.type} />

      {/* TODO: Show EditableDataTable instead of TransactionPreview when full data is available */}
      {/* Replace this preview logic later */}
      {previewTransactions.length > 0 && !isProcessing && (
        <TransactionPreview transactions={previewTransactions} totalCount={totalCount} />
      )}

      {/* Render EditableDataTable when data is ready */}
      {fullTransactionData.length > 0 && !isProcessing && (
         // TODO: Create and use the EditableDataTable component
         <p>Editable Data Table will go here ({fullTransactionData.length} rows)</p>
         // <EditableDataTable data={fullTransactionData} /> 
      )}

      {/* Keep download button for now */}
      {downloadId && (
         <DownloadButton downloadId={downloadId} isProcessing={isProcessing} />
      )}

    </div>
  );
}

export default App;
