import { useState, useEffect } from 'react'
import styles from '../scss/Modal.module.scss'

export default function XeroConnectionModal({ onClose }) {
    const [isConnected, setIsConnected] = useState(false)
    const [loading, setLoading] = useState(false)
    const [statusLoading, setStatusLoading] = useState(true)
    const [tenantName, setTenantName] = useState('')

    // Fetch Xero connection status when modal opens
    useEffect(() => {
        async function fetchXeroStatus() {
            setStatusLoading(true)
            try {
                const response = await fetch('/api/v1/auth/xero-status', {
                    method: 'GET',
                    credentials: 'include'
                })

                if (response.ok) {
                    const data = await response.json()
                    setIsConnected(data.connected || false)
                    if (data.connected && data.tenantName) {
                        setTenantName(data.tenantName)
                    }
                } else {
                    setIsConnected(false)
                }
            } catch (err) {
                console.error('Error fetching Xero status:', err)
                setIsConnected(false)
            } finally {
                setStatusLoading(false)
            }
        }

        fetchXeroStatus()
    }, [])

    function handleConnect() {
        setLoading(true)
        // Navigate to the register-xero endpoint which will redirect to Xero authorization
        window.location.href = '/api/v1/auth/register-xero'
    }

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>Xero Connection</h2>
                    <button className={styles.closeButton} onClick={onClose}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" x2="6" y1="6" y2="18"></line>
                            <line x1="6" x2="18" y1="6" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <div className={styles.modalBody}>
                    {statusLoading ? (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                            <div className={styles.spinner} style={{ margin: '0 auto 1rem' }}></div>
                            <p>Checking connection status...</p>
                        </div>
                    ) : !isConnected ? (
                        <>
                            <div className={styles.infoBox}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <path d="M12 16v-4"></path>
                                    <path d="M12 8h.01"></path>
                                </svg>
                                <div>
                                    <p className={styles.infoTitle}>Connect to Xero</p>
                                    <p className={styles.infoText}>
                                        Connect your Xero account to sync invoices and statements automatically. 
                                        You'll be redirected to Xero to authorize this application.
                                    </p>
                                </div>
                            </div>

                            <div className={styles.connectionStatus}>
                                <div className={styles.statusIndicator}>
                                    <div className={styles.statusDot} style={{ backgroundColor: '#ef4444' }}></div>
                                    <span>Not Connected</span>
                                </div>
                            </div>

                            <div className={styles.modalFooter}>
                                <button type="button" className={styles.cancelButton} onClick={onClose}>
                                    Cancel
                                </button>
                                <button 
                                    type="button" 
                                    className={styles.submitButton} 
                                    onClick={handleConnect}
                                    disabled={loading}
                                >
                                    {loading ? 'Connecting...' : 'Connect to Xero'}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className={styles.infoBox}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                                </svg>
                                <div>
                                    <p className={styles.infoTitle}>Connected to Xero</p>
                                    <p className={styles.infoText}>
                                        Your account is successfully connected to Xero{tenantName ? ` (${tenantName})` : ''}. 
                                        Invoices and statements will be synced automatically.
                                    </p>
                                </div>
                            </div>

                            <div className={styles.connectionStatus}>
                                <div className={styles.statusIndicator}>
                                    <div className={styles.statusDot} style={{ backgroundColor: '#10b981' }}></div>
                                    <span>Connected{tenantName ? ` - ${tenantName}` : ''}</span>
                                </div>
                            </div>

                            <div className={styles.modalFooter}>
                                <button type="button" className={styles.cancelButton} onClick={onClose}>
                                    Close
                                </button>
                                <button 
                                    type="button" 
                                    className={styles.submitButton} 
                                    onClick={handleConnect}
                                    disabled={loading}
                                >
                                    {loading ? 'Reconnecting...' : 'Reconnect'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}