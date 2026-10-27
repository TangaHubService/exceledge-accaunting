import { useState, useEffect } from "react";
import {
  Header,
  HeroSection,
  FeaturesSection,
  PricingSection,
  FAQSection,
  ContactSection,
  CTASection,
  FooterSection,
} from "../components/landing";
import StatsGrid from "../components/landing/StatsGrid";

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col scroll-smooth" style={{ scrollBehavior: 'smooth' }}>
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slide-in-left {
          from { opacity: 0; transform: translateX(-30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-right {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.8; }
        }
        .animate-fade-in { animation: fade-in 0.6s ease-out forwards; }
        .animate-slide-in-left { animation: slide-in-left 0.6s ease-out forwards; }
        .animate-slide-in-right { animation: slide-in-right 0.6s ease-out forwards; }
        .animate-pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }
        .delay-100 { animation-delay: 0.1s; opacity: 0; }
        .delay-200 { animation-delay: 0.2s; opacity: 0; }
        .delay-300 { animation-delay: 0.3s; opacity: 0; }
      `}</style>

      <Header
        isMenuOpen={isMenuOpen}
        setIsMenuOpen={setIsMenuOpen}
        scrolled={scrolled}
      />

      <main className="flex-1">
        <HeroSection />
        <section className="py-10 sm:py-16 md:py-20 px-">
          <h2 className="text-center text-2xl sm:text-3xl md:text-4xl font-bold mb-8">
            Our Performance at a Glance
          </h2>
          <StatsGrid />
        </section>
        <FeaturesSection />
        <PricingSection />
        <FAQSection />
        <ContactSection />
        <CTASection />
      </main>

      <FooterSection />
    </div>
  );
}
