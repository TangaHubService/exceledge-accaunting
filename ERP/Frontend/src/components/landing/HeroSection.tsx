import { ArrowRight, PlayCircle, Star } from "lucide-react";
import { Button } from "../ui/button";
import { Link } from "react-router-dom";

import thumb4 from "../../assets/thumb-4.webp";

export const HeroSection = () => (
  <section id="home" className="relative overflow-hidden h-[80vh]">
    {/* Content */}
    <div className="relative z-10 h-full items-center justify-center flex flex-col">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl text-center text-white h-full">
          <div>
            {/* Background Image with Overlay */}
            <div className="absolute inset-0 -z-10">
              <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                style={{
                  backgroundImage: `url(${thumb4})`,
                  // opacity: 0.3
                }}
              />
              {/* Dark overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/70 to-transparent z-0" />
              {/* Color overlay */}
              <div className="absolute inset-0 bg-gradient-to-b from-primary/20 via-purple-500/10 to-transparent" />
              {/* Animated elements */}
              <div className="absolute top-0 left-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-primary/20 rounded-full blur-3xl animate-pulse-slow" />
              <div
                className="absolute bottom-0 right-1/4 w-72 h-72 sm:w-96 sm:h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse-slow"
                style={{ animationDelay: "1s" }}
              />
            </div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary/10 to-purple-600/10 px-4 sm:px-5 py-2 text-xs sm:text-sm font-medium border border-primary/20 animate-fade-in shadow-lg">
              <Star className="h-4 w-4 text-primary" />
              <span className="bg-gradient-to-r from-primary to-purple-600 bg-clip-text font-semibold">
                Trusted by <span className="text-yellow-400">100+</span>{" "}
                businesses in Rwanda
              </span>
            </div>

            <h1 className="mb-6 text-xl lg:text-5xl font-semibold tracking-tight animate-fade-in delay-100">
              <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/80 bg-clip-text">
                The Complete
              </span>
              <br />
              <span className="text-yellow-500  bg-clip-text">
                Inventory Management
              </span>
              <br />
              <span className="bg-gradient-to-r from-foreground via-foreground to-foreground/80 bg-clip-text">
                Solution
              </span>
            </h1>

            <p className="mb-8 sm:mb-10 text-base sm:text-lg md:text-xl lg:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed px-4 animate-fade-in delay-200">
              Streamline your inventory, sales, and customer management in one
              powerful platform. Designed for Rwandan businesses to grow
              efficiently.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12 sm:mb-16 px-4 animate-fade-in delay-300">
              <Link to="/signup" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="w-full sm:w-auto bg-blue-700 hover:opacity-90 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/40 hover:scale-105 text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6 border "
                >
                  Start Free Trial
                  <ArrowRight className="ml-2 h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto border-2 hover:bg-primary/5 hover:border-primary transition-all duration-300 text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6"
              >
                <PlayCircle className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                Watch Demo
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);
