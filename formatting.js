const { geminiCall } = require("./gemini");

async function formatWithAIToStandardJSON(text, fileName = '', previousError = null, invoiceCountInfo = null, preExtractedIds = null) {
  let errorContext = '';
  if (previousError) {
    errorContext = `

PREVIOUS ATTEMPT FAILED:
${previousError}

IMPORTANT: The previous extraction had errors. Please fix the following issues:
- Review the error message above carefully
- Ensure each invoice has a UNIQUE invoice number
- If the file contains only ONE invoice, return an array with ONE invoice object
- If the file contains multiple invoices (like a statement), each must have a different invoice number
- Do NOT create multiple invoice objects with the same invoice number

`;
  }

  let invoiceCountContext = '';
  if (invoiceCountInfo) {
    if (invoiceCountInfo.hasMultipleInvoices === true) {
      invoiceCountContext = `

INVOICE COUNT ANALYSIS:
⚠️ CRITICAL: This document has been analyzed and contains MULTIPLE invoices/transactions.
- Expected invoice count: ${invoiceCountInfo.invoiceCount || 'multiple (exact count unknown)'}
- Reason: ${invoiceCountInfo.reason || 'Statement or table with multiple rows detected'}

EXTRACTION REQUIREMENTS FOR MULTIPLE INVOICES:
- You MUST extract EACH row/entry from the statement table as a SEPARATE invoice
- Each row MUST have its OWN unique invoice number
- Look for invoice numbers in columns like "Invoice No.", "Reference", "Our Reference", "Transaction ID", "Doc Number"
- If a row doesn't have an invoice number visible, look for it in adjacent columns or the row context
- DO NOT reuse the same invoice number for multiple rows
- If you see ${invoiceCountInfo.invoiceCount || 'multiple'} rows in the table, extract ${invoiceCountInfo.invoiceCount || 'all'} separate invoice objects
- Each invoice object should correspond to ONE row in the statement table

`;
    } else if (invoiceCountInfo.hasMultipleInvoices === false) {
      invoiceCountContext = `

INVOICE COUNT ANALYSIS:
✅ This document has been analyzed and contains a SINGLE invoice.
- Expected invoice count: 1
- Reason: ${invoiceCountInfo.reason || 'Single invoice document detected'}

EXTRACTION REQUIREMENTS FOR SINGLE INVOICE:
- Extract the invoice number from the document header/title (e.g., "Invoice No. XXX")
- Return an array with EXACTLY ONE invoice object
- Do NOT create multiple invoice objects

`;
    }
  }

  const sysPrompt = `You are an expert financial document parser specializing in invoice and statement extraction. Your task is to accurately extract ALL invoice records from the provided document data.
${errorContext}${invoiceCountContext}
CRITICAL RULES:
1. Extract ONLY information that is explicitly visible in the document. Never guess, infer, or assume values.
2. If a field is missing or unclear, set it to null. Do NOT make up values.
3. You MUST extract EVERY invoice/transaction present in the document, even if some fields are incomplete.
4. Output MUST be valid JSON only - no markdown, no explanations, no code blocks.

FILE CONTEXT:
- File name: ${fileName || 'Not provided'}
- This may be a statement of account, invoice list, or transaction summary
${preExtractedIds && preExtractedIds.length > 0 ? `
⚠️ IMPORTANT - PRE-EXTRACTED INVOICE IDs FOUND:
The following potential invoice IDs were already identified in this document:
${JSON.stringify(preExtractedIds, null, 2)}

CRITICAL: You MUST include ALL of these IDs in the potentialInvoiceIds array for the relevant invoice(s).
- If this is a single invoice document, include ALL these IDs in that invoice's potentialInvoiceIds array
- If this is a statement with multiple invoices, distribute these IDs to the appropriate invoice rows based on where they appear in the document
- These IDs are known to exist in the document, so make sure they are included in your extraction
` : ''}

REQUIRED JSON STRUCTURE:
{
  "fileDate": "yyyy-mm-dd",  // Date the file/document was created/issued (extract from document header, footer, or metadata)
  "invoices": [
    {
      "invoiceDate": "dd/mm/yyyy",  // Date of the individual invoice
      "invoiceNumber": "string",     // PRIMARY Invoice/Reference/Transaction number (preserve exactly as shown) - this is the most likely one
      "potentialInvoiceIds": ["string", "string", ...],  // **CRITICAL**: Array of ALL potential invoice IDs found in this invoice row/entry. Include ALL numbers that could be the invoice ID from different columns (e.g., "Our Reference", "Invoice No.", "Reference", "Transaction ID", "Doc Number", etc.). Each invoice should have multiple potential IDs if available.
      "activityDescription": "string", // Description of goods/services/transaction
      "amount": {
        "amount": number,      // Subtotal/amount before tax (numeric, no currency symbols)
        "tax_fees": number     // Tax, VAT, or fees amount (numeric, default 0 if not present)
      },
      "currency": "string",    // Currency symbol: "$", "£", "€", "¥", etc. (extract from document)
      "paymentStatus": "paid" | "unpaid"  // Determine from payment indicators, dates, or status fields
    }
  ]
}

FIELD EXTRACTION GUIDELINES:

- invoiceDate: Look for "Date", "Invoice Date", "Transaction Date", "Due Date" columns/fields. Format as dd/mm/yyyy.
- invoiceNumber: **PRIMARY invoice number** - The most likely invoice number for this invoice. This should be the one that appears most prominently (e.g., in "Invoice No." column or header).
- potentialInvoiceIds: **CRITICAL - Extract ALL potential invoice IDs from this invoice row/entry**
  * **MANDATORY**: For EACH invoice row/entry, extract ALL numbers that could potentially be the invoice ID
  * Look in ALL columns that might contain invoice IDs: "Our Reference", "Invoice No.", "Reference", "Transaction ID", "Invoice Number", "Doc Number", "Document Number", "Ref", "Invoice Ref", etc.
  * Include ALL unique numbers/identifiers found in the row that could be invoice IDs
  * For example, if a row has:
    - Column 1: "INV-12345" (Invoice No.)
    - Column 3: "REF-67890" (Our Reference)
    - Column 5: "12345" (Doc Number)
    Then potentialInvoiceIds should be: ["INV-12345", "REF-67890", "12345"]
  * The invoiceNumber field should be set to the most likely one (usually from "Invoice No." column)
  * Preserve each ID EXACTLY as shown (leading zeros, letters, hyphens, etc.)
  * Remove duplicates - each ID should appear only once in the array
  * If only one ID is found, still put it in the array: ["INV-12345"]
  * **STATEMENT FILES**: Each row = one separate invoice with its own potentialInvoiceIds array
  * **SINGLE INVOICE FILES**: Extract all potential IDs from the document (header, footer, body)
- activityDescription: Extract from "Description", "Item", "Details", "Narrative", "Memo" fields. Include full text.
- amount.amount: Extract from "Amount", "Subtotal", "Total", "Net Amount" fields. Remove currency symbols, commas, convert to number.
- amount.tax_fees: Extract from "Tax", "VAT", "Fees", "GST" fields. Default to 0 if not present.
- currency: Identify from currency symbols ($, £, €, etc.) or currency codes (USD, GBP, EUR) in the document. Convert codes to symbols.
- paymentStatus: 
  * "paid" if you see: "Paid", "Settled", "Cleared", payment date present, or balance is zero
  * "unpaid" if you see: "Outstanding", "Pending", "Due", "Unpaid", or balance > 0
  * Default to "unpaid" if unclear
- fileDate: Extract from document header ("Statement Period", "As of", "Date Generated"), footer, or file metadata. Format as yyyy-mm-dd.

SPECIAL CASES:
- **SINGLE INVOICE DOCUMENTS**: If the file contains a single invoice (not a statement), treat the entire document as ONE invoice. Extract the invoice number from the header/title. Return an array with ONE invoice object.
- **STATEMENT DOCUMENTS**: If the file is a statement of account with a table/list of multiple invoices, each row/entry = ONE separate invoice object with its own unique invoice number
- For Excel files: Process all sheets, each row with an invoice number = separate invoice object
- For PDFs: Extract text from all pages, look for tables and structured data
- Multiple invoices per document: Create separate invoice objects, each with its own unique invoice number
- Credits/Refunds: Include as separate invoices with negative amounts if applicable, each with unique invoice number
- Partial data: Include invoice even if only invoiceNumber is available, but invoiceNumber is REQUIRED
- **CRITICAL**: NEVER create multiple invoice objects with the same invoice number. If there's only one invoice in the file, return ONE invoice object. If there are multiple invoices, each must have a unique invoice number.

OUTPUT FORMAT:
Return ONLY valid JSON matching the structure above. No markdown code blocks, no explanations, no additional text.

Example valid output:
{
  "fileDate": "2024-11-15",
  "invoices": [
    {
      "invoiceDate": "15/10/2024",
      "invoiceNumber": "INV-2024-001",
      "potentialInvoiceIds": ["INV-2024-001", "REF-001", "2024-001"],
      "activityDescription": "Professional services for Q3 2024",
      "amount": { "amount": 1500.00, "tax_fees": 300.00 },
      "currency": "$",
      "paymentStatus": "unpaid"
    },
    {
      "invoiceDate": "20/10/2024",
      "invoiceNumber": "INV-2024-002",
      "potentialInvoiceIds": ["INV-2024-002", "REF-002", "2024-002"],
      "activityDescription": "Consulting services",
      "amount": { "amount": 850.50, "tax_fees": 170.10 },
      "currency": "$",
      "paymentStatus": "paid"
    }
  ]
}`;

  const aiRes = await geminiCall(text, sysPrompt);
  return aiRes;
}


