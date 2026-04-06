const API_BASE = "http://127.0.0.1:8000/api";

const elements = {
  apiStatus: document.getElementById("apiStatus"),
  geminiStatus: document.getElementById("geminiStatus"),
  networkValue: document.getElementById("networkValue"),
  registryCount: document.getElementById("registryCount"),
  walletValue: document.getElementById("walletValue"),
  indexerValue: document.getElementById("indexerValue"),
  heroCapValue: document.getElementById("heroCapValue"),
  heroSpentValue: document.getElementById("heroSpentValue"),
  heroReceiptCount: document.getElementById("heroReceiptCount"),
  serviceGrid: document.getElementById("serviceGrid"),
  dailyCapInput: document.getElementById("dailyCapInput"),
  monthlyCapInput: document.getElementById("monthlyCapInput"),
  saveCapButton: document.getElementById("saveCapButton"),
  spentValue: document.getElementById("spentValue"),
  capValue: document.getElementById("capValue"),
  budgetFill: document.getElementById("budgetFill"),
  monthSpentValue: document.getElementById("monthSpentValue"),
  monthCapValue: document.getElementById("monthCapValue"),
  monthBudgetFill: document.getElementById("monthBudgetFill"),
  intentInput: document.getElementById("intentInput"),
  generateIntentButton: document.getElementById("generateIntentButton"),
  intentOutput: document.getElementById("intentOutput"),
  transactionCard: document.getElementById("transactionCard"),
  timeline: document.getElementById("timeline"),
  receiptTableBody: document.getElementById("receiptTableBody"),
  clearLogButton: document.getElementById("clearLogButton"),
  serviceCardTemplate: document.getElementById("serviceCardTemplate")
};

const appState = {
  services: [],
  config: null,
  state: null,
  selectedServiceId: null
};

bootstrap();

async function bootstrap() {
  bindEvents();
  await hydrateApp();
}

function bindEvents() {
  elements.saveCapButton.addEventListener("click", saveSpendCap);
  elements.clearLogButton.addEventListener("click", clearReceipts);
  elements.generateIntentButton.addEventListener("click", generateIntent);
}

async function hydrateApp() {
  try {
    const [config, servicesPayload, runtimeState] = await Promise.all([
      apiGet("/config"),
      apiGet("/services"),
      apiGet("/state")
    ]);

    appState.config = config;
    appState.services = servicesPayload.services;
    appState.state = runtimeState;

    elements.apiStatus.textContent = "Backend online";
    elements.geminiStatus.textContent = config.gemini_enabled ? "Gemini configured" : "Gemini fallback mode";

    renderConfig();
    renderServices();
    syncStateViews();
    renderReceipts();
  } catch (error) {
    elements.apiStatus.textContent = "Backend offline";
    elements.geminiStatus.textContent = "Start backend/app.py";
    updateTransactionCard(
      "Backend connection required",
      "The frontend is ready, but it needs the Python API running on port 8000 to load services and execute purchases.",
      "blocked"
    );
    setTimeline([
      { step: "Boot", detail: String(error.message || error) }
    ]);
  }
}

function renderConfig() {
  const { config } = appState;
  elements.networkValue.textContent = config.network;
  elements.walletValue.textContent = truncateMiddle(config.payment_wallet);
  elements.indexerValue.textContent = readableEndpoint(config.indexer_server);
  elements.registryCount.textContent = `${appState.services.length} services`;
}

function renderServices() {
  elements.serviceGrid.innerHTML = "";

  appState.services.forEach((service) => {
    const fragment = elements.serviceCardTemplate.content.cloneNode(true);
    fragment.querySelector(".service-card__name").textContent = service.name;
    fragment.querySelector(".service-card__description").textContent = service.description;
    fragment.querySelector(".service-card__price").textContent = formatAlgo(service.price);
    fragment.querySelector(".service-card__category").textContent = service.category;
    fragment.querySelector(".service-card__address").textContent = `Pay to ${truncateMiddle(service.payment_address, 10, 6)}`;
    fragment.querySelector(".service-card__latency").textContent = service.latency_target;
    fragment.querySelector(".service-card__settlement").textContent = service.settlement_mode;
    fragment.querySelector(".service-card__action").addEventListener("click", () => purchaseService(service.id));
    elements.serviceGrid.appendChild(fragment);
  });
}

function syncStateViews() {
  const runtimeState = appState.state;
  elements.dailyCapInput.value = runtimeState.daily_cap;
  elements.monthlyCapInput.value = runtimeState.monthly_cap;
  elements.spentValue.textContent = formatAlgo(runtimeState.spent_daily);
  elements.capValue.textContent = formatAlgo(runtimeState.daily_cap);
  elements.monthSpentValue.textContent = formatAlgo(runtimeState.spent_monthly);
  elements.monthCapValue.textContent = formatAlgo(runtimeState.monthly_cap);
  elements.heroCapValue.textContent = `${formatAlgo(runtimeState.daily_cap)} / ${formatAlgo(runtimeState.monthly_cap)}`;
  elements.heroSpentValue.textContent = `${formatAlgo(runtimeState.spent_daily)} / ${formatAlgo(runtimeState.spent_monthly)}`;
  elements.heroReceiptCount.textContent = String(runtimeState.receipts.length);

  const dailyWidth = Math.min((runtimeState.spent_daily / runtimeState.daily_cap) * 100 || 0, 100);
  const monthlyWidth = Math.min((runtimeState.spent_monthly / runtimeState.monthly_cap) * 100 || 0, 100);
  elements.budgetFill.style.width = `${dailyWidth}%`;
  elements.monthBudgetFill.style.width = `${monthlyWidth}%`;
}

