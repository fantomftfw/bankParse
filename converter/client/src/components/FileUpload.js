import React, { useState } from 'react';

function FileUpload({ onFileSelected, isProcessing }) {
  const [error, setError] = useState('');

  const MAX_FILE_SIZE_MB = 25;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    setError('');

    if (file) {
      console.log('File selected:', file.name);

      if (file.type !== 'application/pdf') {
        const typeError = 'Invalid file type. Please upload a PDF.';
        console.error(typeError);
        setError(typeError);
        event.target.value = null;
        onFileSelected(null);
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeError = `File size exceeds the limit of ${MAX_FILE_SIZE_MB}MB.`;
        console.error(sizeError);
        setError(sizeError);
        event.target.value = null;
        onFileSelected(null);
        return;
      }

      setError('');
      onFileSelected(file);
    } else {
      event.target.value = null;
      setError('');
      onFileSelected(null);
    }
  };

  return (
    <div>
      <h2>1. Select Bank Statement PDF</h2>
      <input
        type="file"
        accept=".pdf"
        onChange={handleFileChange}
        disabled={isProcessing}
        key={isProcessing ? 'processing' : 'idle'}
      />
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {/* TODO: Add visual feedback for upload area */}
    </div>
  );
}

export default FileUpload; 