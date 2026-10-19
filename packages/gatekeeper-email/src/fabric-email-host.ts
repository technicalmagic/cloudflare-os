// Fabric downstream patch `fabric-email-host` (PATCHES.md). A new file, so it adds no conflict surface.

/**
 * The domain a mailbox is addressed at: `EMAIL_HOST` when the deployment sets one, which is the domain
 * Cloudflare Email Routing sends to this Worker, and otherwise BASE_URL's hostname, as upstream does.
 *
 * Inbound routing never reads it -- `email()` routes by the local part alone -- but it is what
 * `getAddress()` tells a gadget and what the binding's description tells the member, so a deployment
 * whose fetch handler is served on a host with no mail (a workers.dev router, say) needs it set.
 */
export function emailHostFrom(env: { EMAIL_HOST?: string }, baseUrl: string): string {
  const host = env.EMAIL_HOST?.trim().toLowerCase();
  return host ? host : new URL(baseUrl).hostname;
}
