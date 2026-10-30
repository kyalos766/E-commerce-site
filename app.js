const STORAGE_KEY = "markethub-state-v2";
const PRODUCT_PLACEHOLDER = "product-placeholder.svg";

const emptyState = {
  accounts: [],
  products: [],
  orders: [],
  cart: [],
  categories: ["Fashion", "Home", "Accessories"],
  session: null
};

let state = loadState();
let activeTab = "overview";
let authMode = "signup";
let selectedType = "seller";
let productFilter = "All";
let searchQuery = "";
let checkoutMethod = "stk";
let productImagePreviewUrl = "";
let pendingProductDraft = null;

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(emptyState);
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Saved data has an invalid format.");
    const accounts = (Array.isArray(parsed.accounts) ? parsed.accounts : []).filter((account) =>
      account && typeof account.id === "string" && typeof account.name === "string" &&
      typeof account.email === "string" && ["seller", "buyer"].includes(account.type)
    ).map((account) => ({
      ...account,
      status: safeStatusClass(account.status, ["active", "blocked"]),
      avatar: typeof account.avatar === "string" ? account.avatar : ""
    }));
    const products = (Array.isArray(parsed.products) ? parsed.products : []).filter((product) =>
      product && typeof product.id === "string" && typeof product.name === "string" &&
      typeof product.sellerId === "string" && typeof product.category === "string" && product.category.trim().length > 0 &&
      Number.isSafeInteger(product.price) && product.price > 0 &&
      Number.isSafeInteger(product.stock) && product.stock >= 0
    );
    const orders = (Array.isArray(parsed.orders) ? parsed.orders : []).filter((order) =>
      order && typeof order.id === "string" && Array.isArray(order.items) &&
      order.items.every((item) => item && typeof item.name === "string" && typeof item.productId === "string" &&
        Number.isSafeInteger(item.price) && item.price >= 0 && Number.isSafeInteger(item.quantity) && item.quantity > 0) &&
      Number.isSafeInteger(order.total) && order.total >= 0
    ).map((order) => ({
      ...order,
      status: safeStatusClass(order.status, ["pending", "received", "shipped"])
    }));
return {
      accounts,
      products,
      orders,
      cart: (Array.isArray(parsed.cart) ? parsed.cart : []).filter((line) =>
        line && typeof line.productId === "string" && Number.isSafeInteger(line.quantity) && line.quantity > 0
      ),
      categories: Array.isArray(parsed.categories) && parsed.categories.length
        ? parsed.categories.map((category) => String(category).trim()).filter((category) => category.length > 0)
        : structuredClone(emptyState.categories),
      session: typeof parsed.session === "string" && accounts.some((account) => account.id === parsed.session) ? parsed.session : null
    };
  } catch (error) {
    console.error("Could not load saved marketplace data.", error);
    return structuredClone(emptyState);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Could not save marketplace data.", error);
    showToast("Your changes could not be saved in this browser.");
    return false;
  }
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function money(amount) {
  const value = Number(amount);
  return `KSh ${(Number.isFinite(value) ? value : 0).toLocaleString("en-KE")}`;
}

function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPhone(value) {
  const digits = value.replace(/\D/g, "");
  return /^[+]?[0-9\s()-]{9,18}$/.test(value) && digits.length >= 9 && digits.length <= 15;
}

function initials(name = "") {
  return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "M";
}

function safeImageSource(source) {
  const value = String(source || "");
  if (value === PRODUCT_PLACEHOLDER) return PRODUCT_PLACEHOLDER;
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value) ? value : PRODUCT_PLACEHOLDER;
}

function safeStatusClass(value, allowed) {
  const status = String(value || "").toLowerCase();
  return allowed.includes(status) ? status : allowed[0];
}

