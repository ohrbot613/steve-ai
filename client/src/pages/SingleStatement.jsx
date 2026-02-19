import { useEffect, useState } from "react";
import { useParams, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss";
import { getCurrencySymbol } from "../utils/currencyUtils";

const API_BASE = "/api/v2/supplier-logs";

export default function SingleStatement() {
    const { logId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const [invoices, setInvoices] = useState([]);
    const [logInfo, setLogInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [pages, setPages] = useState(1);
    // Preserve navigation source to prevent it from changing when sorting
    const [navigationFrom, setNavigationFrom] = useState(() => location.state?.from);
    
    const page = Number(searchParams.get('page')) || 1;
    const sortBy = searchParams.get('sortBy') || 'systemDate';
    const sortOrder = searchParams.get('sortOrder') || 'asc';

    useEffect(() => {
        async function getData() {
            if (!logId) return;
            setLoading(true);
            setError('');

            try {
                const response = await fetch(
                    `${API_BASE}/statements/${logId}/invoices?page=${page}&sortBy=${sortBy}&sortOrder=${sortOrder}`
                );

                if (!response.ok) {
                    throw new Error('Failed to fetch statement details');
                }

                const data = await response.json();
                
                if (data.success) {
                    setInvoices(data.invoices || []);
                    setPages(data.pages || 1);
                    // 2.0 returns statementInfo for header (supplier + statement date)
                    if (data.statementInfo) {
                        const si = data.statementInfo;
                        setLogInfo({
                            invoiceIssueDate: si.invoiceIssueDate,
                            vendorId: si.supplier,
                            supplier: si.supplier,
                        });
                    } else if (data.invoices?.length > 0) {
                        const first = data.invoices[0];
                        setLogInfo({
                            invoiceIssueDate: first.statementId?.invoiceIssueDate,
                            vendorId: first.vendorId,
                            supplier: first.vendorId,
                        });
                    }
                } else {
                    setError('Failed to load statement details');
                }
            } catch (err) {
                setError('An error occurred while loading statement details');
                console.error(err);
            } finally {
                setLoading(false);
            }
        }

        getData();
    }, [logId, page, sortBy, sortOrder]);

    function handleColumnClick(columnName) {
        // If clicking the same column, toggle the order
        if (sortBy === columnName) {
            const newOrder = sortOrder === 'asc' ? 'desc' : 'asc';
            setSearchParams({ page: '1', sortBy: columnName, sortOrder: newOrder });
        } else {
            // If clicking a new column, default to ascending and reset to page 1
            setSearchParams({ page: '1', sortBy: columnName, sortOrder: 'asc' });
        }
    }

    function formatDate(dateString) {
        if (!dateString) return '—';
        const date = new Date(dateString);
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const day = date.getDate();
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${month} ${day}, ${year}`;
    }

    function formatShortDate(dateString) {
        if (!dateString) return '—';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB');
    }

    function formatCurrency(amount, currency = 'USD') {
        if (amount === null || amount === undefined) return '—';
        const currencySymbol = getCurrencySymbol(currency);
        return `${currencySymbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function getAmountMatchStatus(supplierAmount, systemAmount) {
        if (supplierAmount == null || systemAmount == null) {
            return 'N/A';
        }
        const tolerance = 0.01;
        const diff = Math.abs(supplierAmount - systemAmount);
        return diff <= tolerance ? 'Yes' : 'No';
    }

    function getPotentialMatchStatus(invoice) {
        const supplierAmount = invoice.vendorAmount;
        const systemAmount = invoice.xeroAmount;
        const hasSupplierAmount = supplierAmount != null;
        const hasSystemAmount = systemAmount != null;
        const hasXeroDate = invoice.xeroDate != null;
        const hasSupplierDate = invoice.VendorDate != null;

        // If invoice is found in Xero, it's potentially matched
        if (hasXeroDate) {
            return 'Yes';
        }

        // If we have both amounts but no Xero date, it's not matched
        if (hasSupplierAmount && hasSystemAmount && !hasXeroDate) {
            return 'No';
        }

        // If we only have supplier data but no Xero data, can't determine
        if (hasSupplierAmount && !hasSystemAmount) {
            return 'N/A';
        }

        // Default: can't determine
        return 'N/A';
    }

    function getReconciliationStatus(invoice) {
        // 2.0 can send reconciliationStatus from server
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

    const supplierName = logInfo?.vendorId?.name || logInfo?.supplier?.name || 'Supplier';
    const statementDate = logInfo?.invoiceIssueDate ? formatDate(logInfo.invoiceIssueDate) : '—';

    // Determine back navigation based on preserved navigation source
    const fromSupplierLogs = navigationFrom === 'supplier-logs';
    const supplierId = logInfo?.vendorId?._id || logInfo?.supplier?._id;

    function handleBackClick() {
        if (location.state?.from) {
            // Navigate back using browser history if we have state
            navigate(-1);
        } else if (fromSupplierLogs && supplierId) {
            // Go back to supplier logs
            navigate(`/v1/suppliers-logs/${supplierId}?name=${encodeURIComponent(supplierName)}`);
        } else {
            // Default: go back to all statements (route is /statements)
            navigate('/v1/statements');
        }
    }

    const backButtonText = fromSupplierLogs 
        ? `Back to ${supplierName}` 
        : 'Back to All Statements';

    function handlePrevPage() {
        if (page > 1) {
            setSearchParams({ page: String(page - 1), sortBy, sortOrder });
        }
    }

    function handleNextPage() {
        if (page < pages) {
            setSearchParams({ page: String(page + 1), sortBy, sortOrder });
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
                    setSearchParams({ page: String(page - 1), sortBy, sortOrder });
                }
            } else {
                setError(data.message || 'Failed to delete invoice');
            }
        } catch (err) {
            setError('An error occurred while deleting the invoice');
            console.error(err);
        }
    }

    return (
        <>
            <Top />
            <main className={pageStyle.main}>
                <button onClick={handleBackClick} className={pageStyle.back}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m15 18-6-6 6-6"></path>
                    </svg>
                    {backButtonText}
                </button>

                <div className={pageStyle.top}>
                    {loading ? (
                        <>
                            <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ height: '2.8rem', marginBottom: '0.8rem', maxWidth: '28rem' }} />
                            <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} style={{ height: '1.6rem', maxWidth: '20rem' }} />
                        </>
                    ) : (
                        <>
                            <h1>Supplier {supplierName}</h1>
                            <p>Statement issued on {statementDate}</p>
                        </>
                    )}
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
                                    <th>REFERENCE ID</th>
                                    <th>FOUND IN XERO</th>
                                    <th>SUPPLIER DATE</th>
                                    <th>XERO DATE</th>
                                    <th>SUPPLIER AMOUNT</th>
                                    <th>XERO AMOUNT</th>
                                    <th>DIFFERENCE</th>
                                    <th>AMOUNT MATCH</th>
                                    <th>POTENTIALLY MATCHED</th>
                                    <th>STATUS</th>
                                    <th>PAYMENT STATUS</th>
                                    <th>ACTION</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...Array(10)].map((_, i) => (
                                    <tr key={`skeleton-${i}`} className={pageStyle.skeletonRow}>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '2.4rem' }} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} /></td>
                                        <td><div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '2.4rem' }} /></td>
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
                    <div className={pageStyle.tableContainer}>
                        <table className={pageStyle.suppliersTable}>
                            <thead>
                                <tr>
                                    <th onClick={() => handleColumnClick('referenceId')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            REFERENCE ID {sortBy === 'referenceId' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('foundInSystem')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            FOUND IN XERO {sortBy === 'foundInSystem' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('supplierDate')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            SUPPLIER DATE {sortBy === 'supplierDate' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('systemDate')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            XERO DATE {sortBy === 'systemDate' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('supplierAmount')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            SUPPLIER AMOUNT {sortBy === 'supplierAmount' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th onClick={() => handleColumnClick('systemAmount')} style={{ cursor: 'pointer' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            XERO AMOUNT {sortBy === 'systemAmount' && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                                        </span>
                                    </th>
                                    <th>DIFFERENCE</th>
                                    <th>AMOUNT MATCH</th>
                                    <th>POTENTIALLY MATCHED</th>
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
                                        <td colSpan="12" className={pageStyle.noData}>
                                            No invoices found for this statement
                                        </td>
                                    </tr>
                                ) : (
                                    invoices.map((invoice) => {
                                        const supplierAmount = invoice.vendorAmount || 0;
                                        const systemAmount = invoice.xeroAmount || 0;
                                        const difference = supplierAmount - systemAmount;
                                        const currency = invoice.vendorCurrency || invoice.xeroCurrency || 'USD';
                                        const foundInSystem = invoice.xeroDate ? 'Yes' : 'No';
                                        const amountMatch = getAmountMatchStatus(invoice.vendorAmount, invoice.xeroAmount);
                                        const potentialMatch = getPotentialMatchStatus(invoice);
                                        const status = getReconciliationStatus(invoice);

                                        return (
                                            <tr key={invoice._id} className={pageStyle.supplierRow}>
                                                <td>{invoice.invoiceNumber || '—'}</td>
                                                <td>
                                                    {foundInSystem === 'Yes' ? (
                                                        <span style={{ color: '#059669', fontWeight: '600' }}>Yes</span>
                                                    ) : (
                                                        <span style={{ color: '#dc2626', fontWeight: '600' }}>No</span>
                                                    )}
                                                </td>
                                                <td>{formatShortDate(invoice.VendorDate)}</td>
                                                <td>{formatShortDate(invoice.xeroDate)}</td>
                                                <td>{formatCurrency(supplierAmount, currency)}</td>
                                                <td>{formatCurrency(systemAmount, currency)}</td>
                                                <td>
                                                    <span style={{ 
                                                        color: difference !== 0 ? '#dc2626' : '#059669',
                                                        fontWeight: '600'
                                                    }}>
                                                        {difference !== 0 ? '- ' : ''}{formatCurrency(Math.abs(difference), currency)}
                                                    </span>
                                                </td>
                                                <td>
                                                    {amountMatch === 'Yes' ? (
                                                        <span style={{ color: '#059669', fontWeight: '600' }}>Yes</span>
                                                    ) : amountMatch === 'No' ? (
                                                        <span style={{ color: '#dc2626', fontWeight: '600' }}>No</span>
                                                    ) : (
                                                        <span style={{ color: '#6b7280', fontWeight: '600' }}>N/A</span>
                                                    )}
                                                </td>
                                                <td>
                                                    {potentialMatch === 'Yes' ? (
                                                        <span style={{ color: '#059669', fontWeight: '600' }}>Yes</span>
                                                    ) : potentialMatch === 'No' ? (
                                                        <span style={{ color: '#dc2626', fontWeight: '600' }}>No</span>
                                                    ) : (
                                                        <span style={{ color: '#6b7280', fontWeight: '600' }}>N/A</span>
                                                    )}
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
                )}

                {!loading && invoices.length > 0 && pages > 1 && (
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
                )}
            </main>
        </>
    );
}
