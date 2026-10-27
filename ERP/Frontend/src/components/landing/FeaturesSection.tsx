import {
  CheckCircle2,
  Zap,
  ShieldCheck,
  Clock,
  TrendingUp,
  Headset,
  RefreshCw,
  Package,
  ShoppingCart,
  Users as UsersIcon,
  FileText,
  BarChart2,
  UserCheck,
} from "lucide-react";
import type { JSX } from "react";

interface FeatureItem {
  icon: JSX.Element;
  title: string;
  text: string;
  color: string;
  features?: string[];
}

export const FeaturesSection = () => {
  const aboutFeatures: FeatureItem[] = [
    {
      icon: <Zap className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Lightning Fast",
      text: "Process transactions and manage inventory in real-time, even with intermittent internet connectivity.",
      color: "from-blue-500 to-cyan-400",
    },
    {
      icon: <ShieldCheck className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Secure & Reliable",
      text: "Bank-grade security with automatic local backups and 99.9% uptime guarantee.",
      color: "from-emerald-500 to-teal-400",
    },
    {
      icon: <Clock className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Save Time",
      text: "Automate inventory tracking, invoicing, and reporting to focus on growing your business.",
      color: "from-amber-500 to-yellow-400",
    },
    {
      icon: <TrendingUp className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Business Insights",
      text: "Make data-driven decisions with real-time analytics and business performance reports.",
      color: "from-purple-500 to-pink-400",
    },
    {
      icon: <Headset className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Local Support",
      text: "Dedicated support team based in Rwanda, available in Kinyarwanda, English, and French.",
      color: "from-rose-500 to-pink-400",
    },
    {
      icon: <RefreshCw className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Always Improving",
      text: "Regular updates with new features and improvements based on your feedback.",
      color: "from-indigo-500 to-blue-400",
    },
  ];

  const serviceFeatures: FeatureItem[] = [
    {
      icon: <Package className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Inventory Management",
      text: "Track stock levels, expiry dates, and automate reordering with our intelligent system.",
      color: "from-blue-500 to-cyan-400",
      features: [
        "Real-time stock tracking",
        "Expiry date management",
        "Automated reordering",
        "Barcode/QR code support",
      ],
    },
    {
      icon: <ShoppingCart className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Sales & POS",
      text: "Fast, reliable POS with support for all Rwandan payment methods.",
      color: "from-purple-500 to-pink-400",
      features: [
        "Fast checkout",
        "Multiple payment methods",
        "Receipt printing",
        "Sales returns",
      ],
    },
    {
      icon: <UsersIcon className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Customer Management",
      text: "Build lasting relationships with your customers and track their purchase history.",
      color: "from-emerald-500 to-teal-400",
      features: [
        "Customer profiles",
        "Purchase history",
        "Loyalty programs",
        "Customer feedback",
      ],
    },
    {
      icon: <FileText className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Invoicing & Billing",
      text: "Professional invoices and billing that comply with RRA requirements.",
      color: "from-amber-500 to-yellow-400",
      features: [
        "Custom invoices",
        "Tax calculations",
        "Payment tracking",
        "Export to Excel/PDF",
      ],
    },
    {
      icon: <BarChart2 className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "Business Analytics",
      text: "Make data-driven decisions with comprehensive business insights.",
      color: "from-rose-500 to-pink-400",
      features: [
        "Sales reports",
        "Inventory reports",
        "Profit analysis",
        "Performance metrics",
      ],
    },
    {
      icon: <UserCheck className="h-6 w-6 sm:h-7 sm:w-7" />,
      title: "User Management",
      text: "Control access with role-based permissions for your team.",
      color: "from-indigo-500 to-blue-400",
      features: [
        "Role-based access",
        "User permissions",
        "Activity logs",
        "Team management",
      ],
    },
  ];

  return (
    <>
      {/* About Section */}
      <section
        id="about"
        className="py-16 sm:py-20 md:py-24 bg-gradient-to-b from-muted/30 to-background"
      >
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 sm:mb-6">
              <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-[#19c295]">
                Built for Rwandan Businesses
              </span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed px-4">
              We understand the unique challenges of running a business in
              Rwanda. Our platform is designed to help you overcome these
              challenges and grow your business efficiently.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {aboutFeatures.map((item, idx) => (
              <FeatureCard key={idx} feature={item} />
            ))}
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section
        id="services"
        className="py-16 sm:py-20 md:py-24 bg-gradient-to-b from-background to-muted/30"
      >
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 sm:mb-6">
              <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-[#2fa8f3]">
                Everything You Need to Succeed
              </span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed px-4">
              Comprehensive features designed to streamline your business
              operations in Rwanda
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {serviceFeatures.map((service, idx) => (
              <ServiceCard key={idx} service={service} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
};

const FeatureCard = ({ feature }: { feature: FeatureItem }) => (
  <div className="group relative overflow-hidden rounded-xl sm:rounded-2xl border border-border/50 bg-background p-6 sm:p-8 shadow-lg transition-all duration-500 hover:shadow-2xl hover:border-primary/50 hover:scale-105">
    <div
      className={`absolute inset-0 bg-gradient-to-br ${feature.color} opacity-0 group-hover:opacity-10 transition-opacity duration-500`}
    />
    <div className="relative">
      <div
        className={`mb-4 sm:mb-5 inline-flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-xl bg-gradient-to-br ${feature.color} text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}
      >
        {feature.icon}
      </div>
      <h3 className="text-xl sm:text-2xl font-bold mb-2 sm:mb-3 group-hover:text-primary transition-colors">
        {feature.title}
      </h3>
      <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
        {feature.text}
      </p>
    </div>
  </div>
);

const ServiceCard = ({ service }: { service: FeatureItem }) => (
  <div className="group relative overflow-hidden rounded-xl sm:rounded-2xl border border-border/50 bg-background p-6 sm:p-8 shadow-lg transition-all duration-500 hover:shadow-2xl hover:border-primary/50 hover:scale-105">
    <div
      className={`absolute inset-0 bg-gradient-to-br ${service.color} opacity-0 group-hover:opacity-10 transition-opacity duration-500`}
    />
    <div className="relative">
      <div
        className={`mb-4 sm:mb-5 inline-flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-xl bg-gradient-to-br ${service.color} text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}
      >
        {service.icon}
      </div>
      <h3 className="text-xl sm:text-2xl font-bold mb-2 sm:mb-3 group-hover:text-primary transition-colors">
        {service.title}
      </h3>
      <p className="text-sm sm:text-base text-muted-foreground mb-4 sm:mb-5 leading-relaxed">
        {service.text}
      </p>
      <ul className="space-y-2">
        {service.features?.map((feature, i) => (
          <li key={i} className="flex items-start">
            <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
            <span className="text-xs sm:text-sm">{feature}</span>
          </li>
        ))}
      </ul>
    </div>
  </div>
);
