const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Create a new PDF document
const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 50, bottom: 50, left: 50, right: 50 }
});

// Output file path
const outputPath = path.join(__dirname, 'USER_MANUAL.pdf');

// Pipe the PDF to a file
doc.pipe(fs.createWriteStream(outputPath));

// Helper function to add a section header
function addSectionHeader(title, pageBreak = false) {
    if (pageBreak) {
        doc.addPage();
    }
    doc.fontSize(18)
       .font('Helvetica-Bold')
       .fillColor('#1a1a1a')
       .text(title, { align: 'left' });
    doc.moveDown(0.5);
    doc.strokeColor('#e0e0e0')
       .lineWidth(2)
       .moveTo(50, doc.y)
       .lineTo(550, doc.y)
       .stroke();
    doc.moveDown(1);
}

// Helper function to add a subsection
function addSubsection(title) {
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .fillColor('#2c3e50')
       .text(title, { align: 'left' });
    doc.moveDown(0.5);
}

// Helper function to add body text
function addBodyText(text, options = {}) {
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#333333')
       .text(text, {
           align: 'left',
           width: 500,
           ...options
       });
    doc.moveDown(0.5);
}

// Helper function to add bullet points
function addBulletPoint(text, indent = 20) {
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#333333')
       .text('•', indent, doc.y, { width: 20 });
    doc.text(text, indent + 20, doc.y - 11, { width: 480 });
    doc.moveDown(0.5);
}

// Helper function to add numbered steps
function addNumberedStep(number, text) {
    doc.fontSize(11)
       .font('Helvetica-Bold')
       .fillColor('#2c3e50')
       .text(`${number}.`, 50, doc.y, { width: 30 });
    doc.font('Helvetica')
       .fillColor('#333333')
       .text(text, 80, doc.y - 11, { width: 470 });
    doc.moveDown(0.7);
}

// Helper function to add a feature box
function addFeatureBox(title, description) {
    const startY = doc.y;
    doc.rect(50, startY, 500, 40)
       .fillColor('#f8f9fa')
       .fill()
       .strokeColor('#dee2e6')
       .stroke();
    
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .fillColor('#2c3e50')
       .text(title, 60, startY + 10, { width: 480 });
    
    doc.fontSize(10)
       .font('Helvetica')
       .fillColor('#666666')
       .text(description, 60, startY + 28, { width: 480 });
    
    doc.y = startY + 50;
    doc.moveDown(0.5);
}

// ========== COVER PAGE ==========
doc.fontSize(32)
   .font('Helvetica-Bold')
   .fillColor('#1a1a1a')
   .text('Steve AI', 50, 200, { align: 'center' });

doc.fontSize(24)
   .font('Helvetica')
   .fillColor('#666666')
   .text('User Manual', 50, 250, { align: 'center' });

doc.fontSize(14)
   .font('Helvetica')
   .fillColor('#999999')
   .text('Complete Guide to Using the PDF Automation System', 50, 300, { align: 'center' });

doc.fontSize(12)
   .font('Helvetica')
   .fillColor('#999999')
   .text('Version 1.1.0', 50, 650, { align: 'center' });

// ========== TABLE OF CONTENTS ==========
doc.addPage();
addSectionHeader('Table of Contents', false);

const toc = [
    { page: 3, title: '1. Introduction' },
    { page: 4, title: '2. Getting Started' },
    { page: 5, title: '  2.1 Logging In' },
    { page: 6, title: '3. Main Features' },
    { page: 7, title: '  3.1 Suppliers Page' },
    { page: 8, title: '  3.2 All Statements' },
    { page: 9, title: '  3.3 All Invoices' },
    { page: 10, title: '  3.4 Activity Log' },
    { page: 11, title: '  3.5 Supplier Details' },
    { page: 12, title: '  3.6 Single Statement View' },
    { page: 13, title: '4. File Upload' },
    { page: 14, title: '5. Reconciliation Status' },
    { page: 15, title: '6. Navigation Tips' },
    { page: 16, title: '7. Troubleshooting' }
];

toc.forEach(item => {
    doc.fontSize(11)
       .font('Helvetica')
       .fillColor('#333333')
       .text(item.title, 50, doc.y, { width: 400 });
    doc.text(`... ${item.page}`, 450, doc.y - 11, { width: 100, align: 'right' });
    doc.moveDown(0.4);
});