function createId(prefix) {
  const suffix = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

function createOrderId() {
  const randomBytes = new Uint8Array(3);
  window.crypto.getRandomValues(randomBytes);
  const suffix = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  const date = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `MH-${date}-${suffix}`;
}

function avatarForUser(user) {
  if (!user) return "";
  return user.avatar ? safeImageSource(user.avatar) : "";
}

function currentUser() {
  return state.accounts.find((account) => account.id === state.session) || null;
}

function setCartOpen(isOpen) {
  document.body.dataset.cartOpen = isOpen ? "true" : "false";
  document.body.style.overflow = isOpen ? "hidden" : "";
}

function render() {
  const app = document.getElementById("app");
  if (!app) return;
  const user = currentUser();
  if (user?.type === "buyer" && !["discover", "orders", "profile", "help"].includes(activeTab)) activeTab = "discover";
  if (user?.type === "seller" && !["overview", "products", "orders", "referrals", "profile", "help", "categories"].includes(activeTab)) activeTab = "overview";
  app.innerHTML = user ? renderDashboard(user) : renderAuth();
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML = `<span class="site-credit">Developed by Sammy Kyalloh 0710495490</span><span class="site-copyright">2026 All rights reserved</span>`;
  app.appendChild(footer);
  bindEvents();
}

function renderAuth() {
  const signup = authMode === "signup";
  return `
    <div class="auth-shell">
      <section class="auth-visual">
        <div class="brand brand-light"><span class="brand-mark">m</span> MarketHub</div>
        <div class="visual-copy">
          <span class="eyebrow">Good things, shared</span>
          <h1>Make a living.<br>Find your next love.</h1>
          <p>A thoughtful marketplace connecting independent sellers with people who value the things they make.</p>
        </div>
        <div class="visual-foot"><span>Made for local makers and curious shoppers</span></div>
      </section>
      <main class="auth-main">
        <div class="auth-card">
          <div class="mobile-brand brand"><span class="brand-mark">m</span> MarketHub</div>
          <h2>${signup ? "Create your account" : "Welcome back"}</h2>
          <p class="subtle">${signup ? "Join a community where every good find has a story." : "Sign in with the email address linked to your account."}</p>
          <div id="auth-error" class="form-error" role="alert"></div>
          <p class="launch-limit-note">Accounts, products, and orders are stored only in this browser. Secure sign-in and shared data require a server before launch.</p>
          <form id="auth-form">
            ${signup ? `<div class="field"><label for="full-name">Full name</label><input id="full-name" name="name" autocomplete="name" placeholder="e.g. Nia Kamau" required></div><div class="field"><label for="phone">Phone number</label><input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="e.g. 0712 345 678" required></div>` : ""}
            <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>
            ${signup ? `
              <div class="field">
                <label>Choose your account type</label>
                <div class="account-choices">
                  <button type="button" class="choice ${selectedType === "seller" ? "active" : ""}" data-type="seller"><span class="choice-icon">✳</span><b>I'm a seller</b><small>List products & grow your shop</small></button>
                  <button type="button" class="choice ${selectedType === "buyer" ? "active" : ""}" data-type="buyer"><span class="choice-icon">♡</span><b>I'm a buyer</b><small>Discover goods worth keeping</small></button>
                </div>
              </div>
              ${selectedType === "buyer" ? `<div class="field"><label for="referral">Seller referral code <span class="field-hint">(optional)</span></label><input id="referral" name="referral" maxlength="32" placeholder="Enter a code if a seller referred you"></div>` : ""}
              <div class="note"><span>♧</span><span>${selectedType === "seller" ? "Get a unique referral code to share with your customers." : "Optionally enter a seller’s referral code to connect your account."}</span></div>
            ` : ""}
            <button type="submit" class="btn btn-primary full">${signup ? "Create account" : "Continue to your account"} <span>→</span></button>
          </form>
          <p class="auth-switch">${signup ? "Already have an account?" : "New to MarketHub?"} <button type="button" class="text-button" id="toggle-auth">${signup ? "Log in" : "Create an account"}</button></p>
        </div>
      </main>
    </div>`;
}

function navButton(tab, icon, label) {
  return `<button class="nav-item ${activeTab === tab ? "active" : ""}" data-tab="${tab}"><span class="nav-icon">${icon}</span>${label}</button>`;
}

function renderDashboard(user) {
  const seller = user.type === "seller";
  const title = seller ? "Seller studio" : "Your marketplace";
const nav = seller
    ? `${navButton("overview", "≡", "Overview")}${navButton("products", "▦", "My products")}${navButton("categories", "▦", "Categories")}${navButton("orders", "▤", "Orders")}${navButton("referrals", "◎", "Referrals")}${navButton("profile", "⚙", "Profile settings")}${navButton("help", "◈", "Help & support")}`
    : `${navButton("discover", "⌕", "Discover goods")}${navButton("orders", "▤", "My orders")}${navButton("profile", "⚙", "Profile settings")}${navButton("help", "◈", "Help & support")}`;
  let content = "";
  if (seller) {
    if (activeTab === "overview") content = renderSellerOverview(user);
    if (activeTab === "products") content = renderSellerProducts();
    if (activeTab === "orders") content = renderOrders(user, true);
    if (activeTab === "referrals") content = renderReferrals(user);
    if (activeTab === "profile") content = renderProfile(user);
    if (activeTab === "help") content = renderHelp(user);
    if (activeTab === "categories") content = renderCategories(user);
  } else {
    if (activeTab === "discover") content = renderStorefront();
    if (activeTab === "orders") content = renderOrders(user, false);
    if (activeTab === "profile") content = renderProfile(user);
    if (activeTab === "help") content = renderHelp(user);
  }
  return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="brand-mark">m</span> MarketHub</div>
        <p class="side-label">${seller ? "Seller workspace" : "Shop & discover"}</p>
        <nav class="nav-list">${nav}</nav>
        <div class="sidebar-spacer"></div>
        ${seller ? `<div class="seller-tip"><strong>Small shops, big things.</strong><p>Share your shop link and referral code with your community to welcome new customers.</p></div>` : ""}
        <div class="user-chip"><span class="user-avatar">${avatarForUser(user) ? `<img src="${escapeHtml(avatarForUser(user))}" alt="${escapeHtml(user.name)}">` : escapeHtml(initials(user.name))}</span><div><strong>${escapeHtml(user.name)}</strong><small>${seller ? "Seller account" : "Buyer account"}</small></div></div>
      </aside>
      <main class="main-area">
        <header class="topbar">
          <div style="display:flex;align-items:center;gap:12px"><button class="icon-button mobile-menu" id="menu-button" aria-label="Open menu">☰</button><span class="breadcrumb">${title} <span style="color:#c3cac4"> / </span> ${escapeHtml(tabLabel(activeTab, seller))}</span></div>
          <div class="top-actions">${!seller ? `<button class="icon-button open-cart" aria-label="Open shopping cart">♧<span class="badge-count">${cartCount()}</span></button>` : ""}<button class="icon-button" id="top-profile" aria-label="Profile settings">◎</button></div>
        </header>
        ${content}
      </main>
    </div>
    ${!seller && document.body.dataset.cartOpen === "true" ? renderCart() : ""}
    <div id="modal-root"></div>
    <div class="toast" id="toast" role="status"></div>`;
}

function tabLabel(tab, seller) {
  const labels = seller ? { overview: "Overview", products: "My products", categories: "Categories", orders: "Orders", referrals: "Referrals", profile: "Profile settings", help: "Help & support" } : { discover: "Discover goods", orders: "My orders", profile: "Profile settings", help: "Help & support" };
  return labels[tab] || "Overview";
}

function renderSellerOverview(user) {
  const products = sellerProducts(user);
  const orders = sellerOrders(user);
  const revenue = orders.filter((order) => order.status === "Shipped").reduce((sum, order) => sum + order.total, 0);
  const activeUsers = state.accounts.filter((account) => account.referredBy === user.id && account.type === "buyer" && safeStatusClass(account.status, ["active", "blocked"]) === "active").length;
  return `
    <div class="welcome"><div><h1>Welcome, ${escapeHtml(user.name.split(" ")[0])} <span>✦</span></h1><p>Here’s what’s happening with your shop today.</p></div><button class="btn btn-primary" data-action="add-product">＋ Add a product</button></div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-top"><span>Total revenue</span><span class="stat-icon">↗</span></div><b class="stat-value">${money(revenue)}</b><span class="stat-foot">From completed & shipped orders</span></div>
      <div class="stat-card"><div class="stat-top"><span>Orders to fulfill</span><span class="stat-icon">▤</span></div><b class="stat-value">${orders.filter((order) => order.status === "Pending").length.toString().padStart(2, "0")}</b><span class="stat-foot">Ready for your attention</span></div>
      <div class="stat-card"><div class="stat-top"><span>Listed products</span><span class="stat-icon">▦</span></div><b class="stat-value">${products.length.toString().padStart(2, "0")}</b><span class="stat-foot">Across your shop</span></div>
      <div class="stat-card"><div class="stat-top"><span>Active referred buyers</span><span class="stat-icon">♡</span></div><b class="stat-value">${String(activeUsers).padStart(2, "0")}</b><span class="stat-foot">Connected through your code</span></div>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-heading"><div><h2>Recent orders</h2><p>Keep an eye on what needs to go out</p></div><button class="btn btn-quiet" data-tab="orders">View all →</button></div>${renderOrderTable(orders.slice(0, 4), true)}</section>
      <section class="referral-card"><span class="eyebrow">Your community</span><p>Invite your customers with your personal code. They’ll enter it when they join MarketHub.</p><div class="referral-code"><span>${escapeHtml(user.code || "YOUR-CODE")}</span><button data-action="copy-code" aria-label="Copy referral code">⧉</button></div><div class="referral-meta"><span>Active buyers</span><strong>${activeUsers}</strong></div></section>
    </div>`;
}

function renderCategories(user) {
  const products = sellerProducts(user);
  const counts = {};
  products.forEach((product) => { counts[product.category] = (counts[product.category] || 0) + 1; });
  const categories = state.categories.length ? state.categories : ["Fashion", "Home", "Accessories"];
  return `
    <div class="page-lead"><div><h1 class="content-title">Categories</h1><p class="subtle" style="margin:6px 0 0">Create, rename, or remove product categories. New ones appear when you add a product.</p></div><button class="btn btn-primary" data-action="open-category-modal">＋ Add category</button></div>
    <section class="panel">
      <div class="panel-heading"><div><h2>Your categories</h2><p>Organise the goods you list under your shop.</p></div></div>
      ${categories.length ? `<div class="category-grid">${categories.map((category) => `<div class="category-card"><div><span class="category-name">${escapeHtml(category)}</span><small>${counts[category] || 0} product${(counts[category] || 0) === 1 ? "" : "s"}</small></div><div class="inline-actions"><button class="btn btn-soft" style="min-height:30px;padding:0 10px;font-size:10px" data-action="rename-category" data-name="${escapeHtml(category)}">Rename</button><button class="btn btn-danger" style="min-height:30px;padding:0 10px;font-size:10px" data-action="delete-category" data-name="${escapeHtml(category)}" ${(counts[category] || 0) > 0 ? "disabled" : ""}>Delete</button></div></div>`).join("")}</div>` : `<div class="empty-state"><strong>No categories yet</strong>Add your first category to start organising your products.</div>`}
    </section>
  `;
}

function renderSellerProducts() {
  const user = currentUser();
  const products = sellerProducts(user);
  return `
    <div class="page-lead"><div><h1 class="content-title">My products</h1><p class="subtle" style="margin:6px 0 0">Manage what’s on your shop shelf.</p></div><button class="btn btn-primary" data-action="add-product">＋ Add a product</button></div>
    ${products.length ? `<section class="panel"><div class="panel-heading"><div><h2>All products <span style="color:#9aa39d;font-weight:500">(${products.length})</span></h2></div></div><div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Action</th></tr></thead><tbody>${products.map((item) => `<tr><td><div class="product-cell"><img class="tiny-product" src="${escapeHtml(safeImageSource(item.image))}" alt="${escapeHtml(item.name)}" style="cursor:pointer" data-action="view-product-image" data-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.name)}</span></div></td><td>${escapeHtml(item.category)}</td><td>${money(item.price)}</td><td>${item.stock} in stock</td><td><div class="inline-actions"><button class="btn btn-soft" style="min-height:30px;padding:0 10px;font-size:10px" data-action="view-product-image" data-id="${escapeHtml(item.id)}">View</button><button class="btn btn-danger" style="min-height:30px;padding:0 10px;font-size:10px" data-action="delete-product" data-id="${escapeHtml(item.id)}">Delete</button></div></tr>`).join("")}</tbody></table></div></section>` : `<div class="panel empty-state"><strong>Your shop is ready for its first product.</strong>Add a product to help customers discover your work.<br><br><button class="btn btn-primary" data-action="add-product">＋ Add your first product</button></div>`}`;
}

function renderStorefront() {
  const categories = ["All", ...(state.categories.length ? state.categories : ["Fashion", "Home", "Accessories"])];
  const query = searchQuery.toLowerCase();
  const buyer = currentUser();
  const referredSeller = state.accounts.find((account) => account.id === buyer?.referredBy);
  const sellerName = referredSeller ? referredSeller.name.trim().split(/\s+/)[0] : "MarketHub";
  const products = state.products.filter((item) => (productFilter === "All" || item.category === productFilter) && `${item.name} ${item.category} ${item.seller}`.toLowerCase().includes(query));
  return `
    <div class="welcome"><div><h1>Welcome to ${escapeHtml(sellerName)}'s MarketHub.</h1><p>Discover thoughtful finds and everyday essentials from sellers you can trust.</p></div><button class="btn btn-outline open-cart">♤ Your bag <span class="badge-count" style="position:static">${cartCount()}</span></button></div>
    <div class="toolbar"><div class="search-wrap"><span>⌕</span><input id="product-search" class="search-input" placeholder="Search products, makers..." value="${escapeHtml(searchQuery)}"></div></div>
    <div class="filter-pills">${categories.map((category) => `<button class="filter-pill ${productFilter === category ? "active" : ""}" data-filter="${category}">${category}</button>`).join("")}</div>
    ${products.length ? `<div class="product-grid">${products.map((item) => {
      const seller = state.accounts.find((account) => account.id === item.sellerId);
      const sellerPhone = seller ? seller.phone.replace(/\D/g, "") : "";
      const sellerLabel = escapeHtml(item.seller);
      const waLink = sellerPhone ? `https://wa.me/${sellerPhone}?text=${encodeURIComponent(`Hi, I'm interested in your product: ${item.name}`)}` : "";
      return `<article class="product-card"><div class="product-image-wrap"><img class="product-image" src="${escapeHtml(safeImageSource(item.image))}" alt="${escapeHtml(item.name)}"><span class="product-tag">${escapeHtml(item.tag || item.category)}</span></div><div class="product-info"><h3>${escapeHtml(item.name)}</h3><p class="seller-name">by ${sellerLabel}</p><div class="product-bottom"><span class="product-price">${money(item.price)}</span><button class="add-cart" data-action="add-cart" data-id="${escapeHtml(item.id)}" aria-label="Add ${escapeHtml(item.name)} to cart" ${item.stock < 1 ? "disabled" : ""}>${item.stock < 1 ? "Sold out" : "＋"}</button></div></div><div class="product-footer"><span class="product-tag">${escapeHtml(item.tag || item.category)}</span>${waLink ? `<a class="whatsapp-btn" href="${waLink}" target="_blank" rel="noopener" aria-label="Chat ${sellerLabel} on WhatsApp">📞 WhatsApp</a>` : `<span class="whatsapp-btn disabled">No WhatsApp</span>`}</div></article>`;
    }).join("")}</div>` : `<div class="panel empty-state category-empty"><strong>${state.products.length ? "No matching products found." : "No products are listed yet."}</strong>${state.products.length ? "Try a different search or category." : "Check back soon as sellers add their products."}</div>`}`;
}

