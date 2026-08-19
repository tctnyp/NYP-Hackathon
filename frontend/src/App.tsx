import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

import { AuthProvider } from './contexts/AuthContext';
import { AccountProvider } from './contexts/AccountContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { PwaProvider } from './contexts/PwaContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './components/Login';
import Register from './components/Register';
import Verify from './components/Verify';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import AuthCallback from './components/AuthCallback';
import Dashboard from './components/Dashboard';
import TaskList from './components/TaskList';
import Calendar from './components/Calendar';
import Modules from './components/Modules';
import Groups from './components/Groups';
import AdminPanel from './components/AdminPanel';
import SmartAssistant from './components/SmartAssistant';
import AccountSettingsRoute from './components/AccountSettingsRoute';
import LoginStoragePrompt from './components/LoginStorageConsent';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PwaProvider>
          <AccountProvider>
            <Router>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/verify" element={<Verify />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/account/settings" element={<AccountSettingsRoute />} />

              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <Routes>
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/tasks" element={<TaskList />} />
                        <Route path="/calendar" element={<Calendar />} />
                        <Route path="/modules" element={<Modules />} />
                        <Route path="/groups" element={<Groups />} />
                        <Route path="/smart-ai" element={<SmartAssistant />} />
                        <Route
                          path="/admin"
                          element={
                            <ProtectedRoute requireAdmin>
                              <AdminPanel />
                            </ProtectedRoute>
                          }
                        />
                      </Routes>
                    </Layout>
                  </ProtectedRoute>
                }
              />
            </Routes>
            </Router>
            <LoginStoragePrompt />
          </AccountProvider>
        </PwaProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
