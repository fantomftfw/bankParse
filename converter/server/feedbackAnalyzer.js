/**
 * Compares the initial AI results with the user-corrected feedback data.
 * @param {Array<object>} initialData - The array of transaction objects initially parsed by AI.
 * @param {Array<object>} correctedData - The array of transaction objects after user edits.
 * @returns {object} An analysis object containing differences.
 */
function compareResults(initialData, correctedData) {
  console.log('[Feedback Analyzer] Comparing results...');
  const analysis = {
    rowsAdded: 0,
    rowsDeleted: 0,
    rowsModified: 0,
    cellChanges: [], // Array of { rowIndex, header, oldValue, newValue }
    fieldChangeCounts: {}, // Counts per field { header: count }
  };

  // Basic length comparison (can be improved with row matching later)
  analysis.rowsAdded = Math.max(0, correctedData.length - initialData.length);
  analysis.rowsDeleted = Math.max(0, initialData.length - correctedData.length);

  const minRows = Math.min(initialData.length, correctedData.length);
  const headers = initialData.length > 0 ? Object.keys(initialData[0]) : (correctedData.length > 0 ? Object.keys(correctedData[0]) : []);

  for (let i = 0; i < minRows; i++) {
    const initialRow = initialData[i];
    const correctedRow = correctedData[i];
    let rowModified = false;

    for (const header of headers) {
      // Simple string comparison for now (handles null/undefined)
      const initialValue = String(initialRow[header] ?? '');
      const correctedValue = String(correctedRow[header] ?? '');

      if (initialValue !== correctedValue) {
        rowModified = true;
        analysis.cellChanges.push({
          rowIndex: i,
          header: header,
          oldValue: initialRow[header] ?? null,
          newValue: correctedRow[header] ?? null,
        });
        // Increment count for the changed field
        analysis.fieldChangeCounts[header] = (analysis.fieldChangeCounts[header] || 0) + 1;
      }
    }
    if (rowModified) {
      analysis.rowsModified++;
    }
  }

  console.log(`[Feedback Analyzer] Comparison complete: ${analysis.rowsModified} rows modified, ${analysis.cellChanges.length} cell changes.`);
  console.log('[Feedback Analyzer] Field change counts:', analysis.fieldChangeCounts);
  return analysis;
}

module.exports = { compareResults }; 