function paymentPlanForOrder(order) {
  if (!order || !order.total) return [];
  const total = Number(order.total || 0);
  const first = Math.round(total * 0.5);
  const second = Math.round(total * 0.3);
  const final = total - first - second;
  const parsedOrderTime = Date.parse(order.orderedAt || "");
  const orderedAt = new Date(Number.isFinite(parsedOrderTime) ? parsedOrderTime : Date.now());
  const dueAt = (daysAfterOrder) => new Date(orderedAt.getTime() + daysAfterOrder * 24 * 60 * 60 * 1000).toISOString();
  return [
    { label: "50% on ordering", percentage: 50, amount: first, dueAt: dueAt(0), paid: false },
    { label: "30% after 3 days", percentage: 30, amount: second, dueAt: dueAt(3), paid: false },
    { label: "Final 20% after 6 days", percentage: 20, amount: final, dueAt: dueAt(6), paid: false }
  ];
}

function renderOrderTable(orders, sellerView) {
  if (!orders.length) return `<div class="empty-state"><strong>No orders yet</strong>When an order comes in, you’ll find it here.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Order</th><th>${sellerView ? "Customer & pickup details" : "Items"}</th><th>Total</th><th>Status</th>${sellerView ? "<th>Action</th>" : ""}</tr></thead><tbody>${orders.map((order) => {
    const statusClass = safeStatusClass(order.status, ["pending", "received", "shipped"]);
    const normalizedStatus = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);
    const customer = sellerView
      ? `<div class="order-customer"><strong>${escapeHtml(order.buyer)}</strong>${order.buyerEmail ? `<span>Email: ${escapeHtml(order.buyerEmail)}</span>` : ""}${order.buyerPhone ? `<span>Phone: ${escapeHtml(order.buyerPhone)}</span>` : ""}${order.pickupArea ? `<span>Pickup area: ${escapeHtml(order.pickupArea)}</span>` : ""}<span>Items: ${escapeHtml(order.items.map((item) => `${item.name} × ${item.quantity}`).join(", "))}</span></div>`
      : escapeHtml(order.items.map((item) => `${item.name} × ${item.quantity}`).join(", "));
    return `<tr><td><b>${escapeHtml(order.id)}</b><br><span style="color:#9aa39d;font-size:10px">${escapeHtml(order.date || "")}</span></td><td>${customer}</td><td>${money(order.total)}</td><td><span class="status ${statusClass}">${escapeHtml(normalizedStatus)}</span></td>${sellerView ? `<td>${normalizedStatus === "Pending" ? `<button class="text-button" data-action="fulfill-order" data-id="${escapeHtml(order.id)}">Mark received</button>` : "—"}</td>` : ""}</tr>`;
  }).join("")}</tbody></table></div>`;
}

