import React from 'react';

function TransactionPreview({ transactions, totalCount }) {
  if (!transactions || transactions.length === 0) {
    return null; // Don't render if no transactions to preview
  }

  return (
    <div>
      <h2>2. Preview Extracted Transactions</h2>
      <p>Showing first {transactions.length} of {totalCount} transactions found:</p>
      {/* TODO: Style the table */}
      <table border="1" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Amount</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx, index) => {
            // Format amount to 2 decimal places
            const formattedAmount = typeof tx.amount === 'number' 
              ? tx.amount.toFixed(2) 
              : 'N/A'; // Handle cases where amount might not be a number
            
            // Optional: Style based on type (e.g., color)
            const amountStyle = {
              textAlign: 'right',
              color: tx.type === 'debit' ? '#c0392b' : (tx.type === 'credit' ? '#27ae60' : 'inherit')
            };

            return (
              <tr key={index}>
                <td>{tx.date || 'N/A'}</td>
                <td>{tx.description || 'N/A'}</td>
                <td style={amountStyle}>{formattedAmount}</td>
                <td>{tx.type || 'N/A'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TransactionPreview; 