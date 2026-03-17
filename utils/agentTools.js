const { DynamicStructuredTool } = require("@langchain/core/tools");
const { z } = require("zod");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

// Load models
const Vendor = require("../modals/vendorModal");
const SupplierInvoice = require("../modals/supplierInvoiceModal");
const Statements = require("../modals/statementsModal");
const XeroTenants = require("../modals/xeroTenantsModal");

// Aliases for compatibility
const Suppliers = Vendor;
const Invoices = SupplierInvoice;

// Escape special regex characters to prevent ReDoS and regex injection
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Load tool configuration
const toolsConfigPath = path.join(__dirname, "../config/agentTools.json");
const toolsConfig = JSON.parse(fs.readFileSync(toolsConfigPath, "utf8"));

// Context store for current request (set before tool invocation)
let currentRequestContext = null;

/**
 * Set the current request context for tools to access
 */
function setRequestContext(context) {
  currentRequestContext = context;
}

/**
 * Clear the current request context
 */
function clearRequestContext() {
  currentRequestContext = null;
}

/**
 * Convert JSON schema to Zod schema
 */
function createZodSchemaFromJSON(jsonSchema) {
  const shape = {};
  
  for (const [key, prop] of Object.entries(jsonSchema.properties || {})) {
    let zodType;
    
    if (prop.type === "string") {
      zodType = z.string();
      if (prop.enum) {
        zodType = z.enum(prop.enum);
      }
    } else if (prop.type === "number") {
      zodType = z.number();
    } else if (prop.type === "boolean") {
      zodType = z.boolean();
    } else {
      zodType = z.any();
    }
    
    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }
    
    // Check if field is required
    const isRequired = jsonSchema.required && jsonSchema.required.includes(key);
    if (!isRequired) {
      zodType = zodType.optional();
    }
    
    shape[key] = zodType;
  }
  
  return z.object(shape);
}

/**
 * Tool function implementations
 */
