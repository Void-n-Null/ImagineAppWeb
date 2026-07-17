import { createFileRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { CONTACT_EMAIL, CONTACT_MAILTO } from '#/lib/contact'

/**
 * Privacy policy (IMA-47 follow-up). Static prose, but the claims are load
 * bearing: every statement below is checked against the actual data flows
 * (Neon schema, agent transport, PostHog project settings, ZDR routing in
 * openrouter.ts). If a data flow changes, this page must change with it.
 */
export const Route = createFileRoute('/_app/privacy')({
  component: PrivacyPage,
})

const EFFECTIVE_DATE = 'July 14, 2026'

function Section({
  number,
  title,
  children,
}: {
  number: string
  title: string
  children: ReactNode
}) {
  return (
    <section className="mt-7">
      <h2 className="text-body-lg font-extrabold tracking-tight">
        {number}. {title}
      </h2>
      <div className="mt-2 flex flex-col gap-3 text-body-sm leading-relaxed text-text-muted">
        {children}
      </div>
    </section>
  )
}

function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16">
      <h1 className="text-title font-extrabold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-1 text-caption text-text-faint">
        Effective date: {EFFECTIVE_DATE}
      </p>

      <Section number="1" title="Introduction">
        <p>
          This Privacy Policy describes how Imagine App (the "Service", "we",
          "us", or "our"), available at imagineapp.net, collects, uses, and
          discloses information about you when you access or use the Service.
          Please read this Policy carefully. By using the Service, you
          acknowledge the practices described herein.
        </p>
        <p>
          The Service is operated by an independent developer. Imagine App is
          not owned by, operated by, affiliated with, or endorsed by Best Buy
          Co., Inc. Product information displayed within the Service is
          retrieved from publicly available data sources.
        </p>
      </Section>

      <Section number="2" title="Information We Collect">
        <p>
          <strong className="text-text">2.1 Account information.</strong> The
          Service offers sign-in through Google, facilitated by our
          authentication provider, Clerk. When you sign in, the authentication
          provider receives your Google account profile information, including
          your name, email address, and profile image. Of that information, we
          store an account identifier, your email address, your Service
          preferences, and a record of any promotional usage credits granted to
          your account.
        </p>
        <p>
          <strong className="text-text">
            2.2 Conversations with the assistant.
          </strong>{' '}
          When you use the chat feature, the content of your messages, including
          any images you attach and, if you use voice input, a recording of your
          speech for the purpose of transcription, is transmitted to our servers
          and processed as described in Section 4. Conversations are stored on
          your device. If you are signed in, conversations are additionally
          stored on our servers to allow you to resume them across devices, and
          are deleted from our servers approximately seventy-two (72) hours
          after their last activity.
        </p>
        <p>
          <strong className="text-text">2.3 Usage information.</strong> We use
          PostHog, an analytics service, to collect information about how the
          Service is used. This includes pages viewed, features used, searches
          performed, interactions such as clicks and taps, device and browser
          type, operating system, screen dimensions, and approximate, city-level
          location derived from your IP address at the time of receipt. We have
          configured our analytics service to discard full IP addresses rather
          than retain them. We also collect session replays, which are
          reconstructions of individual visits showing on-screen activity. Text
          you type into input fields is masked in session replays by default;
          content displayed on screen, including conversation text rendered in
          the interface, may be visible. If you are signed in, usage information
          is associated with your account identifier and email address;
          otherwise it is associated with a random identifier stored in your
          browser.
        </p>
        <p>
          <strong className="text-text">
            2.4 Information processed only on your device.
          </strong>{' '}
          The barcode scanning and text recognition features process camera
          frames entirely on your device. Camera imagery is never transmitted to
          our servers or to any third party. Your cart contents, scan history,
          model selection, and interface preferences are likewise stored in your
          browser's local storage and remain on your device unless you are
          signed in and a given preference is synchronized to your account.
        </p>
        <p>
          <strong className="text-text">2.5 Server logs.</strong> Our hosting
          provider maintains standard server logs, which may include IP
          addresses, user agent strings, and the time and path of each request.
          These logs are used for security and operational purposes and are
          retained for a limited period in accordance with the hosting
          provider's practices.
        </p>
      </Section>

      <Section number="3" title="How We Use Information">
        <p>We use the information described above to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            provide, operate, and maintain the Service, including
            authentication, conversation synchronization, and administration of
            usage credits;
          </li>
          <li>process requests you direct to the assistant;</li>
          <li>
            understand how the Service is used, diagnose defects, and improve
            functionality and usability;
          </li>
          <li>
            protect the security and integrity of the Service and prevent abuse;
            and
          </li>
          <li>comply with applicable legal obligations.</li>
        </ul>
        <p>
          We do not sell personal information. We do not share personal
          information with third parties for their own advertising purposes. The
          Service displays no third-party advertising.
        </p>
      </Section>

      <Section number="4" title="Artificial Intelligence Processing">
        <p>
          Assistant requests are relayed through OpenRouter, Inc. to the model
          provider corresponding to the model you have selected. Every such
          request is issued under routing restrictions that (a) exclude
          providers that retain or collect prompt data, and (b) require
          zero-data-retention endpoints, meaning the receiving provider does not
          store the content of the request after processing it. We do not permit
          conversation content to be used for the training of machine learning
          models. Voice recordings submitted for transcription are processed
          under the same restrictions and are not retained after transcription.
        </p>
      </Section>

      <Section number="5" title="Cookies and Similar Technologies">
        <p>
          The Service uses cookies and browser storage for two purposes: (a)
          strictly necessary cookies set by our authentication provider to
          maintain your signed-in session; and (b) a first-party analytics
          identifier that allows our analytics service to recognize repeat
          visits. You may configure your browser to refuse cookies or to clear
          site data, although doing so may prevent you from signing in or cause
          the Service to treat you as a new visitor.
        </p>
      </Section>

      <Section number="6" title="Service Providers">
        <p>
          We disclose information to the following service providers, each of
          which processes it on our behalf for the purposes stated:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Clerk, Inc.: authentication and account management;</li>
          <li>Google LLC: sign-in identity provider;</li>
          <li>
            PostHog, Inc.: usage analytics and session replay, processed in the
            United States;
          </li>
          <li>
            OpenRouter, Inc. and the model provider you select: assistant
            request processing, subject to Section 4;
          </li>
          <li>Vercel, Inc.: application hosting and server logs;</li>
          <li>
            Neon, Inc.: database hosting for account records and synchronized
            conversations;
          </li>
          <li>
            Upstash, Inc.: caching of product catalog data; no personal
            information is stored in this cache;
          </li>
          <li>
            Exa Labs, Inc.: web search performed on the assistant's behalf;
            receives only the generated search query text, never your identity;
            and
          </li>
          <li>
            Best Buy's publicly available product interfaces: receive the
            product search terms and item identifiers necessary to fulfill
            catalog lookups; these requests originate from our servers and are
            not associated with your identity.
          </li>
        </ul>
      </Section>

      <Section number="7" title="Data Retention">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Account records are retained while your account remains active and
            are deleted upon verified request;
          </li>
          <li>
            server-side conversation records are deleted approximately
            seventy-two (72) hours after last activity;
          </li>
          <li>
            analytics events are retained for up to one (1) year, and session
            replays for up to thirty (30) days;
          </li>
          <li>
            information stored on your device remains until you clear your
            browser's site data.
          </li>
        </ul>
      </Section>

      <Section number="8" title="Data Security">
        <p>
          We employ commercially reasonable technical and organizational
          measures to protect the information we process, including encryption
          of data in transit and reliance on service providers that encrypt data
          at rest. No method of transmission or storage is completely secure,
          and we cannot guarantee absolute security.
        </p>
      </Section>

      <Section number="9" title="Your Choices and Rights">
        <p>
          You may request access to, correction of, or deletion of the personal
          information we hold about you by contacting us at the address in
          Section 13. We will honor such requests regardless of your place of
          residence, subject to verification of your identity and any legal
          basis for retention. You may also: sign out of the Service at any
          time; clear your browser's site data to remove locally stored
          information; and revoke the Service's camera permission through your
          browser or device settings.
        </p>
      </Section>

      <Section number="10" title="Children's Privacy">
        <p>
          The Service is not directed to children under the age of thirteen
          (13), and we do not knowingly collect personal information from them.
          If you believe a child has provided personal information to the
          Service, please contact us and we will delete it.
        </p>
      </Section>

      <Section number="11" title="Location of Processing">
        <p>
          The Service is operated from the United States, and the information
          described in this Policy is processed in the United States. If you
          access the Service from another jurisdiction, you understand that your
          information will be transferred to and processed in the United States,
          where data protection laws may differ from those of your jurisdiction.
        </p>
      </Section>

      <Section number="12" title="Changes to This Policy">
        <p>
          We may revise this Policy from time to time. The revised Policy will
          be posted on this page with an updated effective date, and material
          changes will be reflected in that date. Your continued use of the
          Service after a revision becomes effective constitutes your
          acknowledgment of the revised Policy.
        </p>
      </Section>

      <Section number="13" title="Contact">
        <p>
          Questions, requests, and complaints concerning this Policy or our data
          practices may be directed to{' '}
          <a
            href={CONTACT_MAILTO}
            className="font-semibold text-text underline decoration-line-strong underline-offset-2"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </div>
  )
}
