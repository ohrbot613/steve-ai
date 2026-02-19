import { useEffect, useState, useRef } from "react";
import { useSearchParams, useParams, Link, useNavigate } from "react-router-dom";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss";
import modalStyle from "../scss/Modal.module.scss";
import { getCurrencySymbol } from "../utils/currencyUtils";
import { exportToCSV, exportToExcel } from "../utils/exportUtils";

export default function SupplierLogs() {
    const [logs, setLogs] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [missedInvoices, setMissedInvoices] = useState([]);
    const [unmatchedInvoices, setUnmatchedInvoices] = useState([]);
    const [matchedInvoices, setMatchedInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchParams, setSearchParams] = useSearchParams();
    const [pages, setPages] = useState(1);
    const [invoicePages, setInvoicePages] = useState(1);
    const [missedInvoicePages, setMissedInvoicePages] = useState(1);
    const [unmatchedInvoicePages, setUnmatchedInvoicePages] = useState(1);
    const [matchedInvoicePages, setMatchedInvoicePages] = useState(1);
    const [activeTab, setActiveTab] = useState('statements');
    const [findingMissedInvoices, setFindingMissedInvoices] = useState(false);
    const [exporting, setExporting] = useState({ tab: null, format: null }); // { tab: 'invoices', format: 'excel' }
    const [showPaymentRunModal, setShowPaymentRunModal] = useState(false);
    const { supplierId } = useParams();
    const navigate = useNavigate();
    
    const supplierName = searchParams.get('name') || 'Supplier';
    const page = Number(searchParams.get('page')) || 1;
    const invoicePage = Number(searchParams.get('invoicePage')) || 1;
    const missedInvoicePage = Number(searchParams.get('missedInvoicePage')) || 1;
    const unmatchedInvoicePage = Number(searchParams.get('unmatchedInvoicePage')) || 1;
    const matchedInvoicePage = Number(searchParams.get('matchedInvoicePage')) || 1;
    const sortBy = searchParams.get('sortBy') || 'processDateTime';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const invoiceSortBy = searchParams.get('invoiceSortBy') || 'addedAt';
    const invoiceSortOrder = searchParams.get('invoiceSortOrder') || 'desc';
    const missedInvoiceSortBy = searchParams.get('missedInvoiceSortBy') || 'addedAt';
    const missedInvoiceSortOrder = searchParams.get('missedInvoiceSortOrder') || 'desc';
    const unmatchedInvoiceSortBy = searchParams.get('unmatchedInvoiceSortBy') || 'addedAt';
    const unmatchedInvoiceSortOrder = searchParams.get('unmatchedInvoiceSortOrder') || 'desc';
    const matchedInvoiceSortBy = searchParams.get('matchedInvoiceSortBy') || 'addedAt';
    const matchedInvoiceSortOrder = searchParams.get('matchedInvoiceSortOrder') || 'desc';
    const paymentFilter = searchParams.get('paymentFilter') || 'all';

    useEffect(() => {
        if (activeTab === 'statements') {
            async function getData() {
                setLoading(true);
                setError('');

                try {
                    const response = await fetch(
                        `/api/v2/supplier-logs/statements?id=${supplierId}&page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}`
                    );

                    if (!response.ok) {
                        throw new Error('Failed to fetch logs');
                    }

                    const data = await response.json();


                    
                    if (data.success) {
                        setLogs(data.logs || []);
                        setPages(data.pages || 1);
                    } else {
                        setError('Failed to load logs');
                    }
                } catch (err) {
                    setError('An error occurred while loading logs');
                    console.error(err);
                } finally {
                    setLoading(false);
                }
            }

            getData();
        }
    }, [supplierId, page, sortBy, sortOrder, activeTab]);

    useEffect(() => {
        if (activeTab === 'invoices') {
            // TODO: 
            async function getInvoices() {
                setLoading(true);
                setError('');

                try {
                    const response = await fetch(
                        `/api/v2/supplier-logs/invoices?supplierId=${supplierId}&page=${invoicePage}&sortBy=${invoiceSortBy}&sortOrder=${invoiceSortOrder}&paymentFilter=${paymentFilter}`
                    );

                    if (!response.ok) {
                        throw new Error('Failed to fetch invoices');
                    }

                    const data = await response.json();


                    if (data.success) {
                        setInvoices(data.invoices || []);
                        setInvoicePages(data.pages || 1);
                    } else {
                        setError('Failed to load invoices');
                    }
                } catch (err) {
                    setError('An error occurred while loading invoices');
                    console.error(err);
                } finally {
                    setLoading(false);
                }
            }

            getInvoices();
        }
    }, [supplierId, invoicePage, invoiceSortBy, invoiceSortOrder, activeTab, paymentFilter]);

    useEffect(() => {
        if (activeTab === 'missed') {
            async function getMissedInvoices() {
                setLoading(true);
                setError('');

                try {
                    const response = await fetch(
                        `/api/v2/supplier-logs/missed-invoices?supplierId=${supplierId}&page=${missedInvoicePage}&sortBy=${missedInvoiceSortBy}&sortOrder=${missedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
                    );

                    if (!response.ok) {
                        throw new Error('Failed to fetch missed invoices');
                    }

                    const data = await response.json();
                    console.log(data)
                    
                    if (data.success) {
                        setMissedInvoices(data.invoices || []);
                        setMissedInvoicePages(data.pages || 1);
                    } else {
                        setError('Failed to load missed invoices');
                    }
                } catch (err) {
                    setError('An error occurred while loading missed invoices');
                    console.error(err);
                } finally {
                    setLoading(false);
                }
            }

            getMissedInvoices();
        }
    }, [supplierId, missedInvoicePage, missedInvoiceSortBy, missedInvoiceSortOrder, activeTab, paymentFilter]);

    useEffect(() => {
        if (activeTab === 'unmatched') {
            async function getUnmatchedInvoices() {
                setLoading(true);
                setError('');

                try {
                    const response = await fetch(
                        `/api/v2/supplier-logs/unmatched-invoices?supplierId=${supplierId}&page=${unmatchedInvoicePage}&sortBy=${unmatchedInvoiceSortBy}&sortOrder=${unmatchedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
                    );

                    if (!response.ok) {
                        throw new Error('Failed to fetch unmatched invoices');
                    }

                    const data = await response.json();
                    
                    if (data.success) {
                        setUnmatchedInvoices(data.invoices || []);
                        setUnmatchedInvoicePages(data.pages || 1);
                    } else {
                        setError('Failed to load unmatched invoices');
                    }
                } catch (err) {
                    setError('An error occurred while loading unmatched invoices');
                    console.error(err);
                } finally {
                    setLoading(false);
                }
            }

            getUnmatchedInvoices();
        }
    }, [supplierId, unmatchedInvoicePage, unmatchedInvoiceSortBy, unmatchedInvoiceSortOrder, activeTab, paymentFilter]);

    useEffect(() => {
        if (activeTab === 'matched') {
            async function getMatchedInvoices() {
                setLoading(true);
                setError('');

                try {
                    const response = await fetch(
                        `/api/v2/supplier-logs/matched-invoices?supplierId=${supplierId}&page=${matchedInvoicePage}&sortBy=${matchedInvoiceSortBy}&sortOrder=${matchedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
                    );

                    if (!response.ok) {
                        throw new Error('Failed to fetch matched invoices');
                    }

                    const data = await response.json();
                    
                    if (data.success) {
                        setMatchedInvoices(data.invoices || []);
                        setMatchedInvoicePages(data.pages || 1);
                    } else {
                        setError('Failed to load matched invoices');
                    }
                } catch (err) {
                    setError('An error occurred while loading matched invoices');
                    console.error(err);
                } finally {
                    setLoading(false);
                }
            }

            getMatchedInvoices();
        }
    }, [supplierId, matchedInvoicePage, matchedInvoiceSortBy, matchedInvoiceSortOrder, activeTab, paymentFilter]);

    function formatDate(dateString) {
        if (!dateString) return '—';
        const date = new Date(dateString);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${month} ${day}, ${year}`;
    }

    function formatDateTime(dateString) {
        if (!dateString) return '—';
        const date = new Date(dateString);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        const hours = date.getHours();
        const minutes = date.getMinutes();
        return `${month} ${day}, ${year} ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }

    function formatCurrency(amount, currency = '$') {
        if (amount == null) return '—';
        const currencySymbol = getCurrencySymbol(currency);
        return `${currencySymbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function getReconciliationStatus(invoice) {
        const supplierAmount = invoice.vendorAmount;
        const systemAmount = invoice.xeroAmount;
        const hasXeroDate = invoice.xeroDate != null;
        
        // If not found in Xero, return N/A
        if (!hasXeroDate) {
            return 'n/a';
        }
        
        // If found in Xero, check if amounts match
        if (supplierAmount != null && systemAmount != null) {
            const tolerance = 0.01;
            const difference = Math.abs(supplierAmount - systemAmount);
            
            if (difference <= tolerance) {
                return 'fully reconciled';
            } else {
                return 'partially reconciled';
            }
        }
        
        // If found in Xero but amounts are missing, consider partially reconciled
        return 'partially reconciled';
    }

    function getStatusBadge(log) {
        const status = (log.status || '').toLowerCase();

        if (status === 'reconciled') {
            return <span className={pageStyle.statusSuccess}>Reconciled</span>;
        } else if (status === 'partially reconciled') {
            return <span className={pageStyle.statusWarning}>Partially reconciled</span>;
        } else if (status === 'not reconciled') {
            return <span className={pageStyle.statusError}>Not reconciled</span>;
        } else {
            return <span className={pageStyle.statusProcessing}>Processing</span>;
        }
    }

    function handleColumnClick(columnName) {
        // If clicking the same column, toggle the order
        if (sortBy === columnName) {
            const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
            setSearchParams({ page: '1', sortBy: columnName, sortOrder: newOrder, name: supplierName });
        } else {
            // If clicking a new column, default to descending
            setSearchParams({ page: '1', sortBy: columnName, sortOrder: 'desc', name: supplierName });
        }
    }

    function handleInvoiceColumnClick(columnName) {
        // If clicking the same column, toggle the order
        if (invoiceSortBy === columnName) {
            const newOrder = invoiceSortOrder === 'asc' ? 'desc' : 'asc';
            setSearchParams({ invoicePage: '1', invoiceSortBy: columnName, invoiceSortOrder: newOrder, name: supplierName, paymentFilter: paymentFilter });
        } else {
            // If clicking a new column, default to descending
            setSearchParams({ invoicePage: '1', invoiceSortBy: columnName, invoiceSortOrder: 'desc', name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleMissedInvoiceColumnClick(columnName) {
        // If clicking the same column, toggle the order
        if (missedInvoiceSortBy === columnName) {
            const newOrder = missedInvoiceSortOrder === 'asc' ? 'desc' : 'asc';
            setSearchParams({ missedInvoicePage: '1', missedInvoiceSortBy: columnName, missedInvoiceSortOrder: newOrder, name: supplierName, paymentFilter: paymentFilter });
        } else {
            // If clicking a new column, default to descending
            setSearchParams({ missedInvoicePage: '1', missedInvoiceSortBy: columnName, missedInvoiceSortOrder: 'desc', name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleUnmatchedInvoiceColumnClick(columnName) {
        // If clicking the same column, toggle the order
        if (unmatchedInvoiceSortBy === columnName) {
            const newOrder = unmatchedInvoiceSortOrder === 'asc' ? 'desc' : 'asc';
            setSearchParams({ unmatchedInvoicePage: '1', unmatchedInvoiceSortBy: columnName, unmatchedInvoiceSortOrder: newOrder, name: supplierName, paymentFilter: paymentFilter });
        } else {
            // If clicking a new column, default to descending
            setSearchParams({ unmatchedInvoicePage: '1', unmatchedInvoiceSortBy: columnName, unmatchedInvoiceSortOrder: 'desc', name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleMatchedInvoiceColumnClick(columnName) {
        // If clicking the same column, toggle the order
        if (matchedInvoiceSortBy === columnName) {
            const newOrder = matchedInvoiceSortOrder === 'asc' ? 'desc' : 'asc';
            setSearchParams({ matchedInvoicePage: '1', matchedInvoiceSortBy: columnName, matchedInvoiceSortOrder: newOrder, name: supplierName, paymentFilter: paymentFilter });
        } else {
            // If clicking a new column, default to descending
            setSearchParams({ matchedInvoicePage: '1', matchedInvoiceSortBy: columnName, matchedInvoiceSortOrder: 'desc', name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handlePrevPage() {
        if (activeTab === 'statements' && page > 1) {
            setSearchParams({ page: String(page - 1), sortBy, sortOrder, name: supplierName, paymentFilter: paymentFilter });
        } else if (activeTab === 'invoices' && invoicePage > 1) {
            setSearchParams({ invoicePage: String(invoicePage - 1), invoiceSortBy, invoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleNextPage() {
        if (activeTab === 'statements' && page < pages) {
            setSearchParams({ page: String(page + 1), sortBy, sortOrder, name: supplierName, paymentFilter: paymentFilter });
        } else if (activeTab === 'invoices' && invoicePage < invoicePages) {
            setSearchParams({ invoicePage: String(invoicePage + 1), invoiceSortBy, invoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleMissedInvoicePrevPage() {
        if (missedInvoicePage > 1) {
            setSearchParams({ missedInvoicePage: String(missedInvoicePage - 1), missedInvoiceSortBy, missedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleMissedInvoiceNextPage() {
        if (missedInvoicePage < missedInvoicePages) {
            setSearchParams({ missedInvoicePage: String(missedInvoicePage + 1), missedInvoiceSortBy, missedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleUnmatchedInvoicePrevPage() {
        if (unmatchedInvoicePage > 1) {
            setSearchParams({ unmatchedInvoicePage: String(unmatchedInvoicePage - 1), unmatchedInvoiceSortBy, unmatchedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleUnmatchedInvoiceNextPage() {
        if (unmatchedInvoicePage < unmatchedInvoicePages) {
            setSearchParams({ unmatchedInvoicePage: String(unmatchedInvoicePage + 1), unmatchedInvoiceSortBy, unmatchedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleMatchedInvoicePrevPage() {
        if (matchedInvoicePage > 1) {
            setSearchParams({ matchedInvoicePage: String(matchedInvoicePage - 1), matchedInvoiceSortBy, matchedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleMatchedInvoiceNextPage() {
        if (matchedInvoicePage < matchedInvoicePages) {
            setSearchParams({ matchedInvoicePage: String(matchedInvoicePage + 1), matchedInvoiceSortBy, matchedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
        }
    }

    function handleInvoiceRowClick(invoice) {
        if (invoice.statementId?._id) {
            navigate(`/v1/single-statement/${invoice.statementId._id}`, {
                state: { from: 'supplier-logs' }
            });
        }
    }

    function handleRowClick(logId) {
        navigate(`/v1/single-statement/${logId}`, { 
            state: { from: 'supplier-logs' } 
        });
    }

    async function handleDeleteLog(logId) {
        if (!window.confirm('Are you sure you want to delete this statement? This will also delete all invoices associated with it. This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`/api/v1/invoice/delete-statement/${logId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success) {
                // Refresh the logs list
                if (activeTab === 'statements') {
                    const refreshResponse = await fetch(
                        `/api/v2/supplier-logs/statements?id=${supplierId}&page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}`
                    );
                    const refreshData = await refreshResponse.json();
                    if (refreshData.success) {
                        setLogs(refreshData.logs || []);
                        setPages(refreshData.pages || 1);
                    }
                }
            } else {
                setError(data.message || 'Failed to delete statement');
            }
        } catch (err) {
            setError('An error occurred while deleting the statement');
            console.error(err);
        }
    }

    function handlePaymentFilterChange(newPaymentFilter) {
        // Get current tab-specific params
        const params = { name: supplierName, paymentFilter: newPaymentFilter };
        
        if (activeTab === 'invoices') {
            params.invoicePage = '1';
            params.invoiceSortBy = invoiceSortBy;
            params.invoiceSortOrder = invoiceSortOrder;
        } else if (activeTab === 'missed') {
            params.missedInvoicePage = '1';
            params.missedInvoiceSortBy = missedInvoiceSortBy;
            params.missedInvoiceSortOrder = missedInvoiceSortOrder;
        } else if (activeTab === 'unmatched') {
            params.unmatchedInvoicePage = '1';
            params.unmatchedInvoiceSortBy = unmatchedInvoiceSortBy;
            params.unmatchedInvoiceSortOrder = unmatchedInvoiceSortOrder;
        } else if (activeTab === 'matched') {
            params.matchedInvoicePage = '1';
            params.matchedInvoiceSortBy = matchedInvoiceSortBy;
            params.matchedInvoiceSortOrder = matchedInvoiceSortOrder;
        }
        
        setSearchParams(params);
    }

    async function handleFindMissedInvoices() {
        setFindingMissedInvoices(true);
        setError('');

        try {
            const response = await fetch(`/api/v1/invoice/missing-invoices?supplierId=${supplierId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success) {
                // Success - could show a success message here if needed
            } else {
                setError(data.message || 'Failed to find missed invoices');
            }
        } catch (err) {
            setError('An error occurred while finding missed invoices');
            console.error(err);
        } finally {
            setFindingMissedInvoices(false);
        }
    }

    function handleDraftEmail(invoice) {
        // Email draft functionality removed - CopilotKit no longer available
        alert('Email draft functionality is currently unavailable. Please use your email client to draft messages manually.');
    }

    async function fetchAllStatements() {
        try {
            // First, get page 1 to know total pages
            const firstPageResponse = await fetch(
                `/api/v2/supplier-logs/statements?id=${supplierId}&page=1&sortBy=${sortBy}&sortOrder=${sortOrder}`
            );
            const firstPageData = await firstPageResponse.json();
            
            if (!firstPageData.success) {
                throw new Error('Failed to fetch statements');
            }
            
            const totalPages = firstPageData.pages || 1;
            let allStatements = [...(firstPageData.logs || [])];
            
            // Fetch remaining pages
            for (let page = 2; page <= totalPages; page++) {
                const response = await fetch(
                    `/api/v2/supplier-logs/statements?id=${supplierId}&page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}`
                );
                const data = await response.json();
                if (data.success && data.logs) {
                    allStatements = [...allStatements, ...data.logs];
                }
            }
            
            return allStatements;
        } catch (error) {
            console.error('Error fetching all statements:', error);
            throw error;
        }
    }

    async function handleExportStatements(format) {
        try {
            setExporting({ tab: 'statements', format });
            const allStatements = await fetchAllStatements();
            
            if (allStatements.length === 0) {
                alert('No statements to export');
                return;
            }

            const headers = [
                { label: 'Supplier Name', key: 'supplierName' },
                { label: 'Statement Issue Date', key: 'statementIssueDate' },
                { label: 'Process Date/Time', key: 'processDateTime' },
                { label: 'Status', key: 'status' },
                { label: 'Reconciled', key: 'reconciled' },
                { label: 'Unreconciled', key: 'unreconciled' },
                { label: 'Total', key: 'total' }
            ];

            const exportData = allStatements.map(log => {
                const reconciled = log.reconciled || 0;
                const unreconciled = log.unreconciled || 0;
                const total = log.total || 0;
                const status = (log.status || '').toLowerCase();
                const statusText = status === 'reconciled' ? 'Reconciled' : status === 'partially reconciled' ? 'Partially reconciled' : status === 'not reconciled' ? 'Not reconciled' : 'Processing';

                return {
                    supplierName: supplierName,
                    statementIssueDate: formatDate(log.invoiceIssueDate),
                    processDateTime: formatDateTime(log.addedAt),
                    status: statusText,
                    reconciled: reconciled,
                    unreconciled: unreconciled,
                    total: total
                };
            });

            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `Statements_${supplierName}_${dateStr}`;
            
            if (format === 'csv') {
                exportToCSV(exportData, headers, filename);
            } else {
                exportToExcel(exportData, headers, filename);
            }
        } catch (error) {
            alert('Failed to export statements. Please try again.');
            console.error('Export error:', error);
        } finally {
            setExporting({ tab: null, format: null });
        }
    }

    async function fetchAllInvoices() {
        try {
            // First, get page 1 to know total pages
            const firstPageResponse = await fetch(
                `/api/v2/supplier-logs/invoices?supplierId=${supplierId}&page=1&sortBy=${invoiceSortBy}&sortOrder=${invoiceSortOrder}&paymentFilter=${paymentFilter}`
            );
            const firstPageData = await firstPageResponse.json();
            
            if (!firstPageData.success) {
                throw new Error('Failed to fetch invoices');
            }
            
            const totalPages = firstPageData.pages || 1;
            let allInvoices = [...(firstPageData.invoices || [])];
            
            // Fetch remaining pages
            for (let page = 2; page <= totalPages; page++) {
                const response = await fetch(
                    `/api/v2/supplier-logs/invoices?supplierId=${supplierId}&page=${page}&sortBy=${invoiceSortBy}&sortOrder=${invoiceSortOrder}&paymentFilter=${paymentFilter}`
                );
                const data = await response.json();
                if (data.success && data.invoices) {
                    allInvoices = [...allInvoices, ...data.invoices];
                }
            }
            
            return allInvoices;
        } catch (error) {
            console.error('Error fetching all invoices:', error);
            throw error;
        }
    }

    async function handleExportInvoices(format) {
        try {
            setExporting({ tab: 'invoices', format });
            const allInvoices = await fetchAllInvoices();
            
            if (allInvoices.length === 0) {
                alert('No invoices to export');
                return;
            }

            const headers = [
                { label: 'Supplier Name', key: 'supplierName' },
                { label: 'Invoice Number', key: 'invoiceNumber' },
                { label: 'Supplier Date', key: 'VendorDate' },
                { label: 'Xero Date', key: 'xeroDate' },
                { label: 'Supplier Amount', key: 'vendorAmount' },
                { label: 'Supplier Currency', key: 'vendorCurrency' },
                { label: 'Xero Amount', key: 'xeroAmount' },
                { label: 'Xero Currency', key: 'xeroCurrency' },
                { label: 'Difference', key: 'difference' },
                { label: 'Found in Xero', key: 'foundInXero' },
                { label: 'Status', key: 'status' },
                { label: 'Payment Status', key: 'paymentStatus' }
            ];

            const exportData = allInvoices.map(invoice => {
                const supplierAmount = invoice.vendorAmount || 0;
                const systemAmount = invoice.xeroAmount || 0;
                const difference = supplierAmount - systemAmount;
                const supplierCurrency = invoice.vendorCurrency || 'Unknown';
                const xeroCurrency = invoice.xeroCurrency || 'Unknown';
                const foundInSystem = invoice.xeroDate ? 'Yes' : 'No';
                const status = getReconciliationStatus(invoice);
                const paymentStatus = invoice.paymentStatus === 'paid' ? 'Paid' : 
                                      invoice.paymentStatus === 'unpaid' ? 'Unpaid' : 'Unknown';

                return {
                    supplierName: supplierName,
                    invoiceNumber: invoice.invoiceNumber || '—',
                    VendorDate: formatDate(invoice.VendorDate),
                    xeroDate: formatDate(invoice.xeroDate),
                    vendorAmount: Number(supplierAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    vendorCurrency: supplierCurrency,
                    xeroAmount: Number(systemAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    xeroCurrency: xeroCurrency,
                    difference: Number(difference).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    foundInXero: foundInSystem,
                    status: status === 'fully reconciled' ? 'Fully Reconciled' : 
                            status === 'partially reconciled' ? 'Partially Reconciled' : 'N/A',
                    paymentStatus: paymentStatus
                };
            });

            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `All_Invoices_${supplierName}_${dateStr}`;
            
            if (format === 'csv') {
                exportToCSV(exportData, headers, filename);
            } else {
                exportToExcel(exportData, headers, filename);
            }
        } catch (error) {
            alert('Failed to export invoices. Please try again.');
            console.error('Export error:', error);
        } finally {
            setExporting({ tab: null, format: null });
        }
    }

    async function fetchAllMissedInvoices() {
        try {
            const firstPageResponse = await fetch(
                `/api/v2/supplier-logs/missed-invoices?supplierId=${supplierId}&page=1&sortBy=${missedInvoiceSortBy}&sortOrder=${missedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
            );
            const firstPageData = await firstPageResponse.json();
            
            if (!firstPageData.success) {
                throw new Error('Failed to fetch missed invoices');
            }
            
            const totalPages = firstPageData.pages || 1;
            let allInvoices = [...(firstPageData.invoices || [])];
            
            for (let page = 2; page <= totalPages; page++) {
                const response = await fetch(
                    `/api/v2/supplier-logs/missed-invoices?supplierId=${supplierId}&page=${page}&sortBy=${missedInvoiceSortBy}&sortOrder=${missedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
                );
                const data = await response.json();
                if (data.success && data.invoices) {
                    allInvoices = [...allInvoices, ...data.invoices];
                }
            }
            
            return allInvoices;
        } catch (error) {
            console.error('Error fetching all missed invoices:', error);
            throw error;
        }
    }

    async function handleExportMissedInvoices(format) {
        try {
            setExporting({ tab: 'missed', format });
            const allInvoices = await fetchAllMissedInvoices();
            
            if (allInvoices.length === 0) {
                alert('No missed invoices to export');
                return;
            }

            const headers = [
                { label: 'Supplier Name', key: 'supplierName' },
                { label: 'Invoice Number', key: 'invoiceNumber' },
                { label: 'Xero Date', key: 'xeroDate' },
                { label: 'Supplier Amount', key: 'vendorAmount' },
                { label: 'Supplier Currency', key: 'vendorCurrency' },
                { label: 'Xero Amount', key: 'xeroAmount' },
                { label: 'Xero Currency', key: 'xeroCurrency' },
                { label: 'Status', key: 'status' },
                { label: 'Payment Status', key: 'paymentStatus' }
            ];

            const exportData = allInvoices.map(invoice => {
                const supplierAmount = invoice.vendorAmount || 0;
                const systemAmount = invoice.xeroAmount || 0;
                const supplierCurrency = invoice.vendorCurrency || 'Unknown';
                const xeroCurrency = invoice.xeroCurrency || 'Unknown';
                const status = getReconciliationStatus(invoice);
                const paymentStatus = invoice.paymentStatus === 'paid' ? 'Paid' : 
                                      invoice.paymentStatus === 'unpaid' ? 'Unpaid' : 'Unknown';

                return {
                    supplierName: supplierName,
                    invoiceNumber: invoice.invoiceNumber || '—',
                    xeroDate: formatDate(invoice.xeroDate),
                    vendorAmount: Number(supplierAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    vendorCurrency: supplierCurrency,
                    xeroAmount: Number(systemAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    xeroCurrency: xeroCurrency,
                    status: status === 'fully reconciled' ? 'Fully Reconciled' : 
                            status === 'partially reconciled' ? 'Partially Reconciled' : 'N/A',
                    paymentStatus: paymentStatus
                };
            });

            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `Missing_Invoices_${supplierName}_${dateStr}`;
            
            if (format === 'csv') {
                exportToCSV(exportData, headers, filename);
            } else {
                exportToExcel(exportData, headers, filename);
            }
        } catch (error) {
            alert('Failed to export missed invoices. Please try again.');
            console.error('Export error:', error);
        } finally {
            setExporting({ tab: null, format: null });
        }
    }

    async function fetchAllUnmatchedInvoices() {
        try {
            const firstPageResponse = await fetch(
                `/api/v2/supplier-logs/unmatched-invoices?supplierId=${supplierId}&page=1&sortBy=${unmatchedInvoiceSortBy}&sortOrder=${unmatchedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
            );
            const firstPageData = await firstPageResponse.json();
            
            if (!firstPageData.success) {
                throw new Error('Failed to fetch unmatched invoices');
            }
            
            const totalPages = firstPageData.pages || 1;
            let allInvoices = [...(firstPageData.invoices || [])];
            
            for (let page = 2; page <= totalPages; page++) {
                const response = await fetch(
                    `/api/v2/supplier-logs/unmatched-invoices?supplierId=${supplierId}&page=${page}&sortBy=${unmatchedInvoiceSortBy}&sortOrder=${unmatchedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
                );
                const data = await response.json();
                if (data.success && data.invoices) {
                    allInvoices = [...allInvoices, ...data.invoices];
                }
            }
            
            return allInvoices;
        } catch (error) {
            console.error('Error fetching all unmatched invoices:', error);
            throw error;
        }
    }

    async function handleExportUnmatchedInvoices(format) {
        try {
            setExporting({ tab: 'unmatched', format });
            const allInvoices = await fetchAllUnmatchedInvoices();
            
            if (allInvoices.length === 0) {
                alert('No unmatched invoices to export');
                return;
            }

            const headers = [
                { label: 'Supplier Name', key: 'supplierName' },
                { label: 'Invoice Number', key: 'invoiceNumber' },
                { label: 'Supplier Date', key: 'VendorDate' },
                { label: 'Xero Date', key: 'xeroDate' },
                { label: 'Supplier Amount', key: 'vendorAmount' },
                { label: 'Supplier Currency', key: 'vendorCurrency' },
                { label: 'Xero Amount', key: 'xeroAmount' },
                { label: 'Xero Currency', key: 'xeroCurrency' },
                { label: 'Status', key: 'status' },
                { label: 'Payment Status', key: 'paymentStatus' }
            ];

            const exportData = allInvoices.map(invoice => {
                const supplierAmount = invoice.vendorAmount || 0;
                const systemAmount = invoice.xeroAmount || 0;
                const supplierCurrency = invoice.vendorCurrency || 'Unknown';
                const xeroCurrency = invoice.xeroCurrency || 'Unknown';
                const status = getReconciliationStatus(invoice);
                const paymentStatus = invoice.paymentStatus === 'paid' ? 'Paid' : 
                                      invoice.paymentStatus === 'unpaid' ? 'Unpaid' : 'Unknown';

                return {
                    supplierName: supplierName,
                    invoiceNumber: invoice.invoiceNumber || '—',
                    VendorDate: formatDate(invoice.VendorDate),
                    xeroDate: formatDate(invoice.xeroDate),
                    vendorAmount: Number(supplierAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    vendorCurrency: supplierCurrency,
                    xeroAmount: Number(systemAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    xeroCurrency: xeroCurrency,
                    status: status === 'fully reconciled' ? 'Fully Reconciled' : 
                            status === 'partially reconciled' ? 'Partially Reconciled' : 'N/A',
                    paymentStatus: paymentStatus
                };
            });

            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `Unmatched_Invoices_${supplierName}_${dateStr}`;
            
            if (format === 'csv') {
                exportToCSV(exportData, headers, filename);
            } else {
                exportToExcel(exportData, headers, filename);
            }
        } catch (error) {
            alert('Failed to export unmatched invoices. Please try again.');
            console.error('Export error:', error);
        } finally {
            setExporting({ tab: null, format: null });
        }
    }

    async function fetchAllMatchedInvoices() {
        try {
            const firstPageResponse = await fetch(
                `/api/v2/supplier-logs/matched-invoices?supplierId=${supplierId}&page=1&sortBy=${matchedInvoiceSortBy}&sortOrder=${matchedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
            );
            const firstPageData = await firstPageResponse.json();
            
            if (!firstPageData.success) {
                throw new Error('Failed to fetch matched invoices');
            }
            
            const totalPages = firstPageData.pages || 1;
            let allInvoices = [...(firstPageData.invoices || [])];
            
            for (let page = 2; page <= totalPages; page++) {
                const response = await fetch(
                    `/api/v2/supplier-logs/matched-invoices?supplierId=${supplierId}&page=${page}&sortBy=${matchedInvoiceSortBy}&sortOrder=${matchedInvoiceSortOrder}&paymentFilter=${paymentFilter}`
                );
                const data = await response.json();
                if (data.success && data.invoices) {
                    allInvoices = [...allInvoices, ...data.invoices];
                }
            }
            
            return allInvoices;
        } catch (error) {
            console.error('Error fetching all matched invoices:', error);
            throw error;
        }
    }

    async function handleExportMatchedInvoices(format) {
        try {
            setExporting({ tab: 'matched', format });
            const allInvoices = await fetchAllMatchedInvoices();
            
            if (allInvoices.length === 0) {
                alert('No matched invoices to export');
                return;
            }

            const headers = [
                { label: 'Supplier Name', key: 'supplierName' },
                { label: 'Invoice Number', key: 'invoiceNumber' },
                { label: 'Supplier Date', key: 'VendorDate' },
                { label: 'Xero Date', key: 'xeroDate' },
                { label: 'Supplier Amount', key: 'vendorAmount' },
                { label: 'Supplier Currency', key: 'vendorCurrency' },
                { label: 'Xero Amount', key: 'xeroAmount' },
                { label: 'Xero Currency', key: 'xeroCurrency' },
                { label: 'Difference', key: 'difference' },
                { label: 'Status', key: 'status' },
                { label: 'Payment Status', key: 'paymentStatus' }
            ];

            const exportData = allInvoices.map(invoice => {
                const supplierAmount = invoice.vendorAmount || 0;
                const systemAmount = invoice.xeroAmount || 0;
                const difference = supplierAmount - systemAmount;
                const supplierCurrency = invoice.vendorCurrency || 'Unknown';
                const xeroCurrency = invoice.xeroCurrency || 'Unknown';
                const status = getReconciliationStatus(invoice);
                const paymentStatus = invoice.paymentStatus === 'paid' ? 'Paid' : 
                                      invoice.paymentStatus === 'unpaid' ? 'Unpaid' : 'Unknown';

                return {
                    supplierName: supplierName,
                    invoiceNumber: invoice.invoiceNumber || '—',
                    VendorDate: formatDate(invoice.VendorDate),
                    xeroDate: formatDate(invoice.xeroDate),
                    vendorAmount: Number(supplierAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    vendorCurrency: supplierCurrency,
                    xeroAmount: Number(systemAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    xeroCurrency: xeroCurrency,
                    difference: Number(difference).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                    status: status === 'fully reconciled' ? 'Fully Reconciled' : 
                            status === 'partially reconciled' ? 'Partially Reconciled' : 'N/A',
                    paymentStatus: paymentStatus
                };
            });

            const dateStr = new Date().toISOString().split('T')[0];
            const filename = `Matched_Invoices_${supplierName}_${dateStr}`;
            
            if (format === 'csv') {
                exportToCSV(exportData, headers, filename);
            } else {
                exportToExcel(exportData, headers, filename);
            }
        } catch (error) {
            alert('Failed to export matched invoices. Please try again.');
            console.error('Export error:', error);
        } finally {
            setExporting({ tab: null, format: null });
        }
    }
    
    // Email draft functionality removed - CopilotKit no longer available

    return (
        <>
            <Top />
            <main className={pageStyle.main}>
                <Link to="/v1" className={pageStyle.back}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6"></path>
                    </svg>
                    Back to Suppliers
                </Link>

                <div className={pageStyle.top}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <div>
                            <h1>{supplierName}</h1>
                            <p>
                                {activeTab === 'statements' ? 'Reconciliation statements' : 
                                 activeTab === 'invoices' ? 'All invoices' : 
                                 activeTab === 'missed' ? 'Missed Invoices (Xero)' :
                                 activeTab === 'unmatched' ? 'Unmatched Invoices (Statements)' :
                                 'Matched Invoices'}
                            </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            {(activeTab === 'invoices' || activeTab === 'missed' || activeTab === 'unmatched' || activeTab === 'matched') && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <label htmlFor="paymentFilter" style={{ fontSize: '1.4rem', fontWeight: '500', color: '#374151' }}>
                                        Payment Status:
                                    </label>
                                    <select
                                        id="paymentFilter"
                                        value={paymentFilter}
                                        onChange={(e) => handlePaymentFilterChange(e.target.value)}
                                        style={{
                                            padding: '0.8rem 1.2rem',
                                            fontSize: '1.4rem',
                                            border: '0.1rem solid #e5e7eb',
                                            borderRadius: '0.6rem',
                                            backgroundColor: '#fff',
                                            color: '#1f2937',
                                            cursor: 'pointer',
                                            outline: 'none',
                                            transition: 'all 0.2s'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                                        onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                                    >
                                        <option value="all">All</option>
                                        <option value="paid">Paid</option>
                                        <option value="unpaid">Unpaid</option>
                                    </select>
                                </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginLeft: activeTab === 'statements' ? '0' : '1rem' }}>
                                <label style={{ fontSize: '1.4rem', fontWeight: '500', color: '#374151' }}>
                                    Export:
                                </label>
                                <button
                                    onClick={() => {
                                        if (activeTab === 'statements') handleExportStatements('excel');
                                        else if (activeTab === 'invoices') handleExportInvoices('excel');
                                        else if (activeTab === 'missed') handleExportMissedInvoices('excel');
                                        else if (activeTab === 'unmatched') handleExportUnmatchedInvoices('excel');
                                        else if (activeTab === 'matched') handleExportMatchedInvoices('excel');
                                    }}
                                    disabled={exporting.tab !== null}
                                    className={pageStyle.browseButton}
                                    style={{ 
                                        padding: '0.6rem 1.2rem', 
                                        fontSize: '1.3rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.6rem',
                                        opacity: exporting.tab !== null && (exporting.tab !== activeTab || exporting.format !== 'excel') ? 0.6 : 1,
                                        cursor: exporting.tab !== null ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    {exporting.tab === activeTab && exporting.format === 'excel' ? (
                                        <>
                                            <div className={pageStyle.spinner} style={{ width: '1.4rem', height: '1.4rem', borderWidth: '0.2rem' }}></div>
                                            <span>Exporting...</span>
                                        </>
                                    ) : (
                                        'Excel'
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        if (activeTab === 'statements') handleExportStatements('csv');
                                        else if (activeTab === 'invoices') handleExportInvoices('csv');
                                        else if (activeTab === 'missed') handleExportMissedInvoices('csv');
                                        else if (activeTab === 'unmatched') handleExportUnmatchedInvoices('csv');
                                        else if (activeTab === 'matched') handleExportMatchedInvoices('csv');
                                    }}
                                    disabled={exporting.tab !== null}
                                    className={pageStyle.browseButton}
                                    style={{ 
                                        padding: '0.6rem 1.2rem', 
                                        fontSize: '1.3rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.6rem',
                                        opacity: exporting.tab !== null && (exporting.tab !== activeTab || exporting.format !== 'csv') ? 0.6 : 1,
                                        cursor: exporting.tab !== null ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    {exporting.tab === activeTab && exporting.format === 'csv' ? (
                                        <>
                                            <div className={pageStyle.spinner} style={{ width: '1.4rem', height: '1.4rem', borderWidth: '0.2rem' }}></div>
                                            <span>Exporting...</span>
                                        </>
                                    ) : (
                                        'CSV'
                                    )}
                                </button>
                            </div>
                            <button
                                onClick={handleFindMissedInvoices}
                                disabled={findingMissedInvoices}
                                className={pageStyle.browseButton}
                                style={{ marginLeft: '2rem' }}
                            >
                                {findingMissedInvoices ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                        <div className={pageStyle.spinner}></div>
                                        <span>Finding...</span>
                                    </div>
                                ) : (
                                    'Find Missed Invoices'
                                )}
                            </button>
                            <button
                                onClick={() => setShowPaymentRunModal(true)}
                                className={pageStyle.browseButton}
                                style={{ marginLeft: '2rem' }}
                            >
                                Generate payment run for this supply.
                            </button>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className={pageStyle.topTabs}>
                    <button
                        className={`${pageStyle.topTabButton} ${activeTab === 'statements' ? pageStyle.topTabActive : ''}`}
                        onClick={() => {
                            setActiveTab('statements');
                            setSearchParams({ page: '1', sortBy, sortOrder, name: supplierName, paymentFilter: paymentFilter });
                        }}
                    >
                        Statements
                    </button>
                    <button
                        className={`${pageStyle.topTabButton} ${activeTab === 'invoices' ? pageStyle.topTabActive : ''}`}
                        onClick={() => {
                            setActiveTab('invoices');
                            setSearchParams({ invoicePage: '1', invoiceSortBy, invoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
                        }}
                    >
                        All Invoices
                    </button>
                    <button
                        className={`${pageStyle.topTabButton} ${activeTab === 'missed' ? pageStyle.topTabActive : ''}`}
                        onClick={() => {
                            setActiveTab('missed');
                            setSearchParams({ missedInvoicePage: '1', missedInvoiceSortBy, missedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
                        }}
                        style={{
                            color: activeTab === 'missed' ? '#dc2626' : '#dc2626',
                            borderBottom: activeTab === 'missed' ? '2px solid #dc2626' : '2px solid transparent'
                        }}
                    >
                        Missed Invoices (Xero)
                    </button>
                    <button
                        className={`${pageStyle.topTabButton} ${activeTab === 'unmatched' ? pageStyle.topTabActive : ''}`}
                        onClick={() => {
                            setActiveTab('unmatched');
                            setSearchParams({ unmatchedInvoicePage: '1', unmatchedInvoiceSortBy, unmatchedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
                        }}
                    >
                        Unmatched Invoices (Statements)
                    </button>
                    <button
                        className={`${pageStyle.topTabButton} ${activeTab === 'matched' ? pageStyle.topTabActive : ''}`}
                        onClick={() => {
                            setActiveTab('matched');
                            setSearchParams({ matchedInvoicePage: '1', matchedInvoiceSortBy, matchedInvoiceSortOrder, name: supplierName, paymentFilter: paymentFilter });
                        }}
                    >
                        Matched Invoices
                    </button>
                </div>

                {error && (
                    <div className={pageStyle.errorMessage}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className={pageStyle.loading}>
                        <p>Loading {activeTab === 'statements' ? 'logs' : activeTab === 'invoices' ? 'invoices' : activeTab === 'missed' ? 'missed invoices' : activeTab === 'unmatched' ? 'unmatched invoices' : 'matched invoices'}...</p>
                    </div>
                ) : (
                    <>
                                {(activeTab === 'statements' ? (
                                    <>
                                        <div className={pageStyle.tableContainer}>
                                            <table className={pageStyle.suppliersTable}>
                                                <thead>
                                                    <tr>
                                                        <th onClick={() => handleColumnClick('statementIssueDate')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                STATEMENT ISSUE DATE {sortBy === 'statementIssueDate' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleColumnClick('processDateTime')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                PROCESS DATE/TIME {sortBy === 'processDateTime' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleColumnClick('status')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                STATUS {sortBy === 'status' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleColumnClick('reconciled')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                RECONCILED {sortBy === 'reconciled' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleColumnClick('unreconciled')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                UNRECONCILED {sortBy === 'unreconciled' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleColumnClick('total')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                TOTAL {sortBy === 'total' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th>FILE</th>
                                                        <th>ACTIONS</th>
                                                        <th></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {logs.length === 0 ? (
                                                        <tr>
                                                            <td colSpan="9" className={pageStyle.noData}>
                                                                No logs found for this supplier
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        logs.map((log) => {
                                                            const reconciled = log.reconciled || 0;
                                                            const unreconciled = log.unreconciled || 0;
                                                            const total = log.total || 0;
                                                         
                                                            return (
                                                                <tr 
                                                                    key={log._id} 
                                                                    className={pageStyle.supplierRow}
                                                                    onClick={() => handleRowClick(log._id)}
                                                                >
                                                                    <td>
                                                                        <strong>{formatDate(log.invoiceIssueDate)}</strong>
                                                                    </td>
                                                                    <td>{formatDateTime(log.addedAt)}</td>
                                                                    <td>{getStatusBadge(log)}</td>
                                                                    <td className={pageStyle.reconciled}>{reconciled}</td>
                                                                    <td className={pageStyle.unreconciled}>{unreconciled}</td>
                                                                    <td>{total}</td>
                                                                    <td onClick={(e) => e.stopPropagation()}>
                                                                        <a href={`/file/${log._id}`} target="_blank" rel="noopener noreferrer" className={pageStyle.downloadLink}>
                                                                            Download
                                                                        </a>
                                                                    </td>
                                                                    <td onClick={(e) => e.stopPropagation()}>
                                                                        <button
                                                                            onClick={() => handleDeleteLog(log._id)}
                                                                            className={pageStyle.deleteButton}
                                                                            title="Delete statement"
                                                                        >
                                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                                <path d="M3 6h18"></path>
                                                                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                                                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                                                            </svg>
                                                                        </button>
                                                                    </td>
                                                                    <td>
                                                                        <svg className={pageStyle.arrowIcon} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                            <path d="m9 18 6-6-6-6"></path>
                                                                        </svg>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className={pageStyle.pagination}>
                                            <button
                                                onClick={handlePrevPage}
                                                disabled={page <= 1}
                                                className={pageStyle.pageButton}
                                            >
                                                Previous
                                            </button>
                                            <span className={pageStyle.pageCount}>
                                                {page} / {pages === 0 ? 1 : pages}
                                            </span>
                                            <button
                                                onClick={handleNextPage}
                                                disabled={page >= pages}
                                                className={pageStyle.pageButton}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </>
                                ) : activeTab === 'invoices' ? (
                                    <>
                                        <div className={pageStyle.tableContainer}>
                                            <table className={pageStyle.suppliersTable}>
                                                <thead>
                                                    <tr>
                                                        <th onClick={() => handleInvoiceColumnClick('invoiceNumber')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                INVOICE NUMBER {invoiceSortBy === 'invoiceNumber' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleInvoiceColumnClick('supplierDate')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                SUPPLIER DATE {invoiceSortBy === 'supplierDate' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleInvoiceColumnClick('xeroDate')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                XERO DATE {invoiceSortBy === 'xeroDate' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleInvoiceColumnClick('supplierAmount')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                SUPPLIER AMOUNT {invoiceSortBy === 'supplierAmount' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleInvoiceColumnClick('xeroAmount')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                XERO AMOUNT {invoiceSortBy === 'xeroAmount' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleInvoiceColumnClick('difference')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                DIFFERENCE {invoiceSortBy === 'difference' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleInvoiceColumnClick('foundInXero')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                FOUND IN XERO {invoiceSortBy === 'foundInXero' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleInvoiceColumnClick('status')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                STATUS {invoiceSortBy === 'status' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleInvoiceColumnClick('paymentStatus')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                PAID STATUS {invoiceSortBy === 'paymentStatus' && <span>{invoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {invoices.length === 0 ? (
                                                        <tr>
                                                            <td colSpan="9" className={pageStyle.noData}>
                                                                No invoices found for this supplier
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        invoices.map((invoice) => {
                                                            const supplierAmount = invoice.vendorAmount || 0;
                                                            const systemAmount = invoice.xeroAmount || 0;
                                                            const difference = supplierAmount - systemAmount;
                                                            const currency = invoice.vendorCurrency || invoice.xeroCurrency || '$';
                                                            const foundInSystem = invoice.xeroDate ? 'Yes' : 'No';
                                                            const status = getReconciliationStatus(invoice);

                                                            return (
                                                                <tr 
                                                                    key={invoice._id} 
                                                                    className={pageStyle.supplierRow}
                                                                    onClick={() => handleInvoiceRowClick(invoice)}
                                                                    style={{ cursor: invoice.statementId?._id ? 'pointer' : 'default' }}
                                                                >
                                                                    <td style={{ 
                                                                        color: (!invoice.VendorDate && Number(invoice.vendorAmount) === 0) ? '#dc2626' : 'inherit'
                                                                    }}>
                                                                        <strong>{invoice.invoiceNumber || '—'}</strong>
                                                                    </td>
                                                                    <td>{formatDate(invoice.VendorDate)}</td>
                                                                    <td>{formatDate(invoice.xeroDate)}</td>
                                                                    <td>{formatCurrency(supplierAmount, currency)}</td>
                                                                    <td>{formatCurrency(systemAmount, currency)}</td>
                                                                    <td className={difference !== 0 ? pageStyle.unreconciled : pageStyle.reconciled}>
                                                                        {formatCurrency(difference, currency)}
                                                                    </td>
                                                                    <td>{foundInSystem}</td>
                                                                    <td>
                                                                        {status === 'fully reconciled' && (
                                                                            <span className={pageStyle.statusSuccess}>Fully Reconciled</span>
                                                                        )}
                                                                        {status === 'partially reconciled' && (
                                                                            <span className={pageStyle.statusWarning}>Partially Reconciled</span>
                                                                        )}
                                                                        {status === 'n/a' && (
                                                                            <span style={{ color: '#6b7280', fontWeight: '500' }}>N/A</span>
                                                                        )}
                                                                    </td>
                                                                    <td>
                                                                        {invoice.paymentStatus === 'paid' ? (
                                                                            <span style={{ color: '#059669', fontWeight: '600' }}>Paid</span>
                                                                        ) : invoice.paymentStatus === 'unpaid' ? (
                                                                            <span style={{ color: '#dc2626', fontWeight: '600' }}>Unpaid</span>
                                                                        ) : (
                                                                            <span style={{ color: '#6b7280', fontWeight: '500' }}>Unknown</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className={pageStyle.pagination}>
                                            <button
                                                onClick={handlePrevPage}
                                                disabled={invoicePage <= 1}
                                                className={pageStyle.pageButton}
                                            >
                                                Previous
                                            </button>
                                            <span className={pageStyle.pageCount}>
                                                {invoicePage} / {invoicePages === 0 ? 1 : invoicePages}
                                            </span>
                                            <button
                                                onClick={handleNextPage}
                                                disabled={invoicePage >= invoicePages}
                                                className={pageStyle.pageButton}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </>
                                ) : activeTab === 'missed' ? (
                                    <>
                                        <div className={pageStyle.tableContainer}>
                                            <table className={pageStyle.suppliersTable}>
                                                <thead>
                                                    <tr>
                                                        <th onClick={() => handleMissedInvoiceColumnClick('invoiceNumber')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                INVOICE NUMBER {missedInvoiceSortBy === 'invoiceNumber' && <span>{missedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMissedInvoiceColumnClick('xeroDate')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                XERO DATE {missedInvoiceSortBy === 'xeroDate' && <span>{missedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMissedInvoiceColumnClick('supplierAmount')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                SUPPLIER AMOUNT {missedInvoiceSortBy === 'supplierAmount' && <span>{missedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMissedInvoiceColumnClick('xeroAmount')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                XERO AMOUNT {missedInvoiceSortBy === 'xeroAmount' && <span>{missedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMissedInvoiceColumnClick('status')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                STATUS {missedInvoiceSortBy === 'status' && <span>{missedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMissedInvoiceColumnClick('paymentStatus')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                PAID STATUS {missedInvoiceSortBy === 'paymentStatus' && <span>{missedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th>ACTIONS</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {missedInvoices.length === 0 ? (
                                                        <tr>
                                                            <td colSpan="7" className={pageStyle.noData}>
                                                                No missed invoices found
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        missedInvoices.map((invoice) => {
                                                            const supplierAmount = invoice.vendorAmount || 0;
                                                            const systemAmount = invoice.xeroAmount || 0;
                                                            const currency = invoice.vendorCurrency || invoice.xeroCurrency || '$';
                                                            const status = getReconciliationStatus(invoice);

                                                            return (
                                                                <tr 
                                                                    key={invoice._id} 
                                                                    className={pageStyle.supplierRow}
                                                                    onClick={() => handleInvoiceRowClick(invoice)}
                                                                    style={{ cursor: invoice.statementId?._id ? 'pointer' : 'default' }}
                                                                >
                                                                    <td style={{ 
                                                                        color: (!invoice.VendorDate && Number(invoice.vendorAmount) === 0) ? '#dc2626' : 'inherit'
                                                                    }}>
                                                                        <strong>{invoice.invoiceNumber || '—'}</strong>
                                                                    </td>
                                                                    <td>{formatDate(invoice.xeroDate)}</td>
                                                                    <td>{formatCurrency(supplierAmount, currency)}</td>
                                                                    <td>{formatCurrency(systemAmount, currency)}</td>
                                                                    <td>
                                                                        {status === 'fully reconciled' && (
                                                                            <span className={pageStyle.statusSuccess}>Fully Reconciled</span>
                                                                        )}
                                                                        {status === 'partially reconciled' && (
                                                                            <span className={pageStyle.statusWarning}>Partially Reconciled</span>
                                                                        )}
                                                                        {status === 'n/a' && (
                                                                            <span style={{ color: '#6b7280', fontWeight: '500' }}>N/A</span>
                                                                        )}
                                                                    </td>
                                                                    <td>
                                                                        {invoice.paymentStatus === 'paid' ? (
                                                                            <span style={{ color: '#059669', fontWeight: '600' }}>Paid</span>
                                                                        ) : invoice.paymentStatus === 'unpaid' ? (
                                                                            <span style={{ color: '#dc2626', fontWeight: '600' }}>Unpaid</span>
                                                                        ) : (
                                                                            <span style={{ color: '#6b7280', fontWeight: '500' }}>Unknown</span>
                                                                        )}
                                                                    </td>
                                                                    <td onClick={(e) => e.stopPropagation()}>
                                                                        <button
                                                                            onClick={() => handleDraftEmail(invoice)}
                                                                            className={pageStyle.browseButton}
                                                                            style={{ padding: '0.6rem 1.2rem', fontSize: '1.2rem' }}
                                                                        >
                                                                            Draft Email to Supplier
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className={pageStyle.pagination}>
                                            <button
                                                onClick={handleMissedInvoicePrevPage}
                                                disabled={missedInvoicePage <= 1}
                                                className={pageStyle.pageButton}
                                            >
                                                Previous
                                            </button>
                                            <span className={pageStyle.pageCount}>
                                                {missedInvoicePage} / {missedInvoicePages === 0 ? 1 : missedInvoicePages}
                                            </span>
                                            <button
                                                onClick={handleMissedInvoiceNextPage}
                                                disabled={missedInvoicePage >= missedInvoicePages}
                                                className={pageStyle.pageButton}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </>
                                ) : activeTab === 'unmatched' ? (
                                    <>
                                        <div className={pageStyle.tableContainer}>
                                            <table className={pageStyle.suppliersTable}>
                                                <thead>
                                                    <tr>
                                                        <th onClick={() => handleUnmatchedInvoiceColumnClick('invoiceNumber')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                INVOICE NUMBER {unmatchedInvoiceSortBy === 'invoiceNumber' && <span>{unmatchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleUnmatchedInvoiceColumnClick('supplierDate')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                SUPPLIER DATE {unmatchedInvoiceSortBy === 'supplierDate' && <span>{unmatchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleUnmatchedInvoiceColumnClick('xeroDate')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                XERO DATE {unmatchedInvoiceSortBy === 'xeroDate' && <span>{unmatchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleUnmatchedInvoiceColumnClick('supplierAmount')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                SUPPLIER AMOUNT {unmatchedInvoiceSortBy === 'supplierAmount' && <span>{unmatchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleUnmatchedInvoiceColumnClick('xeroAmount')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                XERO AMOUNT {unmatchedInvoiceSortBy === 'xeroAmount' && <span>{unmatchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleUnmatchedInvoiceColumnClick('status')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                STATUS {unmatchedInvoiceSortBy === 'status' && <span>{unmatchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleUnmatchedInvoiceColumnClick('paymentStatus')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                PAID STATUS {unmatchedInvoiceSortBy === 'paymentStatus' && <span>{unmatchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {unmatchedInvoices.length === 0 ? (
                                                        <tr>
                                                            <td colSpan="7" className={pageStyle.noData}>
                                                                No unmatched invoices found
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        unmatchedInvoices.map((invoice) => {
                                                            const supplierAmount = invoice.vendorAmount || 0;
                                                            const systemAmount = invoice.xeroAmount || 0;
                                                            const currency = invoice.vendorCurrency || invoice.xeroCurrency || '$';
                                                            const status = getReconciliationStatus(invoice);

                                                            return (
                                                                <tr 
                                                                    key={invoice._id} 
                                                                    className={pageStyle.supplierRow}
                                                                    onClick={() => handleInvoiceRowClick(invoice)}
                                                                    style={{ cursor: invoice.statementId?._id ? 'pointer' : 'default' }}
                                                                >
                                                                    <td style={{ 
                                                                        color: (!invoice.VendorDate && Number(invoice.vendorAmount) === 0) ? '#dc2626' : 'inherit'
                                                                    }}>
                                                                        <strong>{invoice.invoiceNumber || '—'}</strong>
                                                                    </td>
                                                                    <td>{formatDate(invoice.VendorDate)}</td>
                                                                    <td>{formatDate(invoice.xeroDate)}</td>
                                                                    <td>{formatCurrency(supplierAmount, currency)}</td>
                                                                    <td>{formatCurrency(systemAmount, currency)}</td>
                                                                    <td>
                                                                        {status === 'fully reconciled' && (
                                                                            <span className={pageStyle.statusSuccess}>Fully Reconciled</span>
                                                                        )}
                                                                        {status === 'partially reconciled' && (
                                                                            <span className={pageStyle.statusWarning}>Partially Reconciled</span>
                                                                        )}
                                                                        {status === 'n/a' && (
                                                                            <span style={{ color: '#6b7280', fontWeight: '500' }}>N/A</span>
                                                                        )}
                                                                    </td>
                                                                    <td>
                                                                        {invoice.paymentStatus === 'paid' ? (
                                                                            <span style={{ color: '#059669', fontWeight: '600' }}>Paid</span>
                                                                        ) : invoice.paymentStatus === 'unpaid' ? (
                                                                            <span style={{ color: '#dc2626', fontWeight: '600' }}>Unpaid</span>
                                                                        ) : (
                                                                            <span style={{ color: '#6b7280', fontWeight: '500' }}>Unknown</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className={pageStyle.pagination}>
                                            <button
                                                onClick={handleUnmatchedInvoicePrevPage}
                                                disabled={unmatchedInvoicePage <= 1}
                                                className={pageStyle.pageButton}
                                            >
                                                Previous
                                            </button>
                                            <span className={pageStyle.pageCount}>
                                                {unmatchedInvoicePage} / {unmatchedInvoicePages === 0 ? 1 : unmatchedInvoicePages}
                                            </span>
                                            <button
                                                onClick={handleUnmatchedInvoiceNextPage}
                                                disabled={unmatchedInvoicePage >= unmatchedInvoicePages}
                                                className={pageStyle.pageButton}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className={pageStyle.tableContainer}>
                                            <table className={pageStyle.suppliersTable}>
                                                <thead>
                                                    <tr>
                                                        <th onClick={() => handleMatchedInvoiceColumnClick('invoiceNumber')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                INVOICE NUMBER {matchedInvoiceSortBy === 'invoiceNumber' && <span>{matchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMatchedInvoiceColumnClick('supplierDate')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                SUPPLIER DATE {matchedInvoiceSortBy === 'supplierDate' && <span>{matchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMatchedInvoiceColumnClick('xeroDate')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                XERO DATE {matchedInvoiceSortBy === 'xeroDate' && <span>{matchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMatchedInvoiceColumnClick('supplierAmount')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                SUPPLIER AMOUNT {matchedInvoiceSortBy === 'supplierAmount' && <span>{matchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMatchedInvoiceColumnClick('xeroAmount')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                XERO AMOUNT {matchedInvoiceSortBy === 'xeroAmount' && <span>{matchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMatchedInvoiceColumnClick('difference')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                DIFFERENCE {matchedInvoiceSortBy === 'difference' && <span>{matchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMatchedInvoiceColumnClick('status')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                STATUS {matchedInvoiceSortBy === 'status' && <span>{matchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                        <th onClick={() => handleMatchedInvoiceColumnClick('paymentStatus')} style={{ cursor: 'pointer' }}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                PAID STATUS {matchedInvoiceSortBy === 'paymentStatus' && <span>{matchedInvoiceSortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                            </span>
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {matchedInvoices.length === 0 ? (
                                                        <tr>
                                                            <td colSpan="8" className={pageStyle.noData}>
                                                                No matched invoices found
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        matchedInvoices.map((invoice) => {
                                                            const supplierAmount = invoice.vendorAmount || 0;
                                                            const systemAmount = invoice.xeroAmount || 0;
                                                            const difference = supplierAmount - systemAmount;
                                                            const currency = invoice.vendorCurrency || invoice.xeroCurrency || '$';
                                                            const status = getReconciliationStatus(invoice);

                                                            return (
                                                                <tr 
                                                                    key={invoice._id} 
                                                                    className={pageStyle.supplierRow}
                                                                    onClick={() => handleInvoiceRowClick(invoice)}
                                                                    style={{ cursor: invoice.statementId?._id ? 'pointer' : 'default' }}
                                                                >
                                                                    <td style={{ 
                                                                        color: (!invoice.VendorDate && Number(invoice.vendorAmount) === 0) ? '#dc2626' : 'inherit'
                                                                    }}>
                                                                        <strong>{invoice.invoiceNumber || '—'}</strong>
                                                                    </td>
                                                                    <td>{formatDate(invoice.VendorDate)}</td>
                                                                    <td>{formatDate(invoice.xeroDate)}</td>
                                                                    <td>{formatCurrency(supplierAmount, currency)}</td>
                                                                    <td>{formatCurrency(systemAmount, currency)}</td>
                                                                    <td className={difference !== 0 ? pageStyle.unreconciled : pageStyle.reconciled}>
                                                                        {formatCurrency(difference, currency)}
                                                                    </td>
                                                                    <td>
                                                                        {status === 'fully reconciled' && (
                                                                            <span className={pageStyle.statusSuccess}>Fully Reconciled</span>
                                                                        )}
                                                                        {status === 'partially reconciled' && (
                                                                            <span className={pageStyle.statusWarning}>Partially Reconciled</span>
                                                                        )}
                                                                        {status === 'n/a' && (
                                                                            <span style={{ color: '#6b7280', fontWeight: '500' }}>N/A</span>
                                                                        )}
                                                                    </td>
                                                                    <td>
                                                                        {invoice.paymentStatus === 'paid' ? (
                                                                            <span style={{ color: '#059669', fontWeight: '600' }}>Paid</span>
                                                                        ) : invoice.paymentStatus === 'unpaid' ? (
                                                                            <span style={{ color: '#dc2626', fontWeight: '600' }}>Unpaid</span>
                                                                        ) : (
                                                                            <span style={{ color: '#6b7280', fontWeight: '500' }}>Unknown</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        <div className={pageStyle.pagination}>
                                            <button
                                                onClick={handleMatchedInvoicePrevPage}
                                                disabled={matchedInvoicePage <= 1}
                                                className={pageStyle.pageButton}
                                            >
                                                Previous
                                            </button>
                                            <span className={pageStyle.pageCount}>
                                                {matchedInvoicePage} / {matchedInvoicePages === 0 ? 1 : matchedInvoicePages}
                                            </span>
                                            <button
                                                onClick={handleMatchedInvoiceNextPage}
                                                disabled={matchedInvoicePage >= matchedInvoicePages}
                                                className={pageStyle.pageButton}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </>
                                ))}
                            </>
                        )}
            </main>

            {showPaymentRunModal && (
                <div className={modalStyle.modalOverlay} onClick={() => setShowPaymentRunModal(false)}>
                    <div className={modalStyle.modalContent} onClick={(e) => e.stopPropagation()}>
                        <div className={modalStyle.modalHeader}>
                            <h2>Generate payment run for this supply.</h2>
                            <button className={modalStyle.closeButton} onClick={() => setShowPaymentRunModal(false)}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" x2="6" y1="6" y2="18"></line>
                                    <line x1="6" x2="18" y1="6" y2="18"></line>
                                </svg>
                            </button>
                        </div>
                        <div className={modalStyle.modalBody}>
                            <p style={{ margin: 0, fontSize: '1.5rem', color: '#374151' }}>
                                This is in development and will be available soon.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