async function findMatchingCompanyWithAIFromAList(name, fileName, email, contacts) {
  const sysPrompt = `You are an expert at matching company names to contact records in accounting systems.

TASK:
Identify the SINGLE contact record that best matches the provided company name from the list of contacts.

MATCHING STRATEGY:
1. Exact matches (case-insensitive, ignoring punctuation and spacing)
2. Partial matches (company name contains or is contained in contact name)
3. Abbreviation matches (e.g., "Ltd" = "Limited", "Inc" = "Incorporated")
4. Common variations (punctuation, spacing, capitalization differences)
5. Phonetically similar names
6. Acronym matches (if company name is an acronym of contact name or vice versa)

CONTEXT INFORMATION:
- Company name to match: "${name}"
- File name: "${fileName}"
- Email (if available): "${email}"

CONTACT RECORDS:
${JSON.stringify(contacts, null, 2)}

MATCHING RULES:
- Prioritize contacts with balance information (Balances field present)
- If multiple matches exist, choose the one with the most complete data
- Consider the file name as additional context (may contain company name variations)
- Return the ContactID (GUID) of the best match

OUTPUT REQUIREMENTS:
- Return ONLY valid JSON in this exact format:
{ "id": "CONTACT_ID_GUID" }
- The id must be a valid GUID/UUID format
- No explanations, no markdown, no additional text
- If no reasonable match exists, return the closest match anyway

Example output:
{ "id": "12345678-1234-1234-1234-123456789abc" }`;

  const aiResponse = await geminiCall(name, sysPrompt);
  return aiResponse;
}


