/**
 * The one public contact address. Cloudflare Email Routing forwards it to
 * Blake's inbox, so this is the address that goes on every surface where
 * someone (an employee, a curious customer, or Best Buy corporate) might
 * want to reach a human. One constant so the copy can never drift.
 */
export const CONTACT_EMAIL = 'contact@imagineapp.net'
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`
