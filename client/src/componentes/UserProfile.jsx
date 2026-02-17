import { useState, useRef, useEffect } from 'react'
import styles from '../scss/UserProfile.module.scss'
import PasswordResetModal from './PasswordResetModal'
import XeroConnectionModal from './XeroConnectionModal'
import CreateUserModal from './CreateUserModal'

export default function UserProfile({ onLogout, onReloadSuppliers, onReloadInvoices }) {
    const [isOpen, setIsOpen] = useState(false)
    const [showPasswordReset, setShowPasswordReset] = useState(false)
    const [showXeroConnection, setShowXeroConnection] = useState(false)
    const [showCreateUser, setShowCreateUser] = useState(false)
    const dropdownRef = useRef(null)

    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false)
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    function handleToggle() {
        setIsOpen(!isOpen)
    }

    function handlePasswordReset() {
        setIsOpen(false)
        setShowPasswordReset(true)
    }

    function handleXeroConnection() {
        setIsOpen(false)
        setShowXeroConnection(true)
    }

    function handleCreateUser() {
        setIsOpen(false)
        setShowCreateUser(true)
    }

    function handleReloadSuppliers() {
        setIsOpen(false)
        onReloadSuppliers?.()
    }

    function handleReloadInvoices() {
        setIsOpen(false)
        onReloadInvoices?.()
    }

    function handleLogout() {
        setIsOpen(false)
        onLogout()
    }

    return (
        <>
            <div className={styles.userProfile} ref={dropdownRef}>
                <button className={styles.userButton} onClick={handleToggle}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                </button>

                {isOpen && (
                    <div className={styles.dropdown}>
                        <button className={styles.dropdownItem} onClick={handlePasswordReset}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            <span>Reset Password</span>
                        </button>
                        <button className={styles.dropdownItem} onClick={handleXeroConnection}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M15.5 2H8.6c-.4 0-.8.2-1.1.5-.3.3-.5.7-.5 1.1v12.8c0 .4.2.8.5 1.1.3.3.7.5 1.1.5h9.8c.4 0 .8-.2 1.1-.5.3-.3.5-.7.5-1.1V6.5L15.5 2z"></path>
                                <path d="M14 2v4h4"></path>
                                <path d="M10 9H8"></path>
                                <path d="M16 13H8"></path>
                                <path d="M16 17H8"></path>
                            </svg>
                            <span>Connect Xero</span>
                        </button>
                        <button className={styles.dropdownItem} onClick={handleCreateUser}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <line x1="19" x2="19" y1="8" y2="14"></line>
                                <line x1="22" x2="16" y1="11" y2="11"></line>
                            </svg>
                            <span>Create User</span>
                        </button>
                        {(onReloadSuppliers || onReloadInvoices) && (
                            <>
                                <div className={styles.divider}></div>
                                {onReloadSuppliers && (
                                    <button className={styles.dropdownItem} onClick={handleReloadSuppliers}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                                        <span>Reload suppliers</span>
                                    </button>
                                )}
                                {onReloadInvoices && (
                                    <button className={styles.dropdownItem} onClick={handleReloadInvoices}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/></svg>
                                        <span>Reload invoices</span>
                                    </button>
                                )}
                            </>
                        )}
                        <div className={styles.divider}></div>
                        <button className={styles.dropdownItem} onClick={handleLogout}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                <polyline points="16 17 21 12 16 7"></polyline>
                                <line x1="21" x2="9" y1="12" y2="12"></line>
                            </svg>
                            <span>Logout</span>
                        </button>
                    </div>
                )}
            </div>

            {showPasswordReset && (
                <PasswordResetModal onClose={() => setShowPasswordReset(false)} />
            )}

            {showXeroConnection && (
                <XeroConnectionModal onClose={() => setShowXeroConnection(false)} />
            )}

            {showCreateUser && (
                <CreateUserModal onClose={() => setShowCreateUser(false)} />
            )}
        </>
    )
}