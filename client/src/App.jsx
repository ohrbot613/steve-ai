import { Routes, Route, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import RunPayments from './pages/RunPayments'
import './scss/main.scss'
import Login from './pages/Login'
import Activity from './pages/Activity'
import SupplierStatement from './pages/SupplierStatement'
import SupplierLogs from './pages/SupplierLogsV2'
import AllStatements from './pages/AllStatements'
import AllInvoices from './pages/AllInvoices'
import SingleStatement from './pages/SingleStatement'
import NotFound from './pages/NotFound'
import SimpleApp from './pages/SimpleApp'
import ProtectedRoute from './componentes/ProtectedRoute'
import SimpleLayout from './componentes/SimpleLayout'
import AskSteve from './componentes/AskSteve'
import { AppModeProvider, useAppMode } from './context/AppModeContext'
import { useState, useEffect } from 'react'

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
      </div>
      {showAskSteve && !isLoginPage && location.pathname.startsWith('/v1') && <AskSteve isOpen={isSidebarOpen} onToggle={toggleSidebar} />}
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
