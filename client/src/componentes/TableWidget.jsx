import React, { useMemo } from 'react';
import { X, Table2 } from 'lucide-react';
import { motion } from 'motion/react';
import styles from '../scss/TableWidget.module.scss';

function TableWidget({ data, headers, title, onClose }) {
  // Auto-detect headers from data if not provided
  const tableHeaders = useMemo(() => {
    if (headers && headers.length > 0) {
      return headers;
    }
    
    if (!data || data.length === 0) {
      return [];
    }
    
    // Extract all unique keys from all objects
    const allKeys = new Set();
    data.forEach(row => {
      if (typeof row === 'object' && row !== null) {
        Object.keys(row).forEach(key => allKeys.add(key));
      }
    });
    
    return Array.from(allKeys);
  }, [data, headers]);

  // Format cell value for display
  const formatCellValue = (value) => {
    if (value === null || value === undefined) {
      return '—';
    }
    
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    
    if (typeof value === 'number') {
      // Format large numbers with commas
      return value.toLocaleString();
    }
    
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    
    return String(value);
  };

  // Format header label (convert camelCase to Title Case)
  const formatHeaderLabel = (header) => {
    if (typeof header !== 'string') {
      return String(header);
    }
    
    // Convert camelCase to Title Case
    return header
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  };

  if (!data || data.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className={styles.tableWidget}
      >
        <div className={styles.widgetHeader}>
          <h3>{title || 'Table'}</h3>
          {onClose && (
            <button onClick={onClose} className={styles.closeBtn} aria-label="Close">
              <X size={20} />
            </button>
          )}
        </div>
        <div className={styles.widgetContent}>
          <div className={styles.emptyState}>
            <Table2 size={48} className={styles.emptyIcon} />
            <p className={styles.emptyText}>No data available</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={styles.tableWidget}
    >
      <div className={styles.widgetHeader}>
        <h3>{title || 'Table Data'}</h3>
        {onClose && (
          <button onClick={onClose} className={styles.closeBtn} aria-label="Close">
            <X size={20} />
          </button>
        )}
      </div>

      <div className={styles.widgetContent}>
        <div className={styles.tableContainer}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                {tableHeaders.map((header, index) => (
                  <th key={index}>
                    {formatHeaderLabel(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, rowIndex) => (
                <tr key={rowIndex} className={styles.tableRow}>
                  {tableHeaders.map((header, colIndex) => (
                    <td key={colIndex}>
                      {formatCellValue(row[header])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.tableFooter}>
          <span className={styles.rowCount}>
            {data.length} row{data.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export default TableWidget;
