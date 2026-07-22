# Privacy Policy for Klikkikuri Paatti

*Last updated: July 22, 2026*

This Privacy Policy describes how *Klikkikuri* ("Klikkikuri Paatti", "the Extension", "we", "us", or "our") handles user information and data. We are committed to protecting your privacy and ensuring transparency about what data is processed, how it is used, and where it is sent.

## 1. Overview & Core Privacy Principles

Klikkikuri Paatti is designed with privacy-first principles:

* Your routine web browsing activity, visited URLs, and headline checks are processed **entirely on your local device**.
* When you visit websites, **no external server or API is queried** to analyze or check page headlines. All headline processing, link identification, and text replacements take place 100% offline on your machine against a cached local database.
* The extension **never transmits your browsing history**, visited URLs, or browsing activity to any external server **without explicit user taken action** (see Section 2.B below).
* User feedback and invitation requests are sent to Google Forms **only when you explicitly fill out and submit a form**.
* The extension periodically downloads **static, public headline correction database files** from GitHub (`raw.githubusercontent.com`). These downloads are generic and contain no user query parameters or browsing data.
* The extension contains **no third-party analytics trackers, crash reporters, or telemetry tools** (such as Google Analytics or Sentry). We have no way of tracking how often you use the extension or which features you click.

## 2. Information We Collect, Process, and Retrieve

### A. Data Processed Locally (On Your Device - No External Queries)

* Page URLs and headline texts on supported news sites are identified and compared against a local/cached database, ensuring **no external service is queried** during this 100% local process.
* User preferences (e.g., active sites, threshold settings, title modifiers) are **stored locally in your browser**, and in the browser sync settings if you have opted to use that feature.

### B. Data Transmitted to Third-Party Services (Google Forms)