// ========== 1. INTRODUCTION ==========
doc.addPage();
addSectionHeader('1. Introduction', false);

addBodyText('Welcome to Steve AI, an intelligent PDF automation system designed to streamline your invoice and statement processing workflow. This system helps you manage supplier statements, reconcile invoices with your accounting system (Xero), and track all your financial documents in one centralized location.');
doc.moveDown(0.5);

addBodyText('This user manual will guide you through all the features and capabilities of the system, helping you make the most of your PDF automation experience.');
doc.moveDown(1);

addSubsection('What is Steve AI?');
addBodyText('Steve AI is a web-based application that automates the processing of supplier statements and invoices. It extracts data from PDF and Excel files, matches invoices with your Xero accounting system, and provides comprehensive reconciliation reports.');
doc.moveDown(0.5);

addBodyText('Key Benefits:');
addBulletPoint('Automated invoice extraction from PDF and Excel files');
addBulletPoint('Automatic matching with Xero accounting records');
addBulletPoint('Real-time reconciliation status tracking');
addBulletPoint('Comprehensive reporting and activity logs');
addBulletPoint('Easy-to-use interface with intuitive navigation');

// ========== 2. GETTING STARTED ==========
doc.addPage();
addSectionHeader('2. Getting Started', false);

addSubsection('2.1 Logging In');
addBodyText('To access Steve AI, you need to log in with your credentials. Follow these steps:');
doc.moveDown(0.5);

addNumberedStep(1, 'Navigate to the login page in your web browser');
addNumberedStep(2, 'Enter your email address in the email field');
addNumberedStep(3, 'Enter your password in the password field');
addNumberedStep(4, 'Click the "Sign in" button to access the system');
doc.moveDown(0.5);

addBodyText('Note: If you forget your password, contact your system administrator for assistance.');
doc.moveDown(1);

addSubsection('2.2 First Time Users');
addBodyText('If this is your first time using the system, your administrator will provide you with login credentials. Once logged in, you\'ll see the main dashboard with all available features.');

// ========== 3. MAIN FEATURES ==========
doc.addPage();
addSectionHeader('3. Main Features', false);

addBodyText('Steve AI provides several key features to help you manage your supplier statements and invoices. Each feature is accessible through the main navigation menu at the top of the screen.');
doc.moveDown(1);

addSubsection('3.1 Suppliers Page');
addBodyText('The Suppliers page is your main dashboard where you can view all suppliers and upload new statement files.');
doc.moveDown(0.5);

addBodyText('Features:');
addBulletPoint('View all suppliers in a paginated table');
addBulletPoint('See the number of statements for each supplier');
addBulletPoint('Search for specific suppliers using the search bar');
addBulletPoint('Upload PDF or Excel files via drag-and-drop or file browser');
addBulletPoint('Click on any supplier to view their detailed statements');
doc.moveDown(0.5);

addBodyText('How to Use:');
addNumberedStep(1, 'Use the search bar to find a specific supplier');
addNumberedStep(2, 'Click on a supplier name to view their statements');
addNumberedStep(3, 'Upload new files by dragging and dropping them into the upload area or clicking "Browse"');
addNumberedStep(4, 'Use the pagination controls at the bottom to navigate through multiple pages of suppliers');

// ========== 3.2 ALL STATEMENTS ==========
doc.addPage();
addSectionHeader('3.2 All Statements', false);

addBodyText('The All Statements page provides a comprehensive view of all statements across all suppliers, allowing you to monitor processing status and reconciliation results.');
doc.moveDown(0.5);

addBodyText('Features:');
addBulletPoint('View all statements from all suppliers in one place');
addBulletPoint('Sort by any column (Supplier, Statement Issue Date, Process Date/Time, Status, etc.)');
addBulletPoint('See reconciliation status for each statement (Fully Reconciled, Partially Reconciled, Unreconciled)');
addBulletPoint('View reconciled and unreconciled invoice counts');
addBulletPoint('Download original statement files');
addBulletPoint('Click on any statement to view detailed invoice information');
doc.moveDown(0.5);

addBodyText('How to Use:');
addNumberedStep(1, 'Click on any column header to sort by that column (click again to reverse the sort order)');
addNumberedStep(2, 'Review the status badges to quickly identify reconciliation status');
addNumberedStep(3, 'Click on a statement row to view detailed invoice information');
addNumberedStep(4, 'Use the "Download" link to retrieve the original statement file');
addNumberedStep(5, 'Navigate through pages using the Previous/Next buttons');