async function findMatchingCompanyWithAI(email, fileName, content) {
  const systemPrompt = `You are an expert at identifying company/supplier names from financial documents and file metadata.

TASK:
Extract the supplier's or company's name from the provided information. This is the entity that issued the invoice or statement.

INFORMATION PROVIDED:
- Email (sender/recipient): ${email || 'Not provided'}
- File name: ${fileName || 'Not provided'}
- File content (first 2000 characters): ${content ? content.substring(0, 2000) : 'Not provided'}

EXTRACTION GUIDELINES:
1. Look for company names in:
   - Document headers/footers ("From:", "Issued by:", "Company Name")
   - Letterhead or branding
   - File name (often contains company name)
   - Email domain or sender name
   - "Supplier:", "Vendor:", "From Company:" fields
   - Statement headers

2. EXCLUDE these common patterns:
   - "Insperanto LTD" or "Insperanto Limited" (this is typically the receiving company)
   - Generic terms like "Statement", "Invoice", "Account"
   - Date ranges or periods
   - File extensions or metadata

3. PREFERRED FORMAT:
   - Full legal company name if available
   - Include business suffixes (Ltd, LLC, Inc, etc.) if present
   - Preserve capitalization as it appears in the document
   - Remove extra whitespace

4. VALIDATION:
   - Must be a recognizable company/business name
   - Should not be a generic term or document type
   - Should not be the receiving company (Insperanto)

OUTPUT:
- Return ONLY the company name as a plain string
- No explanations, no quotes, no additional text
- If uncertain, return the most likely company name based on the evidence
- If no company name can be identified, return an empty string

Example outputs:
"Adams & Associates Ltd"
"Stolmar Trading Company"
"Takoa Industries"`;

  const aiResponse = await geminiCall('', systemPrompt);
  return aiResponse?.trim();
}