const toolImplementations = {
  text_formatter: async ({ text }) => {
    return text.toUpperCase();
  },

  get_invoices: async ({ invoiceId, supplierId, logId, invoiceNumber, paymentStatus, page = 1, limit = 10 }) => {
    try {
      if (invoiceId) {
        const invoice = await Invoices.findById(invoiceId)
          .populate('supplier', 'name')
          .populate('log', 'status file')
          .select('invoiceNumber invoiceDate amount amountXero currency paymentStatus supplier log')
          .lean();

        if (!invoice) {
          return JSON.stringify({ success: false, message: "Not found" });
        }
        return JSON.stringify({ success: true, invoice });
      }

      const query = { isDeleted: { $ne: true } };
      if (supplierId) query.supplier = supplierId;
      if (logId) query.log = logId;
      if (invoiceNumber) query.invoiceNumber = { $regex: escapeRegex(invoiceNumber), $options: 'i' };
      if (paymentStatus) query.paymentStatus = paymentStatus;

      const skip = (page - 1) * Math.min(limit, 20);
      const invoices = await Invoices.find(query)
        .populate('supplier', 'name')
        .populate('log', 'status file')
        .select('invoiceNumber invoiceDate amount amountXero currency paymentStatus supplier log')
        .sort({ addedAt: -1 })
        .skip(skip)
        .limit(Math.min(limit, 20))
        .lean();

      const total = await Invoices.countDocuments(query);

      return JSON.stringify({
        success: true,
        invoices,
        total,
        page
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },

  get_suppliers: async ({ supplierId, search, page = 1, limit = 10 }) => {
    try {
      if (supplierId) {
        const supplier = await Suppliers.findById(supplierId).select('name xeroId').lean();
        if (!supplier) {
          return JSON.stringify({ success: false, message: "Not found" });
        }
        
        // Get missed invoice count for this supplier
        // Missed invoices: have xeroDate but no VendorDate and no vendorAmount (found in Xero but not from supplier statement)
        const missedInvoiceCount = await Invoices.countDocuments({
          vendorId: supplierId,
          isDeleted: { $ne: true },
          xeroDate: { $ne: null },
          VendorDate: null,
          vendorAmount: null
        });
        
        const supplierWithCount = {
          ...supplier,
          missedInvoiceCount: missedInvoiceCount,
          dataSource: "Database"
        };
        
        return JSON.stringify({ 
          success: true, 
          supplier: supplierWithCount,
          dataSource: "Database"
        });
      }

      const query = {};
      if (search) query.name = { $regex: escapeRegex(search), $options: 'i' };

      const skip = (page - 1) * Math.min(limit, 20);
      const suppliers = await Suppliers.find(query)
        .select('name xeroId')
        .sort({ name: 1 })
        .skip(skip)
        .limit(Math.min(limit, 20))
        .lean();

      const total = await Suppliers.countDocuments(query);

      // Get missed invoice counts for all suppliers
      const supplierIds = suppliers.map(s => s._id);
      const missedInvoiceCounts = await Invoices.aggregate([
        {
          $match: {
            vendorId: { $in: supplierIds },
            isDeleted: { $ne: true },
            xeroDate: { $ne: null },
            VendorDate: null,
            vendorAmount: null
          }
        },
        {
          $group: {
            _id: "$vendorId",
            count: { $sum: 1 }
          }
        }
      ]);

      // Create a map of supplier ID to missed invoice count
      const missedCountMap = {};
      missedInvoiceCounts.forEach(item => {
        missedCountMap[item._id.toString()] = item.count;
      });

      // Add missed invoice count and data source to each supplier
      const suppliersWithCounts = suppliers.map(supplier => ({
        ...supplier,
        missedInvoiceCount: missedCountMap[supplier._id.toString()] || 0,
        dataSource: "Database"
      }));

      return JSON.stringify({
        success: true,
        suppliers: suppliersWithCounts,
        total,
        page,
        dataSource: "Database"
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },

  get_logs: async ({ logId, supplierId, status, page = 1, limit = 10 }) => {
    try {
      if (logId) {
        const log = await Statements.findById(logId)
          .populate('supplier', 'name')
          .select('status supplier file invoiceIssueDate total matched unmatched addedAt')
          .lean();

        if (!log) {
          return JSON.stringify({ success: false, message: "Not found" });
        }
        return JSON.stringify({ success: true, log });
      }

      const query = {
        isDeleted: { $ne: true }
      };
      if (supplierId) query.supplier = supplierId;
      if (status) query.status = status;

      const skip = (page - 1) * Math.min(limit, 20);
      const logs = await Statements.find(query)
        .populate('supplier', 'name')
        .select('status supplier file invoiceIssueDate total matched unmatched addedAt')
        .sort({ addedAt: -1 })
        .skip(skip)
        .limit(Math.min(limit, 20))
        .lean();

      const total = await Statements.countDocuments(query);

      return JSON.stringify({
        success: true,
        logs,
        total,
        page
      });
    } catch (error) {
      return JSON.stringify({ success: false, error: error.message });
    }
  },

  detect_upload_intent: async ({ documentType }) => {
    // Return a special JSON structure that the frontend can detect
    return JSON.stringify({
      action: "show_upload_widget",
      documentType: documentType || "documents",
      message: `I'll help you upload ${documentType || "your documents"}. Please select the files you'd like to upload.`
    });
  },

  get_supplier_details: async ({ supplierId, supplierName }) => {
    const statusMessages = [];
    const result = {
      success: false,
      statusMessages: [],
      supplier: null,
      xeroContact: null,
      error: null
    };

    try {
      // Step 1: Search database
      statusMessages.push("🔍 Searching **Database** for supplier...");
      let supplier = null;

      if (supplierId) {
        supplier = await Suppliers.findById(supplierId).lean();
      } else if (supplierName) {
        // Clean and normalize the supplier name for better matching
        const cleanName = supplierName.trim();
        
        // Try exact match first (case-insensitive)
        let suppliers = await Suppliers.find({
          name: { $regex: `^${cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
        }).limit(5).lean();
        
        // If no exact match, try partial match
        if (suppliers.length === 0) {
          suppliers = await Suppliers.find({
            name: { $regex: cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
          }).limit(10).lean();
        }
        
        if (suppliers.length === 0) {
          return JSON.stringify({
            success: false,
            statusMessages: [`❌ No supplier found in database matching "${supplierName}". Please check the spelling or try a different search term.`],
            error: "Supplier not found in database"
          });
        } else if (suppliers.length === 1) {
          supplier = suppliers[0];
        } else {
          // Multiple matches - return list for user to choose
          const matchList = suppliers.map(s => `- ${s.name} (ID: ${s._id.toString()})`).join('\n');
          return JSON.stringify({
            success: false,
            statusMessages: [`Found ${suppliers.length} suppliers matching "${supplierName}":\n${matchList}\n\nPlease specify which supplier you want details for.`],
            matches: suppliers.map(s => ({ id: s._id.toString(), name: s.name })),
            error: "Multiple matches found"
          });
        }
      } else if (currentRequestContext?.supplierId) {
        // Use context from current page
        supplier = await Suppliers.findById(currentRequestContext.supplierId).lean();
      } else {
        return JSON.stringify({
          success: false,
          statusMessages: ["❌ No supplier specified. Please provide supplierId or supplierName, or navigate to a supplier page."],
          error: "No supplier specified"
        });
      }

      if (!supplier) {
        return JSON.stringify({
          success: false,
          statusMessages: ["❌ Supplier not found in database."],
          error: "Supplier not found"
        });
      }

      statusMessages.push(`✅ Found supplier in **Database**: ${supplier.name}`);
      
      // Get missed invoice count for this supplier
      // Missed invoices: have xeroDate but no VendorDate and no vendorAmount (found in Xero but not from supplier statement)
      const missedInvoiceCount = await Invoices.countDocuments({
        vendorId: supplier._id,
        isDeleted: { $ne: true },
        xeroDate: { $ne: null },
        VendorDate: null,
        vendorAmount: null
      });
      
      result.supplier = {
        id: supplier._id.toString(),
        name: supplier.name,
        email: supplier.email || null,
        xeroId: supplier.xeroId || null,
        missedInvoiceCount: missedInvoiceCount,
        dataSource: "Database"
      };
      
      if (missedInvoiceCount > 0) {
        statusMessages.push(`📊 **Database**: This supplier has ${missedInvoiceCount} missed invoice(s) (found in Xero but not in supplier statements)`);
      } else {
        statusMessages.push(`📊 **Database**: No missed invoices for this supplier`);
      }

      // Step 2: Fetch from Xero
      if (!currentRequestContext?.xeroAccessToken || !currentRequestContext?.xeroTenantId) {
        statusMessages.push("⚠️ **Xero** credentials not available. Skipping **Xero** contact fetch.");
        result.statusMessages = statusMessages;
        result.success = true;
        return JSON.stringify(result);
      }

      const accessToken = currentRequestContext.xeroAccessToken;
      const tenantId = currentRequestContext.xeroTenantId;

      statusMessages.push("🔍 Fetching contact details from **Xero**...");

      let xeroContact = null;

      // Try to fetch by xeroId first
      if (supplier.xeroId) {
        try {
          const contactUrl = `https://api.xero.com/api.xro/2.0/Contacts/${supplier.xeroId}`;
          const contactResponse = await axios.get(contactUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Xero-tenant-id': tenantId,
              Accept: 'application/json',
            },
            timeout: 10000
          });

          if (contactResponse.data?.Contacts && contactResponse.data.Contacts.length > 0) {
            xeroContact = contactResponse.data.Contacts[0];
            statusMessages.push(`✅ Found contact in **Xero** using Xero ID: ${supplier.xeroId}`);
          }
        } catch (error) {
          if (error.response?.status !== 404) {
            statusMessages.push(`⚠️ Error fetching contact by Xero ID: ${error.message}`);
          }
        }
      }

      // If not found by xeroId, search by name
      if (!xeroContact && supplier.name) {
        try {
          const searchTerm = encodeURIComponent(supplier.name);
          const searchUrl = `https://api.xero.com/api.xro/2.0/Contacts?where=Name.Contains("${searchTerm}")`;
          const searchResponse = await axios.get(searchUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Xero-tenant-id': tenantId,
              Accept: 'application/json',
            },
            timeout: 10000
          });

          const contacts = searchResponse.data?.Contacts || [];
          if (contacts.length > 0) {
            // Find best match (exact or closest)
            const exactMatch = contacts.find(c => c.Name.toLowerCase() === supplier.name.toLowerCase());
            xeroContact = exactMatch || contacts[0];
            statusMessages.push(`✅ Found contact in **Xero** by name search: ${xeroContact.Name}`);
          } else {
            statusMessages.push("⚠️ No matching contact found in **Xero**.");
          }
        } catch (error) {
          statusMessages.push(`⚠️ Error searching Xero contacts: ${error.message}`);
        }
      }

      // Format Xero contact data
      if (xeroContact) {
        // Extract balance information - suppliers use AccountsPayable, customers use AccountsReceivable
        const balances = xeroContact.Balances || {};
        const isSupplier = xeroContact.IsSupplier || false;
        
        // For suppliers: AccountsPayable (money we owe them)
        // For customers: AccountsReceivable (money they owe us)
        let accountBalance = null;
        let totalOwed = null;
        let balanceType = null;
        
        if (isSupplier && balances.AccountsPayable) {
          accountBalance = balances.AccountsPayable.Outstanding || null;
          totalOwed = balances.AccountsPayable.Overdue || null;
          balanceType = 'AccountsPayable'; // Money we owe to supplier
        } else if (!isSupplier && balances.AccountsReceivable) {
          accountBalance = balances.AccountsReceivable.Outstanding || null;
          totalOwed = balances.AccountsReceivable.Overdue || null;
          balanceType = 'AccountsReceivable'; // Money customer owes us
        }
        
        // If no balance found in expected location, try both
        if (accountBalance === null) {
          if (balances.AccountsPayable?.Outstanding !== undefined) {
            accountBalance = balances.AccountsPayable.Outstanding;
            totalOwed = balances.AccountsPayable.Overdue || null;
            balanceType = 'AccountsPayable';
          } else if (balances.AccountsReceivable?.Outstanding !== undefined) {
            accountBalance = balances.AccountsReceivable.Outstanding;
            totalOwed = balances.AccountsReceivable.Overdue || null;
            balanceType = 'AccountsReceivable';
          }
        }
        
        result.xeroContact = {
          contactId: xeroContact.ContactID,
          name: xeroContact.Name,
          email: xeroContact.EmailAddress || null,
          phone: xeroContact.Phones?.[0]?.PhoneNumber || null,
          address: xeroContact.Addresses?.[0] ? {
            addressLine1: xeroContact.Addresses[0].AddressLine1 || null,
            addressLine2: xeroContact.Addresses[0].AddressLine2 || null,
            city: xeroContact.Addresses[0].City || null,
            region: xeroContact.Addresses[0].Region || null,
            postalCode: xeroContact.Addresses[0].PostalCode || null,
            country: xeroContact.Addresses[0].Country || null
          } : null,
          contactStatus: xeroContact.ContactStatus || null,
          isSupplier: isSupplier,
          isCustomer: xeroContact.IsCustomer || false,
          accountBalance: accountBalance,
          totalOwed: totalOwed,
          balanceType: balanceType,
          dataSource: "Xero",
          // Include full balances object for debugging
          balances: balances
        };
        
        // Add balance information to status messages for better visibility
        if (accountBalance !== null) {
          const balanceLabel = isSupplier ? 'Outstanding (Amount Owed to Supplier)' : 'Outstanding (Amount Owed by Customer)';
          statusMessages.push(`💰 **Xero** Balance: ${accountBalance.toFixed(2)} (${balanceLabel})`);
          if (totalOwed !== null && totalOwed > 0) {
            statusMessages.push(`⚠️ **Xero** Overdue Amount: ${totalOwed.toFixed(2)}`);
          }
        } else {
          statusMessages.push("ℹ️ Balance information not available in **Xero** for this contact.");
        }
      }
      result.statusMessages = statusMessages;
      result.success = true;
      return JSON.stringify(result);

    } catch (error) {
      statusMessages.push(`❌ Error: ${error.message}`);
      result.statusMessages = statusMessages;
      result.error = error.message;
      return JSON.stringify(result);
    }
  },

  get_xero_invoice: async ({ invoiceNumber, reference }) => {
    const statusMessages = [];
    const result = {
      success: false,
      statusMessages: [],
      invoices: [],
      error: null
    };

    try {
      // Check if Xero credentials are available
      if (!currentRequestContext?.xeroAccessToken || !currentRequestContext?.xeroTenantId) {
        return JSON.stringify({
          success: false,
          statusMessages: ["⚠️ Xero credentials not available. Please ensure you're logged in to Xero."],
          error: "Xero authentication required"
        });
      }

      const accessToken = currentRequestContext.xeroAccessToken;
      const tenantId = currentRequestContext.xeroTenantId;

      // Use invoiceNumber or reference (whichever is provided)
      const searchTerm = invoiceNumber || reference;
      if (!searchTerm) {
        return JSON.stringify({
          success: false,
          statusMessages: ["❌ Please provide either invoiceNumber or reference to search for."],
          error: "Missing search parameter"
        });
      }

      statusMessages.push(`🔍 Searching Xero for invoice with number/reference: "${searchTerm}"`);

      // Helper function to handle rate limiting with Retry-After header
      const makeRequestWithRetry = async (url, config, maxRetries = 3) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const response = await axios.get(url, config);
            return response;
          } catch (error) {
            // Check if it's a 429 rate limit error
            if (error.response?.status === 429) {
              const retryAfter = error.response.headers['retry-after'] || error.response.headers['Retry-After'];
              const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
              console.log(`Rate limit hit (429). Waiting ${waitSeconds} seconds before retry ${attempt + 1}/${maxRetries}...`);
              await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
              continue;
            }
            throw error;
          }
        }
        throw new Error(`Request failed after ${maxRetries} retries`);
      };

      // Fuzzy matching helper functions (same as in InvoiceController.js)
      function normalizeInvoiceNumber(invoiceNumber) {
        if (!invoiceNumber) return '';
        return invoiceNumber.toString().replace(/\D/g, '');
      }

      function getInvoiceNumberVariations(invoiceNumber) {
        if (!invoiceNumber) return new Set();
        const variations = new Set();
        const normalized = invoiceNumber.toString().trim();

        // Original
        variations.add(normalized);
        // Lowercase
        variations.add(normalized.toLowerCase());
        // Uppercase
        variations.add(normalized.toUpperCase());
        // Digits only
        const digitsOnly = normalizeInvoiceNumber(normalized);
        if (digitsOnly) {
          variations.add(digitsOnly);
        }
        // Remove common prefixes/suffixes
        const withoutPrefix = normalized.replace(/^(INV|INVOICE|REF|REFERENCE|DOC|DOCUMENT|#|NO|NUMBER)[\s\-_]*/i, '');
        if (withoutPrefix !== normalized) {
          variations.add(withoutPrefix);
          variations.add(normalizeInvoiceNumber(withoutPrefix));
        }
        // Remove common suffixes
        const withoutSuffix = normalized.replace(/[\s\-_]*(INV|INVOICE|REF|REFERENCE|DOC|DOCUMENT)?$/i, '');
        if (withoutSuffix !== normalized) {
          variations.add(withoutSuffix);
          variations.add(normalizeInvoiceNumber(withoutSuffix));
        }

        return variations;
      }

      function containsMostOf(container, contained, threshold = 0.7) {
        if (!container || !contained) return false;
        const containerNorm = container.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const containedNorm = contained.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        if (containerNorm.length === 0 || containedNorm.length === 0) return false;
        
        if (containerNorm.includes(containedNorm)) {
          return true;
        }
        
        if (containedNorm.startsWith(containerNorm) || containedNorm.endsWith(containerNorm)) {
          const matchRatio = containerNorm.length / containedNorm.length;
          return matchRatio >= threshold;
        }
        
        return false;
      }

      function getPartialMatchScore(str1, str2) {
        if (!str1 || !str2) return 0;
        const norm1 = str1.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const norm2 = str2.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        
        if (norm1.length === 0 || norm2.length === 0) return 0;
        
        if (norm1.includes(norm2)) {
          return norm2.length / norm1.length;
        }
        if (norm2.includes(norm1)) {
          return norm1.length / norm2.length;
        }
        
        const shorter = norm1.length <= norm2.length ? norm1 : norm2;
        const longer = norm1.length > norm2.length ? norm1 : norm2;
        
        let prefixMatch = 0;
        for (let i = 0; i < shorter.length && i < longer.length; i++) {
          if (shorter[i] === longer[i]) prefixMatch++;
          else break;
        }
        
        let suffixMatch = 0;
        for (let i = 0; i < shorter.length && i < longer.length; i++) {
          if (shorter[shorter.length - 1 - i] === longer[longer.length - 1 - i]) suffixMatch++;
          else break;
        }
        
        const bestMatch = Math.max(prefixMatch, suffixMatch);
        return bestMatch / shorter.length;
      }

      // Step 1: Try exact match first
      let allInvoices = [];
      try {
        const where = `Reference == "${searchTerm}" OR InvoiceNumber == "${searchTerm}"`;
        const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}`;
        
        const invoiceResponse = await makeRequestWithRetry(invoiceUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantId,
            Accept: 'application/json',
          },
          timeout: 10000
        });

        allInvoices = invoiceResponse.data.Invoices || [];
        if (allInvoices.length > 0) {
          statusMessages.push(`✅ Found ${allInvoices.length} exact match(es) in Xero`);
        }
      } catch (error) {
        statusMessages.push(`⚠️ Exact search failed: ${error.message}`);
      }

      // Step 2: If no exact match, fetch all invoices and use fuzzy matching
      if (allInvoices.length === 0) {
        statusMessages.push(`🔍 No exact match found, trying fuzzy matching...`);
        
        try {
          // Fetch recent invoices (last 12 months) for fuzzy matching
          const today = new Date();
          const fromDateObj = new Date(today);
          fromDateObj.setMonth(today.getMonth() - 12);
          const fromDate = `${fromDateObj.getFullYear()},${String(fromDateObj.getMonth() + 1).padStart(2, '0')},${String(fromDateObj.getDate()).padStart(2, '0')}`;
          
          const invoiceUrl = `https://api.xero.com/api.xro/2.0/Invoices?where=Date >= DateTime(${fromDate})`;
          
          const invoiceResponse = await makeRequestWithRetry(invoiceUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Xero-tenant-id': tenantId,
              Accept: 'application/json',
            },
            timeout: 10000
          });

          const fetchedInvoices = invoiceResponse.data.Invoices || [];
          statusMessages.push(`📊 Fetched ${fetchedInvoices.length} recent invoices from Xero for fuzzy matching`);

          // Get search term variations
          const searchVariations = getInvoiceNumberVariations(searchTerm);
          
          // Find fuzzy matches
          const fuzzyMatches = [];
          fetchedInvoices.forEach(inv => {
            const invNumber = inv.InvoiceNumber || '';
            const invReference = inv.Reference || '';
            
            // Check invoice number variations
            if (invNumber) {
              const invVariations = getInvoiceNumberVariations(invNumber);
              for (const searchVar of searchVariations) {
                if (invVariations.has(searchVar)) {
                  fuzzyMatches.push({
                    invoice: inv,
                    matchType: 'exact_variation',
                    matchField: 'InvoiceNumber',
                    score: 1.0
                  });
                  return;
                }
              }
            }
            
            // Check reference variations
            if (invReference) {
              const refVariations = getInvoiceNumberVariations(invReference);
              for (const searchVar of searchVariations) {
                if (refVariations.has(searchVar)) {
                  fuzzyMatches.push({
                    invoice: inv,
                    matchType: 'exact_variation',
                    matchField: 'Reference',
                    score: 1.0
                  });
                  return;
                }
              }
            }
            
            // Try fuzzy matching with containsMostOf
            let bestScore = 0;
            let bestField = '';
            
            if (invNumber) {
              const fileContainsXero = containsMostOf(searchTerm, invNumber, 0.7);
              const xeroContainsFile = containsMostOf(invNumber, searchTerm, 0.7);
              if (fileContainsXero || xeroContainsFile) {
                const score = getPartialMatchScore(searchTerm, invNumber);
                if (score > bestScore) {
                  bestScore = score;
                  bestField = 'InvoiceNumber';
                }
              }
            }
            
            if (invReference) {
              const fileContainsXero = containsMostOf(searchTerm, invReference, 0.7);
              const xeroContainsFile = containsMostOf(invReference, searchTerm, 0.7);
              if (fileContainsXero || xeroContainsFile) {
                const score = getPartialMatchScore(searchTerm, invReference);
                if (score > bestScore) {
                  bestScore = score;
                  bestField = 'Reference';
                }
              }
            }
            
            // Only include if score is at least 70%
            if (bestScore >= 0.7) {
              fuzzyMatches.push({
                invoice: inv,
                matchType: 'fuzzy',
                matchField: bestField,
                score: bestScore
              });
            }
          });

          // Sort by score (descending) and remove duplicates
          fuzzyMatches.sort((a, b) => b.score - a.score);
          const uniqueMatches = [];
          const seenInvoiceIds = new Set();
          fuzzyMatches.forEach(match => {
            const invId = match.invoice.InvoiceID;
            if (!seenInvoiceIds.has(invId)) {
              seenInvoiceIds.add(invId);
              uniqueMatches.push(match);
            }
          });

          allInvoices = uniqueMatches.map(m => m.invoice);
          
          if (allInvoices.length > 0) {
            statusMessages.push(`✅ Found ${allInvoices.length} fuzzy match(es) (score >= 70%)`);
          } else {
            statusMessages.push(`⚠️ No fuzzy matches found (tried ${fetchedInvoices.length} invoices)`);
          }
        } catch (error) {
          statusMessages.push(`❌ Error during fuzzy matching: ${error.message}`);
        }
      }

      // Return invoice data
      if (allInvoices.length > 0) {
        result.invoices = allInvoices;
        result.success = true;
      } else {
        statusMessages.push(`❌ No invoices found matching "${searchTerm}"`);
      }

      result.statusMessages = statusMessages;
      return JSON.stringify(result);
    } catch (error) {
      statusMessages.push(`❌ Error: ${error.message}`);
      result.statusMessages = statusMessages;
      result.error = error.message;
      return JSON.stringify(result);
    }
  },
};