// ========== 3.3 ALL INVOICES ==========
doc.addPage();
addSectionHeader('3.3 All Invoices', false);

addBodyText('The All Invoices page displays every invoice across all suppliers, providing detailed reconciliation information for each invoice.');
doc.moveDown(0.5);

addBodyText('Features:');
addBulletPoint('View all invoices from all suppliers in a single table');
addBulletPoint('See supplier invoice dates and Xero dates side by side');
addBulletPoint('Compare supplier amounts with Xero amounts');
addBulletPoint('View differences between supplier and Xero amounts');
addBulletPoint('See whether each invoice was found in Xero');
addBulletPoint('View reconciliation status for each invoice');
addBulletPoint('Sort by any column for easy analysis');
addBulletPoint('Click on any invoice to view its statement details');
doc.moveDown(0.5);

addBodyText('Understanding the Columns:');
addBulletPoint('Supplier: The supplier name');
addBulletPoint('Invoice Number: The invoice reference number');
addBulletPoint('Supplier Date: The date from the supplier\'s invoice');
addBulletPoint('Xero Date: The date from your Xero accounting system');
addBulletPoint('Supplier Amount: The amount from the supplier\'s invoice');
addBulletPoint('Xero Amount: The amount from your Xero system');
addBulletPoint('Difference: The difference between supplier and Xero amounts');
addBulletPoint('Found in Xero: Whether the invoice was matched in Xero (Yes/No)');
addBulletPoint('Status: Reconciliation status (Fully Reconciled, Partially Reconciled, or N/A)');

// ========== 3.4 ACTIVITY LOG ==========
doc.addPage();
addSectionHeader('3.4 Activity Log', false);

addBodyText('The Activity Log provides a chronological history of all system activities, including file uploads and processing results.');
doc.moveDown(0.5);

addBodyText('Features:');
addBulletPoint('View all system activities in chronological order');
addBulletPoint('See processing status for each statement');
addBulletPoint('View supplier information for each activity');
addBulletPoint('See timestamps for when each activity occurred');
addBulletPoint('Click on any activity to view detailed statement information');
addBulletPoint('Identify successful reconciliations and discrepancies');
doc.moveDown(0.5);

addBodyText('Activity Types:');
addBulletPoint('Full reconciliation completed: All invoices were successfully matched');
addBulletPoint('Statement processed with discrepancies: Some invoices had matching issues');
addBulletPoint('New statement uploaded: A new file was uploaded and is being processed');
doc.moveDown(0.5);

addBodyText('How to Use:');
addNumberedStep(1, 'Review the activity list to see recent processing activities');
addNumberedStep(2, 'Click on any activity card to view the detailed statement');
addNumberedStep(3, 'Use pagination to view older activities');

// ========== 3.5 SUPPLIER DETAILS ==========
doc.addPage();
addSectionHeader('3.5 Supplier Details', false);

addBodyText('When you click on a supplier from the Suppliers page, you\'ll see a detailed view with two tabs: Statements and All Invoices.');
doc.moveDown(0.5);

addSubsection('Statements Tab');
addBodyText('This tab shows all statements for the selected supplier:');
addBulletPoint('Statement Issue Date: When the statement was issued');
addBulletPoint('Process Date/Time: When the statement was processed by the system');
addBulletPoint('Status: Current reconciliation status');
addBulletPoint('Reconciled: Number of invoices that matched with Xero');
addBulletPoint('Unreconciled: Number of invoices that didn\'t match');
addBulletPoint('Total: Total number of invoices in the statement');
addBulletPoint('File: Download link for the original statement file');
doc.moveDown(0.5);

addSubsection('All Invoices Tab');
addBodyText('This tab shows all invoices for the selected supplier:');
addBulletPoint('All invoice details including dates, amounts, and reconciliation status');
addBulletPoint('Sortable columns for easy analysis');
addBulletPoint('Click on any invoice to view its statement context');
doc.moveDown(0.5);

addBodyText('How to Use:');
addNumberedStep(1, 'Click on a supplier from the Suppliers page');
addNumberedStep(2, 'Switch between "Statements" and "All Invoices" tabs');
addNumberedStep(3, 'Click on any statement or invoice to view detailed information');
addNumberedStep(4, 'Use sorting and pagination to find specific items');

