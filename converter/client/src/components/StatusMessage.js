import React from 'react';
import './StatusMessage.css'; // Import a dedicated CSS file

function StatusMessage({ message, type }) {
  if (!message && type !== 'loading') { // Keep showing if loading, even without specific text message
    return null;
  }

  let typeClass = '';
  switch (type) {
    case 'error':
      typeClass = 'status-error';
      break;
    case 'success':
      typeClass = 'status-success';
      break;
    case 'loading':
      typeClass = 'status-loading';
      break;
    case 'info':
    default:
      typeClass = 'status-info';
      break;
  }

  return (
    <div className={`status-message ${typeClass}`}>
      {type === 'loading' && <div className="spinner"></div>} {/* Add spinner */} 
      <span>{message || (type === 'loading' ? 'Processing...' : '')}</span> {/* Default loading text */}
    </div>
  );
}

export default StatusMessage; 