async function checkMultipleInvoiceNumbers(text, fileName = '') {
  const sysPrompt = `You are an expert financial document analyzer. Your task is to determine if a document contains ONE invoice or MULTIPLE invoices.

TASK:
Analyze the provided document content and determine:
1. Does this document contain a SINGLE invoice (one invoice number)?
2. Or does it contain MULTIPLE invoices/transactions (multiple invoice numbers)?

FILE CONTEXT:
- File name: ${fileName || 'Not provided'}
- This may be a single invoice, a statement of account, an invoice list, or a transaction summary

ANALYSIS GUIDELINES:

SINGLE INVOICE INDICATORS:
- Document has ONE invoice number in the header/title (e.g., "Invoice No. AAA-S-16129")
- Document is structured as a single invoice with one set of line items
- No table or list of multiple transactions
- Single total amount, single invoice date
- Document title contains "Invoice" (singular)

MULTIPLE INVOICES INDICATORS:
- Document is a "Statement of Account" or "Account Statement"
- Contains a TABLE with multiple rows, each row representing a different invoice/transaction
- Multiple invoice numbers visible (e.g., in different rows or entries)
- Multiple transaction dates
- Document title contains "Statement", "Summary", "List", or similar plural terms
- Multiple line items with different invoice/reference numbers

OUTPUT REQUIREMENTS:
Return ONLY valid JSON in this exact format:
{
  "hasMultipleInvoices": true | false,
  "invoiceCount": number | null,
  "reason": "brief explanation"
}

- hasMultipleInvoices: true if document contains multiple invoices/transactions, false if it's a single invoice
- invoiceCount: The number of invoices/transactions found (null if cannot determine)
- reason: Brief explanation of why you determined single vs multiple (e.g., "Single invoice with one invoice number in header" or "Statement table with 8 rows, each with different invoice numbers")

Example outputs:
{
  "hasMultipleInvoices": false,
  "invoiceCount": 1,
  "reason": "Single invoice document with one invoice number in header"
}

{
  "hasMultipleInvoices": true,
  "invoiceCount": 8,
  "reason": "Statement of account with table containing 8 rows, each row has a different invoice number"
}

{
  "hasMultipleInvoices": true,
  "invoiceCount": null,
  "reason": "Statement table visible but exact count unclear from content preview"
}`;

  const aiRes = await geminiCall(text, sysPrompt);
  
  // Parse the response
  try {
    let cleaned = aiRes.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(cleaned);
  } catch (parseError) {
    console.error('Failed to parse invoice count check response:', parseError);
    // Return default response
    return {
      hasMultipleInvoices: null,
      invoiceCount: null,
      reason: 'Failed to parse AI response'
    };
  }
}

