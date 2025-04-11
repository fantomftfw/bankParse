import React, { useState } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import DownloadButton from './components/DownloadButton';
import StatusMessage from './components/StatusMessage';
import EditableDataTable from './components/EditableDataTable';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fullTransactionData, setFullTransactionData] = useState([]);
  const [downloadId, setDownloadId] = useState(null);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState({ message: 'Please select a PDF file.', type: 'info' });

  const handleFileSelected = (file) => {
    setSelectedFile(file);
    setFullTransactionData([]);
    setDownloadId(null);
    setCurrentRunId(null);
    if (file) {
      setStatus({ message: `Selected: ${file.name}. Ready to convert.`, type: 'info' });
    } else {
      setStatus({ message: 'Please select a PDF file.', type: 'info' });
    }
  };

  const handleConvert = async () => {
    if (!selectedFile || isProcessing) return;

    setFullTransactionData([]);
    setDownloadId(null);
    setCurrentRunId(null);
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

      setStatus({ message: result.message || 'Processing complete!', type: 'success' });
      setFullTransactionData(result.fullTransactions || []);
      setDownloadId(result.downloadId || null);
      setCurrentRunId(result.runId || null);
      console.log('[App.js] Received runId from API:', result.runId);

    } catch (error) {
      console.error('Conversion Error:', error);
      setStatus({ message: `Error: ${error.message}`, type: 'error' });
      setFullTransactionData([]);
      setDownloadId(null);
      setCurrentRunId(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="App">
      <h1>Bank Statement to CSV Converter</h1>

      <FileUpload onFileSelected={handleFileSelected} isProcessing={isProcessing} />

      {selectedFile && (
        <div style={{ marginTop: '20px' }}>
          <h2>2. Convert File</h2>
          <button onClick={handleConvert} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Convert to CSV'}
          </button>
        </div>
      )}

      <StatusMessage message={status.message} type={status.type} />

      {fullTransactionData.length > 0 && !isProcessing && (
         <EditableDataTable data={fullTransactionData} runId={currentRunId} />
      )}

      {downloadId && !isProcessing && (
         <DownloadButton downloadId={downloadId} isProcessing={isProcessing} />
      )}

    </div>
  );
}

export default App;