// ========== 3.6 SINGLE STATEMENT VIEW ==========
doc.addPage();
addSectionHeader('3.6 Single Statement View', false);

addBodyText('The Single Statement view provides detailed information about all invoices within a specific statement, allowing you to perform detailed reconciliation analysis.');
doc.moveDown(0.5);

addBodyText('Features:');
addBulletPoint('View all invoices from a specific statement');
addBulletPoint('See detailed comparison between supplier and Xero data');
addBulletPoint('View reference IDs (invoice numbers)');
addBulletPoint('Check if each invoice was found in Xero');
addBulletPoint('Compare supplier dates with Xero dates');
addBulletPoint('Compare supplier amounts with Xero amounts');
addBulletPoint('See the difference between amounts');
addBulletPoint('View amount match status');
addBulletPoint('See potential match indicators');
addBulletPoint('View reconciliation status for each invoice');
addBulletPoint('Sort by any column for detailed analysis');
doc.moveDown(0.5);

addBodyText('Understanding the Columns:');
addBulletPoint('Reference ID: The invoice number from the supplier');
addBulletPoint('Found in Xero: Whether the invoice exists in your Xero system (Yes/No)');
addBulletPoint('Supplier Date: Date from the supplier\'s invoice');
addBulletPoint('Xero Date: Date from your Xero system');
addBulletPoint('Supplier Amount: Amount from the supplier\'s invoice');
addBulletPoint('Xero Amount: Amount from your Xero system');
addBulletPoint('Difference: The difference between supplier and Xero amounts');
addBulletPoint('Amount Match: Whether the amounts match (Yes/No/N/A)');
addBulletPoint('Potentially Matched: Whether the invoice could be matched (Yes/No/N/A)');
addBulletPoint('Status: Reconciliation status (Fully Reconciled, Partially Reconciled, or N/A)');
doc.moveDown(0.5);

addBodyText('How to Use:');
addNumberedStep(1, 'Navigate to a statement from any page (All Statements, Supplier Details, or Activity Log)');
addNumberedStep(2, 'Review all invoices in the statement');
addNumberedStep(3, 'Click on column headers to sort the data');
addNumberedStep(4, 'Use the back button to return to the previous page');
addNumberedStep(5, 'Use pagination if the statement contains many invoices');

// ========== 4. FILE UPLOAD ==========
doc.addPage();
addSectionHeader('4. File Upload', false);

addBodyText('Uploading files is a core feature of Steve AI. The system supports both PDF and Excel files for processing supplier statements and invoices.');
doc.moveDown(0.5);

addSubsection('Supported File Types');
addBodyText('The system accepts the following file formats:');
addBulletPoint('PDF files (.pdf)');
addBulletPoint('Excel files (.xlsx, .xls)');
doc.moveDown(0.5);

addSubsection('Upload Methods');
addBodyText('You can upload files using two methods:');
doc.moveDown(0.5);

addBodyText('Method 1: Drag and Drop');
addNumberedStep(1, 'Locate the file on your computer');
addNumberedStep(2, 'Drag the file over the upload area on the Suppliers page');
addNumberedStep(3, 'Release the file when you see the upload area highlighted');
addNumberedStep(4, 'Wait for the file to be processed');
doc.moveDown(0.5);

addBodyText('Method 2: Browse');
addNumberedStep(1, 'Click the "Browse" button in the upload area');
addNumberedStep(2, 'Select the file from your computer\'s file browser');
addNumberedStep(3, 'Wait for the file to be processed');
doc.moveDown(0.5);

addSubsection('What Happens After Upload');
addBodyText('Once you upload a file, the system will:');
addBulletPoint('Validate the file format');
addBulletPoint('Extract invoice data from the file');
addBulletPoint('Match invoices with your Xero accounting system');
addBulletPoint('Calculate reconciliation status');
addBulletPoint('Display a success message with processing results');
addBulletPoint('Automatically refresh the page to show updated data');
doc.moveDown(0.5);

addSubsection('Upload Success Messages');
addBodyText('After successful upload, you\'ll see a message indicating:');
addBulletPoint('The file name that was processed');
addBulletPoint('The number of invoices found');
addBulletPoint('How many invoices were matched');
addBulletPoint('How many invoices were unmatched');
addBulletPoint('Whether the data was saved to the database');
doc.moveDown(0.5);

