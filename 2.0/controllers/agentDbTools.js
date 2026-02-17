const { DynamicStructuredTool } = require("@langchain/core/tools");
const { z } = require("zod");
const Statement = require("../modals/statementModal");
const Invoice = require("../modals/invoiceModal");
const Vendor = require("../modals/vendorModal");
const { searchSimilarVendors } = require("../scripts/scripts");

// ---------------------------------------------------------------------------
// Schema summary: introspect Mongoose models so the agent understands fields and relationships
// ---------------------------------------------------------------------------
function getSchemaSummary() {
  const toFieldList = (schema) => {
    const list = [];
    schema.eachPath((pathName, path) => {
      if (pathName === "__v") return;
      const type = path.instance || path.options?.type?.name || "Mixed";
      const ref = path.options?.ref || null;
      const enumVals = path.enumValues?.length ? path.enumValues : null;
      list.push({
        field: pathName,
        type,
        ...(ref && { ref }),
        ...(enumVals && { enum: enumVals }),
      });
    });
    return list;
  };

  return {
    Statement: {
      collection: "statements-2.0",
      fields: toFieldList(Statement.schema),
      relationships: [
        "contactId links to Vendor.xeroId (Xero contact ID). Use contactId to filter by vendor.",
      ],
    },
    Invoice: {
      collection: "invoices-2.0",
      fields: toFieldList(Invoice.schema),
      relationships: [
        "statementId refs Statement._id. Use statementId to filter invoices by statement.",
        "contactId is the Xero contact ID; same as Vendor.xeroId. Use for vendor-scoped invoice queries.",
      ],
    },
    Vendor: {
      collection: "vendors-2.0",
      fields: toFieldList(Vendor.schema),
      relationships: [
        "xeroId is the Xero contact ID. Use in query_invoices (contactId) and query_statements (contactId).",
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Shared helper: paginated query with structured error handling
// ---------------------------------------------------------------------------
async function paginatedQuery(Model, filter, sortField, toolName, params) {
  try {
    filter.isDeleted = { $ne: true };
    console.log("[AgentDbTool]", toolName, { params, filter: JSON.stringify(filter) });
    const [total, data] = await Promise.all([
      Model.countDocuments(filter),
      Model.find(filter)
        .sort({ [sortField]: -1 })
        .limit(100)
        .lean(),
    ]);
    console.log("[AgentDbTool]", toolName, "result", { total, count: data.length, hasMore: total > 100 });
    return JSON.stringify({
      success: true,
      total,
      count: data.length,
      hasMore: total > 100,
      data,
    });
  } catch (err) {
    console.error("[AgentDbTool]", toolName, "error", err.message);
    return JSON.stringify({
      success: false,
      error: {
        code: err.code || "QUERY_ERROR",
        message: err.message,
        tool: toolName,
        params,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Tool 1: query_statements (TOOL-01)
// ---------------------------------------------------------------------------
const queryStatementsTool = new DynamicStructuredTool({
  name: "query_statements",
  description:
    "Query statements from the database. Filter by contactId, date range, or both. Returns up to 100 results with total count.",
  schema: z.object({
    contactId: z.string().optional().describe("Filter by contact ID"),
    dateFrom: z
      .string()
      .optional()
      .describe("Start date for dateOnFile range (ISO string)"),
    dateTo: z
      .string()
      .optional()
      .describe("End date for dateOnFile range (ISO string)"),
  }),
  func: async (params) => {
    const { contactId, dateFrom, dateTo } = params;
    const filter = {};

    if (contactId) filter.contactId = contactId;

    if (dateFrom || dateTo) {
      const dateFilter = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (!isNaN(from.getTime())) dateFilter.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (!isNaN(to.getTime())) dateFilter.$lte = to;
      }
      if (Object.keys(dateFilter).length > 0) {
        filter.dateOnFile = dateFilter;
      }
    }

    return paginatedQuery(Statement, filter, "dateOnFile", "query_statements", params);
  },
});

// ---------------------------------------------------------------------------
// Tool 2: query_invoices (TOOL-02)
// ---------------------------------------------------------------------------
const queryInvoicesTool = new DynamicStructuredTool({
  name: "query_invoices",
  description:
    "Query invoices from the database. Filter by statementId, status (paid/unpaid), contactId, vendorName, or date range. Returns up to 100 results with total count.",
  schema: z.object({
    statementId: z.string().optional().describe("Filter by statement ID"),
    status: z
      .enum(["paid", "unpaid"])
      .optional()
      .describe("Filter by invoice status"),
    contactId: z.string().optional().describe("Filter by contact ID"),
    vendorName: z
      .string()
      .optional()
      .describe("Filter by vendor name (fuzzy match). Resolves to contactId via vendor lookup."),
    dateFrom: z
      .string()
      .optional()
      .describe("Start date for date range (ISO string)"),
    dateTo: z
      .string()
      .optional()
      .describe("End date for date range (ISO string)"),
  }),
  func: async (params) => {
    const { statementId, status, contactId, vendorName, dateFrom, dateTo } = params;
    const filter = {};

    if (statementId) filter.statementId = statementId;
    if (status) filter.status = status;
    if (contactId) filter.contactId = contactId;

    // If vendorName provided and no contactId, look up vendor to get xeroId
    if (vendorName && !contactId) {
      try {
        const vendor = await Vendor.findOne({
          name: { $regex: vendorName, $options: "i" },
          isDeleted: { $ne: true },
        }).lean();
        if (vendor && vendor.xeroId) {
          filter.contactId = vendor.xeroId;
        }
      } catch (_) {
        // If vendor lookup fails, continue without contactId filter
      }
    }

    if (dateFrom || dateTo) {
      const dateFilter = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (!isNaN(from.getTime())) dateFilter.$gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (!isNaN(to.getTime())) dateFilter.$lte = to;
      }
      if (Object.keys(dateFilter).length > 0) {
        filter.date = dateFilter;
      }
    }

    return paginatedQuery(Invoice, filter, "date", "query_invoices", params);
  },
});

// ---------------------------------------------------------------------------
// Tool 3: query_vendors (TOOL-03)
// ---------------------------------------------------------------------------
const queryVendorsTool = new DynamicStructuredTool({
  name: "query_vendors",
  description:
    "Query vendors from the database. Filter by name (fuzzy match) or xeroId. Returns up to 100 results with total count.",
  schema: z.object({
    name: z
      .string()
      .optional()
      .describe("Filter by vendor name (case-insensitive regex match)"),
    xeroId: z.string().optional().describe("Filter by Xero contact ID"),
  }),
  func: async (params) => {
    const { name, xeroId } = params;
    const filter = {};

    if (name) filter.name = { $regex: name, $options: "i" };
    if (xeroId) filter.xeroId = xeroId;

    return paginatedQuery(Vendor, filter, "createdAt", "query_vendors", params);
  },
});

// Same threshold as parse invoice 2.9: above this we auto-select the best match
const SIMILARITY_SELECT_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Tool 4: search_similar_vendors (TOOL-04) — like parse invoice 2.9, then choose and return the one to use
// ---------------------------------------------------------------------------
const searchSimilarVendorsTool = new DynamicStructuredTool({
  name: "search_similar_vendors",
  description:
    "Search the database for vendor names similar to the given name, then choose which vendor is correct and return it for you to use. Use when the exact vendor name does not match any vendor. Returns matches plus selectedVendor: the best match above 0.8, or the match at selectIndex if you provide it. Use selectedVendor.xeroId or selectedVendor.name in query_invoices or query_statements.",
  schema: z.object({
    vendorName: z.string().describe("The vendor or company name to find similar matches for"),
    limit: z
      .number()
      .optional()
      .describe("Max number of similar vendors to return (default 10, max 50)"),
    selectIndex: z
      .number()
      .optional()
      .describe("0-based index of which match to choose (e.g. 0 = first/best, 1 = second). If omitted, the best match above 0.8 is chosen automatically."),
  }),
  func: async (params) => {
    const { vendorName, limit, selectIndex } = params;
    try {
      const result = await searchSimilarVendors(vendorName || "", limit ?? 10);
      const matches = result.matches || [];
      const scoreOf = (m) => Number(m.score ?? m.similarityToQuery ?? 0);

      let selectedVendor = null;
      if (typeof selectIndex === "number" && selectIndex >= 0 && selectIndex < matches.length) {
        selectedVendor = matches[selectIndex];
        console.log("[AgentDbTool] search_similar_vendors selected by index", { selectIndex, name: selectedVendor?.name });
      } else if (matches.length > 0 && scoreOf(matches[0]) >= SIMILARITY_SELECT_THRESHOLD) {
        selectedVendor = matches[0];
        console.log("[AgentDbTool] search_similar_vendors auto-selected best match", { name: selectedVendor?.name, score: scoreOf(selectedVendor) });
      }

      const payload = {
        success: true,
        query: result.query,
        limit: result.limit,
        matches,
        selectedVendor: selectedVendor
          ? {
              name: selectedVendor.name,
              xeroId: selectedVendor.xeroId,
              email: selectedVendor.email,
              score: scoreOf(selectedVendor),
            }
          : null,
        instruction: selectedVendor
          ? `Use this vendor for follow-up: contactId/xeroId="${selectedVendor.xeroId}", name="${selectedVendor.name}". Call query_invoices or query_statements with this contactId.`
          : "No match above threshold; use matches list or ask user to clarify.",
      };

      console.log("[AgentDbTool] search_similar_vendors", {
        query: result.query,
        matchCount: matches.length,
        hasSelected: !!selectedVendor,
      });
      return JSON.stringify(payload);
    } catch (err) {
      console.error("[AgentDbTool] search_similar_vendors error", err.message);
      return JSON.stringify({
        success: false,
        error: {
          code: err.code || "SEARCH_ERROR",
          message: err.message,
          tool: "search_similar_vendors",
          params,
        },
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Tool 5: get_db_schema — expose all model fields and relationships for query tools
// ---------------------------------------------------------------------------
const getDbSchemaTool = new DynamicStructuredTool({
  name: "get_db_schema",
  description:
    "Return the database schema for Statement, Invoice, and Vendor: every field (name, type, enum if any), collection names, and how collections relate (e.g. Invoice.statementId -> Statement, contactId/xeroId for vendor). Call this when you need to know which fields exist or how to join/filter across statements, invoices, and vendors.",
  schema: z.object({}),
  func: async () => {
    const schema = getSchemaSummary();
    return JSON.stringify(schema, null, 2);
  },
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
const dbTools = [
  getDbSchemaTool,
  queryStatementsTool,
  queryInvoicesTool,
  queryVendorsTool,
  searchSimilarVendorsTool,
];

module.exports = {
  getSchemaSummary,
  getDbSchemaTool,
  queryStatementsTool,
  queryInvoicesTool,
  queryVendorsTool,
  searchSimilarVendorsTool,
  dbTools,
};
