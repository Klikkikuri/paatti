"use strict";

/**
 * @file invitation.js
 * The waitlist sign-up for the paid version, without the DOM, so `make test` covers it.
 */

const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSf0m5X_EKJume6oSbz5o36CmOVofsNy8F8AjrwOLQ4Tm4B_8g/formResponse";

/**
 * Send an email address to the waitlist form. The request is `no-cors`, so a response says nothing: only a
 * network failure rejects.
 *
 * @param {string} email
 * @param {{fetch?: typeof fetch}} [deps]
 * @returns {Promise<void>}
 */
export async function registerInvitation(email, { fetch: fetchImpl = fetch } = {}) {
    const body = new FormData();
    body.append("emailAddress", email);
    body.append("pageHistory", "0");
    body.append("submissionTimestamp", Date.now().toString());

    await fetchImpl(FORM_URL, {
        method: "POST",
        mode: "no-cors",
        referrerPolicy: "no-referrer",
        credentials: "omit",
        body,
    });
}
