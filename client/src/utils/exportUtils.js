/**
 * Export data to CSV format
 * @param {Array} data - Array of objects to export
 * @param {Array} headers - Array of header objects with label and key
 * @param {string} filename - Name of the file to download
 */
export function exportToCSV(data, headers, filename) {
    if (!data || data.length === 0) {
        alert('No data to export');
        return;
    }

    // Create CSV header row
    const headerRow = headers.map(h => h.label).join(',');
    
    // Create CSV data rows
    const dataRows = data.map(item => {
        return headers.map(header => {
            let value = item[header.key];
            
            // Handle null/undefined values
            if (value == null) {
                value = '';
            }
            
            // Handle objects (like dates)
            if (typeof value === 'object') {
                value = JSON.stringify(value);
            }
            
            // Escape commas and quotes in values
            const stringValue = String(value);
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            
            return stringValue;
        }).join(',');
    });
    
    // Combine header and data rows
    const csvContent = [headerRow, ...dataRows].join('\n');
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Export data to Excel format using SheetJS
 * @param {Array} data - Array of objects to export
 * @param {Array} headers - Array of header objects with label and key
 * @param {string} filename - Name of the file to download
 */
export async function exportToExcel(data, headers, filename) {
    if (!data || data.length === 0) {
        alert('No data to export');
        return;
    }

    try {
        // Dynamically import xlsx library
        const XLSX = await import('xlsx');
        
        // Prepare worksheet data
        const worksheetData = [
            // Header row
            headers.map(h => h.label),
            // Data rows
            ...data.map(item => {
                return headers.map(header => {
                    let value = item[header.key];
                    
                    // Handle null/undefined values
                    if (value == null) {
                        return '';
                    }
                    
                    // Handle dates - convert to readable format
                    if (value instanceof Date) {
                        return value.toLocaleDateString();
                    }
                    
                    // Return value as-is
                    return value;
                });
            })
        ];
        
        // Create workbook and worksheet
        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        
        // Generate Excel file and download
        XLSX.writeFile(workbook, `${filename}.xlsx`);
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        alert('Failed to export to Excel. Please try CSV export instead.');
    }
}
