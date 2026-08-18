import { useState, useEffect } from 'react';
import { Shield, User, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import apiClient from '../services/api';

interface AdminUser {
  username: string;
  email: string;
  name?: string;
  enabled: boolean;
  status: string;
  groups: string[];
  created: string;
  modified: string;
}

function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get<{ data: { users: AdminUser[] } }>('/admin/users');
      setUsers(response.data.data.users);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const updateUser = async (username: string, action: string, group?: string) => {
    setUpdating(username);
    setError('');
    setSuccess('');

    try {
      const payload: { action: string; group?: string } = { action };
      if (group) {
        payload.group = group;
      }

      await apiClient.patch(`/admin/users/${encodeURIComponent(username)}`, payload);
      setSuccess(`User ${username} updated successfully`);
      await loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to update user');
    } finally {
      setUpdating(null);
    }
  };

  const toggleUserEnabled = async (username: string, currentEnabled: boolean) => {
    await updateUser(username, currentEnabled ? 'disable' : 'enable');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary-600 border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
            <Shield className="text-primary-600" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Panel</h1>
            <p className="text-gray-600">Manage user access</p>
          </div>
        </div>
        <button
          onClick={loadUsers}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <RefreshCw size={18} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
          <CheckCircle className="text-green-600 flex-shrink-0 mt-0.5" size={20} />
          <p className="text-sm text-green-800">{success}</p>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map((user) => {
                const isAdmin = user.username === 'admin' && (user.groups || []).includes('Admins');
                const isProtectedAdmin = user.username === 'admin';
                const displayName = user.name || user.email?.split('@')[0] || user.username;
                const isUpdating = updating === user.username;

                return (
                  <tr key={user.username} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                          <User className="text-primary-600" size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{displayName}</p>
                          <p className="text-sm text-gray-500">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          user.enabled
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {user.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          isAdmin
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {isAdmin ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(user.created).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => toggleUserEnabled(user.username, user.enabled)}
                          disabled={isUpdating || isProtectedAdmin}
                          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                            user.enabled
                              ? 'bg-red-50 text-red-700 hover:bg-red-100'
                              : 'bg-green-50 text-green-700 hover:bg-green-100'
                          }`}
                          title={isProtectedAdmin ? 'The sole administrator account is protected' : undefined}
                        >
                          {isProtectedAdmin ? 'Protected' : user.enabled ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {users.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              <User className="mx-auto mb-3 text-gray-400" size={48} />
              <p>No users found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminPanel;
