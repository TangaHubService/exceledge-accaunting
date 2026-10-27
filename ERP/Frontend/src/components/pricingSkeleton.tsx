export const PricingSkeletonCard = () => {
    return (
        <div className="p-6 rounded-2xl border bg-white/50 shadow-sm animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div className="h-10 bg-gray-200 rounded w-1/3 mb-6"></div>

            <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>

            <div className="mt-6 h-8 bg-gray-200 rounded w-full"></div>
        </div>
    );
};
