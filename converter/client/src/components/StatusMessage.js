import React from 'react';
// Optional: Import CSS if you add specific styles for StatusMessage
// import './StatusMessage.css'; 

function StatusMessage({ message, type = 'info' }) {
  if (!message) {
    return null;
  }

  const style = {
    padding: '10px',
    border: '1px solid',
    borderRadius: '4px',
    maxWidth: '600px', // Limit width
    margin: '15px auto', // Center block
  };

  switch (type) {
    case 'success':
      style.borderColor = '#4CAF50';
      style.color = '#4CAF50';
      style.backgroundColor = '#e8f5e9';
      break;
    case 'error':
      style.borderColor = '#f44336';
      style.color = '#f44336';
      style.backgroundColor = '#ffebee';
      break;
    case 'loading':
      style.borderColor = '#4a90e2';
      style.color = '#4a90e2';
      style.backgroundColor = '#e7f0fe';
      break;
    default: // info
      style.borderColor = '#cccccc';
      style.color = '#333333';
      style.backgroundColor = '#f8f8f8';
      break;
  }

  return (
    // Add the 'loading' class conditionally for styling with spinner
    <div style={style} className={`status-message ${type}`}>
      {type === 'loading' && <div className="spinner"></div>} 
      {message}
    </div>
  );
}

export default StatusMessage; 