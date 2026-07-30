import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Authenticator } from '@aws-amplify/ui-react';
import { Amplify } from 'aws-amplify';
import '@aws-amplify/ui-react/styles.css';
import './index.css';

import Dashboard from './components/Dashboard';
import TaskList from './components/TaskList';
import Calendar from './components/Calendar';
import Modules from './components/Modules';
import PriorityView from './components/PriorityView';
import Layout from './components/Layout';
import awsExports from './aws-exports';

Amplify.configure(awsExports);

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <Router>
          <Layout user={user} signOut={signOut}>
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
      )}
    </Authenticator>
  );
}

export default App;
