import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

import Dashboard from './components/Dashboard';
import TaskList from './components/TaskList';
import Calendar from './components/Calendar';
import Modules from './components/Modules';
import PriorityView from './components/PriorityView';
import Layout from './components/Layout';

function App() {
  const labUser = { signInDetails: { loginId: 'Lab Demo User' } };

  return (
    <Router>
      <Layout user={labUser}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/modules" element={<Modules />} />
          <Route path="/priority" element={<PriorityView />} />
        </Routes>
      </Layout>
    </Router>
  );
}

export default App;