function renderOrders(user, sellerView) {
  const orders = sellerView ? sellerOrders(user) : state.orders.filter((order) => order.buyerId === user.id);
  const paymentPlanMarkup = !sellerView ? orders.map((order) => {
    const paymentPlan = Array.isArray(order.paymentPlan) && order.paymentPlan.every((planItem) => planItem.dueAt && typeof planItem.paid === "boolean")
      ? order.paymentPlan
      : paymentPlanForOrder(order);
    if (!paymentPlan.length) return "";
    const paidCount = paymentPlan.filter((planItem) => planItem.paid).length;
    const outstanding = paymentPlan.filter((planItem) => !planItem.paid).reduce((sum, planItem) => sum + planItem.amount, 0);
    const nextDue = paymentPlan.find((planItem) => !planItem.paid);
    const now = new Date();
    return `
      <section class="panel payment-plan-panel">
        <div class="panel-heading"><div><h2>Repayment plan · ${escapeHtml(order.id)}</h2><p>Pay 50% now, then 30% in 3 days and the remaining 20% 3 days later. ${paidCount} of ${paymentPlan.length} installments settled.</p></div></div>
        <div class="payment-plan-list">${paymentPlan.map((planItem, index) => {
          const dueDate = new Date(planItem.dueAt);
          const dueLabel = index === 0 ? "Due on ordering" : `Due ${dueDate.toLocaleDateString()}`;
          const paid = !!planItem.paid;
          const overdue = !paid && dueDate < now;
          const statusClass = paid ? "paid" : (overdue ? "overdue" : "pending");
          const statusText = paid ? "Paid" : (overdue ? "Overdue — pay now" : "Payment setup required");
          return `<div class="payment-plan-row ${paid ? "is-paid" : ""} ${overdue ? "is-overdue" : ""}"><div><span>${escapeHtml(planItem.label)}</span><small>${escapeHtml(dueLabel)}</small></div><strong>${money(planItem.amount)}</strong><span class="status ${statusClass}">${escapeHtml(statusText)}</span>${paid ? "" : `<button class="btn btn-primary" style="min-height:28px;padding:0 10px;font-size:10px" data-action="stk-push" data-order="${escapeHtml(order.id)}" data-installment="${index}">📱 STK push</button>`}</div>`;
        }).join("")}</div>
        ${nextDue ? `<p class="payment-setup-note">Next payment of <b>${money(nextDue.amount)}</b> is due. Tap “STK push” to send an M-Pesa prompt to the phone on file.</p>` : `<p class="payment-setup-note">All installments for this order are settled.</p>`}
        ${outstanding > 0 ? `<p class="payment-setup-note" style="margin-top:8px">Outstanding balance: <b>${money(outstanding)}</b>. Online M-Pesa is not configured; prompts are simulated in this browser only.</p>` : ""}
      </section>
    `;
  }).join("") : "";
  const storageNotice = `<p class="launch-limit-note">${sellerView ? "Orders are stored only in this browser and are not shared across devices." : "Your order history is stored only in this browser; the seller will not receive a notification."}</p>`;
  return `<div class="page-lead"><div><h1 class="content-title">${sellerView ? "Orders" : "My orders"}</h1><p class="subtle" style="margin:6px 0 0">${sellerView ? "Orders placed by your customers." : "A little record of the good things you’ve found."}</p></div></div>${storageNotice}${!sellerView && paymentPlanMarkup}${renderOrderTable(orders, sellerView) ? `<section class="panel">${renderOrderTable(orders, sellerView)}</section>` : ""}`;
}

