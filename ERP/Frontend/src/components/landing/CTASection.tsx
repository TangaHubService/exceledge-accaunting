import { ArrowRight, Phone } from "lucide-react";
import { Button } from "../ui/button";
import { Link } from "react-router-dom";

export const CTASection = () => (
  <section className="py-16 sm:py-20 md:py-24 bg-[#628af6] to-primary text-white relative overflow-hidden">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent" />
    <div className="absolute top-10 left-10 w-32 h-32 sm:w-40 sm:h-40 bg-white/10 rounded-full blur-3xl animate-pulse-slow" />
    <div
      className="absolute bottom-10 right-10 w-32 h-32 sm:w-40 sm:h-40 bg-white/10 rounded-full blur-3xl animate-pulse-slow"
      style={{ animationDelay: "1s" }}
    />

    <div className="container mx-auto relative z-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 sm:mb-6 animate-fade-in">
          Ready to Transform Your Business?
        </h2>
        <p className="text-lg sm:text-xl mb-8 sm:mb-10 opacity-90 leading-relaxed px-4 animate-fade-in delay-100">
          Join thousands of businesses already using our platform to streamline
          operations and boost profits.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-6 sm:mb-8 animate-fade-in delay-200">
          <Link to="/signup" className="w-full sm:w-auto">
            <Button
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto hover:scale-105 transition-all duration-300 shadow-xl text-base sm:text-lg px-6 sm:px-8 bg-[#18be8e]"
            >
              Start Free Trial
              <ArrowRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          </Link>

          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto bg-transparent border-2 border-white text-white hover:scale-105 transition-all duration-300  text-base sm:text-lg px-6 sm:px-8"
          >
            <Phone className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
            Contact Sales
          </Button>
        </div>

        <p className="text-xs sm:text-sm opacity-75 animate-fade-in delay-300">
          ✓ No credit card required • ✓ 7-day free trial • ✓ Cancel anytime
        </p>
      </div>
    </div>
  </section>
);