Data is sent to Google Forms endpoints ([`docs.google.com/forms/...`](https://docs.google.com/forms/)) **only when you explicitly submit data**:

#### 1. Feedback & Headline Corrections

When you submit a feedback item or correction report via the extension:

* The address of the **news page** containing the headline (`entry.1944615860`).
* The **original and/or converted headline title** (`entry.917360051`, `entry.1935829065`).
* Any optional **comments, feedback, or corrections** you type into the feedback field (`entry.78795748`).
* Technical **metadata related to the feedback item** (URL signature hash, clickbait severity level rating, feedback type, database status).

#### 2. Paid Version Invitation / Waitlist

When you request an invitation or register interest for the paid version:

* The **email address** provided in the invitation form (`emailAddress`).
* The **timestamp** of the request submission.

### C. Data Retrieved from External Services (GitHub Database Updates)

To keep clickbait detection up to date, the extension periodically fetches public database updates (`data.json`) via HTTP GET requests from GitHub ([`https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json`](https://raw.githubusercontent.com/Klikkikuri/rahti/refs/heads/main/data.json)).

* These requests are read-only downloads of public database files, and **no personal information, browsing history, queried URLs, or user identifiers are included**.
* As with any web request, GitHub's servers receive **standard HTTP request metadata** (such as your IP address and browser User-Agent).

## 3. How We Use Your Information

* Submitted feedback is used solely to **review clickbait detection accuracy**, improve headline replacement algorithms, and update our database of headline corrections.
* Additionally, **we may compile and publish these feedback submissions as an open-source, anonymized dataset**. Prior to any public release, all data is strictly sanitized to strip any inadvertent personal information, to a point it would fall outside the scope of GDPR Article 4(1) definition of personal data.
* Your email address is used solely to **notify you about updates regarding invitations, early access, or subscriptions** for the paid version of Klikkikuri Paatti, and is never sold, rented, or used for unrelated marketing purposes.
* Retrieved database files are **used locally to perform headline replacements** on supported sites.

### A. Proactive Notice of Changes

If we make material changes to our data handling practices — including changing the third-party services that process your data — we will notify you via an extension update release note or in-extension alert at least 14 days before the new practices take effect. For non-material changes (such as upgrading security infrastructure or correcting typos), we will update the 'Last updated' date at the top of this document.

### B. Lawful Basis for Processing (GDPR Article 6)

#### 1. Periodic database downloads from GitHub (Section 2.C)

**Legitimate Interest — Art. 6(1)(f)**: Necessary for the extension's core functionality (fetching updated headline databases). This interest is not overridden by your data protection rights because the processing is strictly limited to the transient network metadata (IP address, User-Agent) required to establish the HTTP connection. The request is entirely decoupled from your browsing history, involves no user authentication, and is not used for tracking or profiling.

#### 2. Feedback & headline correction submissions (Section 2.B.1):

**Consent — Art. 6(1)(a)**: You take an explicit, affirmative action (filling out and submitting the feedback form) each time. No feedback is ever collected without this action.

#### 3. Paid version waitlist / invitation requests (Section 2.B.2):

  **Consent — Art. 6(1)(a)**: Providing your email is a voluntary, explicit action taken solely to request future contact from us.

## 4. Third-Party Services (Processors & Independent Controllers)

### A. Google Forms (Form Submissions)

* We utilize Google Forms (operated by Google LLC) to collect and store your feedback and waitlist registrations. For this specific data, Google acts as a data processor on our behalf.
* Google Forms responses are processed and stored by Google LLC on **servers located in the United States**.
* Because form submission requires your browser to connect directly to Google's servers (`docs.google.com`), Google independently collects standard HTTP network metadata (such as IP addresses and browser details) for its own security, anti-abuse, and operational purposes. For this network data, Google acts as an independent data controller under its own [Privacy Policy](https://policies.google.com/privacy) and [Terms of Service](https://policies.google.com/terms).
* Google LLC is self-certified under the EU-U.S. Data Privacy Framework (DPF), including the UK Extension and the Swiss-U.S. DPF, as verified via the U.S. Department of Commerce's [Data Privacy Framework List](https://www.dataprivacyframework.gov/participant/6172). This means transfers of your feedback or email address to Google's U.S. servers are covered by the European Commission's DPF adequacy decision, providing a legal transfer mechanism recognized under GDPR Article 45 without requiring separate Standard Contractual Clauses.

### B. GitHub / GitHub User Content (Database Updates)

Headline database updates are fetched from GitHub Inc. / Microsoft.

* Database updates are fetched from `https://raw.githubusercontent.com`.
* GitHub, Inc. maintains its own EU-U.S. Data Privacy Framework self-certification (separate from Microsoft's corporate certification), also active for the UK Extension and Swiss-U.S. DPF. As the database fetch is a read-only, unauthenticated request, the only personal data GitHub's servers receive is the standard connection metadata described above (IP address, User-Agent) — this too falls under GitHub's DPF-covered processing.
* Network interactions with GitHub servers are governed by the **[GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement)**.

## 5. Data Storage and Security

* Extension settings and temporary cached data remain in your **browser's isolated extension storage**.
* Form responses are **securely stored within our Google Forms account**, and access is restricted to authorized maintainers of Klikkikuri.
* Email addresses on the waitlist **are deleted immediately upon your request**, **within 30 days after the paid version officially launches** and final notifications are sent, or **12 months from the date of your submission**, whichever occurs first.

### A. Data Transfer

We reserve the right to migrate stored data (including feedback submissions, or waitlist emails) to infrastructure, storage providers, or processing methods that **better align with the data protection principles set out in GDPR Article 5** — including data minimization, storage limitation, integrity and confidentiality, and purpose limitation — or that strengthen compliance with **Article 25's "data protection by design and by default"** requirement. Examples include moving to a processor established in the EU/EEA (reducing reliance on cross-border transfer mechanisms such as the DPF), reducing the categories of data collected, shortening retention periods, or adding technical safeguards like encryption at rest. Such changes are considered non-material administrative updates, as they only narrow how your data is processed relative to this policy. We will reflect these infrastructure changes by updating the Privacy Policy document and its 'Last updated' date.

## 6. Your Responsibilities

* We ask that you **do not submit sensitive personal information** (such as passwords, financial details, or personal addresses) in the free-text fields of our feedback forms.
* You are expected to use the feedback and correction submission features responsibly, and **refrain from spamming or submitting malicious data**.
* You are responsible for ensuring your **browser and the extension are kept up to date** to maintain optimal security and performance.
* If you opt to request an invitation for the paid version, ensure you provide an email address that you own and have authority to use.
* If you choose to back up extension settings using browser sync, you are responsible for **maintaining the security of your browser sign-in account** (e.g., your Google or Firefox account) and understanding that synced data is governed by your browser provider's policies.

## 7. Your Rights and Choices

* Submitting feedback and email addresses is **entirely optional**, and implies your consent to the processing of that data for the purposes described in this Privacy Policy.

Where we rely on your consent as the legal basis for processing:

* You may withdraw consent at any time for waitlist registration, which will stop any future use of your email and result in its deletion. Withdrawal does not affect the lawfulness of any contact or processing that occurred before your request.
* Feedback submissions (page URL, headline text, severity rating) are designed to be collected anonymously. Because we do not collect your name, email, or IP address with these form submissions, we generally have no way to identify which specific feedback record belongs to you. Consequently, under GDPR Article 11, we cannot fulfill erasure requests for these anonymous submissions. If you inadvertently included identifying information in the optional comment field and wish for it to be deleted, you must contact us with the exact details and timestamp of your submission so we can attempt to locate and erase it.
* You have the right to object (Article 21), on grounds relating to your particular situation, to the processing of your network metadata (IP address, User-Agent) when the extension fetches database updates from GitHub. Because this data transmission is an unavoidable technical function of standard HTTP requests required to keep the extension's database current, we cannot modify the network protocol to hide your IP address from GitHub. To exercise your right to object and halt this processing, you must either uninstall the extension or disable its network access in your browser's extension settings.

## 8. Contact Us

If you have questions or concerns regarding this Privacy Policy or data processing in Klikkikuri Paatti, please contact us:

* **Email:** `klikkikuri+gdpr-rocks@protonmail.com`
* **GitHub Repository:** [https://github.com/Klikkikuri](https://github.com/Klikkikuri)
