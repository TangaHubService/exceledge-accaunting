import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";

export const FAQSection = () => (
  <section
    id="faq"
    className="py-16 sm:py-20 md:py-24 bg-gradient-to-b from-background to-muted/30"
  >
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center mb-12 sm:mb-16">
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 sm:mb-6">
          <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-[#f44a72]">
            Frequently Asked Questions
          </span>
        </h2>
        <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed px-4">
          Everything you need to know about our platform
        </p>
      </div>

      <div className="mx-auto max-w-3xl">
        <Accordion type="single" collapsible className="w-full space-y-4">
          <FAQItem
            value="1"
            question="What types of businesses can use this platform?"
            answer="Our platform is designed for pharmacies, hardware stores, retail shops, grocery stores, restaurants, and many other business types across Rwanda. Whether you're a small shop or a growing enterprise, we have the right solution for you."
          />
          <FAQItem
            value="2"
            question="Can I manage multiple locations?"
            answer="Yes! You can manage multiple organizations or branches from one account. Our multi-location support allows you to track inventory, sales, and performance across all your business locations in real-time."
          />
          <FAQItem
            value="3"
            question="Is my data secure?"
            answer="Absolutely. We use bank-grade encryption for all data transfers and storage. Your data is backed up daily, and we maintain a 99.9% uptime guarantee. We also comply with all Rwandan data protection regulations."
          />
          <FAQItem
            value="4"
            question="Do you offer training and support?"
            answer="Yes! We provide comprehensive onboarding training for all new users. Our local support team is available 24/7 via phone, email, and chat in Kinyarwanda, English, and French. Premium plans include in-person training and dedicated account managers."
          />
          <FAQItem
            value="5"
            question="Can I cancel my subscription anytime?"
            answer="Yes, you can cancel your subscription at any time with no penalties or hidden fees. Your data will remain accessible for 30 days after cancellation, giving you time to export everything you need."
          />
        </Accordion>
      </div>
    </div>
  </section>
);

interface FAQItemProps {
  value: string;
  question: string;
  answer: string;
}

const FAQItem = ({ value, question, answer }: FAQItemProps) => (
  <AccordionItem
    value={value}
    className="border rounded-xl px-4 sm:px-6 bg-background shadow-sm hover:shadow-md transition-shadow"
  >
    <AccordionTrigger className="text-base sm:text-lg font-semibold hover:text-primary py-4">
      {question}
    </AccordionTrigger>
    <AccordionContent className="text-sm sm:text-base text-muted-foreground leading-relaxed pb-4">
      {answer}
    </AccordionContent>
  </AccordionItem>
);