async function saveSpendCap() {
  const dailyCap = Number(elements.dailyCapInput.value);
  const monthlyCap = Number(elements.monthlyCapInput.value);

  if (!Number.isFinite(dailyCap) || !Number.isFinite(monthlyCap) || dailyCap <= 0 || monthlyCap <= 0 || monthlyCap < dailyCap) {
    updateTransactionCard("Policy rejected", "Use valid positive daily and monthly caps, and keep monthly cap at least as large as daily cap.", "blocked");
    setTimeline([{ step: "Policy", detail: "Spend cap update failed validation in the browser." }]);
    return;
  }

  try {
    const payload = await apiPost("/policy", { daily_cap: dailyCap, monthly_cap: monthlyCap });
    appState.state = payload.state;
    syncStateViews();
    updateTransactionCard("Policy updated", `Daily cap ${formatAlgo(dailyCap)} and monthly cap ${formatAlgo(monthlyCap)} are now active.`, "active");
    setTimeline([{ step: "Policy", detail: payload.message }]);
  } catch (error) {
    handleApiError(error, "Unable to save the spend cap.");
  }
}

async function generateIntent() {
  const objective = elements.intentInput.value.trim();

  if (!objective) {
    elements.intentOutput.textContent = "Add an objective first so Gemini can generate a compact purchase brief.";
    return;
  }

  try {
    elements.generateIntentButton.disabled = true;
    elements.intentOutput.textContent = "Generating a buyer brief...";
    const payload = await apiPost("/gemini/brief", {
      objective,
      service_id: appState.selectedServiceId
    });
    elements.intentOutput.textContent = payload.brief;
  } catch (error) {
    elements.intentOutput.textContent = `Unable to generate brief: ${error.message || error}`;
  } finally {
    elements.generateIntentButton.disabled = false;
  }
}

async function purchaseService(serviceId) {
  appState.selectedServiceId = serviceId;
  const service = appState.services.find((entry) => entry.id === serviceId);

  updateTransactionCard("Purchase queued", `Preparing policy and payment checks for ${service.name}.`, "active");
  setTimeline([
    { step: "Discover", detail: `Selected ${service.name} from the registry.` }
  ]);

  try {
    const payload = await apiPost("/purchase", {
      service_id: serviceId,
      objective: elements.intentInput.value.trim()
    });

    appState.state = payload.state;
    syncStateViews();
    renderReceipts();
    updateTransactionCard(payload.summary.title, payload.summary.copy, payload.summary.tone);
    setTimeline(payload.timeline);
  } catch (error) {
    handleApiError(error, `Purchase failed for ${service.name}.`);
  }
}

async function clearReceipts() {
  try {
    const payload = await apiPost("/receipts/clear", {});
    appState.state = payload.state;
    syncStateViews();
    renderReceipts();
    updateTransactionCard("Receipts cleared", "Receipt history and spend totals were reset on the backend.", "active");
    setTimeline([{ step: "Log", detail: payload.message }]);
  } catch (error) {
    handleApiError(error, "Unable to clear receipts.");
  }
}

function renderReceipts() {
  const receipts = appState.state.receipts;
  elements.receiptTableBody.innerHTML = "";

  if (!receipts.length) {
    elements.receiptTableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No receipts yet. Complete a purchase to create an auditable log entry.</td></tr>';
    return;
  }

  receipts.forEach((receipt) => {
    const row = document.createElement("tr");
    const statusClass = receipt.status === "Confirmed" ? "status-badge--confirmed" : "status-badge--rejected";
    const explorerCell = receipt.explorer_url
      ? `<a class="receipt-link" href="${receipt.explorer_url}" target="_blank" rel="noreferrer">Open</a>`
      : "N/A";
    row.innerHTML = `
      <td>${receipt.service_name}</td>
      <td>${formatAlgo(receipt.cost)}</td>
      <td><code>${receipt.tx_id}</code></td>
      <td><span class="status-badge ${statusClass}">${receipt.status}</span></td>
      <td>${explorerCell}</td>
      <td>${receipt.response}</td>
      <td>${formatTimestamp(receipt.timestamp)}</td>
    `;
    elements.receiptTableBody.appendChild(row);
  });
}

function updateTransactionCard(title, copy, tone) {
  elements.transactionCard.className = `transaction-card transaction-card--${tone}`;
  elements.transactionCard.innerHTML = `
    <p class="transaction-card__title">${title}</p>
    <p class="transaction-card__copy">${copy}</p>
  `;
}

function setTimeline(items) {
  elements.timeline.innerHTML = "";
  items.forEach(({ step, detail }) => appendTimelineStep(step, detail));
}

function appendTimelineStep(step, detail) {
  const item = document.createElement("li");
  item.innerHTML = `
    <span class="timeline__step">${step}</span>
    <div>${detail}</div>
  `;
  elements.timeline.appendChild(item);
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE}${path}`);
  return parseResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

function handleApiError(error, fallbackMessage) {
  updateTransactionCard("Request failed", fallbackMessage, "blocked");
  setTimeline([{ step: "Error", detail: String(error.message || error) }]);
}

function formatAlgo(value) {
  return `${Number(value).toFixed(0)} ALGO`;
}

function formatTimestamp(isoString) {
  return new Date(isoString).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function truncateMiddle(value, front = 6, back = 4) {
  if (!value || value.length <= front + back + 3) {
    return value || "";
  }
  return `${value.slice(0, front)}...${value.slice(-back)}`;
}

function readableEndpoint(url) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
