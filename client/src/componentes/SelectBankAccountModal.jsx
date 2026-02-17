import { useState } from 'react'
import styles from '../scss/Modal.module.scss'

// Placeholder account names (frontend only; replace with real data when backend is ready)
const PLACEHOLDER_ACCOUNTS = [
    'Business Checking',
    'Savings',
    'Operating Account',
    'Payroll Account',
    'Trust Account',
]

export default function SelectBankAccountModal({ onClose }) {
    const [selectedIds, setSelectedIds] = useState(() =>
        PLACEHOLDER_ACCOUNTS.reduce((acc, _, i) => ({ ...acc, [i]: false }), {})
    )

    function handleToggle(id) {
        setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }))
    }

    function handleSave() {
        // Selected account IDs: Object.keys(selectedIds).filter(id => selectedIds[id])
        onClose()
    }

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>Select bank account</h2>
                    <button className={styles.closeButton} onClick={onClose}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" x2="6" y1="6" y2="18"></line>
                            <line x1="6" x2="18" y1="6" y2="18"></line>
                        </svg>
                    </button>
                </div>

                <div className={styles.modalBody}>
                    <ul className={styles.accountList}>
                        {PLACEHOLDER_ACCOUNTS.map((name, id) => (
                            <li key={id} className={styles.accountItem}>
                                <label className={styles.accountLabel}>
                                    <input
                                        type="checkbox"
                                        checked={!!selectedIds[id]}
                                        onChange={() => handleToggle(id)}
                                        className={styles.accountCheckbox}
                                    />
                                    <span>{name}</span>
                                </label>
                            </li>
                        ))}
                    </ul>

                    <div className={styles.modalFooter}>
                        <button type="button" className={styles.cancelButton} onClick={onClose}>
                            Close
                        </button>
                        <button type="button" className={styles.submitButton} onClick={handleSave}>
                            Save
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
