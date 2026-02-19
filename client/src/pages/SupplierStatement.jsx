import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Top from "../componentes/Top";
import pageStyle from "../scss/Pages.module.scss"

export default function Home() {
    const { supplierId } = useParams();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchParams, setSearchParams] = useSearchParams();
    const [pages, setPages] = useState(1);
    console.log(supplierId)
    const page = Number(searchParams.get('page')) || 1;

    function formatDate(dateString) {
        if (!dateString) return 'Unknown';
        const date = new Date(dateString);
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        const month = monthNames[date.getMonth()];
        const year = date.getFullYear();
        return `${month} ${day}, ${year}`;
    }

    useEffect(() => {
        async function getData() {
            setLoading(true);
            setError('');

            try {
                const response = await fetch(
                    `/api/v1/invoice/get-statements?page=${page}&id=${supplierId}`
                );

                if (!response.ok) {
                    throw new Error('Failed to fetch Reconciliation statements');
                }

                const data = await response.json();

                if (data.success) {
                    console.log(data)
                    setLogs(data.logs || []);
                    setPages(data.pages || 1);

                } else {
                    setError('Failed to load Reconciliation statements');
                }
            } catch (err) {
                setError('An error occurred while loading Reconciliation statements');
                console.error(err);
            } finally {
                setLoading(false);
            }
        }

        getData();
    }, [page]);



    function handleSupplierClick(supplierId, supplierName) {
        window.location.href = `/v1/suppliers-statements/${supplierId}?name=${encodeURIComponent(supplierName)}`;
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

    return (
        <>
            <Top />
            <main className={pageStyle.main}>
                <Link to="/v1" className={pageStyle.back}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left w-4 h-4" data-filename="pages/SupplierStatements" data-linenumber="29" data-visual-selector-id="pages/SupplierStatements29" data-source-location="pages/SupplierStatements:29:10" data-dynamic-content="false"><path d="m15 18-6-6 6-6"></path></svg>
                    Back to Suppliers
                </Link>
                <div className={pageStyle.top}>
                    <h1>Acme Corporation</h1>
                    <p>Reconciliation statements</p>
                </div>


                {error && (
                    <div className={pageStyle.errorMessage}>
                        {error}
                    </div>
                )}

                {loading ? (
                    <div className={pageStyle.loading}>
                        <p>Loading suppliers...</p>
                    </div>
                ) : (
                    <>
                        <div className={pageStyle.tableContainer}>
                            <table className={pageStyle.suppliersTable}>
                                <thead>
                                    <tr>
                                        <th>STATEMENT ISSUE DATE</th>
                                        <th>Process Date/Time</th>
                                        <th>Status</th>
                                        <th>Reconciled</th>
                                        <th>Unreconciled</th>
                                        <th>Total</th>
                                        <th>file</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.length === 0 ? (
                                        <tr>
                                            <td colSpan="2" className={pageStyle.noData}>
                                                No suppliers found
                                            </td>
                                        </tr>
                                    ) : (
                                        logs.map((supplier) => (
                                            <tr
                                                key={supplier._id}
                                                className={pageStyle.supplierRow}

                                            >
                                                <td>
                                                    {formatDate(supplier.invoiceIssueDate)}
                                                </td>
                                                <td>
                                                    {formatDate(supplier.addedAt)}
                                                </td>
                                                <td>
                                                    {
                                                        supplier.unmatched == 0 ? (
                                                            <span className={pageStyle.statusSuccess}>Fully Reconciled</span>
                                                        ) : supplier.match > 0 && supplier.unmatched > 0 ? (
                                                            <span className={pageStyle.statusWarning}>Partially Reconciled</span>
                                                        ) : (
                                                            <span className={pageStyle.statusError}>Unreconciled</span>
                                                        )
                                                    }
                                                </td>
                                                <td className={pageStyle.reconciled}>
                                                    {supplier.match || 0}
                                                </td>
                                                <td className={pageStyle.unreconciled}>
                                                    - {supplier.unmatched || 0}
                                                </td>
                                                <td>
                                                    {(supplier.match || 0) + (supplier.unmatched || 0)}
                                                </td>
                                                <td>
                                                    <a href={`/file/${supplier._id}`} target="_blank" rel="noopener noreferrer" className={pageStyle.downloadLink}>
                                                        Download
                                                    </a>
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
    )
}
