import React, { useState, useEffect } from 'react';
import './EditableDataTable.css'; // We'll create this for styling

function EditableDataTable({ data, runId }) {
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25); // Default rows per page
  // State to hold the potentially edited data
  const [editedData, setEditedData] = useState([]);
  // State to track which cell is being edited { rowIndex, header }
  const [editingCell, setEditingCell] = useState(null); 
  // State for feedback submission
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState('');

  // Effect to update local state when data prop changes
  useEffect(() => {
    setEditedData(data); // Initialize/reset local state with prop data
    setCurrentPage(1); // Reset page on new data
    setEditingCell(null); // Cancel any active edit
    setFeedbackStatus(''); // Reset feedback status on new data
    setIsSubmittingFeedback(false);
  }, [data]);

  if (!editedData || editedData.length === 0) {
    return <p>No transaction data to display.</p>;
  }

  // Get headers from the keys of the first transaction object
  // Assuming all objects have the same keys
  const headers = Object.keys(editedData[0] || {});

  // --- Pagination Logic ---
  const totalRows = editedData.length;
  const totalPages = Math.ceil(totalRows / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentPageData = editedData.slice(startIndex, endIndex);

  const handleRowsPerPageChange = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setCurrentPage(1);
    setEditingCell(null); // Cancel edit on page change
  };

  const goToPreviousPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
    setEditingCell(null); // Cancel edit on page change
  };

  const goToNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
    setEditingCell(null); // Cancel edit on page change
  };
  // --- End Pagination Logic ---

  // --- Editing Logic ---
  const handleCellClick = (rowIndexOnPage, header) => {
    // Calculate the actual index in the full editedData array
    const actualRowIndex = startIndex + rowIndexOnPage;
    setEditingCell({ rowIndex: actualRowIndex, header });
  };

  const handleCellChange = (event, actualRowIndex, header) => {
    const newValue = event.target.value;
    setEditedData(prevData => {
      const newData = [...prevData];
      // Create a new object for the changed row to ensure state update
      newData[actualRowIndex] = { ...newData[actualRowIndex], [header]: newValue };
      return newData;
    });
  };

  const handleCellBlur = () => {
    // Optionally save/validate here, for now just exit edit mode
    setEditingCell(null);
  };

  // Handle Enter key press to finish editing
  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      setEditingCell(null);
    }
  };
  // --- End Editing Logic ---

  // --- Feedback Logic ---
  const handleFeedbackSubmit = async () => {
    if (isSubmittingFeedback || !runId) {
        console.warn('Feedback submission attempted without runId.');
        setFeedbackStatus('Cannot submit feedback: Missing processing run ID.');
        return;
    }

    setIsSubmittingFeedback(true);
    setFeedbackStatus('Submitting feedback...');
    setEditingCell(null);

    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || '';
      const response = await fetch(`${API_BASE_URL}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            runId: runId, 
            correctedData: editedData 
        }), 
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP error! status: ${response.status}`);
      }

      setFeedbackStatus('Feedback submitted successfully!');

    } catch (error) {
      console.error('Feedback Submission Error:', error);
      setFeedbackStatus(`Error submitting feedback: ${error.message}`);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };
  // --- End Feedback Logic ---

  return (
    <div className="table-container">
      <h2>Editable Transaction Data</h2>
      {/* --- Pagination Controls --- */} 
      <div className="pagination-controls">
         <span>Rows per page:</span>
         <select value={rowsPerPage} onChange={handleRowsPerPageChange}>
           <option value={10}>10</option>
           <option value={25}>25</option>
           <option value={50}>50</option>
         </select>
         <span className="page-info">
           Page {currentPage} of {totalPages} ({startIndex + 1} - {Math.min(endIndex, totalRows)} of {totalRows} rows)
         </span>
         <button onClick={goToPreviousPage} disabled={currentPage === 1}>
           Previous
         </button>
         <button onClick={goToNextPage} disabled={currentPage === totalPages}>
           Next
         </button>
      </div>
      {/* --- End Pagination Controls --- */} 

      <table>
        <thead>
          <tr>
            {headers.map(header => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Render only the data for the current page */} 
          {currentPageData.map((row, rowIndexOnPage) => {
            const actualRowIndex = startIndex + rowIndexOnPage;
            return (
              <tr key={`row-${actualRowIndex}`}> 
                {headers.map(header => {
                  const isEditing = editingCell && editingCell.rowIndex === actualRowIndex && editingCell.header === header;
                  return (
                    <td 
                      key={`${header}-${actualRowIndex}`}
                      onClick={() => handleCellClick(rowIndexOnPage, header)}
                      className={isEditing ? 'editing' : ''}
                    >
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedData[actualRowIndex][header] ?? ''}
                          onChange={(e) => handleCellChange(e, actualRowIndex, header)}
                          onBlur={handleCellBlur}
                          onKeyDown={handleKeyDown}
                          autoFocus
                        />
                      ) : (
                        typeof row[header] === 'boolean' ? row[header].toString() : row[header]
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* --- Pagination Controls (Bottom) --- */} 
      <div className="pagination-controls bottom-controls">
         <span className="page-info">
           Page {currentPage} of {totalPages}
         </span>
         <button onClick={goToPreviousPage} disabled={currentPage === 1}>
           Previous
         </button>
         <button onClick={goToNextPage} disabled={currentPage === totalPages}>
           Next
         </button>
      </div>
      {/* --- End Pagination Controls --- */} 

      {/* --- Feedback Section --- */}
      <div className="feedback-section">
         <button 
           onClick={handleFeedbackSubmit} 
           disabled={isSubmittingFeedback || editedData.length === 0 || !runId}
         >
           {isSubmittingFeedback ? 'Submitting...' : 'Submit Corrections as Feedback'}
         </button>
         {feedbackStatus && <span className="feedback-status">{feedbackStatus}</span>}
      </div>
      {/* --- End Feedback Section --- */}

    </div>
  );
}

export default EditableDataTable; 