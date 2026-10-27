import { Star, Users, Headset, ShieldCheck } from "lucide-react";

const statsData = [
  {
    value: "98%",
    label: "Customer Satisfaction",
    icon: <Star className="h-4 w-4 sm:h-5 sm:w-5" />,
  },
  {
    value: "50+",
    label: "Active Users",
    icon: <Users className="h-4 w-4 sm:h-5 sm:w-5" />,
  },
  {
    value: "24/7",
    label: "Support",
    icon: <Headset className="h-4 w-4 sm:h-5 sm:w-5" />,
  },
  {
    value: "99.9%",
    label: "Uptime",
    icon: <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5" />,
  },
];

const StatsGrid = () => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 px-4 container mx-auto">
      {statsData.map((stat, i) => (
        <div
          key={i}
          className={`group p-4 sm:p-6 bg-background/80 backdrop-blur-sm rounded-xl sm:rounded-2xl border border-border/50 shadow-lg hover:shadow-xl hover:border-primary/50 transition-all duration-300 hover:scale-105 animate-fade-in`}
          style={{ animationDelay: `${(i + 4) * 100}ms` }}
        >
          <div className="flex items-center justify-center mb-2 text-primary group-hover:scale-110 transition-transform">
            {stat.icon}
          </div>
          <div className="text-xl sm:text-2xl md:text-2xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text">
            {stat.value}
          </div>
          <div className="text-xs sm:text-sm text-muted-foreground mt-1 font-medium">
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatsGrid;
