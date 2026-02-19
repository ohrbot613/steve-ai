import { useState, useCallback, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import ReportErrorModal from "./ReportErrorModal";
import styles from "../scss/Top.module.scss";
import layoutStyles from "../scss/SimpleLayout.module.scss";

export default function SimpleLayout({ children }) {
  const navigate = useNavigate();
  const [showReportError, setShowReportError] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);

  useEffect(() => {
    const handler = (e) => setUploadLoading(Boolean(e?.detail?.loading));
    window.addEventListener("simple-app-upload-loading", handler);
    return () => window.removeEventListener("simple-app-upload-loading", handler);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
    } finally {
      navigate("/login");
    }
  }, [navigate]);

  return (
    <div className={layoutStyles.root}>
      <header className={`${styles.topWrapper} ${styles.topWrapperDark}`}>
        <div className={styles.top}>
          <div className={styles.topLeft}>
            <p>Steve Solutions</p>
          </div>
          <div className={styles.topRight}>
            <button
              type="button"
              className={`${styles.uploadStatementsBtn} ${uploadLoading ? layoutStyles.uploadBtnLoading : ""}`}
              title={uploadLoading ? "Processing…" : "Upload PDF or Excel statements (single or multiple)"}
              onClick={() => !uploadLoading && window.dispatchEvent(new CustomEvent("simple-app-open-upload"))}
              disabled={uploadLoading}
              aria-busy={uploadLoading}
            >
              {uploadLoading ? (
                <>
                  <span className={layoutStyles.uploadBtnSpinner} aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
                    </svg>
                  </span>
                  <span>Processing…</span>
                </>
              ) : (
                "+ Upload Statements"
              )}
            </button>
            <button
              type="button"
              className={styles.reportErrorButton}
              onClick={() => setShowReportError(true)}
              title="Report an error"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              <p>Report error</p>
            </button>
            <button
              type="button"
              className={styles.reportErrorButton}
              onClick={handleLogout}
            >
              <span className={layoutStyles.logoutLabel}>Log out</span>
            </button>
          </div>
        </div>
      </header>
      {showReportError && (
        <ReportErrorModal onClose={() => setShowReportError(false)} />
      )}
      <main>{children}</main>
      <Link
        to="/v1"
        className={layoutStyles.v1Icon}
        title="Open full app (v1)"
        aria-label="Open full app (v1)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </svg>
        <span className={layoutStyles.v1IconLabel}>v1</span>
      </Link>
    </div>
  );
}
