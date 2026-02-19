import { useState, useEffect } from "react"
import { Link, useNavigate, useLocation } from "react-router-dom"
import styles from "../scss/Top.module.scss"
import modalStyle from "../scss/Modal.module.scss"
import UserProfile from "./UserProfile"
import ReportErrorModal from "./ReportErrorModal"
import { formatCurrency } from '../utils/currencyUtils'
import { useAppMode } from '../context/AppModeContext'

const DASHBOARD_STATS_URL = "/api/v2/dashboard/stats";
const RELOAD_SUPPLIERS_URL = "/api/v2/scripts/get-all-vendors";
const RELOAD_INVOICES_URL = "/api/v2/scripts/get-all-invoices";
const RELOADING_STATUS_URL = "/api/v2/scripts/reloading-status";
const RELOADING_POLL_MS = 6000;

export default function Top() {
    const navigate = useNavigate();
    const location = useLocation();
    const { appMode, setAppMode } = useAppMode();
    const [showReportError, setShowReportError] = useState(false);
    const [bankBalance, setBankBalance] = useState(null);
    const [balanceLoading, setBalanceLoading] = useState(true);
    const [reloadConfirm, setReloadConfirm] = useState(null);
    const [reloading, setReloading] = useState(null);
    const [reloadResult, setReloadResult] = useState(null);
    const [backendReloading, setBackendReloading] = useState(false);

    useEffect(() => {
        async function fetchBalance() {
            try {
                const response = await fetch(DASHBOARD_STATS_URL, {
                    method: "GET",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                });
                const data = await response.json();
                if (response.ok && data.success && data.bankBalance != null) {
                    setBankBalance(data.bankBalance);
                }
            } catch {
                // ignore
            } finally {
                setBalanceLoading(false);
            }
        }
        fetchBalance();
    }, []);

    useEffect(() => {
        async function checkReloading() {
            try {
                const res = await fetch(RELOADING_STATUS_URL, { credentials: "include", headers: { "Content-Type": "application/json" } });
                const data = await res.json();
                if (data.success && data.reloading) setBackendReloading(true);
                else if (data.success && !data.reloading) setBackendReloading(false);
            } catch {
                setBackendReloading(false);
            }
        }
        checkReloading();
        const id = setInterval(checkReloading, RELOADING_POLL_MS);
        return () => clearInterval(id);
    }, []);

    // Determine main section
    const isDashboardActive = location.pathname === '/' || location.pathname === '/dashboard';
    const isRunPaymentsActive = location.pathname === '/run-payments';
    const isActivityActive = location.pathname === '/activity';
    const isReconciliationActive = !isRunPaymentsActive && !isDashboardActive && !isActivityActive;

    // Determine which sub-link should be active (Reconciliation sub-nav)
    const isSuppliersActive = location.pathname === '/' || location.pathname === '/suppliers' || location.pathname.startsWith('/suppliers-');
    const isStatementsActive = location.pathname === '/statements';
    const isInvoicesActive = location.pathname === '/invoices';

    async function handleReloadConfirm() {
        if (!reloadConfirm) return;
        setReloading(reloadConfirm);
        setReloadResult(null);
        setBackendReloading(true);
        const url = reloadConfirm === "suppliers" ? RELOAD_SUPPLIERS_URL : RELOAD_INVOICES_URL;
        const method = "POST";
        try {
            const response = await fetch(url, {
                method,
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (response.ok && data.success) {
                setReloadResult({ success: true, message: data.message || "Done." });
            } else {
                setReloadResult({ success: false, message: data.message || data.error?.message || "Something went wrong." });
            }
        } catch (err) {
            setReloadResult({ success: false, message: err.message || "Request failed." });
        } finally {
            setReloading(null);
            setBackendReloading(false);
        }
    }

    function closeReloadModal() {
        setReloadConfirm(null);
        setReloadResult(null);
    }

    async function handleLogout() {
        try {
            const response = await fetch('/api/v1/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });

            const data = await response.json();

            if (data.status === 'success' || response.ok) {
                navigate('/login');
            } else {
                console.error('Logout error:', data.message);
                navigate('/login');
            }
        } catch (err) {
            console.error('Logout error:', err);
            navigate('/login');
        }
    }

    return (
        <>
        {backendReloading && (
            <div className={styles.reloadBlockOverlay} role="alert" aria-live="polite">
                <div className={styles.reloadBlockContent}>
                    <div className={styles.reloadBlockSpinner} />
                    <p className={styles.reloadBlockTitle}>Reloading data from Xero</p>
                    <p className={styles.reloadBlockMessage}>You cannot use the site until this finishes. This may take around 10 minutes.</p>
                </div>
            </div>
        )}
        <div className={styles.topWrapper}>
            {/* Main top nav */}
            <div className={styles.top}>
                <div className={styles.topLeft}>
                    <p>Steve Solutions</p>
                    <div className={styles.topLeftLinks}>
                        <Link className={`${styles.topLeftLink} ${isDashboardActive ? styles.topLeftLinkActive : ''}`} to="/">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>
                            <p>Dashboard</p>
                        </Link>
                        <Link className={`${styles.topLeftLink} ${isRunPaymentsActive ? styles.topLeftLinkActive : ''}`} to="/run-payments">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                            <p>Payments Run</p>
                        </Link>
                        <Link className={`${styles.topLeftLink} ${isReconciliationActive ? styles.topLeftLinkActive : ''}`} to="/suppliers">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>
                            <p>Reconciliation</p>
                        </Link>
                        <Link className={`${styles.topLeftLink} ${isActivityActive ? styles.topLeftLinkActive : ''}`} to="/activity">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"></path></svg>
                            <p>Activity</p>
                        </Link>
                    </div>
                </div>
                <div className={styles.topRight}>
                    <div className={styles.appModeSwitch} role="switch" aria-checked={appMode === 'simple'}>
                        <button
                            type="button"
                            className={`${styles.appModeBtn} ${appMode === 'full' ? styles.appModeBtnActive : ''}`}
                            onClick={() => setAppMode('full')}
                        >
                            Full app
                        </button>
                        <button
                            type="button"
                            className={`${styles.appModeBtn} ${appMode === 'simple' ? styles.appModeBtnActive : ''}`}
                            onClick={() => setAppMode('simple')}
                        >
                            Simple
                        </button>
                    </div>
                    <div className={styles.userBalance}>
                        <span className={styles.userBalanceLabel}>
                            Bank balance
                        </span>
                        <span className={styles.userBalanceAmount}>
                            {balanceLoading ? 'Loading...' :
                             bankBalance != null ? formatCurrency(bankBalance, null) : '—'}
                        </span>
                    </div>
                    <button
                        type="button"
                        className={styles.reportErrorButton}
                        onClick={() => setShowReportError(true)}
                        title="Report an error"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                            <path d="M12 9v4"></path>
                            <path d="M12 17h.01"></path>
                        </svg>
                        <p>Report error</p>
                    </button>
                    <UserProfile
                        onLogout={handleLogout}
                        onReloadSuppliers={() => setReloadConfirm("suppliers")}
                        onReloadInvoices={() => setReloadConfirm("invoices")}
                    />
                </div>
                {showReportError && (
                    <ReportErrorModal onClose={() => setShowReportError(false)} />
                )}
                {reloadConfirm && (
                    <div
                        className={modalStyle.modalOverlay}
                        onClick={() => !reloading && closeReloadModal()}
                    >
                        <div className={modalStyle.modalContent} onClick={(e) => e.stopPropagation()}>
                            <div className={modalStyle.modalHeader}>
                                <h2>
                                    {reloadConfirm === "suppliers" ? "Reload suppliers from Xero" : "Reload invoices from Xero"}
                                </h2>
                                {!reloading && !reloadResult && (
                                    <button type="button" className={modalStyle.closeButton} onClick={closeReloadModal}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
                                    </button>
                                )}
                            </div>
                            <div className={modalStyle.modalBody}>
                                {reloading && (
                                    <>
                                        <p style={{ margin: 0, fontSize: "1.5rem", color: "#374151", marginBottom: "1rem" }}>
                                            This may take around 10 minutes. Please do not close this window or use the site.
                                        </p>
                                        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                                            <div className={modalStyle.spinner} style={{ width: "2.4rem", height: "2.4rem", borderWidth: "0.3rem" }} />
                                            <span style={{ fontSize: "1.5rem", color: "#6b7280" }}>Reloading…</span>
                                        </div>
                                    </>
                                )}
                                {!reloading && !reloadResult && (
                                    <p style={{ margin: 0, fontSize: "1.5rem", color: "#374151" }}>
                                        This may take around 10 minutes. You will not be able to use the site while it runs. Are you sure you want to continue?
                                    </p>
                                )}
                                {!reloading && reloadResult && (
                                    <p style={{ margin: 0, fontSize: "1.5rem", color: reloadResult.success ? "#059669" : "#dc2626" }}>
                                        {reloadResult.success ? reloadResult.message : reloadResult.message}
                                    </p>
                                )}
                            </div>
                            {!reloading && (
                                <div className={modalStyle.modalFooter}>
                                    {!reloadResult ? (
                                        <>
                                            <button type="button" className={modalStyle.cancelButton} onClick={closeReloadModal}>
                                                Cancel
                                            </button>
                                            <button type="button" className={modalStyle.submitButton} onClick={handleReloadConfirm}>
                                                Yes, run it
                                            </button>
                                        </>
                                    ) : (
                                        <button type="button" className={modalStyle.submitButton} onClick={closeReloadModal}>
                                            OK
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Divider between main nav and sub-nav */}
            {isReconciliationActive && <div className={styles.navDivider} />}

            {/* Sub-nav for Reconciliation */}
            {isReconciliationActive && (
                <div className={styles.subNav}>
                    <div className={styles.subNavLinks}>
                        <Link className={`${styles.subNavLink} ${isSuppliersActive ? styles.subNavLinkActive : ''}`} to="/suppliers">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>
                            <p>Suppliers</p>
                        </Link>
                        <Link className={`${styles.subNavLink} ${isStatementsActive ? styles.subNavLinkActive : ''}`} to="/statements">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h.01"></path><path d="M3 18h.01"></path><path d="M3 6h.01"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M8 6h13"></path></svg>
                            <p>All Statements</p>
                        </Link>
                        <Link className={`${styles.subNavLink} ${isInvoicesActive ? styles.subNavLinkActive : ''}`} to="/invoices">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"></path><path d="M14 8H8"></path><path d="M16 12H8"></path><path d="M13 16H8"></path></svg>
                            <p>All Invoices</p>
                        </Link>
                    </div>
                </div>
            )}
        </div>
        </>
    )
}
