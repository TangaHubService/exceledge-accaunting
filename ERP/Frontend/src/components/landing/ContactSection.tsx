import { useState } from "react";
import { Button } from "../ui/button";
import { MapPin, Phone, Mail } from "lucide-react";
import { toast } from "react-toastify";

interface ContactInfoCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}

const ContactInfoCard = ({
  icon,
  title,
  children,
  className = "",
}: ContactInfoCardProps) => (
  <div className={` sm:rounded-2xl px-5 sm:px-6  ${className}`}>
    <div className="flex items-start gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg  text-[#628af6] flex-shrink-0 shadow-lg">
        {icon}
      </div>
      <div>
        <h3 className="font-semibold text-base sm:text-lg mb-2">{title}</h3>
        <div className="text-sm sm:text-base text-muted-foreground">
          {children}
        </div>
      </div>
    </div>
  </div>
);

export const ContactSection = () => {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormData({ name: "", email: "", phone: "", message: "" });
    const scriptFormApi = import.meta.env.VITE_CONTACT_FORM_SCRIPT_ID
    const url = `https://script.google.com/macros/s/${scriptFormApi}/exec`
    const encoded_data = encodeURI(JSON.stringify(formData))

    try {
      setLoading(true)
      const response = await fetch(`${url}?data=${encoded_data}`)
      setLoading(false)

      if (!response.ok) {
        toast.success("Message sent successfully!")
        return
      }

      const result = await response.json()
      toast.error(result.message)
    } catch (error) {
      setLoading(false)
      toast.error("Failed to send message. Please try again later.")
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  return (
    <section
      id="contact"
      className="py-16 sm:py-20 md:py-24 bg-gradient-to-b from-muted/30 to-background"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-4 sm:mb-6">
              <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-[#628af6]">
                Get In Touch
              </span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto px-4">
              Have questions? We'd love to hear from you. Send us a message and
              we'll respond as soon as possible.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 sm:gap-12">
            {/* Contact Form */}
            <div className="bg-background rounded-xl sm:rounded-2xl border border-border/50 shadow-xl p-6 sm:p-8 hover:shadow-2xl transition-shadow duration-300">
              <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6">
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium mb-2"
                  >
                    Full Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium mb-2"
                  >
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="block text-sm font-medium mb-2"
                  >
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  />
                </div>

                <div>
                  <label
                    htmlFor="message"
                    className="block text-sm font-medium mb-2"
                  >
                    Your Message
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    value={formData.message}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                    required
                  ></textarea>
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-[#628af6] hover:shadow-xl hover:shadow-primary/30 transition-all duration-300 hover:scale-105 text-white"
                >
                  {loading ? "Loading..." : "Send message"}
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="ml-2 h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </Button>
              </form>
            </div>

            {/* Contact Information */}
            <div className="space-y-6 sm:space-y-8">
              <ContactInfoCard
                icon={<MapPin className="h-5 w-5 sm:h-6 sm:w-6" />}
                title="Visit Us"
              >
                42 St KK 718, Excelege
                <br />
                Kigali, Rwanda
              </ContactInfoCard>

              <ContactInfoCard
                icon={<Phone className="h-5 w-5 sm:h-6 sm:w-6" />}
                title="Call Us"
              >
                +250 788 701 837
              </ContactInfoCard>

              <ContactInfoCard
                icon={<Mail className="h-5 w-5 sm:h-6 sm:w-6" />}
                title="Email Us"
              >

                info@exceledgecpa.com
                <br />
                support@exceledgecpa.com
              </ContactInfoCard>

              <div className="bg-gradient-to-br from-primary/10 to-purple-600/10 rounded-xl sm:rounded-2xl p-5 sm:p-6">
                <h3 className="font-semibold text-base sm:text-lg mb-3">
                  Business Hours
                </h3>
                <div className="space-y-2 text-xs sm:text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Monday - Friday:</span>
                    <span className="font-medium text-foreground">
                      8:00 AM - 5:00 PM
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Saturday:</span>
                    <span className="font-medium text-foreground">
                      Closed
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sunday:</span>
                    <span className="font-medium text-foreground">
                      9:00 AM - 3:00 PM
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-primary/20">
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    <span className="font-semibold text-primary">
                      24/7 Support:
                    </span>{" "}
                    Available for all customers
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