addSubsection('Troubleshooting Upload Issues');
addBodyText('If you encounter issues during upload:');
addBulletPoint('Ensure the file is in PDF or Excel format');
addBulletPoint('Check that the file is not corrupted');
addBulletPoint('Verify the file contains readable invoice data');
addBulletPoint('Contact your administrator if issues persist');

// ========== 5. RECONCILIATION STATUS ==========
doc.addPage();
addSectionHeader('5. Reconciliation Status', false);

addBodyText('Understanding reconciliation status is crucial for managing your invoices effectively. The system provides several status indicators to help you track the matching process.');
doc.moveDown(0.5);

addSubsection('Status Types');
addBodyText('The system uses the following status indicators:');
doc.moveDown(0.5);

addFeatureBox('Fully Reconciled', 'All invoices in the statement have been successfully matched with Xero, and the amounts match within acceptable tolerance.');
doc.moveDown(0.3);

addFeatureBox('Partially Reconciled', 'Some invoices have been matched with Xero, but there are discrepancies in amounts or some invoices remain unmatched.');
doc.moveDown(0.3);

addFeatureBox('Unreconciled', 'No invoices have been matched with Xero, or the statement processing failed.');
doc.moveDown(0.3);

addFeatureBox('Processing', 'The statement is currently being processed by the system.');
doc.moveDown(0.5);

addSubsection('Understanding Reconciliation');
addBodyText('Reconciliation occurs when the system:');
addBulletPoint('Extracts invoice data from uploaded files');
addBulletPoint('Searches for matching invoices in your Xero system');
addBulletPoint('Compares invoice numbers, dates, and amounts');
addBulletPoint('Identifies matches and discrepancies');
addBulletPoint('Calculates reconciliation statistics');
doc.moveDown(0.5);

addSubsection('Amount Matching');
addBodyText('The system considers amounts to match when:');
addBulletPoint('The difference between supplier amount and Xero amount is less than $0.01');
addBulletPoint('Both amounts are present and valid');
addBulletPoint('The invoice was found in Xero');
doc.moveDown(0.5);

addSubsection('What to Do with Unreconciled Items');
addBodyText('If you see unreconciled invoices:');
addBulletPoint('Review the invoice details in the Single Statement view');
addBulletPoint('Check if the invoice exists in Xero with a different reference number');
addBulletPoint('Verify that dates and amounts are correct');
addBulletPoint('Contact your administrator if you believe there\'s a system error');

// ========== 6. NAVIGATION TIPS ==========
doc.addPage();
addSectionHeader('6. Navigation Tips', false);

addBodyText('Efficient navigation is key to using Steve AI effectively. Here are some tips to help you move through the system quickly.');
doc.moveDown(0.5);

addSubsection('Main Navigation Menu');
addBodyText('The top navigation bar provides quick access to all main features:');
addBulletPoint('Suppliers: View and manage all suppliers');
addBulletPoint('All Statements: View all statements across suppliers');
addBulletPoint('All Invoices: View all invoices across suppliers');
addBulletPoint('Activity: View system activity log');
addBulletPoint('Logout: Sign out of the system');
doc.moveDown(0.5);

addSubsection('Breadcrumb Navigation');
addBodyText('Use the back buttons to navigate:');
addBulletPoint('Click "Back to Suppliers" to return to the main suppliers list');
addBulletPoint('Click "Back to All Statements" to return to the statements overview');
addBulletPoint('Use your browser\'s back button as an alternative');
doc.moveDown(0.5);

addSubsection('Search and Filter');
addBodyText('Make use of search and sorting features:');
addBulletPoint('Use the search bar on the Suppliers page to find specific suppliers');
addBulletPoint('Click column headers to sort tables in ascending or descending order');
addBulletPoint('Use pagination controls to navigate through large datasets');
doc.moveDown(0.5);

addSubsection('Quick Actions');
addBodyText('Speed up your workflow:');
addBulletPoint('Click directly on table rows to view details');
addBulletPoint('Use the download links to retrieve original files');
addBulletPoint('Switch between tabs in Supplier Details for different views');
addBulletPoint('Sort columns to find specific items quickly');

// ========== 7. TROUBLESHOOTING ==========
doc.addPage();
addSectionHeader('7. Troubleshooting', false);

