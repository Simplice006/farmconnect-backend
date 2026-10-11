// Automated API tests. Start the backend first (npm start), then run: npm test
// They use the seed data from database/seed.sql and clean up what they create.
const test = require("node:test");
const assert = require("node:assert");

const BASE = process.env.API_URL || "http://localhost:5000/api";

async function call(method, path, token, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json() };
}

async function login(email) {
  const { data } = await call("POST", "/auth/login", null, { email, password: "password123" });
  return data.token;
}

let buyer1, buyer2, buyer4, farmer1, farmer3, admin;

test.before(async () => {
  buyer1 = await login("buyer1@farmconnect.test");   // user 5
  buyer2 = await login("buyer2@farmconnect.test");   // user 6
  buyer4 = await login("buyer4@farmconnect.test");   // user 8 (has a completed order for product 10)
  farmer1 = await login("farmer1@farmconnect.test"); // user 2
  farmer3 = await login("farmer3@farmconnect.test"); // user 4
  admin = await login("admin@farmconnect.test");
});

test("original workflow: login and browsing still work", async () => {
  assert.ok(buyer1, "buyer can log in");
  const products = await call("GET", "/products");
  assert.strictEqual(products.status, 200);
  assert.ok(products.data.products.length >= 10);
});

test("original workflow: buyer orders, farmer updates the status", async () => {
  const created = await call("POST", "/orders", buyer1, { product_id: 3, quantity_requested: 2, delivery_option: "pickup" });
  assert.strictEqual(created.status, 201);
  const farmerOrders = await call("GET", "/orders/farmer", farmer1);
  assert.ok(farmerOrders.data.orders.some((o) => o.id === created.data.id));
  const updated = await call("PUT", `/orders/${created.data.id}/status`, farmer1, { status: "cancelled" });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual((await call("PUT", `/orders/${created.data.id}/status`, farmer3, { status: "accepted" })).status, 403);
});

// ---------- Feature 1: favorites ----------
test("favorites: requires login and the buyer role", async () => {
  assert.strictEqual((await call("GET", "/favorites")).status, 401);
  assert.strictEqual((await call("GET", "/favorites", farmer1)).status, 403);
});

test("favorites: add, list, duplicate, remove, invalid and unknown product", async () => {
  await call("DELETE", "/favorites/3", buyer4); // make sure the state is clean
  const empty = await call("GET", "/favorites", buyer4);
  assert.strictEqual(empty.status, 200);
  assert.deepStrictEqual(empty.data.favorites, []); // empty state

  assert.strictEqual((await call("POST", "/favorites", buyer4, { product_id: 3 })).status, 201);
  assert.strictEqual((await call("POST", "/favorites", buyer4, { product_id: 3 })).status, 200); // duplicate is harmless
  const list = await call("GET", "/favorites", buyer4);
  assert.strictEqual(list.data.favorites.length, 1);
  assert.strictEqual(list.data.favorites[0].product_name, "Fresh Tomatoes");

  assert.strictEqual((await call("POST", "/favorites", buyer4, {})).status, 400);
  assert.strictEqual((await call("POST", "/favorites", buyer4, { product_id: 9999 })).status, 404);

  // favorites are private: another buyer does not see them
  const other = await call("GET", "/favorites", buyer2);
  assert.ok(!other.data.favorites.some((f) => f.product_id === 3));

  assert.strictEqual((await call("DELETE", "/favorites/3", buyer4)).status, 200);
  assert.strictEqual((await call("DELETE", "/favorites/3", buyer4)).status, 404);
});

// ---------- Feature 2: reviews ----------
test("reviews: public list with average (seed review on product 10)", async () => {
  const res = await call("GET", "/reviews/product/10");
  assert.strictEqual(res.status, 200);
  assert.ok(res.data.summary.review_count >= 1);
  assert.strictEqual((await call("GET", "/reviews/product/9999")).status, 404);
  const none = await call("GET", "/reviews/product/1");
  assert.strictEqual(none.data.summary.review_count, 0); // empty state
  assert.strictEqual(none.data.summary.average_rating, null);
});

