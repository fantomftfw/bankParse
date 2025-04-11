import React from 'react';

function DownloadButton({ downloadId, isProcessing }) {
  if (!downloadId || isProcessing) {
    return null; // Don't render if no ID or still processing
  }

  const handleDownload = () => {
    console.log('Download requested for:', downloadId);
    
    // Construct URL using environment variable
    const API_BASE_URL = process.env.REACT_APP_API_URL || ''; // Get base URL
    const downloadUrl = `${API_BASE_URL}/api/download/${downloadId}`; 

    console.log('Attempting download from URL:', downloadUrl);
    // Trigger download by navigating
    window.location.href = downloadUrl;
  };

  return (
    <div>
      <h2>3. Download Full Data</h2>
      <button onClick={handleDownload} disabled={!downloadId}>
        Download CSV ({downloadId})
      </button>
    </div>
  );
}

export default DownloadButton; 