function renderReferrals(user) {
  const referredUsers = state.accounts.filter((account) => account.referredBy === user.id && account.type === "buyer");
  const activeCount = referredUsers.filter((account) => (account.status || "active") === "active").length;
  return `
    <div class="page-lead"><div><h1 class="content-title">Referrals</h1><p class="subtle" style="margin:6px 0 0">Track your community and manage buyer referrals.</p></div></div>
    <div class="stats-grid" style="margin-top:0;">
      <div class="stat-card"><div class="stat-top"><span>Total referrals</span><span class="stat-icon">◎</span></div><b class="stat-value">${String(referredUsers.length).padStart(2, "0")}</b><span class="stat-foot">Buyers connected to your code</span></div>
      <div class="stat-card"><div class="stat-top"><span>Active users</span><span class="stat-icon">♡</span></div><b class="stat-value">${String(activeCount).padStart(2, "0")}</b><span class="stat-foot">Currently active in your referral network</span></div>
    </div>
    <section class="panel">
      <div class="panel-heading"><div><h2>Your referred buyers</h2><p>Review, manage, or remove buyers connected through your referral code.</p></div></div>
      ${referredUsers.length ? `<div class="table-wrap"><table><thead><tr><th>Buyer</th><th>Email</th><th>Status</th><th>Action</th></tr></thead><tbody>${referredUsers.map((account) => { const status = safeStatusClass(account.status, ["active", "blocked"]); const waPhone = (account.phone || "").replace(/\D/g, ""); const waLink = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent("Hi, thanks for joining through my referral code!")}` : ""; return `<tr><td><strong>${escapeHtml(account.name)}</strong></td><td>${escapeHtml(account.email)}</td><td><span class="status ${status}">${status === "active" ? "Active" : "Blocked"}</span></td><td><div class="inline-actions">${waLink ? `<a class="btn btn-soft" style="min-height:30px;padding:0 10px;font-size:10px" href="${waLink}" target="_blank" rel="noopener">WhatsApp</a>` : ""}<button class="btn btn-quiet" data-action="toggle-referral-status" data-id="${escapeHtml(account.id)}">${status === "active" ? "Block" : "Activate"}</button><button class="btn btn-danger" style="min-height:30px;padding:0 10px;font-size:10px" data-action="delete-referral" data-id="${escapeHtml(account.id)}">Delete</button></div></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>No referred buyers yet</strong>Your referral network is still empty.</div>`}
    </section>
  `;
}

function renderHelp(user) {
  const seller = user.type === "seller";
  return `
    <div class="page-lead"><div><h1 class="content-title">Help & support</h1><p class="subtle" style="margin:6px 0 0">Need a hand? Reach out to the MarketHub team directly.</p></div></div>
    <section class="panel help-panel">
      <div class="help-card">
        <div class="help-icon">✉</div>
        <div><h2>Email support</h2><p>Send us an email and we'll reply as soon as we can.</p><a class="help-link" href="mailto:kyalos766@gmail.com">kyalos766@gmail.com</a></div>
      </div>
      <div class="help-card">
        <div class="help-icon">📞</div>
        <div><h2>Phone support</h2><p>Call us during business hours for urgent help.</p><a class="help-link" href="tel:0710495490">0710495490</a></div>
      </div>
    </section>
    <section class="panel help-panel">
      <div class="help-card help-wide">
        <div class="help-icon">✦</div>
        <div><h2>How we can help</h2>
          <p>${seller ? "Track orders, manage your product listings, and grow your referral community." : "Browse products, manage your bag, and follow your repayment plan."}</p>
          <p class="help-quick">Quick tips: use your referral code when inviting buyers, and keep your profile phone number up to date so STK push prompts reach you.</p>
        </div>
      </div>
    </section>
  `;
}

function renderProfile(user) {
  const seller = user.type === "seller";
  return `
    <div class="page-lead"><div><h1 class="content-title">Profile settings</h1><p class="subtle" style="margin:6px 0 0">Keep your account details up to date.</p></div></div>
    <div class="profile-grid">
      <section class="panel profile-card">
        <div class="profile-avatar">${avatarForUser(user) ? `<img class="profile-avatar-image" src="${escapeHtml(avatarForUser(user))}" alt="${escapeHtml(user.name)}">` : escapeHtml(initials(user.name))}</div>
        <h3>${escapeHtml(user.name)}</h3>
        <p>${seller ? "Seller account" : "Buyer account"}</p>
        <button class="btn btn-soft" type="button" data-action="choose-avatar" style="margin-top:14px; width:100%;">Choose profile picture</button>
      </section>
      <section class="panel profile-details"><h2>Personal information</h2><p>Update the details associated with your MarketHub account.</p><div id="profile-error" class="form-error" role="alert"></div>
        <form id="profile-form"><div class="field"><label for="profile-name">Full name</label><input id="profile-name" name="name" value="${escapeHtml(user.name)}" required></div><div class="field"><label for="profile-email">Email address</label><input id="profile-email" name="email" type="email" value="${escapeHtml(user.email)}" required></div><div class="field"><label for="profile-phone">Phone number</label><input id="profile-phone" name="phone" type="tel" autocomplete="tel" value="${escapeHtml(user.phone || "")}" placeholder="e.g. 0712 345 678" required></div>
        ${seller ? `<div class="profile-code">Your seller referral code: <b>${escapeHtml(user.code)}</b></div>` : `<div class="profile-code">Referred by seller: <b>${escapeHtml(state.accounts.find((account) => account.id === user.referredBy)?.name || "MarketHub community")}</b></div>`}
        <button class="btn btn-primary" type="submit">Save changes</button> <button class="btn btn-outline" type="button" data-action="logout">Log out</button></form>
      </section>
    </div>`;
}

function cartCount() {
  return state.cart.reduce((sum, line) => sum + line.quantity, 0);
}

function sellerProducts(user) {
  return state.products.filter((item) => item.sellerId === user.id);
}

function sellerOrders(user) {
  const productIds = new Set(sellerProducts(user).map((item) => item.id));
  return state.orders.flatMap((order) => {
    const items = order.items.filter((item) => productIds.has(item.productId));
    if (!items.length) return [];
    return [{
      ...order,
      items,
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    }];
  });
}

function cartTotal() {
  return state.cart.reduce((sum, line) => sum + (state.products.find((item) => item.id === line.productId)?.price || 0) * line.quantity, 0);
}

function renderCart() {
  const lines = state.cart.map((line) => ({ ...line, product: state.products.find((item) => item.id === line.productId) })).filter((line) => line.product);
  return `<div class="cart-drawer" id="cart-backdrop"><aside class="cart-panel"><div class="cart-header"><h2>Your bag <span style="color:#9aa39d;font-size:13px;font-weight:500">(${cartCount()})</span></h2><button class="icon-button" data-action="close-cart" aria-label="Close cart">×</button></div>
    <div class="cart-items">${lines.length ? lines.map((line) => `<div class="cart-item"><img src="${escapeHtml(safeImageSource(line.product.image))}" alt=""><div class="cart-item-main"><strong>${escapeHtml(line.product.name)}</strong><small>${money(line.product.price)}</small></div><div class="qty-controls"><button data-action="quantity" data-id="${escapeHtml(line.productId)}" data-change="-1" aria-label="Decrease quantity">−</button><span>${line.quantity}</span><button data-action="quantity" data-id="${escapeHtml(line.productId)}" data-change="1" aria-label="Increase quantity">＋</button></div></div>`).join("") : `<div class="empty-state"><strong>Your bag is taking a little break.</strong>Add something lovely to get started.</div>`}</div>
    ${lines.length ? `<div class="cart-summary"><div class="summary-row"><span>Subtotal</span><span>${money(cartTotal())}</span></div><div class="summary-row"><span>Delivery</span><span>Calculated at checkout</span></div><div class="summary-row total"><span>Total</span><span>${money(cartTotal())}</span></div><div class="payment-options"><button class="payment-option ${checkoutMethod === "stk" ? "active" : ""}" data-payment="stk">📱 M-Pesa STK push</button><button class="payment-option ${checkoutMethod === "paypal" ? "active" : ""}" data-payment="paypal">PayPal</button></div><button class="btn btn-primary full" data-action="checkout">Order now →</button><p style="font-size:10px;color:#929b95;text-align:center;line-height:1.5;margin:12px 0 0">Select your payment method, complete the order form, and receive a repayment plan.</p></div>` : ""}</aside></div>`;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function showError(id, message) {
  const error = document.getElementById(id);
  if (!error) return;
  error.textContent = message;
  error.style.display = "block";
}

function hideError(id) {
  const error = document.getElementById(id);
  if (error) error.style.display = "none";
}

function openImageModal(product) {
  if (!product) return;
  const root = document.getElementById("modal-root");
  const image = safeImageSource(product.image);
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><section class="modal image-modal"><button class="modal-close" data-action="close-modal" aria-label="Close">×</button><img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}"><div class="image-modal-foot"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)} · ${money(product.price)} · ${product.stock} in stock</span></div></section></div>`;
  bindModalEvents();
}

function openCategoryModal() {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><section class="modal"><h2>Add a category</h2><p>Give your new category a clear, short name. It will appear in your product dropdown.</p><div id="category-error" class="form-error" role="alert"></div><form id="category-form"><div class="field"><label for="new-category-name">Category name</label><input id="new-category-name" name="name" placeholder="e.g. Handmade ceramics" maxlength="40" required></div><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Add category</button></div></form></section></div>`;
  bindModalEvents();
}

function openAddProductModal() {
  const categories = state.categories.length ? state.categories : ["Fashion", "Home", "Accessories"];
  const categoryOptions = categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><section class="modal"><h2>Add a new product</h2><p>Share a few details so shoppers can find your next good thing.</p><div id="product-error" class="form-error" role="alert"></div><form id="product-form"><div class="field"><label for="new-product-name">Product name</label><input id="new-product-name" name="name" placeholder="e.g. Handwoven market basket" required></div><div class="field"><label for="new-product-category">Category</label><select id="new-product-category" name="category">${categoryOptions}<option value="">── Add a new category ──</option></select></div><div class="field"><label for="new-product-price">Price (KSh)</label><input id="new-product-price" name="price" type="number" min="1" step="1" placeholder="2500" required></div><div class="field"><label for="new-product-stock">Available stock</label><input id="new-product-stock" name="stock" type="number" min="1" value="1" required></div><div class="field"><label for="new-product-image">Product image (optional)</label><input id="new-product-image" name="image" type="file" accept="image/jpeg,image/png,image/webp"><img id="product-image-preview" class="product-image-preview" alt="Product image preview" hidden><small class="field-hint">JPG, PNG, or WebP. Images are resized for storage.</small></div><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Add product</button></div></form></section></div>`;
  bindModalEvents();
  document.getElementById("new-product-category")?.addEventListener("change", (event) => {
    if (event.target.value !== "") return;
    const form = document.getElementById("product-form");
    if (form) pendingProductDraft = Object.fromEntries(new FormData(form));
    openCategoryModal();
  });
}

function copyCode() {
  const user = currentUser();
  if (!user?.code) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(user.code).then(() => showToast("Referral code copied!")).catch(() => showToast(`Your referral code is ${user.code}`));
  } else showToast(`Your referral code is ${user.code}`);
}

function bindEvents() {
  document.querySelectorAll("[data-type]").forEach((button) => button.addEventListener("click", () => {
    const name = document.getElementById("full-name")?.value || "";
    const phone = document.getElementById("phone")?.value || "";
    const email = document.getElementById("email")?.value || "";
    const referral = document.getElementById("referral")?.value || "";
    selectedType = button.dataset.type;
    render();
    const nameField = document.getElementById("full-name");
    const phoneField = document.getElementById("phone");
    const emailField = document.getElementById("email");
    const referralField = document.getElementById("referral");
    if (nameField) nameField.value = name;
    if (phoneField) phoneField.value = phone;
    if (emailField) emailField.value = email;
    if (referralField) referralField.value = referral;
  }));
  document.getElementById("toggle-auth")?.addEventListener("click", () => { authMode = authMode === "signup" ? "login" : "signup"; selectedType = "seller"; render(); });
  document.getElementById("auth-form")?.addEventListener("submit", handleAuth);
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    if (!button.dataset.tab) return;
    activeTab = button.dataset.tab;
    setCartOpen(false);
    render();
  }));
  document.getElementById("top-profile")?.addEventListener("click", () => { activeTab = "profile"; render(); });
  document.getElementById("menu-button")?.addEventListener("click", () => document.getElementById("sidebar")?.classList.toggle("open"));
  document.querySelectorAll(".open-cart").forEach((button) => button.addEventListener("click", () => { setCartOpen(true); render(); }));
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { productFilter = button.dataset.filter; render(); }));
  document.getElementById("product-search")?.addEventListener("input", (event) => {
    const position = event.target.selectionStart;
    searchQuery = event.target.value;
    render();
    const search = document.getElementById("product-search");
    search?.focus();
    search?.setSelectionRange(position, position);
  });
  document.querySelectorAll("[data-payment]").forEach((button) => button.addEventListener("click", () => { checkoutMethod = button.dataset.payment; render(); setCartOpen(true); }));
  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button)));
  document.getElementById("profile-form")?.addEventListener("submit", handleProfile);
  document.getElementById("cart-backdrop")?.addEventListener("click", (event) => { if (event.target.id === "cart-backdrop") closeCart(); });
}

