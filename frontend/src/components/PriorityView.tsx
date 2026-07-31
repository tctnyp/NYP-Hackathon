import { useEffect, useState } from 'react';
import { aiApi } from '../services/api';
import { Target, Sparkles, AlertTriangle } from 'lucide-react';
import type { AIRecommendations } from '../types/api';

function PriorityView() {
  const [recommendations, setRecommendations] = useState<AIRecommendations | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPrioritization();
  }, []);

  const loadPrioritization = async () => {
    try {
      setLoading(true);
      const response = await aiApi.getPrioritization();
      setRecommendations(response.data.data.recommendations);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">AI Priority View</h1>
        <div className="flex items-center justify-center h-64 bg-white rounded-lg">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4" />
            <p className="text-gray-600">Analyzing your tasks with AI...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target size={32} className="text-primary-600" />
          <h1 className="text-3xl font-bold">AI Priority View</h1>
        </div>
        <button onClick={loadPrioritization} className="btn-primary flex items-center gap-2">
          <Sparkles size={20} />
          Refresh
        </button>
      </div>

      {recommendations?.top_priorities && (
        <div className="bg-white rounded-lg border overflow-hidden">
          <div className="px-6 py-4 bg-gradient-to-r from-red-500 to-orange-500">
            <h2 className="text-lg font-semibold text-white">🎯 Top Priorities</h2>
          </div>
          <div className="p-6 space-y-4">
            {recommendations.top_priorities.map((priority, index) => (
              <div key={index} className="p-4 bg-red-50 border-l-4 border-red-500 rounded-lg">
                <div className="flex gap-4">
                  <div className="w-10 h-10 bg-red-500 text-white rounded-full flex items-center justify-center font-bold">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-700">{priority.reason}</p>
                    <p className="text-sm text-gray-600 mt-2">{priority.suggested_action}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recommendations?.warnings && recommendations.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="text-yellow-600" size={24} />
            <h2 className="text-lg font-semibold">Warnings</h2>
          </div>
          <ul className="space-y-2">
            {recommendations.warnings.map((warning, index) => (
              <li key={index} className="text-gray-700">• {warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default PriorityView;
