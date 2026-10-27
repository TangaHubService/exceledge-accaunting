import SubscriptionPage from "../../pages/SubscriptionPage";
export const PricingSection = () => {
  return (
    <section
      id="pricing"
      className="py-16 sm:py-20 md:py-24 bg-gradient-to-b from-muted/30 to-background"
    >

      <div className="mx-auto text-center mb-12 sm:mb-16 px-6">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 sm:mb-6">
          <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-[#c560df]">
            Simple, Transparent Pricing
          </span>
        </h2>
        <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed px-4 mb-6">
          Find the right plan for your business and scale with confidence.
          Every plan includes powerful features to help you grow.
          Start your journey with a free trial—no credit card required and no hidden fees.
        </p>

        <SubscriptionPage showPlanHeader={false} />
        <p className="text-sm sm:text-base max-w-2xl mx-auto text-muted-foreground my-6">
          Need something more advanced?
          Our sales team can help you build a custom enterprise package
          with personalized support and tailored features.
          <a
            href="#contact"
            className="text-primary font-semibold hover:underline"
          >
            Contact our sales team
          </a>
        </p>
      </div>
    </section>
  );
};