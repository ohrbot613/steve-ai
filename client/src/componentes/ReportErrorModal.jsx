import { useState, useRef, useEffect } from 'react'
import html2canvas from 'html2canvas'
import styles from '../scss/Modal.module.scss'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const SCREENSHOT_MAX_WIDTH = 1200
const SCREENSHOT_JPEG_QUALITY = 0.75
const MAX_FILE_UPLOADS = 5
const MAX_FILE_SIZE_MB = 10
const MAX_FILE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

/** Capture page as JPEG data URL, excluding the report modal. Optionally resize to limit size. */
async function capturePageScreenshot(modalOverlayRef) {
    const opts = {
        useCORS: true,
        allowTaint: true,
        scale: 1,
        logging: false,
        ignoreElements: (el) => modalOverlayRef?.current?.contains(el) ?? false,
    }
    const canvas = await html2canvas(document.body, opts)
    let dataUrl = canvas.toDataURL('image/jpeg', SCREENSHOT_JPEG_QUALITY)
    if (canvas.width > SCREENSHOT_MAX_WIDTH) {
        const scaled = document.createElement('canvas')
        const ratio = SCREENSHOT_MAX_WIDTH / canvas.width
        scaled.width = SCREENSHOT_MAX_WIDTH
        scaled.height = Math.round(canvas.height * ratio)
        const ctx = scaled.getContext('2d')
        ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height)
        dataUrl = scaled.toDataURL('image/jpeg', SCREENSHOT_JPEG_QUALITY)
    }
    return dataUrl
}

function waitForIdle(timeoutMs = 500) {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(() => resolve(), { timeout: timeoutMs })
        } else {
            window.setTimeout(resolve, Math.min(timeoutMs, 250))
        }
    })
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

