import React from 'react';

export const LoadingSkeleton: React.FC = () => {
  return (
    <div className="space-y-3">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex space-x-4 rounded bg-gray-100 px-4 py-3 animate-pulse dark:bg-gray-800">
          <div className="w-1/4 h-6 bg-gray-200 rounded dark:bg-gray-700"></div>
          <div className="w-2/4 h-6 bg-gray-200 rounded dark:bg-gray-700"></div>
          <div className="w-1/6 h-6 bg-gray-200 rounded dark:bg-gray-700"></div>
        </div>
      ))}
    </div>
  );
};
