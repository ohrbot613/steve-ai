import { useState, useEffect } from 'react'
import styles from '../scss/Login.module.scss'
import { Link, useNavigate, Navigate } from 'react-router-dom'


export default function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [isCheckingAuth, setIsCheckingAuth] = useState(true)
    const [isAuthenticated, setIsAuthenticated] = useState(false)
    const navigate = useNavigate()

    // If already logged in, redirect to home
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const response = await fetch('/api/v1/auth/check', {
                    method: 'GET',
                    credentials: 'include'
                })
                if (response.ok) {
                    setIsAuthenticated(true)
                }
            } catch {
                // Not authenticated
            } finally {
                setIsCheckingAuth(false)
            }
        }
        checkAuth()
    }, [])

    async function handleLogin(e) {
        e.preventDefault();
        setError('')
        setLoading(true)

        if (!email || !password) {
            setError('Please enter both email and password')
            setLoading(false)
            return
        }

        try {
            const response = await fetch('/api/v1/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    password
                })
            });

            const data = await response.json();
            
            if (data.status === 'success') {
                navigate('/')
            } else {
                setError(data.message || 'Invalid email or password')
            }
        } catch (err) {
            setError('An error occurred. Please try again.')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    function handleMicrosoftLogin() {
        setError('Microsoft login is not supported at this time. Please use email and password to sign in.');
    }

    function handleGoogleLogin() {
        setError('Google login is not supported at this time. Please use email and password to sign in.');
    }

    function handleForgotPassword(e) {
        e.preventDefault();
        setError('This feature is not available. Please contact your administrator.');
    }

    if (isCheckingAuth) {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                fontSize: '18px'
            }}>
                Loading...
            </div>
        )
    }

    if (isAuthenticated) {
        return <Navigate to="/" replace />
    }

    return (
        <div className={styles.login}>
            <div className={styles.loginContent}>
                <span className={styles.loginContentTop}></span>
                <h1 className={styles.loginContentTitle}>Welcome to Steve AI</h1>
                <p className={styles.loginContentSubtitle}>Sign in to continue</p>
                <div className={styles.loginContentOauth}>
                    <button onClick={handleGoogleLogin}>
                        <svg className={styles.googleIcon} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"></path><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path></svg>
                        <span>Continue with Google</span>
                    </button>
                    <button onClick={handleMicrosoftLogin}>
                        <svg className={styles.microsoftIcon} viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
                            <rect x="0" y="0" width="11" height="11" fill="#F25022"/>
                            <rect x="12" y="0" width="11" height="11" fill="#7FBA00"/>
                            <rect x="0" y="12" width="11" height="11" fill="#00A4EF"/>
                            <rect x="12" y="12" width="11" height="11" fill="#FFB900"/>
                        </svg>
                        <span>Continue with Microsoft</span>
                    </button>
                </div>
                <div className={styles.loginContentDivder}>
                    <p>OR</p>
                </div>
                {error && (
                    <div className={styles.errorMessage}>
                        {error}
                    </div>
                )}
                <form className={styles.loginContentForm} onSubmit={handleLogin}>
                    <label className={styles.loginContentFormLabel} htmlFor="email">Email</label>
                    <div className={styles.loginContentFormInput}>
                        <svg className={styles.inputIcon} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg>
                        <input 
                            type="email" 
                            id='email' 
                            required 
                            placeholder='you@example.com'
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={loading}
                        />
                    </div>
                    <label className={styles.loginContentFormLabel} htmlFor="password">Password</label>
                    <div className={styles.loginContentFormInput}>
                        <svg className={styles.inputIcon} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        <input 
                            type={showPassword ? 'text' : 'password'}
                            id='password' 
                            required 
                            placeholder='••••••••'
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                        />
                        <button
                            type="button"
                            className={styles.eyeButton}
                            onClick={() => setShowPassword(!showPassword)}
                            disabled={loading}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                            {showPassword ? (
                                <svg className={styles.eyeIcon} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                            ) : (
                                <svg className={styles.eyeIcon} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path>
                                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path>
                                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path>
                                    <line x1="2" x2="22" y1="2" y2="22"></line>
                                </svg>
                            )}
                        </button>
                    </div>
                    <button 
                        className={styles.loginContentFormButton} 
                        type="submit"
                        disabled={loading}
                    >
                        {loading ? 'Signing in...' : 'Sign in'}
                    </button>
                </form>
                <div className={styles.loginContentNav}>
                    <Link className={styles.navLink} onClick={handleForgotPassword}>Forgot password?</Link>
                </div>
            </div>
        </div>
    )
}
