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
import ProtectedRoute from './componentes/ProtectedRoute'
import AskSteve from './componentes/AskSteve'
import { useState, useEffect } from 'react'

function App() {
  const [mySessionId] = useState(() => `sess_${Math.random().toString(36).substr(2, 9)}`);
  const location = useLocation();
  
  // Sidebar state with localStorage persistence
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('askSteveOpen');
    return saved === 'true';
  });

  useEffect(() => {
    sessionStorage.setItem('sessionId', mySessionId);
  }, [mySessionId]);

  // Save sidebar state to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('askSteveOpen', String(isSidebarOpen));
  }, [isSidebarOpen]);

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  // Hide AskSteve on login page
  const isLoginPage = location.pathname === '/login';
  // Hide Ask Steve in production when VITE_SHOW_ASK_STEVE is false
  const showAskSteve = import.meta.env.VITE_SHOW_ASK_STEVE === 'true';

  return (
    <>
      <div 
        style={{
          marginRight: showAskSteve && isSidebarOpen && !isLoginPage ? '42rem' : '0',
          transition: 'margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route 
          path="/suppliers" 
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/run-payments"
          element={
            <ProtectedRoute>
              <RunPayments />
            </ProtectedRoute>
          }
        />
        <Route
          path="/statements" 
          element={
            <ProtectedRoute>
              <AllStatements />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/invoices" 
          element={
            <ProtectedRoute>
              <AllInvoices />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/activity" 
          element={
            <ProtectedRoute>
              <Activity />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/suppliers-statements/:supplierId" 
          element={
            <ProtectedRoute>
              <SupplierStatement />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/suppliers-logs/:supplierId" 
          element={
            <ProtectedRoute>
              <SupplierLogs />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/single-statement/:logId" 
          element={
            <ProtectedRoute>
              <SingleStatement />
            </ProtectedRoute>
          } 
        />
        <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
      {showAskSteve && !isLoginPage && <AskSteve isOpen={isSidebarOpen} onToggle={toggleSidebar} />}
    </>
  )
}

export default App