/**
 * Create tool instances from configuration
 */
const toolInstances = {};

toolsConfig.tools.forEach(toolConfig => {
  if (toolConfig.enabled) {
    const zodSchema = createZodSchemaFromJSON(toolConfig.schema);
    const implementation = toolImplementations[toolConfig.name];
    
    if (!implementation) {
      console.warn(`Warning: No implementation found for tool: ${toolConfig.name}`);
      return;
    }
    
    toolInstances[toolConfig.name] = new DynamicStructuredTool({
      name: toolConfig.name,
      description: toolConfig.description,
      schema: zodSchema,
      func: implementation,
    });
  }
});

/**
 * Get all tool instances
 */
function getAllTools() {
  return Object.values(toolInstances);
}

/**
 * Get tools for a specific agent type
 */
function getToolsForAgent(agentType) {
  return toolsConfig.tools
    .filter(tool => 
      tool.enabled && 
      tool.agentTypes && 
      tool.agentTypes.includes(agentType)
    )
    .map(tool => toolInstances[tool.name])
    .filter(Boolean); // Remove any undefined tools
}

/**
 * Get tool metadata (for frontend/documentation)
 */
function getToolMetadata(agentType = null) {
  let tools = toolsConfig.tools;
  
  if (agentType) {
    tools = tools.filter(tool => 
      tool.agentTypes && tool.agentTypes.includes(agentType)
    );
  }
  
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    enabled: tool.enabled,
    agentTypes: tool.agentTypes,
    schema: tool.schema,
  }));
}

/**
 * Get a specific tool by name
 */
function getTool(toolName) {
  return toolInstances[toolName];
}

// Export individual tools for direct access
module.exports = {
  getAllTools,
  getToolsForAgent,
  getToolMetadata,
  getTool,
  setRequestContext,
  clearRequestContext,
  // Export individual tools
  textFormatterTool: toolInstances.text_formatter,
  getInvoicesTool: toolInstances.get_invoices,
  getSuppliersTool: toolInstances.get_suppliers,
  getLogsTool: toolInstances.get_logs,
  detectUploadIntentTool: toolInstances.detect_upload_intent,
};
