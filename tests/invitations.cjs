// Prueba aislada de la función: ninguna petición sale a Internet.
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
let pendingInvitation = true,
  prepared = true,
  recorded = true;
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
      return Response.json(
        { id: "11111111-1111-4111-8111-111111111111" },
        { status: valid ? 200 : 401 },
      );
    if (url.endsWith("/rpc/team_view_allowed")) return Response.json(owner);
    if (url.endsWith("/rpc/cancel_pending_invitation"))
      return Response.json(pendingInvitation);
    if (url.endsWith("/rpc/prepare_consultant_invitation"))
      return Response.json(prepared);
    if (url.endsWith("/rpc/record_consultant_invitation")) return Response.json(recorded);
    if (options.method === "DELETE") return Response.json({});
    return Response.json(
      {
        id: "22222222-2222-4222-8222-222222222222",
        access_token: "must-not-leak",
        hashed_token: "test-hash",
        verification_type: "invite",
      },
      { status: mailStatus },
    );
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
  assert.equal(JSON.stringify(output).includes("must-not-leak"), false);
  assert.equal(
    output.invitation_url,
    "https://carlosovb.github.io/carlos-portfolio-propuesta/cuenta/#token_hash=test-hash&type=invite",
  );
  assert.equal(
    calls.some((c) => c.url.includes("/auth/v1/invite?")),
    false,
  );
  const invite = calls.find((c) => c.url.includes("/admin/generate_link"));
  assert.equal(JSON.parse(invite.options.body).email, "test@ovb.es");
  assert.equal(invite.options.headers.Authorization, "Bearer server-only-secret");
  assert.equal(calls[1].options.headers.Authorization, "Bearer user-token");
  const registration = calls.find((c) =>
    c.url.endsWith("/rpc/record_consultant_invitation"),
  );
  assert.equal(
    JSON.parse(registration.options.body).p_inviter,
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(registration.options.headers.Authorization, "Bearer server-only-secret");
  prepared = false;
  calls = [];
  assert.equal((await handler(request("test@ovb.es"))).status, 409);
  assert.equal(
    calls.some((c) => c.url.includes("generate_link")),
    false,
  );
  prepared = true;
  recorded = false;
  const rejected = await handler(request("test@ovb.es"));
  assert.equal(rejected.status, 409);
  assert.equal((await rejected.text()).includes("token_hash"), false);
  recorded = true;
  mailStatus = 429;
  assert.equal((await handler(request("test@ovb.es"))).status, 429);
  mailStatus = 200;
  const deletion = () =>
    new Request("https://example.invalid", {
      method: "POST",
      headers: { authorization: "Bearer user-token" },
      body: JSON.stringify({
        action: "delete_pending",
        user_id: "22222222-2222-4222-8222-222222222222",
      }),
    });
  pendingInvitation = false;
  calls = [];
  assert.equal((await handler(deletion())).status, 409);
  assert.equal(
    calls.some((c) => c.options.method === "DELETE"),
    false,
  );
  pendingInvitation = true;
  owner = false;
  calls = [];
  assert.equal((await handler(deletion())).status, 403);
  assert.equal(
    calls.some((c) => c.options.method === "DELETE"),
    false,
  );
  owner = true;
  calls = [];
  assert.equal((await handler(deletion())).status, 200);
  assert.equal(calls.at(-1).options.method, "DELETE");
  const photoCleanup = calls.find((call) =>
    call.url.endsWith("/storage/v1/object/consultant-avatars"),
  );
  assert.equal(
    JSON.parse(photoCleanup.options.body).prefixes[0],
    "22222222-2222-4222-8222-222222222222/portrait.webp",
  );
  assert.equal(calls.at(-1).options.headers.Authorization, "Bearer server-only-secret");
  console.log(
    "OK: identidad, rol, dominio, envío, límite y ausencia de secretos en respuesta.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
