/**
 * M31 Security Hardening (5D) - safe serialization for JSON-LD injected
 * via `dangerouslySetInnerHTML`. `JSON.stringify` alone does NOT escape
 * `<` (it's not a JSON-syntax character), so a value containing a
 * literal `</script>` breaks out of the script tag and injects
 * attacker-controlled HTML/JS into the page - a real stored-XSS vector
 * here, since the structured-data fields (product name, brand,
 * category, fabric/fit/occasion) are staff-curated free text
 * (`products/styles` write routes), not hard-coded constants; a
 * careless or compromised `product:write` account could otherwise
 * inject a script that runs in every visitor's browser on that PDP.
 * Escaping `<` as `<` is the standard, minimal fix - functionally
 * identical JSON, safe inside an HTML `<script>` element.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
