// Hand-authored contact routes.
//
// Anything left as an empty string is simply not rendered — no dead links, no
// "coming soon" placeholders shipped to a visitor. Fill in `email`, `linkedin`,
// or `resumeUrl` here and the contact page grows that channel automatically.
export interface ContactChannel {
  label: string;
  value: string;
  href: string;
  note: string;
}

export interface ContactConfig {
  github: string;
  /** Leave empty to keep the address off the public site. */
  email: string;
  linkedin: string;
  /** Path or URL to a CV; renders a "Download CV" button when set. */
  resumeUrl: string;
  availability: string;
  responseTime: string;
}

export const CONTACT: ContactConfig = {
  github: "https://github.com/arcTanMyAngle",
  email: "",
  linkedin: "",
  resumeUrl: "",
  // Shown verbatim at the top of the contact page. Keep it factual.
  availability: "Open to work on real-time systems, native tooling, and on-device ML.",
  responseTime: "GitHub notifications are watched; expect a reply within a few days.",
};

export function getContactChannels(): ContactChannel[] {
  const channels: ContactChannel[] = [
    {
      label: "GitHub",
      value: "arcTanMyAngle",
      href: CONTACT.github,
      note: "Issues and discussions on any repo reach me directly.",
    },
  ];

  if (CONTACT.email) {
    channels.push({
      label: "Email",
      value: CONTACT.email,
      href: `mailto:${CONTACT.email}`,
      note: "Best for hiring conversations and anything with an attachment.",
    });
  }

  if (CONTACT.linkedin) {
    channels.push({
      label: "LinkedIn",
      value: CONTACT.linkedin.replace(/^https?:\/\/(www\.)?/, ""),
      href: CONTACT.linkedin,
      note: "Work history and the usual recruiter-facing profile.",
    });
  }

  return channels;
}
