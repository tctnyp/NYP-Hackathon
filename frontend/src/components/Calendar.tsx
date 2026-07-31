import { Calendar as CalendarIcon } from 'lucide-react';

function Calendar() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Calendar</h1>
      <div className="bg-white p-12 rounded-lg border text-center">
        <CalendarIcon className="mx-auto text-gray-400 mb-4" size={48} />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Calendar View</h2>
        <p className="text-gray-500">
          Visualize your tasks in a calendar format with deadlines and milestones.
        </p>
      </div>
    </div>
  );
}

export default Calendar;
