// Site-wide navigation and footer links. Every page reads from here,
// so adding a page means adding one line.

export const MAIN_NAV = [
  { label: "Features", href: "/features" },
  { label: "Caption styles", href: "/styles" },
  { label: "Examples", href: "/examples" },
  { label: "Pricing", href: "/pricing" },
] as const;

export const FOOTER_NAV = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Caption styles", href: "/styles" },
      { label: "Examples", href: "/examples" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Blog", href: "/blog" },
      { label: "Contact", href: "mailto:hello@shortcraft.app" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Log in", href: "/login" },
      { label: "Sign up", href: "/signup" },
    ],
  },
] as const;
