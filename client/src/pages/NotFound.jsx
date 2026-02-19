import { Link, useLocation } from 'react-router-dom'
import styles from '../scss/NotFound.module.scss'

export default function NotFound() {
  const location = useLocation()
  const homeTo = location.pathname.startsWith('/v1') ? '/v1' : '/'
  return (
    <div className={styles.notFound}>
      <div className={styles.container}>
        <div className={styles.content}>
          <div className={styles.errorCode}>404</div>
          <h1 className={styles.title}>Page Not Found</h1>
          <p className={styles.description}>
            The page you're looking for doesn't exist or has been moved.
          </p>
          <div className={styles.actions}>
            <Link to={homeTo} className={styles.homeButton}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
              Go to Home
            </Link>
            <button 
              onClick={() => window.history.back()} 
              className={styles.backButton}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6"></path>
              </svg>
              Go Back
            </button>
          </div>
        </div>
        <div className={styles.illustration}>
          <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className={styles.illustrationSvg}>
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
      </div>
    </div>
  )
}

