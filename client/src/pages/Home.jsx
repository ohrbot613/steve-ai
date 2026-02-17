import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss"

export default function Home() {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchParams, setSearchParams] = useSearchParams();
    const [pages, setPages] = useState(1);
    const [uploadLoading, setUploadLoading] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState('');
    const [uploadError, setUploadError] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [findingMissedInvoices, setFindingMissedInvoices] = useState({});
    const [xeroConnected, setXeroConnected] = useState(false);

    const page = Number(searchParams.get('page')) || 1;
    const search = searchParams.get('search') || '';
    const xeroConnectedParam = searchParams.get('xeroConnected');

    useEffect(() => {
        let cancelled = false;

        async function getData() {
            setLoading(true);
            setError('');

            try {
                // Load first 50 vendors immediately (no statement/invoice lookups)
                const response = await fetch(
                    `/api/v2/vendor/get-vendors?page=${page}&search=${encodeURIComponent(search)}`
                );

                if (!response.ok) {
                    throw new Error('Failed to fetch suppliers');
                }

                const data = await response.json();

                if (!data.success) {
                    setError('Failed to load suppliers');
                    return;
                }

                const list = data.suppliers || [];
                setSuppliers(list);
                setPages(data.pages || 1);
                setLoading(false);

                // Then fetch counts for this page and merge into suppliers
                const countsRes = await fetch(
                    `/api/v2/vendor/get-vendor-counts?page=${page}&search=${encodeURIComponent(search)}`
                );
                if (cancelled || !countsRes.ok) return;

                const countsData = await countsRes.json();
                if (!countsData.success || !countsData.counts) return;

                const countById = Object.fromEntries(
                    (countsData.counts || []).map((c) => [String(c._id), { logCount: c.logCount ?? 0, invoiceCount: c.invoiceCount ?? 0 }])
                );

                setSuppliers((prev) =>
                    prev.map((s) => {
                        const counts = countById[String(s._id)];
                        if (!counts) return s;
                        return { ...s, logCount: counts.logCount, invoiceCount: counts.invoiceCount };
                    })
                );
            } catch (err) {
                if (!cancelled) {
                    setError('An error occurred while loading suppliers');
                    console.error(err);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        getData();
        return () => { cancelled = true; };
    }, [page, search]);

    // Check for Xero connection success
    useEffect(() => {
        if (xeroConnectedParam === 'success') {
            setXeroConnected(true);
            // Clear the query parameter
            const newParams = new URLSearchParams(searchParams);
            newParams.delete('xeroConnected');
            setSearchParams(newParams, { replace: true });
            // Clear the message after 5 seconds
            setTimeout(() => {
                setXeroConnected(false);
            }, 5000);
        }
    }, [xeroConnectedParam, searchParams, setSearchParams]);

    function handleSearch(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const searchValue = formData.get('search') || '';
        setSearchParams({ page: '1', search: searchValue });
    }

    function handleSupplierClick(supplierId, supplierName) {
        window.location.href = `/suppliers-logs/${supplierId}?name=${encodeURIComponent(supplierName)}`;
    }

    function handlePrevPage() {
        if (page > 1) {
            setSearchParams({ page: String(page - 1), ...(search && { search }) });
        }
    }

    function handleNextPage() {
        if (page < pages) {
            setSearchParams({ page: String(page + 1), ...(search && { search }) });
        }
    }

    async function handleFileUpload(files) {
        if (!files || files.length === 0) return;

        // Validate file types (PDF or Excel)
        const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
        const allowedExtensions = ['.pdf', '.xlsx', '.xls'];
        
        const fileArray = Array.from(files);
        const invalidFiles = fileArray.filter(file => {
            const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
            return !allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension);
        });

        if (invalidFiles.length > 0) {
            setUploadError(`Please upload only PDF or Excel files (.pdf, .xlsx, .xls). Invalid files: ${invalidFiles.map(f => f.name).join(', ')}`);
            return;
        }

        setUploadLoading(true);
        setUploadError('');
        setUploadSuccess('');

        const successes = [];
        const errors = [];

        try {
            // Version 2.0: one file per request to /api/v2/invoice/invoice-file-upload (field name "file")
            for (const file of fileArray) {
                const formData = new FormData();
                formData.append('file', file);

                const response = await fetch('/api/v2/invoice/invoice-file-upload', {
                    method: 'POST',
                    body: formData,
                });

                const data = await response.json();

                if (!response.ok) {
                    const msg = data.message || data.error?.message || 'Failed to parse file';
                    errors.push({ fileName: file.name, error: msg });
                    continue;
                }

                if (data.success) {
                    const vendorName = data.vendor?.name || 'supplier';
                    const createdCount = data.createdCount ?? (data.created?.length ?? 0);
                    successes.push({
                        fileName: file.name,
                        vendorName,
                        createdCount,
                    });
                } else {
                    errors.push({ fileName: file.name, error: data.message || 'Failed to process file' });
                }
            }

            if (successes.length > 0) {
                let successMessage = successes.length === 1
                    ? `File "${successes[0].fileName}" processed successfully.`
                    : `Processed ${successes.length} of ${fileArray.length} file(s) successfully.`;
                if (successes.some(s => s.createdCount > 0)) {
                    const totalCreated = successes.reduce((sum, s) => sum + s.createdCount, 0);
                    successMessage += ` ${totalCreated} invoice(s) saved to database.`;
                }
                if (errors.length > 0) {
                    successMessage += ` ${errors.length} file(s) failed: ${errors.map(e => `${e.fileName}: ${e.error}`).join('; ')}`;
                }
                setUploadSuccess(successMessage);
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            }
            if (errors.length > 0 && successes.length === 0) {
                setUploadError(errors.length === 1
                    ? errors[0].error
                    : errors.map(e => `${e.fileName}: ${e.error}`).join('; '));
            }
        } catch (err) {
            const errorMessage = err.message || 'An error occurred while processing the file(s)';
            setUploadError(errorMessage);
            console.error('File upload error:', err);
        } finally {
            setUploadLoading(false);
        }
    }

    function handleDragOver(e) {
        e.preventDefault();
        setIsDragging(true);
    }

    function handleDragLeave(e) {
        e.preventDefault();
        setIsDragging(false);
    }

    function handleDrop(e) {
        e.preventDefault();
        setIsDragging(false);
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileUpload(files);
        }
    }

    function handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            handleFileUpload(files);
        }
    }

    async function handleFindMissedInvoices(supplierId, e) {
        if (e) {
            e.stopPropagation();
        }
        
        setFindingMissedInvoices(prev => ({ ...prev, [supplierId]: true }));
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
                setUploadSuccess(`Missing invoices found for supplier`);
                setTimeout(() => {
                    setUploadSuccess('');
                }, 3000);
            } else {
                setError(data.message || 'Failed to find missed invoices');
            }
        } catch (err) {
            setError('An error occurred while finding missed invoices');
            console.error(err);
        } finally {
            setFindingMissedInvoices(prev => ({ ...prev, [supplierId]: false }));
        }
    }

    return (
        <>
            <Top />
            <main className={pageStyle.main}>
                <div className={pageStyle.top}>
                    <h1>Suppliers</h1>
                    <p>Overview of all suppliers and their statements</p>
                </div>

                {/* File Upload Section */}
                <div className={pageStyle.uploadSection}>
                    <div 
                        className={`${pageStyle.dropZone} ${isDragging ? pageStyle.dragging : ''} ${uploadLoading ? pageStyle.uploading : ''}`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                    >
                        {uploadLoading ? (
                            <div className={pageStyle.uploadLoader}>
                                <div className={pageStyle.spinner}></div>
                                <p>Uploading and processing file...</p>
                            </div>
                        ) : (
                            <>
                                <svg className={pageStyle.uploadIcon} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="17 8 12 3 7 8"></polyline>
                                    <line x1="12" y1="3" x2="12" y2="15"></line>
                                </svg>
                                <p>Drag and drop PDF or Excel file(s) or browse</p>
                                <input 
                                    type="file" 
                                    accept=".pdf,.xlsx,.xls,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                                    onChange={handleFileSelect}
                                    className={pageStyle.fileInput}
                                    multiple
                                />
                                <button 
                                    type="button" 
                                    className={pageStyle.browseButton}
                                    onClick={() => document.querySelector(`.${pageStyle.fileInput}`).click()}
                                >
                                    Browse
                                </button>
                            </>
                        )}
                    </div>

                    {uploadSuccess && (
                        <div className={pageStyle.successMessage}>
                            {uploadSuccess}
                        </div>
                    )}

                    {uploadError && (
                        <div className={pageStyle.errorMessage}>
                            {uploadError}
                        </div>
                    )}

                    {xeroConnected && (
                        <div className={pageStyle.successMessage}>
                            Successfully connected to Xero! Your account is now linked.
                        </div>
                    )}
                </div>

                <form onSubmit={handleSearch} className={pageStyle.searchForm}>
                    <div className={pageStyle.searchInput}>
                        <input
                            type="text"
                            name="search"
                            placeholder="Search suppliers..."
                            defaultValue={search}
                        />
                        <button type="submit">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
                            </svg>
                        </button>
                    </div>
                </form>

                {error && (
                    <div className={pageStyle.errorMessage}>
                        {error}
                    </div>
                )}

                <div className={pageStyle.tableContainer}>
                    <table className={pageStyle.suppliersTable}>
                        <thead>
                            <tr>
                                <th>SUPPLIER NAME</th>
                                <th>NUMBER OF STATEMENTS</th>
                                <th>NUMBER OF INVOICES</th>
                                <th>ACTIONS</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                // Skeleton (guts) loading: show table structure with placeholder rows
                                Array.from({ length: 10 }).map((_, i) => (
                                    <tr key={`skeleton-${i}`} className={pageStyle.skeletonRow}>
                                        <td>
                                            <div className={pageStyle.supplierName}>
                                                <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} style={{ width: '2rem', height: '2rem', borderRadius: '0.4rem' }} />
                                                <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonShort}`} />
                                            </div>
                                        </td>
                                        <td>
                                            <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} />
                                        </td>
                                        <td>
                                            <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonMedium}`} />
                                        </td>
                                        <td>
                                            <div className={`${pageStyle.skeletonBlock} ${pageStyle.skeletonButton}`} />
                                        </td>
                                        <td>
                                            <div className={pageStyle.skeletonBlock} style={{ width: '1.6rem', height: '1.6rem', margin: '0 auto' }} />
                                        </td>
                                    </tr>
                                ))
                            ) : suppliers.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className={pageStyle.noData}>
                                        No suppliers found
                                    </td>
                                </tr>
                            ) : (
                                suppliers.map((supplier) => (
                                            <tr
                                                key={supplier._id}
                                                className={pageStyle.supplierRow}
                                                onClick={() => handleSupplierClick(supplier._id, supplier.name)}
                                            >
                                                <td>
                                                    <div className={pageStyle.supplierName}>
                                                        <svg className={pageStyle.documentIcon} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path>
                                                            <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
                                                            <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path>
                                                            <path d="M10 6h4"></path>
                                                            <path d="M10 10h4"></path>
                                                            <path d="M10 14h4"></path>
                                                            <path d="M10 18h4"></path>
                                                        </svg>
                                                        <span>{supplier.name}</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className={pageStyle.statementCount}>
                                                        <span>{supplier.logCount || 0} statements</span>
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className={pageStyle.statementCount}>
                                                        <span>{supplier.invoiceCount || 0} invoices</span>
                                                    </div>
                                                </td>
                                                <td onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        onClick={(e) => handleFindMissedInvoices(supplier._id, e)}
                                                        disabled={findingMissedInvoices[supplier._id]}
                                                        className={pageStyle.browseButton}
                                                        style={{ 
                                                            padding: '0.6rem 1.2rem',
                                                            fontSize: '1.3rem',
                                                            whiteSpace: 'nowrap'
                                                        }}
                                                    >
                                                        {findingMissedInvoices[supplier._id] ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                                                                <div className={pageStyle.spinner}></div>
                                                                <span>Finding...</span>
                                                            </div>
                                                        ) : (
                                                            'Find Missing Invoices'
                                                        )}
                                                    </button>
                                                </td>
                                                <td>
                                                    <svg className={pageStyle.arrowIcon} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="m9 18 6-6-6-6"></path>
                                                    </svg>
                                                </td>
                                            </tr>
                                        ))
                            )}
                        </tbody>
                            </table>
                </div>

                <div className={pageStyle.pagination}>
                    <button
                        onClick={handlePrevPage}
                        disabled={page <= 1 || loading}
                        className={pageStyle.pageButton}
                    >
                        Previous
                    </button>
                    <span className={pageStyle.pageCount}>
                        {page} / {pages === 0 ? 1 : pages}
                    </span>
                    <button
                        onClick={handleNextPage}
                        disabled={page >= pages || loading}
                        className={pageStyle.pageButton}
                    >
                        Next
                    </button>
                </div>
            </main>
        </>
    )
}