function bindModalEvents() {
  document.querySelectorAll("#modal-root [data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button)));
  document.getElementById("product-form")?.addEventListener("submit", handleAddProduct);
  document.getElementById("category-form")?.addEventListener("submit", handleAddCategory);
  document.getElementById("new-product-image")?.addEventListener("change", previewProductImage);
  document.getElementById("modal-backdrop")?.addEventListener("click", (event) => { if (event.target.id === "modal-backdrop") closeModal(); });
}

function previewProductImage(event) {
  const file = event.currentTarget.files[0];
  const preview = document.getElementById("product-image-preview");
  if (!preview) return;
  if (productImagePreviewUrl) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = "";
  preview.hidden = true;
  if (!file) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return showError("product-error", "Choose a JPG, PNG, or WebP image.");
  hideError("product-error");
  productImagePreviewUrl = URL.createObjectURL(file);
  preview.src = productImagePreviewUrl;
  preview.hidden = false;
}

function prepareProductImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 10 * 1024 * 1024) return reject(new Error("Choose an image smaller than 10 MB."));
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(sourceUrl);
      const maxDimension = 900;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("Your browser couldn’t process this image."));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      } catch (error) {
        reject(new Error("Your browser couldn’t prepare this image for saving.", { cause: error }));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error("This image couldn’t be opened. Try another image."));
    };
    image.src = sourceUrl;
  });
}

function handleAuth(event) {
  event.preventDefault();
  hideError("auth-error");
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim().toLowerCase();
  if (authMode === "login") {
    const existing = state.accounts.find((account) => account.email.toLowerCase() === email);
    if (!existing) return showError("auth-error", "We couldn’t find an account with that email. Create an account to get started.");
    if (existing.status === "blocked") return showError("auth-error", "This account is currently blocked. Contact support for assistance.");
    const previousSession = state.session;
    state.session = existing.id;
    activeTab = existing.type === "seller" ? "overview" : "discover";
    if (!saveState()) {
      state.session = previousSession;
      return;
    }
    render();
    return;
  }
  const name = String(form.get("name") || "").trim();
  const phone = String(form.get("phone") || "").trim();
  if (!name) return showError("auth-error", "Please enter your full name.");
  if (name.length > 100) return showError("auth-error", "Your name must be 100 characters or fewer.");
  if (!validPhone(phone)) return showError("auth-error", "Enter a valid phone number to use for STK Push payments.");
  if (!validEmail(email)) return showError("auth-error", "Enter a valid email address.");
  if (state.accounts.some((account) => account.email.toLowerCase() === email)) return showError("auth-error", "An account with this email already exists. Please log in instead.");
  const account = { id: createId("account"), name, email, phone, type: selectedType, code: "", referredBy: "", avatar: "" };
  if (selectedType === "buyer") {
    const code = String(form.get("referral") || "").trim().toUpperCase();
    if (code) {
      const seller = state.accounts.find((item) => item.type === "seller" && item.code.toUpperCase() === code);
      if (!seller) return showError("auth-error", "That seller code doesn’t look right. Check the code with your seller and try again.");
      account.referredBy = seller.id;
    }
  } else {
    const prefix = name.replace(/[^a-z]/gi, "").slice(0, 5).toUpperCase() || "SHOP";
    const randomBytes = new Uint8Array(4);
    window.crypto.getRandomValues(randomBytes);
    const suffix = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    account.code = `${prefix}-${suffix}`;
  }
  const previousSession = state.session;
  state.accounts.push(account);
  state.session = account.id;
  activeTab = account.type === "seller" ? "overview" : "discover";
  if (!saveState()) {
    state.accounts = state.accounts.filter((item) => item.id !== account.id);
    state.session = previousSession;
    return;
  }
  render();
}

function handleProfile(event) {
  event.preventDefault();
  hideError("profile-error");
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const phone = String(form.get("phone") || "").trim();
  const user = currentUser();
  if (!user) return;
  if (!name || name.length > 100 || !validEmail(email)) return showError("profile-error", "Check your name and email address, then try again.");
  if (state.accounts.some((account) => account.id !== user.id && account.email.toLowerCase() === email)) return showError("profile-error", "Another MarketHub account already uses this email.");
  if (!validPhone(phone)) return showError("profile-error", "Enter a valid phone number.");
  const previousProfile = { name: user.name, email: user.email, phone: user.phone };
  const previousProductNames = state.products.filter((product) => product.sellerId === user.id).map((product) => product.seller);
  user.name = name;
  user.email = email;
  user.phone = phone;
  state.products.filter((product) => product.sellerId === user.id).forEach((product) => { product.seller = name; });
  if (!saveState()) {
    Object.assign(user, previousProfile);
    state.products.filter((product) => product.sellerId === user.id).forEach((product, index) => { product.seller = previousProductNames[index]; });
    return;
  }
  render();
  showToast("Your profile has been updated.");
}

