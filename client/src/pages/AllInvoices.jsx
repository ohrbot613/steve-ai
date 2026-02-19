import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss";
import { getCurrencySymbol } from "../utils/currencyUtils";
import { exportToCSV, exportToExcel } from "../utils/exportUtils";

const API_BASE = "/api/v2/supplier-logs";

export default function AllInvoices() {
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchParams, setSearchParams] = useSearchParams();
    const [pages, setPages] = useState(1);
    const [exporting, setExporting] = useState({ tab: null, format: null });
    const navigate = useNavigate();

    const page = Number(searchParams.get('page')) || 1;
    const sortBy = searchParams.get('sortBy') || 'addedAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const filterTab = searchParams.get('filter') || 'all';
    const paymentFilter = searchParams.get('paymentFilter') || 'unpaid';

    useEffect(() => {
        async function getData() {
            setLoading(true);
            setError('');

            try {
                const response = await fetch(
                    `${API_BASE}/all-invoices?page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}&filter=${filterTab}&paymentFilter=${paymentFilter}`
                );

                if (!response.ok) {
                    throw new Error('Failed to fetch invoices');
                }

                const data = await response.json();
                
                if (data.success) {
                    setInvoices(data.invoices || []);
                    setPages(data.pages || 1);
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

        getData();
    }, [page, sortBy, sortOrder, filterTab, paymentFilter]);

    function formatDate(dateString) {
        if (!dateString) return '—';
        const date = new Date(dateString);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${month} ${day}, ${year}`;
    }

    function formatCurrency(amount, currency = '$') {
        if (amount == null) return '—';
        const currencySymbol = getCurrencySymbol(currency);
        return `${currencySymbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function getReconciliationStatus(invoice) {
        if (invoice.reconciliationStatus === "fully reconciled") return "fully reconciled";
        if (invoice.reconciliationStatus === "not reconciled") return "n/a";
        if (invoice.reconciliationStatus === "partially reconciled") return "partially reconciled";

        const supplierAmount = invoice.vendorAmount;
        const systemAmount = invoice.xeroAmount;
        const hasXeroDate = invoice.xeroDate != null;
        if (!hasXeroDate) return "n/a";
        if (supplierAmount != null && systemAmount != null) {
            const tolerance = 0.01;
            const difference = Math.abs(supplierAmount - systemAmount);
            return difference <= tolerance ? "fully reconciled" : "partially reconciled";
        }
        return "partially reconciled";
    }

    function handleColumnClick(columnName) {
        // If clicking the same column, toggle the order
        if (sortBy === columnName) {
            const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
            setSearchParams({ page: '1', sortBy: columnName, sortOrder: newOrder, filter: filterTab, paymentFilter: paymentFilter });
        } else {
            // If clicking a new column, default to descending
            setSearchParams({ page: '1', sortBy: columnName, sortOrder: 'desc', filter: filterTab, paymentFilter: paymentFilter });
        }
    }

    function handlePrevPage() {
        if (page > 1) {
            setSearchParams({ page: String(page - 1), sortBy, sortOrder, filter: filterTab, paymentFilter: paymentFilter });
        }
    }

    function handleNextPage() {
        if (page < pages) {
            setSearchParams({ page: String(page + 1), sortBy, sortOrder, filter: filterTab, paymentFilter: paymentFilter });
        }
    }

    function handleRowClick(invoice) {
        if (invoice.statementId?._id) {
            navigate(`/v1/single-statement/${invoice.statementId._id}`, {
                state: { from: 'all-invoices' }
            });
        }
    }

    async function handleDeleteInvoice(invoiceId, e) {
        e.stopPropagation(); // Prevent row click event
        
        if (!window.confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/invoices/${invoiceId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (data.success) {
                // Remove the invoice from the list
                setInvoices(prevInvoices => prevInvoices.filter(inv => inv._id !== invoiceId));
                
                // If we deleted the last invoice on the page and it's not page 1, go to previous page
                if (invoices.length === 1 && page > 1) {
                    setSearchParams({ page: String(page - 1), sortBy, sortOrder, filter: filterTab, paymentFilter: paymentFilter });
                }
            } else {
                setError(data.message || 'Failed to delete invoice');
            }
        } catch (err) {
            setError('An error occurred while deleting the invoice');
            console.error(err);
        }
    }

    function handleTabChange(tab) {
        setSearchParams({ 
            page: '1', 
            sortBy, 
            sortOrder, 
            filter: tab,
            paymentFilter: paymentFilter
        });
    }

    function handlePaymentFilterChange(newPaymentFilter) {
        setSearchParams({ 
            page: '1', 
            sortBy, 
            sortOrder, 
            filter: filterTab,
            paymentFilter: newPaymentFilter
        });
    }

    async function fetchAllInvoicesForTab(tab) {
        try {
            const firstPageResponse = await fetch(
                `${API_BASE}/all-invoices?page=1&sortBy=${sortBy}&sortOrder=${sortOrder}&filter=${tab}&paymentFilter=${paymentFilter}`
            );
            const firstPageData = await firstPageResponse.json();
            if (!firstPageData.success) throw new Error('Failed to fetch invoices');

            const totalPages = firstPageData.pages || 1;
            let allInvoices = [...(firstPageData.invoices || [])];
            for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
                const response = await fetch(
                    `${API_BASE}/all-invoices?page=${pageNum}&sortBy=${sortBy}&sortOrder=${sortOrder}&filter=${tab}&paymentFilter=${paymentFilter}`
                );
                const data = await response.json();
                if (data.success && data.invoices) allInvoices = [...allInvoices, ...data.invoices];
            }
            return allInvoices;
        } catch (err) {
            console.error('Error fetching all invoices:', err);
            throw err;
        }
    }

    async function handleExportInvoices(format) {
        try {
            setExporting({ tab: filterTab, format });
            const allInvoices = await fetchAllInvoicesForTab(filterTab);
            
            if (allInvoices.length === 0) {
                alert('No invoices to export');
                return;
            }

            const isMissedExport = filterTab === 'missed';
            const headers = isMissedExport
                ? [
                    { label: 'Supplier Name', key: 'supplierName' },
                    { label: 'Invoice Number', key: 'invoiceNumber' },
                    { label: 'Date', key: 'date' },
                    { label: 'Amount', key: 'amount' },
                    { label: 'Found in Xero', key: 'foundInXero' },
                    { label: 'Status', key: 'status' },
                    { label: 'Payment Status', key: 'paymentStatus' }
                ]
                : [
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
                const supplierCurrency = getCurrencySymbol(invoice.vendorCurrency || '');
                const xeroCurrency = getCurrencySymbol(invoice.xeroCurrency || '');
                const foundInSystem = invoice.xeroDate ? 'Yes' : 'No';
                const status = getReconciliationStatus(invoice);
                const paymentStatus = invoice.paymentStatus === 'paid' ? 'Paid' : 
                                      invoice.paymentStatus === 'unpaid' ? 'Unpaid' : 'Unknown';

                if (isMissedExport) {
                    return {
                        supplierName: invoice.vendorId?.name || 'Unknown',
                        invoiceNumber: invoice.invoiceNumber || '—',
                        date: formatDate(invoice.xeroDate),
                        amount: Number(systemAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                        foundInXero: foundInSystem,
                        status: 'Unreconciled',
                        paymentStatus: paymentStatus
                    };
                }
                return {
                    supplierName: invoice.vendorId?.name || 'Unknown',
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
            const tabName = filterTab === 'all' ? 'All' : 
                           filterTab === 'matched' ? 'Matched' :
                           filterTab === 'unmatched' ? 'Unmatched (Statement)' : 'Missed (Xero)';
            const filename = `${tabName}_Invoices_${dateStr}`;
            
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

    return (
        <>
            <Top />
            <main className={pageStyle.main}>
                <div className={pageStyle.top}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        <div>
                            {loading ? (
                                <>
                                    <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ height: '2.8rem', marginBottom: '0.8rem', maxWidth: '20rem' }} />
                                    <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} style={{ height: '1.6rem', maxWidth: '28rem' }} />
                                </>
                            ) : (
                                <>
                                    <h1>All Invoices</h1>
                                    <p>Complete invoice listing across all suppliers</p>
                                </>
                            )}
                        </div>
                        {!loading && (
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginLeft: '1rem' }}>
                                <label style={{ fontSize: '1.4rem', fontWeight: '500', color: '#374151' }}>
                                    Export:
                                </label>
                                <button
                                    onClick={() => handleExportInvoices('excel')}
                                    disabled={exporting.tab !== null}
                                    className={pageStyle.browseButton}
                                    style={{ 
                                        padding: '0.6rem 1.2rem', 
                                        fontSize: '1.3rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.6rem',
                                        opacity: exporting.tab !== null && (exporting.tab !== filterTab || exporting.format !== 'excel') ? 0.6 : 1,
                                        cursor: exporting.tab !== null ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    {exporting.tab === filterTab && exporting.format === 'excel' ? (
                                        <>
                                            <div className={pageStyle.spinner} style={{ width: '1.4rem', height: '1.4rem', borderWidth: '0.2rem' }}></div>
                                            <span>Exporting...</span>
                                        </>
                                    ) : (
                                        'Excel'
                                    )}
                                </button>
                                <button
                                    onClick={() => handleExportInvoices('csv')}
                                    disabled={exporting.tab !== null}
                                    className={pageStyle.browseButton}
                                    style={{ 
                                        padding: '0.6rem 1.2rem', 
                                        fontSize: '1.3rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.6rem',
                                        opacity: exporting.tab !== null && (exporting.tab !== filterTab || exporting.format !== 'csv') ? 0.6 : 1,
                                        cursor: exporting.tab !== null ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    {exporting.tab === filterTab && exporting.format === 'csv' ? (
                                        <>
                                            <div className={pageStyle.spinner} style={{ width: '1.4rem', height: '1.4rem', borderWidth: '0.2rem' }}></div>
                                            <span>Exporting...</span>
                                        </>
                                    ) : (
                                        'CSV'
                                    )}
                                </button>
                            </div>
                        </div>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className={pageStyle.topTabs}>
                    <button
                        className={`${pageStyle.topTabButton} ${filterTab === 'all' ? pageStyle.topTabActive : ''}`}
                        onClick={() => handleTabChange('all')}
                    >
                        All
                    </button>
                    <button
                        className={`${pageStyle.topTabButton} ${filterTab === 'matched' ? pageStyle.topTabActive : ''}`}
                        onClick={() => handleTabChange('matched')}
                    >
                        Matched
                    </button>
                    <button
                        className={`${pageStyle.topTabButton} ${filterTab === 'unmatched' ? pageStyle.topTabActive : ''}`}
                        onClick={() => handleTabChange('unmatched')}
                    >
                        Unmatched (Statement)
                    </button>
                    <button
                        className={`${pageStyle.topTabButton} ${filterTab === 'missed' ? pageStyle.topTabActive : ''}`}
                        onClick={() => handleTabChange('missed')}
                        style={{
                            color: filterTab === 'missed' ? '#dc2626' : '#dc2626',
                            borderBottom: filterTab === 'missed' ? '2px solid #dc2626' : '2px solid transparent'
                        }}
                    >
                        Missed (Xero)
                    </button>
                </div>

                {error && (
                    <div className={pageStyle.errorMessage}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className={pageStyle.tableContainer}>
                        <table className={pageStyle.suppliersTable}>
                            <thead>
                                <tr>
                                    <th>SUPPLIER</th>
                                    <th>INVOICE NUMBER</th>
                                    <th>SUPPLIER DATE</th>
                                    <th>XERO DATE</th>
                                    <th>SUPPLIER AMOUNT</th>
                                    <th>XERO AMOUNT</th>
                                    <th>DIFFERENCE</th>
                                    <th>FOUND IN XERO</th>
                                    <th>STATUS</th>
                                    <th>PAYMENT STATUS</th>
                                    <th>ACTION</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...Array(10)].map((_, i) => (
                                    <tr key={`skeleton-${i}`} className={pageStyle.skeletonRow}>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ maxWidth: '12rem' }} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '2.4rem' }} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '4rem' }} /></td>
                                        <td><div className={pageStyle.skeletonBlock} style={{ width: '2.4rem', height: '2.4rem', margin: '0 auto', borderRadius: '0.4rem' }} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <>
                        <div className={pageStyle.tableContainer}>
                            <table className={pageStyle.suppliersTable}>
                                <thead>
                                    <tr>
                                        <th onClick={() => handleColumnClick('supplier')} style={{ cursor: 'pointer' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                SUPPLIER {sortBy === 'supplier' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                            </span>
                                        </th>
                                        <th onClick={() => handleColumnClick('invoiceNumber')} style={{ cursor: 'pointer' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                INVOICE NUMBER {sortBy === 'invoiceNumber' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                            </span>
                                        </th>
                                        {filterTab !== 'missed' && (
                                            <th onClick={() => handleColumnClick('supplierDate')} style={{ cursor: 'pointer' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    SUPPLIER DATE {sortBy === 'supplierDate' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                </span>
                                            </th>
                                        )}
                                        <th onClick={() => handleColumnClick('xeroDate')} style={{ cursor: 'pointer' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {filterTab === 'missed' ? 'DATE' : 'XERO DATE'} {sortBy === 'xeroDate' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                            </span>
                                        </th>
                                        {filterTab !== 'missed' && (
                                            <th onClick={() => handleColumnClick('supplierAmount')} style={{ cursor: 'pointer' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    SUPPLIER AMOUNT {sortBy === 'supplierAmount' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                </span>
                                            </th>
                                        )}
                                        <th onClick={() => handleColumnClick('xeroAmount')} style={{ cursor: 'pointer' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {filterTab === 'missed' ? 'AMOUNT' : 'XERO AMOUNT'} {sortBy === 'xeroAmount' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                            </span>
                                        </th>
                                        {filterTab !== 'missed' && (
                                            <th onClick={() => handleColumnClick('difference')} style={{ cursor: 'pointer' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    DIFFERENCE {sortBy === 'difference' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                                </span>
                                            </th>
                                        )}
                                        <th onClick={() => handleColumnClick('foundInXero')} style={{ cursor: 'pointer' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                FOUND IN XERO {sortBy === 'foundInXero' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                            </span>
                                        </th>
                                        <th onClick={() => handleColumnClick('status')} style={{ cursor: 'pointer' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                STATUS {sortBy === 'status' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                            </span>
                                        </th>
                                        <th onClick={() => handleColumnClick('paymentStatus')} style={{ cursor: 'pointer' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                                PAYMENT STATUS {sortBy === 'paymentStatus' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                            </span>
                                        </th>
                                        <th>ACTION</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoices.length === 0 ? (
                                        <tr>
                                            <td colSpan={filterTab === 'missed' ? 8 : 11} className={pageStyle.noData}>
                                                No invoices found
                                            </td>
                                        </tr>
                                    ) : (
                                        invoices.map((invoice) => {
                                            const supplierAmount = Number(invoice.vendorAmount) || 0;
                                            const systemAmount = Number(invoice.xeroAmount) || 0;
                                            const difference = supplierAmount - systemAmount;
                                            const currency = invoice.vendorCurrency || invoice.xeroCurrency || '$';
                                            const foundInSystem = invoice.xeroDate ? 'Yes' : 'No';
                                            const status = getReconciliationStatus(invoice);
                                            const isRed = Math.abs(difference) > 0.001;
                                            const displayDifference = isRed ? -Math.abs(difference) : difference;
                                            const isMissed = filterTab === 'missed';

                                            return (
                                                <tr 
                                                    key={invoice._id} 
                                                    className={pageStyle.supplierRow}
                                                    onClick={() => handleRowClick(invoice)}
                                                    style={{ cursor: invoice.statementId?._id ? 'pointer' : 'default' }}
                                                >
                                                    <td>
                                                        <strong>{invoice.vendorId?.name || 'Unknown'}</strong>
                                                    </td>
                                                    <td style={{ 
                                                        color: (!invoice.VendorDate && Number(invoice.vendorAmount) === 0) ? '#dc2626' : 'inherit'
                                                    }}>
                                                        {invoice.invoiceNumber || '—'}
                                                    </td>
                                                    {!isMissed && <td>{formatDate(invoice.VendorDate)}</td>}
                                                    <td>{formatDate(invoice.xeroDate)}</td>
                                                    {!isMissed && <td>{formatCurrency(supplierAmount, currency)}</td>}
                                                    <td>{formatCurrency(systemAmount, currency)}</td>
                                                    {!isMissed && (
                                                        <td className={isRed ? pageStyle.unreconciled : pageStyle.reconciled}>
                                                            {formatCurrency(displayDifference, currency)}
                                                        </td>
                                                    )}
                                                    <td>{foundInSystem}</td>
                                                    <td>
                                                        {isMissed ? (
                                                            <span style={{ color: '#dc2626', fontWeight: '600' }}>Unreconciled</span>
                                                        ) : (
                                                            <>
                                                                {status === 'fully reconciled' && (
                                                                    <span className={pageStyle.statusSuccess}>Fully Reconciled</span>
                                                                )}
                                                                {status === 'partially reconciled' && (
                                                                    <span className={pageStyle.statusWarning}>Partially Reconciled</span>
                                                                )}
                                                                {status === 'n/a' && (
                                                                    <span style={{ color: '#6b7280', fontWeight: '500' }}>N/A</span>
                                                                )}
                                                            </>
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
                                                    <td>
                                                        <button
                                                            onClick={(e) => handleDeleteInvoice(invoice._id, e)}
                                                            className={pageStyle.deleteButton}
                                                            title="Delete invoice"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M3 6h18"></path>
                                                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                                            </svg>
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
                )}
            </main>
        </>
    );
}






