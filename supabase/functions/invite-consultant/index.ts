// Solo se ejecuta en Supabase. Nunca copiar claves administrativas al navegador.
const origin = "https://carlosovb.github.io";
const redirectTo = origin + "/carlos-portfolio-propuesta/cuenta/";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const reply = (status, message) =>
  new Response(JSON.stringify(typeof message === "string" ? { message } : message), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
async function handleInvite(req) {
  if (req.headers.get("origin") && req.headers.get("origin") !== origin)
    return reply(403, "Forbidden");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, "Method not allowed");
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return reply(401, "Unauthorized");
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) return reply(503, "Not configured");
  const call = (path, options = {}) =>
    fetch(url + path, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: secret,
        Authorization: authorization,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  try {
    // Auth verifica la identidad y Postgres comprueba el rol real del solicitante.
    const identity = await call("/auth/v1/user");
    if (!identity.ok) return reply(401, "Unauthorized");
    const check = await call("/rest/v1/rpc/is_panel_owner", {
      method: "POST",
      body: "{}",
    });
    if (!check.ok || (await check.json()) !== true) return reply(403, "Forbidden");
    if (Number(req.headers.get("content-length")) > 1024)
      return reply(400, "Invalid request");
    const body = await req.text();
    if (body.length > 1024) return reply(400, "Invalid request");
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      return reply(400, "Invalid request");
    }
    if (input?.action === 'delete_pending') {
      if (typeof input.user_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.user_id)) return reply(400, 'Invalid user');
      const claim = await call('/rest/v1/rpc/cancel_pending_invitation', {
        method: 'POST', body: JSON.stringify({ p_user_id: input.user_id }),
      });
      if (!claim.ok || await claim.json() !== true) return reply(409, 'Invitation is not pending');
      const removed = await call('/auth/v1/admin/users/' + input.user_id, {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + secret },
      });
      if (!removed.ok) return reply(503, 'Access revoked; deletion not confirmed');
      return reply(200, 'Invitation deleted');
    }
    if (input?.action && input.action !== 'invite') return reply(400, 'Invalid action');
    const email =
      typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
    if (email.length > 254 || !/^[^\s@]+@ovb\.es$/.test(email))
      return reply(400, "Invalid email");
    // Solo esta llamada usa el privilegio administrativo. Nunca se devuelve su respuesta.
    const result = await call(
      "/auth/v1/admin/generate_link?redirect_to=" + encodeURIComponent(redirectTo),
      {
        method: "POST",
        headers: { Authorization: "Bearer " + secret },
        body: JSON.stringify({ type: "invite", email }),
      },
    );
    if (!result.ok)
      return reply(result.status === 429 ? 429 : 502, "Invitation not confirmed");
    const data = await result.json();
    if (data.verification_type !== 'invite' || typeof data.hashed_token !== 'string' || !data.hashed_token)
      return reply(502, 'Invalid invitation response');
    // Solo el enlace de activación necesario; no devolver usuarios, OTP ni tokens de sesión.
    return reply(200, { invitation_url: redirectTo + '#token_hash=' + encodeURIComponent(data.hashed_token) + '&type=invite' });
  } catch {
    return reply(503, "Service unavailable");
  }
}
Deno.serve(handleInvite);
