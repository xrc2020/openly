import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Terms of Service | Openly",
  description: "Terms for hosting, joining games and using Openly Plus.",
  alternates: { canonical: "https://playopenly.com/terms" },
};

const sections = [
  ["1. Using Openly", "These terms apply to playopenly.com and its game-management features. By using Openly, you agree to these terms. If you do not agree, do not use the service. If you are under 18, obtain a parent or guardian’s permission before registering, making payments or participating in games."],
  ["2. Your account", "Provide accurate information, protect your sign-in account and do not impersonate another person. You are responsible for activity you authorize through your account. Notify openly.rc@gmail.com if you suspect unauthorized access."],
  ["3. Hosts and participants", "Openly provides tools to discover games, manage participation and organize play. Unless expressly stated, Openly is not the venue operator or the organizer of a host’s event. Hosts are responsible for accurate schedules, venue arrangements, fees, payment instructions, cancellation conditions and participant communications.", "Submitting a join request or payment does not by itself guarantee a confirmed place. Check your participation status and the host’s decision. Players should confirm the game details and any refund conditions with the host before paying or travelling."],
  ["4. Game fees and payment verification", "A host’s game fee is separate from Openly Plus or a Session unlock. Pay through the method shown by the host or Openly checkout, as appropriate. Never send account passwords or payment PINs. Uploaded receipts are evidence for review, not automatic confirmation of payment.", "Premium purchases currently require administrator verification. Access is activated after approval, not merely after opening a payment link or submitting a receipt. Contact support if a payment is missing, duplicated or incorrectly recorded."],
  ["5. Free hosting and premium tools", "Free hosting allows up to three published Open Plays per Philippine calendar day. Participants do not need Openly Plus to join games; the host’s own participation fee may still apply.", "The listed Session unlock price is ₱39 for premium tools on one selected saved Open Play. It does not remove the Free daily hosting limit. Openly Plus is listed at ₱399 for one calendar month and includes unlimited daily hosting and the premium host tools described at purchase. Check the checkout page for the current price and included features.", "Plus validity starts on approval; an approved early renewal extends the paid-through date. Your displayed validity period indicates when access expires. The current manual payment flow does not automatically charge renewals. Feature availability may change; material changes to purchased access will be communicated."],
  ["6. Cancellations and refunds", "For a host’s game fee, contact the host about cancellations, rejection, rescheduling or refunds. Hosts should clearly explain their conditions before collecting payment and address payments from players they cannot accommodate.", "For payments made to Openly, contact openly.rc@gmail.com with your account email and payment reference. We review duplicate payments, failed activation and other refund requests individually. Refunds are not automatic, and requesting one does not guarantee approval. Nothing in these terms removes refund or other consumer rights required by applicable law."],
  ["7. Respectful and safe participation", "Do not harass others, post unlawful material, submit fake receipts, manipulate results, access other accounts or interfere with the service. Only upload content you are entitled to share. You allow Openly to store and display your submitted content as necessary to operate the features you use.", "Sport involves physical risks. Assess your fitness, follow venue rules and stop playing if conditions are unsafe. Hosts and players remain responsible for their own conduct. Rotation suggestions and recorded results are organizational tools, not safety advice or an official third-party rating."],
  ["8. Service availability and moderation", "Openly may experience outages, errors or feature changes, particularly during beta testing. We may restrict accounts or cancel listings to address misuse, safety concerns or legal requirements. You can contact support to question a moderation decision. We do not promise uninterrupted access or guarantee a host’s conduct, venue availability or a particular sporting outcome."],
  ["9. Responsibility and applicable rights", "Each party remains responsible for its own actions under applicable law. Openly is not responsible for independent host or venue conduct merely because a game is listed here. Nothing in these terms excludes liability or rights that cannot lawfully be excluded. These terms are governed by Philippine law, subject to any mandatory protections that apply to you."],
  ["10. Privacy, changes and contact", "Our Privacy Policy explains how we handle account and game information. We may update these terms and will update the revision date and provide additional notice for material changes where appropriate. For support, payment concerns or questions about these terms, email openly.rc@gmail.com."],
];

export default function TermsPage() {
  return <main className={styles.page}><div className={styles.wrap}>
    <nav className={styles.nav} aria-label="Page navigation"><Link href="/" className={styles.brand}>openly<span>.</span></Link><Link href="/">Back to Discover</Link></nav>
    <p className={styles.eyebrow}>Good games. Clear expectations.</p><h1>Terms of Service</h1>
    <p className={styles.intro}>Last updated: September 17, 2026<br />The ground rules for hosting, joining and using Openly.</p>
    <article className={styles.article}>{sections.map(([title, ...paragraphs]) => <section key={title}><h2>{title}</h2>{paragraphs.map(p => <p key={p}>{p}</p>)}</section>)}</article>
    <footer className={styles.footer}><Link href="/privacy">Privacy Policy</Link><a href="mailto:openly.rc@gmail.com">Contact Openly</a></footer>
  </div></main>;
}