async function handleAddProduct(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const user = currentUser();
  const price = Number(form.get("price"));
  const stock = Number(form.get("stock"));
  if (!Number.isSafeInteger(price) || price < 1 || !Number.isSafeInteger(stock) || stock < 1 || stock > 100000) return showError("product-error", "Enter a whole-number price and a stock quantity between 1 and 100,000.");
  const name = String(form.get("name")).trim();
  if (!name || name.length > 120) return showError("product-error", "Product name must be between 1 and 120 characters.");
  const category = String(form.get("category")).trim();
  if (!category || category.length > 40) return showError("product-error", "Choose or enter a valid product category.");
  if (state.categories.includes(category)) return showError("product-error", "That category already exists.");
  const imageFile = form.get("image");
  let image = PRODUCT_PLACEHOLDER;
  if (imageFile.size > 0) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(imageFile.type)) return showError("product-error", "Choose a JPG, PNG, or WebP image.");
    try {
      image = await prepareProductImage(imageFile);
    } catch (error) {
      console.error("Could not process product image.", error);
      return showError("product-error", error.message);
    }
  }
  const product = { id: createId("product"), name, category, price, stock, seller: user.name, sellerId: user.id, image, tag: "New" };
  if (!state.categories.includes(category)) state.categories.push(category);
  state.products.unshift(product);
  if (!saveState()) {
    state.products = state.products.filter((item) => item.id !== product.id);
    return;
  }
  closeModal();
  activeTab = "products";
  render();
  showToast("Your product is now listed.");
}

function handleAddCategory(event) {
  event.preventDefault();
  hideError("category-error");
  const form = new FormData(event.currentTarget);
  const name = String(form.get("name") || "").trim();
  if (!name || name.length > 40) return showError("category-error", "Category name must be between 1 and 40 characters.");
  if (state.categories.includes(name)) return showError("category-error", "That category already exists.");
  const previousCategories = state.categories.map((category) => category);
  state.categories.push(name);
  if (!saveState()) {
    state.categories = previousCategories;
    return;
  }
  closeModal();
  if (pendingProductDraft) {
    const draft = pendingProductDraft;
    pendingProductDraft = null;
    openAddProductModal();
    const form = document.getElementById("product-form");
    if (form) {
      Object.entries(draft).forEach(([key, value]) => {
        const field = form.elements[key];
        if (field && field.name === key && !(field instanceof HTMLInputElement && field.type === "file")) field.value = value;
      });
      const select = document.getElementById("new-product-category");
      if (select) select.value = name;
    }
    showToast(`Category "${name}" added. Complete your product.`);
    return;
  }
  activeTab = "categories";
  render();
  showToast(`Category "${name}" added.`);
}

function chooseProfileAvatar() {
  const user = currentUser();
  if (!user) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,image/gif";
  input.onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      showToast("Choose a JPG, PNG, GIF, or WebP image.");
      return;
    }
    try {
      const image = await prepareProductImage(file);
      const previousAvatar = user.avatar;
      user.avatar = image;
      if (!saveState()) {
        user.avatar = previousAvatar;
        return;
      }
      render();
      showToast("Profile picture updated.");
    } catch (error) {
      console.error("Could not upload profile image.", error);
      showToast(error.message || "Could not update profile picture.");
    }
  };
  input.click();
}

function handleAction(button) {
  const { action, id } = button.dataset;
  if (action === "add-product") openAddProductModal();
  if (action === "close-modal") closeModal();
  if (action === "close-cart") closeCart();
  if (action === "copy-code") copyCode();
  if (action === "choose-avatar") chooseProfileAvatar();
  if (action === "toggle-referral-status") {
    const user = currentUser();
    const referredUser = state.accounts.find((account) => account.id === id && account.referredBy === user?.id && account.type === "buyer");
    if (!user || user.type !== "seller" || !referredUser) return;
    const previousStatus = referredUser.status;
    referredUser.status = safeStatusClass(referredUser.status, ["active", "blocked"]) === "active" ? "blocked" : "active";
    if (!saveState()) {
      referredUser.status = previousStatus;
      return;
    }
    render();
    showToast(`${referredUser.name} is now ${referredUser.status === "active" ? "active" : "blocked"}.`);
  }
  if (action === "delete-referral") {
    const user = currentUser();
    const referredUser = state.accounts.find((account) => account.id === id && account.referredBy === user?.id && account.type === "buyer");
    if (!user || user.type !== "seller" || !referredUser) return;
    if (!window.confirm(`Remove ${referredUser.name} from your referral list?`)) return;
    const previousAccounts = state.accounts;
    state.accounts = state.accounts.filter((account) => account.id !== id);
    if (!saveState()) {
      state.accounts = previousAccounts;
      return;
    }
    render();
    showToast(`${referredUser.name} was removed from your referrals.`);
  }
  if (action === "logout") {
    const previousSession = state.session;
    state.session = null;
    if (!saveState()) {
      state.session = previousSession;
      return;
    }
    authMode = "login";
    render();
  }
  if (action === "view-product-image") {
    const product = state.products.find((item) => item.id === id);
    if (!product) return;
    openImageModal(product);
  }
  if (action === "delete-product") {
    const user = currentUser();
    const product = state.products.find((item) => item.id === id && item.sellerId === user?.id);
    if (!user || user.type !== "seller" || !product || !window.confirm(`Remove "${product.name}" from your shop?`)) return;
    const previousProducts = state.products;
    const previousCart = state.cart;
    state.products = state.products.filter((item) => item.id !== id);
    state.cart = state.cart.filter((line) => line.productId !== id);
    if (!saveState()) {
      state.products = previousProducts;
      state.cart = previousCart;
      return;
    }
    render();
    showToast("Product removed from your shop.");
  }
  if (action === "open-category-modal") openCategoryModal();
  if (action === "rename-category") {
    const currentName = button.dataset.name;
    const newName = window.prompt("Rename category to:", currentName);
    if (!newName) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length > 40) return showToast("Category name must be between 1 and 40 characters.");
    if (trimmed === currentName) return;
    if (state.categories.includes(trimmed)) return showToast("That category name already exists.");
    const previousCategories = state.categories.map((category) => category);
    state.categories = state.categories.map((category) => (category === currentName ? trimmed : category));
    state.products.filter((product) => product.category === currentName).forEach((product) => { product.category = trimmed; });
    if (!saveState()) {
      state.categories = previousCategories;
      return;
    }
    render();
    showToast(`Category renamed to "${trimmed}".`);
  }
  if (action === "delete-category") {
    const category = button.dataset.name;
    const inUse = state.products.filter((product) => product.category === category).length;
    if (inUse) return showToast(`Cannot delete "${category}" — ${inUse} product${inUse === 1 ? "" : "s"} use it.`);
    if (!window.confirm(`Delete the "${category}" category?`)) return;
    const previousCategories = state.categories.map((category) => category);
    state.categories = state.categories.filter((item) => item !== category);
    if (!saveState()) {
      state.categories = previousCategories;
      return;
    }
    render();
    showToast(`Category "${category}" deleted.`);
  }
  if (action === "add-cart") {
    const product = state.products.find((item) => item.id === id);
    if (!product || product.stock < 1) return showToast("This product is currently unavailable.");
    const previousCart = state.cart.map((item) => ({ ...item }));
    const line = state.cart.find((item) => item.productId === id);
    if (line && line.quantity < product.stock) line.quantity += 1;
    else if (line) return showToast("You’ve reached the available stock for this product.");
    else state.cart.push({ productId: id, quantity: 1 });
    if (!saveState()) {
      state.cart = previousCart;
      return;
    }
    render();
    showToast("Added to your bag.");
  }
  if (action === "quantity") {
    const previousCart = state.cart.map((item) => ({ ...item }));
    const line = state.cart.find((item) => item.productId === id);
    const product = state.products.find((item) => item.id === id);
    if (line && product) line.quantity = Math.min(product.stock, line.quantity + Number(button.dataset.change));
    state.cart = state.cart.filter((item) => item.quantity > 0);
    if (!saveState()) {
      state.cart = previousCart;
      return;
    }
    setCartOpen(true);
    render();
  }
  if (action === "checkout") checkout();
  if (action === "stk-push") {
    const user = currentUser();
    if (!user || user.type !== "buyer") return;
    const order = state.orders.find((item) => item.id === id);
    if (!order || !Array.isArray(order.paymentPlan)) return;
    const index = Number(button.dataset.installment);
    const planItem = order.paymentPlan[index];
    if (!planItem || planItem.paid) return;
    const previousPaid = planItem.paid;
    const phone = (user.phone || "").replace(/\D/g, "");
    if (!phone) return showToast("Add a phone number in your profile to receive an STK push.");
    const promptMessage = `M-Pesa STK Push: Pay ${money(planItem.amount)} for order ${order.id} (${planItem.label}).`;
    const confirmed = window.confirm(`Send STK prompt to ${phone}?\n\n${promptMessage}`);
    if (!confirmed) return;
    planItem.paid = true;
    planItem.paidAt = new Date().toISOString();
    planItem.method = "M-Pesa STK push";
    if (!saveState()) {
      planItem.paid = previousPaid;
      planItem.paidAt = undefined;
      planItem.method = undefined;
      return;
    }
    render();
    showToast(`STK push sent. ${planItem.label} marked as paid.`);
  }
  if (action === "fulfill-order") {
    const user = currentUser();
    if (user?.type !== "seller") return;
    const sellerOrderIds = new Set(sellerOrders(user).map((order) => order.id));
    const order = state.orders.find((item) => item.id === id && sellerOrderIds.has(item.id));
    if (order) {
      const previousStatus = order.status;
      order.status = "Received";
      if (!saveState()) {
        order.status = previousStatus;
        return;
      }
      render();
      showToast(`${order.id} marked as received.`);
    }
  }
}