addBodyText('This section addresses common issues you might encounter while using Steve AI.');
doc.moveDown(0.5);

addSubsection('Login Issues');
addBodyText('If you cannot log in:');
addBulletPoint('Verify that your email and password are correct');
addBulletPoint('Check that your Caps Lock is not enabled');
addBulletPoint('Ensure you have an active internet connection');
addBulletPoint('Contact your administrator if you\'ve forgotten your password');
doc.moveDown(0.5);

addSubsection('File Upload Problems');
addBodyText('If file upload fails:');
addBulletPoint('Verify the file is in PDF or Excel format');
addBulletPoint('Check that the file is not corrupted');
addBulletPoint('Ensure the file size is reasonable (very large files may take longer)');
addBulletPoint('Try uploading the file again');
addBulletPoint('Contact support if the problem persists');
doc.moveDown(0.5);

addSubsection('Missing Data');
addBodyText('If you don\'t see expected data:');
addBulletPoint('Check that files have been successfully uploaded');
addBulletPoint('Verify that processing has completed (check the Activity Log)');
addBulletPoint('Use the search function to find specific items');
addBulletPoint('Check different pages using pagination');
addBulletPoint('Refresh the page to see the latest data');
doc.moveDown(0.5);

addSubsection('Reconciliation Issues');
addBodyText('If invoices are not matching:');
addBulletPoint('Verify that your Xero account is properly connected');
addBulletPoint('Check that invoice numbers match between supplier and Xero');
addBulletPoint('Review dates to ensure they\'re within the expected range');
addBulletPoint('Check amounts for discrepancies');
addBulletPoint('Contact your administrator if matching should occur but doesn\'t');
doc.moveDown(0.5);

addSubsection('Performance Issues');
addBodyText('If the system is slow:');
addBulletPoint('Check your internet connection speed');
addBulletPoint('Try refreshing the page');
addBulletPoint('Clear your browser cache if problems persist');
addBulletPoint('Contact support if performance issues continue');
doc.moveDown(0.5);

addSubsection('Getting Help');
addBodyText('If you need additional assistance:');
addBulletPoint('Review this user manual for detailed feature information');
addBulletPoint('Check the Activity Log for processing status');
addBulletPoint('Contact your system administrator');
addBulletPoint('Report bugs or issues to your IT support team');

// ========== APPENDIX ==========
doc.addPage();
addSectionHeader('Appendix: Quick Reference', false);

addSubsection('Keyboard Shortcuts');
addBodyText('While the system is primarily mouse-driven, you can use:');
addBulletPoint('Tab key to navigate between form fields');
addBulletPoint('Enter key to submit forms');
addBulletPoint('Browser back/forward buttons for navigation');
doc.moveDown(0.5);

addSubsection('Supported Browsers');
addBodyText('Steve AI works best with:');
addBulletPoint('Google Chrome (latest version)');
addBulletPoint('Mozilla Firefox (latest version)');
addBulletPoint('Microsoft Edge (latest version)');
addBulletPoint('Safari (latest version)');
doc.moveDown(0.5);

addSubsection('System Requirements');
addBodyText('To use Steve AI, you need:');
addBulletPoint('A modern web browser (see supported browsers above)');
addBulletPoint('An active internet connection');
addBulletPoint('JavaScript enabled in your browser');
addBulletPoint('Valid user credentials provided by your administrator');
doc.moveDown(0.5);

addSubsection('Contact Information');
addBodyText('For support and assistance:');
addBulletPoint('Contact your system administrator for account issues');
addBulletPoint('Reach out to your IT support team for technical problems');
addBulletPoint('Refer to this manual for feature documentation');

// ========== END PAGE ==========
doc.addPage();
doc.fontSize(24)
   .font('Helvetica-Bold')
   .fillColor('#1a1a1a')
   .text('Thank You!', 50, 300, { align: 'center' });

doc.fontSize(14)
   .font('Helvetica')
   .fillColor('#666666')
   .text('We hope this manual helps you make the most of Steve AI.', 50, 350, { align: 'center' });

doc.fontSize(12)
   .font('Helvetica')
   .fillColor('#999999')
   .text('For questions or support, please contact your administrator.', 50, 400, { align: 'center' });

// Finalize the PDF
doc.end();

console.log(`User manual generated successfully at: ${outputPath}`);