async function extractPotentialInvoiceIds(text, fileName = '') {
  // Determine if this is Excel (JSON) or PDF (text) format
  const isExcelFormat = typeof text === 'string' && (text.trim().startsWith('[') || text.trim().startsWith('{'));
  const isJSON = isExcelFormat || (text.trim().startsWith('[') || text.trim().startsWith('{'));
  
  const sysPrompt = `You are an expert at extracting potential invoice/reference numbers from financial documents. Your task is to find EVERY possible identifier that could be an invoice ID.

CRITICAL TASK:
Extract ALL potential invoice/reference numbers from the document. Be thorough - it's better to include too many than to miss any.

FILE TYPE:
${isJSON ? 'This appears to be an Excel/structured data file (JSON format). Look in ALL columns/fields.' : 'This appears to be a PDF/text document. Look in headers, tables, and throughout the document.'}

WHAT TO LOOK FOR - CHECK ALL OF THESE:

1. COLUMN/FIELD NAMES (for Excel/structured data):
   - "Invoice No.", "Invoice Number", "Invoice #", "InvoiceNo", "InvoiceNum"
   - "Our Reference", "Your Reference", "Reference", "Ref", "Ref No", "RefNo"
   - "Transaction ID", "Transaction Number", "Trans ID", "TransNo"
   - "Doc Number", "Document Number", "Document #", "DocNo", "DocNum"
   - "Invoice Ref", "Reference Number", "Ref Number"
   - "Voucher No", "Voucher Number", "Voucher #"
   - "Statement Ref", "Statement Reference"
   - "Bill Number", "Bill No", "Bill #"
   - Any column header containing: "ID", "Number", "No", "Ref", "Reference", "Invoice", "Doc", "Transaction"

2. FOR PDF/TEXT DOCUMENTS:
   - Look for patterns like: "Invoice No: XXX", "Ref: XXX", "Invoice Number: XXX"
   - Check headers and footers
   - Look in table cells that might contain invoice numbers
   - Find any alphanumeric codes that appear near invoice-related text

3. COMMON PATTERNS TO EXTRACT:
   - Alphanumeric codes: "INV-12345", "REF-2024-001", "DOC-789"
   - Numeric codes: "12345", "001234", "2024001"
   - Codes with prefixes: "INV123", "REF456", "DOC789"
   - Codes with suffixes: "123INV", "456REF"
   - Date-based codes: "2024-001", "24-123", "20240123"
   - Mixed formats: "AAA-S-16129", "ABC-2024-001"

EXTRACTION RULES:
1. Extract EVERY unique value that could be an invoice ID
2. Preserve EXACTLY as shown: keep leading zeros, hyphens, letters, case (e.g., "INV-001" not "inv-1")
3. For Excel/structured data: Check EVERY row, extract IDs from relevant columns
4. For PDF/text: Scan the entire document, look in tables and headers
5. Remove duplicates (same value appears multiple times)
6. Include variations - if you see "INV-123" and "123", include BOTH
7. Don't filter out IDs that seem "wrong" - include everything that could be an invoice ID

WHAT TO EXCLUDE:
- Dates (unless they're clearly part of an invoice number like "2024-001")
- Amounts/currency values
- Phone numbers
- Email addresses
- Generic sequential numbers that are clearly row numbers (1, 2, 3...)
- Page numbers

OUTPUT FORMAT:
Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "potentialIds": ["ID1", "ID2", "ID3", ...]
}

- potentialIds: Array of ALL unique invoice IDs found
- Each ID should be a string, preserved exactly as found
- Remove duplicates (same ID appearing multiple times)
- If no IDs found, return: {"potentialIds": []}

EXAMPLES OF GOOD EXTRACTIONS:

Example 1 (Excel with multiple columns):
If you see:
  Invoice No: "INV-2024-001"
  Our Ref: "REF-001"
  Doc Number: "2024-001"
Extract: ["INV-2024-001", "REF-001", "2024-001"]

Example 2 (PDF with text):
If you see: "Invoice Number: AAA-S-16129" and "Reference: 16129"
Extract: ["AAA-S-16129", "16129"]

Example 3 (Statement with multiple rows):
If each row has different invoice numbers, extract ALL of them:
Extract: ["INV-001", "INV-002", "INV-003", "REF-001", "REF-002", "REF-003"]

Example 4 (Single invoice):
If document has: "Invoice No. 12345" in header and "Ref: 12345" in footer
Extract: ["12345"] (or both if they're different)

REMEMBER:
- Be THOROUGH - extract everything that could be an invoice ID
- Preserve EXACT format (case, hyphens, leading zeros)
- Include ALL variations found
- Better to have too many IDs than to miss the correct one`;

  const aiRes = await geminiCall(text, sysPrompt);
  
  // Parse the response
  try {
    let cleaned = aiRes.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Validate and clean the IDs
      if (parsed.potentialIds && Array.isArray(parsed.potentialIds)) {
        // Remove null, undefined, empty strings, and normalize
        parsed.potentialIds = parsed.potentialIds
          .filter(id => id != null && String(id).trim().length > 0)
          .map(id => String(id).trim())
          .filter((id, index, self) => self.indexOf(id) === index); // Remove duplicates
      } else {
        parsed.potentialIds = [];
      }
      return parsed;
    }
    const parsed = JSON.parse(cleaned);
    // Validate and clean
    if (parsed.potentialIds && Array.isArray(parsed.potentialIds)) {
      parsed.potentialIds = parsed.potentialIds
        .filter(id => id != null && String(id).trim().length > 0)
        .map(id => String(id).trim())
        .filter((id, index, self) => self.indexOf(id) === index);
    } else {
      parsed.potentialIds = [];
    }
    return parsed;
  } catch (parseError) {
    console.error('Failed to parse potential invoice IDs response:', parseError);
    console.error('Raw AI response:', aiRes);
    return {
      potentialIds: []
    };
  }
}

