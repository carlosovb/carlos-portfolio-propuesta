const vm = require("node:vm"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");
(async () => {
  let now = Date.now(),
    owner = "a",
    release,
    slow = false,
    fail = false;
  const calls = new Map(),
    saved = new Map();
  const json = (value) =>
    new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    });
  const sandbox = {
    URL,
    URLSearchParams,
    Response,
    Uint8Array,
    AbortSignal,
    Blob,
    TextDecoder,
    crypto,
    structuredClone,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    sessionStorage: {
      getItem: (k) => saved.get(k) || null,
      removeItem: (k) => saved.delete(k),
      setItem: (k, v) => saved.set(k, v),
    },
    document: { currentScript: { src: "https://example.invalid/js/backend.js" } },
    window: {
      PORTFOLIO_BACKEND: {
        url: "https://test.supabase.co",
        publishableKey: "sb_publishable_test",
      },
    },
    fetch: async (url, options) => {
      const path = new URL(url).pathname,
        body = options.body ? JSON.parse(options.body) : {};
      calls.set(path, (calls.get(path) || 0) + 1);
      if (path === "/auth/v1/token") {
        owner = body.email === "b@example.invalid" ? "b" : "a";
        return json({
          access_token: "test-" + owner,
          refresh_token: "refresh",
          expires_in: 3600,
          user: { id: owner },
        });
      }
      if (path.endsWith("/panel_access"))
        return json({ role: "consultant", profile_complete: true });
      if (path.endsWith("/search_my_clients")) {
        const captured = owner;
        if (slow) {
          slow = false;
          await new Promise((r) => (release = r));
        }
        return json({ rows: [{ owner: captured }], total: 1, stats: { clients: 1 } });
      }
      if (path.endsWith("/team_resources")) {
        if (fail) {
          fail = false;
          return new Response("{}", { status: 500 });
        }
        return json([{ owner }]);
      }
      if (path.endsWith("/get_career_progress"))
        return json({ user_id: body.p_user_id, counts: {}, units_available: false });
      if (path.endsWith("/update_panel_presence")) return json([]);
      if (path.endsWith("/client_products"))
        return json([{ id: "11111111-1111-4111-8111-111111111111" }]);
      if (path.endsWith("/logout")) return json({});
      throw Error("Unexpected " + path);
    },
  };
  vm.runInNewContext(fs.readFileSync("js/backend.js", "utf8"), sandbox);
  const b = sandbox.window.PortfolioBackend,
    count = (p) => calls.get("/rest/v1/" + p) || 0;
  await b.signIn("a@example.invalid", "test");
  const first = await b.listClients();
  first.rows[0].owner = "changed";
  assert.equal((await b.listClients()).rows[0].owner, "a");
  assert.equal(count("rpc/search_my_clients"), 1);
  await b.getCareerProgress("11111111-1111-4111-8111-111111111111");
  await b.getCareerProgress("11111111-1111-4111-8111-111111111111");
  assert.equal(
    count("rpc/get_career_progress"),
    2,
    "El progreso revalida permisos en cada consulta",
  );
  await b.listClients();
  assert.equal(
    count("rpc/search_my_clients"),
    1,
    "Consultar progreso no invalida los demás listados",
  );
  await b.updatePresence("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", true);
  await b.updatePresence("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", true);
  assert.equal(count("rpc/update_panel_presence"), 2, "Presence is never cached");
  await b.listClients();
  assert.equal(count("rpc/search_my_clients"), 1, "Presence updates preserve data cache");
  b.invalidateCache();
  await Promise.all([b.listClients(), b.listClients()]);
  assert.equal(count("rpc/search_my_clients"), 2, "Concurrent reads coalesce");
  now += 61000;
  await b.listClients();
  assert.equal(count("rpc/search_my_clients"), 3, "TTL refreshes");
  await b.saveClientProduct("11111111-1111-4111-8111-111111111111", {
    company: "AXA",
    product: "Test",
    portfolio: "",
    payment_type: "monthly",
    amount: 50,
    units: null,
  });
  await b.listClients();
  assert.equal(count("rpc/search_my_clients"), 4, "Mutation invalidates");
  fail = true;
  await assert.rejects(() => b.listResources());
  await b.listResources();
  assert.equal(count("team_resources"), 2, "Failures are retried");
  b.invalidateCache();
  slow = true;
  const pending = b.listClients(),
    rejected = assert.rejects(pending);
  while (!release) await new Promise((r) => setTimeout(r, 0));
  await b.signOut();
  await b.signIn("b@example.invalid", "test");
  release();
  await rejected;
  assert.equal(
    (await b.listClients()).rows[0].owner,
    "b",
    "Previous account data is never reused",
  );
  await b.signOut();
  await assert.rejects(() => b.listClients());
  assert.equal(saved.size, 0);
  console.log(
    "Caché: consultas compartidas, copias independientes, caducidad, invalidación al guardar, errores, cierre de sesión y aislamiento entre cuentas comprobados.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