export default function ReportErrorModal({ onClose, initialMessage = '' }) {
    const [message, setMessage] = useState(initialMessage || '')
    const [includeScreenshot, setIncludeScreenshot] = useState(true)
    const [files, setFiles] = useState([])
    const [status, setStatus] = useState(null) // 'loading' | 'success' | 'error'
    const [errorText, setErrorText] = useState('')
    const [captureStatus, setCaptureStatus] = useState('')
    const overlayRef = useRef(null)
    const fileInputRef = useRef(null)

    useEffect(() => {
        setMessage(initialMessage || '')
    }, [initialMessage])

    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape' && status !== 'loading') {
                onClose()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [onClose, status])

    async function handleSubmit(e) {
        e.preventDefault()
        const trimmed = message?.trim()
        if (!trimmed) {
            setErrorText('Please describe what went wrong.')
            return
        }
        setStatus('loading')
        setErrorText('')
        setCaptureStatus('')
        try {
            let screenshot = null
            if (includeScreenshot) {
                try {
                    setCaptureStatus('Capturing screenshot...')
                    await waitForIdle(700)
                    screenshot = await capturePageScreenshot(overlayRef)
                } catch (captureErr) {
                    console.warn('Screenshot capture failed:', captureErr)
                } finally {
                    setCaptureStatus('')
                }
            }
            const attachments = []
            for (let i = 0; i < Math.min(files.length, MAX_FILE_UPLOADS); i++) {
                const f = files[i]
                if (f.size > MAX_FILE_BYTES) {
                    setStatus('error')
                    setErrorText(`"${f.name}" is too large (max ${MAX_FILE_SIZE_MB}MB).`)
                    return
                }
                const dataUrl = await readFileAsBase64(f)
                attachments.push({ name: f.name, data: dataUrl })
            }
            const res = await fetch(`${API_BASE}/api/v1/report-error`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    message: trimmed,
                    screenshot: screenshot || undefined,
                    attachments: attachments.length ? attachments : undefined,
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (res.ok && data.status === 'success') {
                setStatus('success')
                setMessage('')
                setFiles([])
                if (fileInputRef.current) fileInputRef.current.value = ''
                setTimeout(() => onClose(), 1500)
            } else {
                setStatus('error')
                setErrorText(res.status === 401 ? 'Please log in to report an error.' : (data.message || 'Failed to submit report.'))
            }
        } catch (err) {
            setStatus('error')
            setErrorText(err.message || 'Failed to submit report.')
        }
    }

    return (
        <div ref={overlayRef} className={styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2>Report an error</h2>
                    <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <form onSubmit={handleSubmit} className={styles.modalBody}>
                    {status === 'success' && (
                        <div className={styles.successMessage}>Thank you. Your report has been submitted.</div>
                    )}
                    {status === 'error' && errorText && (
                        <div className={styles.errorMessage}>{errorText}</div>
                    )}
                    {status === 'loading' && captureStatus && (
                        <div className={styles.helperText}>{captureStatus}</div>
                    )}
                    {status !== 'success' && (
                        <>
                            <div className={styles.formGroup}>
                                <label htmlFor="report-message">What went wrong? *</label>
                                <textarea
                                    id="report-message"
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="Describe the error or what you were doing..."
                                    rows={4}
                                    disabled={status === 'loading'}
                                    style={{
                                        width: '100%',
                                        padding: '1rem 1.2rem',
                                        border: '0.1rem solid #e5e7eb',
                                        borderRadius: '0.8rem',
                                        fontSize: '1.5rem',
                                        color: '#1f2937',
                                        resize: 'vertical',
                                        fontFamily: 'inherit',
                                    }}
                                />
                                <p className={styles.helperText} style={{ marginTop: '0.6rem' }}>
                                    Add details so we can reproduce what happened.
                                </p>
                                <label
                                    htmlFor="report-include-screenshot"
                                    className={styles.checkboxLabel}
                                    style={{ marginTop: '1rem', cursor: status === 'loading' ? 'not-allowed' : 'pointer' }}
                                >
                                    <input
                                        id="report-include-screenshot"
                                        type="checkbox"
                                        checked={includeScreenshot}
                                        disabled={status === 'loading'}
                                        onChange={(e) => setIncludeScreenshot(e.target.checked)}
                                        className={styles.checkboxInput}
                                    />
                                    Include a screenshot of the current page
                                </label>
                            </div>
                            <div className={styles.formGroup}>
                                <label htmlFor="report-files">Attach files (optional)</label>
                                <div className={styles.fileUploadZone}>
                                    <input
                                        ref={fileInputRef}
                                        id="report-files"
                                        type="file"
                                        multiple
                                        accept="*"
                                        disabled={status === 'loading'}
                                        onChange={(e) => setFiles(Array.from(e.target.files || []))}
                                        className={styles.fileUploadInput}
                                    />
                                    <div className={styles.fileUploadLabel}>
                                        <svg className={styles.fileUploadLabelIcon} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="17 8 12 3 7 8" />
                                            <line x1="12" y1="3" x2="12" y2="15" />
                                        </svg>
                                        <span className={styles.fileUploadLabelText}>
                                            {files.length ? `${files.length} file(s) selected` : 'Click or drop files here'}
                                        </span>
                                        <span className={styles.fileUploadLabelHint}>
                                            Up to {MAX_FILE_UPLOADS} files, {MAX_FILE_SIZE_MB}MB each
                                        </span>
                                    </div>
                                </div>
                                {files.length > 0 && (
                                    <ul className={styles.fileUploadList}>
                                        {files.slice(0, MAX_FILE_UPLOADS).map((f, i) => (
                                            <li key={i} className={styles.fileUploadListItem}>
                                                <span className={styles.fileUploadListItemName} title={f.name}>{f.name}</span>
                                                <span className={styles.fileUploadListItemSize}>{(f.size / 1024).toFixed(1)} KB</span>
                                            </li>
                                        ))}
                                        {files.length > MAX_FILE_UPLOADS && (
                                            <li className={styles.fileUploadListOverflow}>
                                                +{files.length - MAX_FILE_UPLOADS} more (only first {MAX_FILE_UPLOADS} will be sent)
                                            </li>
                                        )}
                                    </ul>
                                )}
                            </div>
                            <div className={styles.modalFooter}>
                                <button type="button" className={styles.cancelButton} onClick={onClose} disabled={status === 'loading'}>
                                    Cancel
                                </button>
                                <button type="submit" className={styles.submitButton} disabled={status === 'loading'}>
                                    {status === 'loading' ? (
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                            <span className={styles.spinner} /> Submitting...
                                        </span>
                                    ) : (
                                        'Submit report'
                                    )}
                                </button>
                            </div>
                        </>
                    )}
                </form>
            </div>
        </div>
    )
}