async function guessBestInvoiceIdFormat(potentialIds, xeroInvoiceNumbers, fileName = '') {
  const sysPrompt = `You are an expert at determining which invoice ID format to use when matching invoices.

TASK:
Given a list of potential invoice IDs extracted from a document and a list of invoice numbers from Xero, determine which ID format/pattern should be used for matching.

POTENTIAL INVOICE IDs FROM DOCUMENT:
${JSON.stringify(potentialIds, null, 2)}

XERO INVOICE NUMBERS:
${JSON.stringify(xeroInvoiceNumbers.slice(0, 20), null, 2)}${xeroInvoiceNumbers.length > 20 ? `\n(Showing first 20 of ${xeroInvoiceNumbers.length} total)` : ''}

ANALYSIS:
1. Compare the potential IDs with Xero invoice numbers
2. Identify which format/pattern matches best
3. Consider:
   - Exact matches
   - Partial matches (e.g., digits-only matches)
   - Format patterns (e.g., "INV-123" vs "123")
   - Common transformations (removing prefixes, normalizing)

OUTPUT REQUIREMENTS:
Return ONLY valid JSON in this exact format:
{
  "selectedFormat": "pattern_description",
  "exampleId": "example_id_value",
  "confidence": 0.0-1.0,
  "reason": "explanation"
}

- selectedFormat: Description of the format pattern to use (e.g., "digits_only", "with_prefix_INV", "exact_as_shown")
- exampleId: An example ID from potentialIds that matches this format
- confidence: Confidence level (0.0 to 1.0)
- reason: Brief explanation

If no good match found, suggest the most common format from potentialIds.

Example output:
{
  "selectedFormat": "digits_only",
  "exampleId": "12345",
  "confidence": 0.9,
  "reason": "Xero invoice numbers match when only digits are extracted from potential IDs"
}`;

  const aiRes = await geminiCall('', sysPrompt);
  
  // Parse the response
  try {
    let cleaned = aiRes.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(cleaned);
  } catch (parseError) {
    console.error('Failed to parse ID format guess response:', parseError);
    return {
      selectedFormat: 'exact_as_shown',
      exampleId: potentialIds[0] || '',
      confidence: 0.5,
      reason: 'Failed to parse AI response, using first potential ID'
    };
  }
}

module.exports = { formatWithAIToStandardJSON, findMatchingCompanyWithAIFromAList, findMatchingCompanyWithAI, checkMultipleInvoiceNumbers, extractPotentialInvoiceIds, guessBestInvoiceIdFormat };