test("reviews: only buyers with a completed order can review", async () => {
  assert.strictEqual((await call("POST", "/reviews/product/1", buyer1, { rating: 5 })).status, 403); // order is only pending
  assert.strictEqual((await call("POST", "/reviews/product/10", farmer1, { rating: 5 })).status, 403); // wrong role
  assert.strictEqual((await call("POST", "/reviews/product/10", null, { rating: 5 })).status, 401);
  const elig = await call("GET", "/reviews/product/10/eligibility", buyer4);
  assert.strictEqual(elig.data.can_review, true);
});

test("reviews: validation, update instead of duplicate, ownership on delete", async () => {
  assert.strictEqual((await call("POST", "/reviews/product/10", buyer4, { rating: 0 })).status, 400);
  assert.strictEqual((await call("POST", "/reviews/product/10", buyer4, { rating: 6 })).status, 400);
  assert.strictEqual((await call("POST", "/reviews/product/10", buyer4, { rating: "abc" })).status, 400);
  assert.strictEqual((await call("POST", "/reviews/product/10", buyer4, { rating: 4, comment: "x".repeat(501) })).status, 400);

  assert.strictEqual((await call("POST", "/reviews/product/10", buyer4, { rating: 4, comment: "Good" })).status, 201);
  const list = await call("GET", "/reviews/product/10");
  assert.strictEqual(list.data.reviews.filter((r) => r.buyer_name === "Agnes Nankya").length, 1); // updated, not duplicated
  const mine = list.data.reviews.find((r) => r.buyer_name === "Agnes Nankya");
  assert.strictEqual(mine.rating, 4);

  assert.strictEqual((await call("DELETE", `/reviews/${mine.id}`, buyer2)).status, 403); // someone else's review
  assert.strictEqual((await call("DELETE", `/reviews/${mine.id}`, buyer4)).status, 200);
  assert.strictEqual((await call("DELETE", `/reviews/${mine.id}`, admin)).status, 404);

  // restore the seed review
  await call("POST", "/reviews/product/10", buyer4, { rating: 5, comment: "Milk arrived chilled and on time. Will order again." });
});

// ---------- Feature 3: inquiry replies ----------
test("replies: only participants can read or write a conversation", async () => {
  // inquiry 2: buyer 6 (buyer2) <-> farmer 4 (farmer3), seeded with 2 replies
  assert.strictEqual((await call("GET", "/inquiries/2/replies", null)).status, 401);
  assert.strictEqual((await call("GET", "/inquiries/2/replies", buyer1)).status, 403); // unrelated buyer
  assert.strictEqual((await call("GET", "/inquiries/2/replies", farmer1)).status, 403); // unrelated farmer
  assert.strictEqual((await call("POST", "/inquiries/2/replies", buyer1, { message: "hi" })).status, 403);
  assert.strictEqual((await call("POST", "/inquiries/2/replies", admin, { message: "hi" })).status, 403); // admin reads only
  assert.strictEqual((await call("GET", "/inquiries/9999/replies", buyer2)).status, 404);

  const thread = await call("GET", "/inquiries/2/replies", buyer2);
  assert.strictEqual(thread.status, 200);
  assert.ok(thread.data.replies.length >= 2);
  assert.strictEqual((await call("GET", "/inquiries/2/replies", admin)).status, 200);
});

test("replies: validation, closed inquiries, and auto 'answered' status", async () => {
  assert.strictEqual((await call("POST", "/inquiries/2/replies", buyer2, { message: "   " })).status, 400);
  assert.strictEqual((await call("POST", "/inquiries/2/replies", buyer2, { message: "x".repeat(1001) })).status, 400);
  assert.strictEqual((await call("POST", "/inquiries/4/replies", buyer4, { message: "still there?" })).status, 400); // closed

  // inquiry 1 is open: buyer 5 <-> farmer 2
  const before = await call("GET", "/inquiries/1/replies", buyer1);
  assert.strictEqual(before.data.inquiry_status, "open");
  assert.strictEqual((await call("POST", "/inquiries/1/replies", buyer1, { message: "Any update?" })).status, 201);
  assert.strictEqual((await call("GET", "/inquiries/1/replies", buyer1)).data.inquiry_status, "open"); // buyer reply keeps it open
  assert.strictEqual((await call("POST", "/inquiries/1/replies", farmer1, { message: "Yes, sorted by size." })).status, 201);
  const after = await call("GET", "/inquiries/1/replies", buyer1);
  assert.strictEqual(after.data.inquiry_status, "answered");
  assert.strictEqual(after.data.replies.at(-1).sender_role, "farmer");
});