function checkout() {
  const user = currentUser();
  if (!user || user.type !== "buyer") return showToast("Sign in with a buyer account before placing an order.");
  if (!state.cart.length) return;
  const method = checkoutMethod === "stk" ? "M-Pesa STK push" : "PayPal";
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><section class="modal"><h2>Buyer and pickup details</h2><p>Enter your contact details and nearest pickup area for this order of <b>${money(cartTotal())}</b>.</p><div id="checkout-error" class="form-error" role="alert"></div><form id="checkout-form"><div class="field"><label for="checkout-name">Full name</label><input id="checkout-name" name="name" autocomplete="name" value="${escapeHtml(user.name)}" maxlength="100" required></div><div class="field"><label for="checkout-email">Email address</label><input id="checkout-email" name="email" type="email" autocomplete="email" value="${escapeHtml(user.email)}" maxlength="254" required></div><div class="field"><label for="checkout-phone">Phone number</label><input id="checkout-phone" name="phone" type="tel" autocomplete="tel" placeholder="e.g. 0712 345 678" value="${escapeHtml(user.phone || "")}" required></div><div class="field"><label for="pickup-area">Nearest pickup area</label><input id="pickup-area" name="pickupArea" placeholder="e.g. Westlands, near Sarit Centre" autocomplete="street-address" maxlength="160" required></div><div class="note"><span>${checkoutMethod === "stk" ? "📱" : "Ⓟ"}</span><span>${checkoutMethod === "stk" ? "M-Pesa STK Push is not available yet." : "PayPal is not available yet."} Provider setup is required. This order will only be saved in this browser and will not notify the seller.</span></div><div class="modal-actions"><button type="button" class="btn btn-outline" data-action="close-modal">Not now</button><button class="btn btn-primary" type="submit">Submit order</button></div></form></section></div>`;
  setCartOpen(false);
  bindModalEvents();
  document.getElementById("checkout-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    hideError("checkout-error");
    const form = new FormData(event.currentTarget);
    const buyerName = String(form.get("name") || "").trim();
    const buyerEmail = String(form.get("email") || "").trim().toLowerCase();
    const buyerPhone = String(form.get("phone") || "").trim();
    const pickupArea = String(form.get("pickupArea") || "").trim();
    if (!buyerName || !buyerEmail || !buyerPhone || !pickupArea) return showError("checkout-error", "Complete all buyer and pickup details to place your order.");
    if (buyerName.length > 100 || buyerEmail.length > 254 || pickupArea.length > 160) return showError("checkout-error", "Check the length of your name, email, and pickup details.");
    if (!validEmail(buyerEmail)) return showError("checkout-error", "Enter a valid email address.");
    if (!validPhone(buyerPhone)) return showError("checkout-error", "Enter a valid phone number to continue.");
    const productsInCart = state.cart.map((line) => ({
      line,
      product: state.products.find((item) => item.id === line.productId)
    }));
    if (!productsInCart.length || productsInCart.some(({ line, product }) => !product || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > product.stock)) {
      return showError("checkout-error", "Some items are no longer available in the requested quantities. Review your bag and try again.");
    }
    const itemsBySeller = new Map();
    productsInCart.forEach(({ line, product }) => {
      const sellerItems = itemsBySeller.get(product.sellerId) || [];
      sellerItems.push({
        productId: product.id,
        name: product.name,
        quantity: line.quantity,
        price: product.price
      });
      itemsBySeller.set(product.sellerId, sellerItems);
    });
    const orders = Array.from(itemsBySeller.entries()).map(([sellerId, items]) => {
      const orderTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      return {
        id: createOrderId(),
        sellerId,
        buyer: buyerName,
        buyerId: user.id,
        buyerEmail,
        buyerPhone,
        pickupArea,
        items,
        total: orderTotal,
        status: "Pending",
        date: "Just now",
        orderedAt: new Date().toISOString(),
        paymentMethod: method,
        paymentPlan: paymentPlanForOrder({ total: orderTotal })
      };
    });
    if (!orders.length || orders.some((order) => !Number.isSafeInteger(order.total) || order.total <= 0)) {
      return showError("checkout-error", "The order total is invalid. Review your bag and try again.");
    }
    const previousCart = state.cart;
    const previousOrders = state.orders;
    const previousProducts = state.products.map((product) => ({ ...product }));
    const previousPhone = user.phone;
    user.phone = buyerPhone;
    productsInCart.forEach(({ line, product }) => { product.stock -= line.quantity; });
    state.orders.unshift(...orders);
    state.cart = [];
    if (!saveState()) {
      state.products = previousProducts;
      state.orders = previousOrders;
      state.cart = previousCart;
      user.phone = previousPhone;
      return;
    }
    closeModal();
    activeTab = "orders";
    render();
    showToast("Order saved in this browser. The seller has not been notified.");
  });
}

function closeModal() {
  const root = document.getElementById("modal-root");
  if (root) root.innerHTML = "";
  if (productImagePreviewUrl) URL.revokeObjectURL(productImagePreviewUrl);
  productImagePreviewUrl = "";
}

function closeCart() {
  setCartOpen(false);
  render();
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.getElementById("modal-root")?.innerHTML) {
    closeModal();
    return;
  }
  if (document.body.dataset.cartOpen === "true") {
    closeCart();
  }
});

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  const updatedState = loadState();
  state = {
    ...state,
    accounts: updatedState.accounts,
    products: updatedState.products,
    orders: updatedState.orders
  };
  render();
});

render();


