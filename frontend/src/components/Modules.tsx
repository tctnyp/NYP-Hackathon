import { useEffect, useState } from 'react';
import { modulesApi } from '../services/api';
import { BookOpen, Plus } from 'lucide-react';
import type { Module } from '../types/api';

function Modules() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadModules();
  }, []);

  const loadModules = async () => {
    try {
      const response = await modulesApi.getAll();
      setModules(response.data.data.modules || []);
    } catch (err) {
      console.error('Error loading modules:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Modules</h1>
        <button className="btn-primary flex items-center gap-2">
          <Plus size={20} />
          Add Module
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
        </div>
      ) : modules.length === 0 ? (
        <div className="bg-white p-12 rounded-lg border text-center">
          <BookOpen className="mx-auto text-gray-400 mb-4" size={48} />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No Modules Yet</h2>
          <p className="text-gray-500">Add your first module to start organizing tasks</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {modules.map((module) => (
            <div
              key={module.module_id}
              className="bg-white p-6 rounded-lg border-2 hover:shadow-lg transition"
              style={{ borderColor: module.color }}
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: module.color }}
                >
                  {module.module_code.substring(0, 2)}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">{module.active_task_count}</p>
                  <p className="text-xs text-gray-500">active</p>
                </div>
              </div>
              <h3 className="text-lg font-semibold">{module.module_code}</h3>
              <p className="text-gray-600 text-sm mt-1">{module.module_name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Modules;
