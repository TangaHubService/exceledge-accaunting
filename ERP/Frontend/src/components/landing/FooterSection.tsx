import logo from "../../assets/vdlogo.fd0748ee6ccf6d81d171.png";

const footerLinks = [
  {
    title: "Company",
    links: [
      { label: "About Us", href: "#about" },
      { label: "Pricing", href: "#pricing" },
      { label: "Contact", href: "#contact" }
    ]
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "#" },
      { label: "Terms of Service", href: "#" },
      { label: "Cookie Policy", href: "#" }
    ]
  }
];

export const FooterSection = () => (
  <footer className="py-10 sm:py-12 border-t bg-muted/30">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-6 sm:gap-8 mb-10 sm:mb-12">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="h-20 w-20">
              <img src={logo} loading="lazy" className="rounded-full" />
            </div>
            <span className="text-lg font-semibold">Exceledge ERP</span>
            <span className="text-xs text-muted-foreground text-center">
              Your reliable and trusted business partner in the inventory management game.
            </span>
          </div>
        </div>
        {footerLinks.map((group, idx) => (
          <div key={idx}>
            <h3 className="font-semibold mb-3 sm:mb-4 text-base sm:text-lg">{group.title}</h3>
            <ul className="space-y-2 sm:space-y-3 text-xs sm:text-sm text-muted-foreground">
              {group.links.map((link, i) => (
                <li key={i}>
                  <a
                    href={link.href}
                    className="hover:text-primary transition-colors hover:underline"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="pt-4 sm:pt-4 border-t">
        <div className="flex flex-col md:flex-row justify-center items-center">
          <p className="text-xs sm:text-sm text-muted-foreground text-center md:text-left">
            &copy; {new Date().getFullYear()} Exceledge ERP. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  </footer>
);
