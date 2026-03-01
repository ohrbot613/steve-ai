import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import './scss/main.scss'
import ProtectedRoute from './componentes/ProtectedRoute'
import SimpleLayout from './componentes/SimpleLayout'
import { AppModeProvider, useAppMode } from './context/AppModeContext'

const Home = lazy(() => import('./pages/Home'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const RunPayments = lazy(() => import('./pages/RunPayments'))
const Login = lazy(() => import('./pages/Login'))
const Activity = lazy(() => import('./pages/Activity'))
const SupplierStatement = lazy(() => import('./pages/SupplierStatement'))
const SupplierLogs = lazy(() => import('./pages/SupplierLogsV2'))
const AllStatements = lazy(() => import('./pages/AllStatements'))
const AllInvoices = lazy(() => import('./pages/AllInvoices'))
const SingleStatement = lazy(() => import('./pages/SingleStatement'))
const NotFound = lazy(() => import('./pages/NotFound'))
const SimpleApp = lazy(() => import('./pages/SimpleApp'))
const UserErrors = lazy(() => import('./pages/UserErrors'))
const AskSteve = lazy(() => import('./componentes/AskSteve'))

function RouteFallback() {
  return <main style={{ padding: '1.6rem 4rem' }}>Loading...</main>
}

function AppContent() {
  const [mySessionId] = useState(() => `sess_${Math.random().toString(36).substr(2, 9)}`);
  const location = useLocation();
  const { appMode, setAppMode } = useAppMode();

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('askSteveOpen');
    return saved === 'true';
  });

  useEffect(() => {
    sessionStorage.setItem('sessionId', mySessionId);
  }, [mySessionId]);

  useEffect(() => {
    localStorage.setItem('askSteveOpen', String(isSidebarOpen));
  }, [isSidebarOpen]);

  // Sync app mode from route: /v1* = full app, otherwise = simple (main)
  useEffect(() => {
    const isV1 = location.pathname.startsWith('/v1');
    setAppMode(isV1 ? 'full' : 'simple');
  }, [location.pathname, setAppMode]);

  useEffect(() => {
    document.body.classList.toggle('app-mode-simple', appMode === 'simple');
    return () => document.body.classList.remove('app-mode-simple');
  }, [appMode]);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  const isLoginPage = location.pathname === '/login';
  const showAskSteve = import.meta.env.VITE_SHOW_ASK_STEVE === 'true';

  const contentClass = [
    'appContent',
    appMode === 'simple' ? 'appContent--simple' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div
        className={contentClass}
        style={{
          marginRight: showAskSteve && isSidebarOpen && !isLoginPage ? '42rem' : '0',
        }}
      >
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            {/* Simple App is the main page at / */}
            <Route path="/" element={
              <ProtectedRoute>
                <SimpleLayout>
                  <SimpleApp />
                </SimpleLayout>
              </ProtectedRoute>
            } />
            <Route path="/errors" element={
              <ProtectedRoute>
                <SimpleLayout>
                  <UserErrors />
                </SimpleLayout>
              </ProtectedRoute>
            } />
            {/* V1 app under /v1 (linked from small icon in Simple App) */}
            <Route path="/v1" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/v1/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/v1/suppliers" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/v1/run-payments" element={<ProtectedRoute><RunPayments /></ProtectedRoute>} />
            <Route path="/v1/statements" element={<ProtectedRoute><AllStatements /></ProtectedRoute>} />
            <Route path="/v1/invoices" element={<ProtectedRoute><AllInvoices /></ProtectedRoute>} />
            <Route path="/v1/activity" element={<ProtectedRoute><Activity /></ProtectedRoute>} />
            <Route path="/v1/suppliers-statements/:supplierId" element={<ProtectedRoute><SupplierStatement /></ProtectedRoute>} />
            <Route path="/v1/suppliers-logs/:supplierId" element={<ProtectedRoute><SupplierLogs /></ProtectedRoute>} />
            <Route path="/v1/single-statement/:logId" element={<ProtectedRoute><SingleStatement /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </div>
      {showAskSteve && !isLoginPage && location.pathname.startsWith('/v1') && (
        <Suspense fallback={null}>
          <AskSteve isOpen={isSidebarOpen} onToggle={toggleSidebar} />
        </Suspense>
      )}
    </>
  )
}

function App() {
  return (
    <AppModeProvider>
      <AppContent />
    </AppModeProvider>
  )
}

export default App
