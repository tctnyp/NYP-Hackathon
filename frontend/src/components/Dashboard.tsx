import { useEffect, useState } from 'react';
import { dashboardApi } from '../services/api';
import { AlertCircle, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import type { DashboardData } from '../types/api';

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const response = await dashboardApi.get();
      setData(response.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  const stats = data?.statistics || {
    total_tasks: 0,
    completed_tasks: 0,
    in_progress_tasks: 0,
    overdue_tasks: 0,
    completion_rate: 0,
  };

  const statCards = [
    { name: 'Total', value: stats.total_tasks, icon: CheckCircle, color: 'bg-blue-500' },
    { name: 'In Progress', value: stats.in_progress_tasks, icon: Clock, color: 'bg-yellow-500' },
    { name: 'Overdue', value: stats.overdue_tasks, icon: AlertCircle, color: 'bg-red-500' },
    { name: 'Done', value: `${stats.completion_rate}%`, icon: TrendingUp, color: 'bg-green-500' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">{stat.name}</p>
                  <p className="text-3xl font-bold mt-2">{stat.value}</p>
                </div>
                <div className={`${stat.color} w-12 h-12 rounded-lg flex items-center justify-center`}>
                  <Icon className="text-white" size={24} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Dashboard;
