// Prueba aislada de la función: ninguna petición sale a Internet.
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
let handler,
  calls = [],
  owner = true,
  valid = true,
  mailStatus = 200;
const context = {
  Request,
  Response,
  AbortSignal,
  Deno: {
    env: {
      get: (name) =>
        name === "SUPABASE_URL" ? "https://example.invalid" : "server-only-secret",
    },
    serve: (fn) => (handler = fn),
  },
  fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/user"))
      return Response.json({}, { status: valid ? 200 : 401 });
    if (url.endsWith("/rpc/is_panel_owner")) return Response.json(owner);
    return Response.json({ access_token: "must-not-leak", hashed_token: "test-hash", verification_type: "invite" }, { status: mailStatus });
  },
};
vm.runInNewContext(
  fs.readFileSync("supabase/functions/invite-consultant/index.ts", "utf8"),
  context,
);
const request = (email, auth = "Bearer user-token") =>
  new Request("https://example.invalid", {
    method: "POST",
    headers: { origin: "https://carlosovb.github.io", authorization: auth },
    body: JSON.stringify({ email }),
  });
(async () => {
  assert.equal((await handler(request("test@ovb.es", ""))).status, 401);
  valid = false;
  assert.equal((await handler(request("test@ovb.es"))).status, 401);
  valid = true;
  owner = false;
  calls = [];
  assert.equal((await handler(request("test@ovb.es"))).status, 403);
  assert.equal(
    calls.some((c) => c.url.includes("/admin/generate_link")),
    false,
  );
  owner = true;
  calls = [];
  assert.equal((await handler(request("test@other.invalid"))).status, 400);
  assert.equal(
    calls.some((c) => c.url.includes("/admin/generate_link")),
    false,
  );
  calls = [];
  const result = await handler(request(" TEST@OVB.ES "));
  assert.equal(result.status, 200);
  const output = await result.json();
  assert.equal(JSON.stringify(output).includes('must-not-leak'), false);
  assert.equal(output.invitation_url, 'https://carlosovb.github.io/carlos-portfolio-propuesta/cuenta/#token_hash=test-hash&type=invite');
  assert.equal(calls.some(c => c.url.includes('/auth/v1/invite?')), false);
  const invite = calls.find((c) => c.url.includes("/admin/generate_link"));
  assert.equal(JSON.parse(invite.options.body).email, "test@ovb.es");
  assert.equal(invite.options.headers.Authorization, "Bearer server-only-secret");
  assert.equal(calls[1].options.headers.Authorization, "Bearer user-token");
  mailStatus = 429;
  assert.equal((await handler(request("test@ovb.es"))).status, 429);
  console.log(
    "OK: identidad, rol, dominio, envío, límite y ausencia de secretos en respuesta.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
