const STORAGE_KEY = "prestamos_pro_v1";

const state = loadState();

const els = {
  pageTitle: document.getElementById("pageTitle"),
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  toast: document.getElementById("toast"),
  metricPrincipal: document.getElementById("metricPrincipal"),
  metricBalance: document.getElementById("metricBalance"),
  metricInterest: document.getElementById("metricInterest"),
  metricOverdue: document.getElementById("metricOverdue"),
  recentLoansTable: document.getElementById("recentLoansTable"),
  upcomingList: document.getElementById("upcomingList"),
  loanCards: document.getElementById("loanCards"),
  clientsTable: document.getElementById("clientsTable"),
  paymentsTable: document.getElementById("paymentsTable"),
  paymentCount: document.getElementById("paymentCount"),
  paymentLoanSelect: document.getElementById("paymentLoanSelect"),
  paymentDate: document.getElementById("paymentDate"),
  paymentAmount: document.getElementById("paymentAmount"),
  dueList: document.getElementById("dueList"),
  loanSearch: document.getElementById("loanSearch"),
  clientSearch: document.getElementById("clientSearch"),
  loanStatusFilter: document.getElementById("loanStatusFilter"),
  dueFilter: document.getElementById("dueFilter"),
  dueDateFilter: document.getElementById("dueDateFilter"),
  currencyInput: document.getElementById("currencyInput"),
  companyInput: document.getElementById("companyInput")
};

function defaultState() {
  return {
    settings: {
      currency: "$",
      company: "Prestamos Pro"
    },
    clients: [],
    loans: [],
    payments: []
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...defaultState(), ...saved } : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function today() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function money(value) {
  return `${state.settings.currency}${Number(value || 0).toLocaleString("es-DO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function dateLabel(dateString) {
  if (!dateString) return "";
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("es-DO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateString, months) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const start = new Date(`${a}T00:00:00`);
  const end = new Date(`${b}T00:00:00`);
  return Math.round((end - start) / 86400000);
}

function getClient(clientId) {
  return state.clients.find(client => client.id === clientId);
}

function loanPayments(loanId) {
  return state.payments.filter(payment => payment.loanId === loanId);
}

function totalPaid(loanId) {
  return loanPayments(loanId).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function totalLoanAmount(loan) {
  const principal = Number(loan.principal || 0);
  const rate = Number(loan.rate || 0) / 100;
  if (loan.interestType === "simple") {
    return principal + principal * rate * Number(loan.terms || 1);
  }
  return principal + principal * rate;
}

function paymentStep(frequency) {
  if (frequency === "weekly") return { type: "days", value: 7 };
  if (frequency === "biweekly") return { type: "days", value: 15 };
  return { type: "months", value: 1 };
}

function generateSchedule(loan) {
  const terms = Number(loan.terms || 1);
  const total = totalLoanAmount(loan);
  const amount = total / terms;
  const step = paymentStep(loan.frequency);
  const paid = totalPaid(loan.id);
  let remainingPaid = paid;

  return Array.from({ length: terms }, (_, index) => {
    const dueDate = step.type === "months"
      ? addMonths(loan.startDate, index + 1)
      : addDays(loan.startDate, step.value * (index + 1));
    const paidForInstallment = Math.min(amount, Math.max(remainingPaid, 0));
    remainingPaid -= paidForInstallment;
    return {
      number: index + 1,
      dueDate,
      amount,
      paid: paidForInstallment,
      balance: amount - paidForInstallment,
      status: paidForInstallment >= amount ? "paid" : daysBetween(dueDate, today()) > 0 ? "overdue" : "pending"
    };
  });
}

function loanSummary(loan) {
  const total = totalLoanAmount(loan);
  const paid = totalPaid(loan.id);
  const balance = Math.max(total - paid, 0);
  const schedule = generateSchedule(loan);
  const overdue = schedule.filter(item => item.status === "overdue").length;
  const status = balance <= 0 ? "closed" : overdue > 0 ? "late" : "active";
  return {
    total,
    paid,
    balance,
    interest: total - Number(loan.principal || 0),
    progress: total > 0 ? Math.min((paid / total) * 100, 100) : 0,
    overdue,
    status,
    nextDue: schedule.find(item => item.status !== "paid")
  };
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function setView(viewId) {
  els.views.forEach(view => view.classList.toggle("active", view.id === viewId));
  els.navItems.forEach(item => item.classList.toggle("active", item.dataset.view === viewId));
  const active = [...els.navItems].find(item => item.dataset.view === viewId);
  els.pageTitle.textContent = active ? active.textContent : "Inicio";
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (id === "loanModal") {
    fillLoanClientSelect();
    document.getElementById("loanCode").value = `PRE-${String(state.loans.length + 1).padStart(4, "0")}`;
    document.getElementById("loanStartDate").value = today();
  }
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModals() {
  document.querySelectorAll(".modal").forEach(modal => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  });
}

function fillLoanClientSelect() {
  const select = document.getElementById("loanClient");
  if (!state.clients.length) {
    select.innerHTML = `<option value="">Primero registra un cliente</option>`;
    return;
  }
  select.innerHTML = state.clients
    .map(client => `<option value="${client.id}">${escapeHtml(client.name)}</option>`)
    .join("");
}

function render() {
  saveState();
  renderSettings();
  renderDashboard();
  renderLoans();
  renderClients();
  renderPayments();
  renderDue();
  fillPaymentLoanSelect();
}

function renderSettings() {
  els.currencyInput.value = state.settings.currency;
  els.companyInput.value = state.settings.company;
  const brandName = document.querySelector(".brand strong");
  if (brandName) brandName.textContent = state.settings.company;
  document.title = state.settings.company;
}

function renderDashboard() {
  const summaries = state.loans.map(loanSummary);
  const principal = state.loans.reduce((sum, loan) => sum + Number(loan.principal || 0), 0);
  const balance = summaries.reduce((sum, item) => sum + item.balance, 0);
  const interest = summaries.reduce((sum, item) => sum + item.interest, 0);
  const overdue = summaries.reduce((sum, item) => sum + item.overdue, 0);

  els.metricPrincipal.textContent = money(principal);
  els.metricBalance.textContent = money(balance);
  els.metricInterest.textContent = money(interest);
  els.metricOverdue.textContent = overdue;

  const recent = [...state.loans].slice(-5).reverse();
  els.recentLoansTable.innerHTML = recent.length
    ? recent.map(loan => {
      const client = getClient(loan.clientId);
      const summary = loanSummary(loan);
      return `<tr>
        <td>${escapeHtml(client?.name || "Sin cliente")}</td>
        <td>${money(loan.principal)}</td>
        <td>${money(summary.balance)}</td>
        <td>${statusBadge(summary.status)}</td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="4">No hay prestamos registrados.</td></tr>`;

  const upcoming = getAllDueItems()
    .filter(item => item.status !== "paid")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 5);

  els.upcomingList.innerHTML = upcoming.length
    ? upcoming.map(item => `<div class="stack-item">
      <div>
        <strong>${escapeHtml(item.clientName)}</strong>
        <span class="muted">${item.loanCode} - cuota ${item.number}</span>
      </div>
      <div>
        <strong>${money(item.balance)}</strong>
        <span class="${item.status === "overdue" ? "danger-text" : "muted"}">${dateLabel(item.dueDate)}</span>
      </div>
    </div>`).join("")
    : `<div class="empty">No hay cobros pendientes.</div>`;
}

function renderLoans() {
  const query = els.loanSearch.value.trim().toLowerCase();
  const statusFilter = els.loanStatusFilter.value;
  const loans = state.loans.filter(loan => {
    const client = getClient(loan.clientId);
    const summary = loanSummary(loan);
    const haystack = `${loan.code} ${client?.name || ""} ${summary.status}`.toLowerCase();
    return haystack.includes(query) && (statusFilter === "all" || summary.status === statusFilter);
  });

  els.loanCards.innerHTML = loans.length
    ? loans.map(loan => {
      const client = getClient(loan.clientId);
      const summary = loanSummary(loan);
      return `<article class="loan-card">
        <div class="loan-head">
          <div>
            <h3>${escapeHtml(client?.name || "Sin cliente")}</h3>
            <span class="loan-code">${escapeHtml(loan.code)}</span>
          </div>
          ${statusBadge(summary.status)}
        </div>
        <div class="loan-stats">
          <div class="mini-stat"><span>Prestado</span><strong>${money(loan.principal)}</strong></div>
          <div class="mini-stat"><span>Total</span><strong>${money(summary.total)}</strong></div>
          <div class="mini-stat"><span>Balance</span><strong>${money(summary.balance)}</strong></div>
        </div>
        <div class="progress" aria-label="Progreso de pago"><span style="width:${summary.progress}%"></span></div>
        <p class="muted" style="margin:12px 0 0;">${summary.nextDue ? `Proxima cuota: ${dateLabel(summary.nextDue.dueDate)} por ${money(summary.nextDue.balance)}` : "Prestamo saldado"}</p>
      </article>`;
    }).join("")
    : `<div class="empty">No hay prestamos que coincidan con el filtro.</div>`;
}

function renderClients() {
  const query = els.clientSearch.value.trim().toLowerCase();
  const clients = state.clients.filter(client => {
    const haystack = `${client.name} ${client.document} ${client.phone}`.toLowerCase();
    return haystack.includes(query);
  });

  els.clientsTable.innerHTML = clients.length
    ? clients.map(client => {
      const count = state.loans.filter(loan => loan.clientId === client.id).length;
      return `<tr>
        <td><strong>${escapeHtml(client.name)}</strong><br><span class="muted">${escapeHtml(client.address || "")}</span></td>
        <td>${escapeHtml(client.document || "-")}</td>
        <td>${escapeHtml(client.phone || "-")}</td>
        <td>${count}</td>
        <td><button class="ghost-btn" type="button" data-client-loan="${client.id}">Prestar</button></td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="5">No hay clientes registrados.</td></tr>`;
}

function fillPaymentLoanSelect() {
  const activeLoans = state.loans.filter(loan => loanSummary(loan).status !== "closed");
  els.paymentLoanSelect.innerHTML = activeLoans.length
    ? activeLoans.map(loan => {
      const client = getClient(loan.clientId);
      return `<option value="${loan.id}">${escapeHtml(loan.code)} - ${escapeHtml(client?.name || "Sin cliente")}</option>`;
    }).join("")
    : `<option value="">No hay prestamos activos</option>`;
}

function renderPayments() {
  const payments = [...state.payments].sort((a, b) => b.date.localeCompare(a.date));
  els.paymentCount.textContent = `${payments.length} pagos`;
  els.paymentsTable.innerHTML = payments.length
    ? payments.map(payment => {
      const loan = state.loans.find(item => item.id === payment.loanId);
      const client = loan ? getClient(loan.clientId) : null;
      return `<tr>
        <td>${dateLabel(payment.date)}</td>
        <td>${escapeHtml(client?.name || "Cliente eliminado")}</td>
        <td>${escapeHtml(loan?.code || "-")}</td>
        <td><strong>${money(payment.amount)}</strong></td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="4">Todavia no hay pagos registrados.</td></tr>`;
}

function getAllDueItems() {
  return state.loans.flatMap(loan => {
    const client = getClient(loan.clientId);
    return generateSchedule(loan).map(item => ({
      ...item,
      loanId: loan.id,
      loanCode: loan.code,
      clientName: client?.name || "Sin cliente"
    }));
  });
}

function renderDue() {
  const filter = els.dueFilter.value;
  const dateFilter = els.dueDateFilter.value;
  const items = getAllDueItems()
    .filter(item => item.status !== "paid")
    .filter(item => !dateFilter || item.dueDate === dateFilter)
    .filter(item => {
      if (filter === "overdue") return item.status === "overdue";
      if (filter === "today") return item.dueDate === today();
      if (filter === "future") return item.dueDate > today();
      return true;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  els.dueList.innerHTML = items.length
    ? items.map(item => `<article class="due-card">
      <div class="due-head">
        <div>
          <h3>${escapeHtml(item.clientName)}</h3>
          <span class="muted">${escapeHtml(item.loanCode)} - cuota ${item.number}</span>
        </div>
        ${item.status === "overdue" ? statusBadge("late") : statusBadge("active", "Pendiente")}
      </div>
      <div class="loan-stats">
        <div class="mini-stat"><span>Fecha</span><strong>${dateLabel(item.dueDate)}</strong></div>
        <div class="mini-stat"><span>Monto</span><strong>${money(item.amount)}</strong></div>
        <div class="mini-stat"><span>Resta</span><strong>${money(item.balance)}</strong></div>
      </div>
    </article>`).join("")
    : `<div class="empty">No hay cuotas para este filtro.</div>`;
}

function statusBadge(status, label) {
  const labels = {
    active: "Activo",
    late: "Atrasado",
    closed: "Saldado"
  };
  return `<span class="status ${status}">${label || labels[status] || status}</span>`;
}

function createClient(event) {
  event.preventDefault();
  const client = {
    id: uid("client"),
    name: document.getElementById("clientName").value.trim(),
    document: document.getElementById("clientDocument").value.trim(),
    phone: document.getElementById("clientPhone").value.trim(),
    address: document.getElementById("clientAddress").value.trim(),
    createdAt: new Date().toISOString()
  };
  state.clients.push(client);
  event.target.reset();
  closeModals();
  render();
  showToast("Cliente guardado.");
}

function createLoan(event) {
  event.preventDefault();
  const clientId = document.getElementById("loanClient").value;
  if (!clientId) {
    showToast("Registra un cliente antes de crear el prestamo.");
    return;
  }
  const loan = {
    id: uid("loan"),
    clientId,
    code: document.getElementById("loanCode").value,
    principal: Number(document.getElementById("loanPrincipal").value),
    rate: Number(document.getElementById("loanRate").value),
    frequency: document.getElementById("loanFrequency").value,
    terms: Number(document.getElementById("loanTerms").value),
    startDate: document.getElementById("loanStartDate").value,
    interestType: document.getElementById("loanInterestType").value,
    note: document.getElementById("loanNote").value.trim(),
    createdAt: new Date().toISOString()
  };
  state.loans.push(loan);
  event.target.reset();
  closeModals();
  render();
  showToast("Prestamo creado.");
}

function registerPayment() {
  const loanId = els.paymentLoanSelect.value;
  const amount = Number(els.paymentAmount.value);
  const loan = state.loans.find(item => item.id === loanId);
  if (!loan || amount <= 0) {
    showToast("Selecciona un prestamo y escribe un monto valido.");
    return;
  }
  const summary = loanSummary(loan);
  state.payments.push({
    id: uid("payment"),
    loanId,
    date: els.paymentDate.value || today(),
    amount: Math.min(amount, summary.balance),
    createdAt: new Date().toISOString()
  });
  els.paymentAmount.value = "";
  render();
  showToast("Pago registrado.");
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `respaldo-prestamos-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.clients) || !Array.isArray(imported.loans) || !Array.isArray(imported.payments)) {
        throw new Error("Formato invalido");
      }
      state.settings = imported.settings || defaultState().settings;
      state.clients = imported.clients;
      state.loans = imported.loans;
      state.payments = imported.payments;
      render();
      showToast("Respaldo importado.");
    } catch {
      showToast("No se pudo importar el archivo.");
    }
  };
  reader.readAsText(file);
}

function saveSettings() {
  state.settings.currency = els.currencyInput.value.trim() || "$";
  state.settings.company = els.companyInput.value.trim() || "Prestamos Pro";
  render();
  showToast("Configuracion guardada.");
}

function seedDemoData() {
  if (state.clients.length || state.loans.length) {
    const ok = confirm("Esto agregara datos demo a los datos actuales. Continuar?");
    if (!ok) return;
  }
  const c1 = { id: uid("client"), name: "Maria Alvarez", document: "001-1234567-8", phone: "809-555-0120", address: "Santo Domingo", createdAt: new Date().toISOString() };
  const c2 = { id: uid("client"), name: "Carlos Mendez", document: "402-7654321-0", phone: "829-555-0144", address: "Santiago", createdAt: new Date().toISOString() };
  state.clients.push(c1, c2);
  const loan1 = { id: uid("loan"), clientId: c1.id, code: `PRE-${String(state.loans.length + 1).padStart(4, "0")}`, principal: 50000, rate: 12, frequency: "weekly", terms: 10, startDate: addDays(today(), -28), interestType: "flat", note: "", createdAt: new Date().toISOString() };
  const loan2 = { id: uid("loan"), clientId: c2.id, code: `PRE-${String(state.loans.length + 2).padStart(4, "0")}`, principal: 120000, rate: 8, frequency: "monthly", terms: 6, startDate: today(), interestType: "flat", note: "", createdAt: new Date().toISOString() };
  state.loans.push(loan1, loan2);
  state.payments.push({ id: uid("payment"), loanId: loan1.id, date: addDays(today(), -14), amount: 11200, createdAt: new Date().toISOString() });
  render();
  showToast("Datos demo agregados.");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.querySelectorAll("[data-open-modal]").forEach(button => {
  button.addEventListener("click", () => openModal(button.dataset.openModal));
});

document.querySelectorAll("[data-close-modal]").forEach(button => {
  button.addEventListener("click", closeModals);
});

document.querySelectorAll(".modal").forEach(modal => {
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModals();
  });
});

els.navItems.forEach(item => {
  item.addEventListener("click", () => setView(item.dataset.view));
});

document.querySelectorAll("[data-view-shortcut]").forEach(item => {
  item.addEventListener("click", () => setView(item.dataset.viewShortcut));
});

document.getElementById("clientForm").addEventListener("submit", createClient);
document.getElementById("loanForm").addEventListener("submit", createLoan);
document.getElementById("registerPaymentBtn").addEventListener("click", registerPayment);
document.getElementById("exportBtn").addEventListener("click", exportBackup);
document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
document.getElementById("seedBtn").addEventListener("click", seedDemoData);

document.getElementById("importInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importBackup(file);
  event.target.value = "";
});

document.addEventListener("click", event => {
  const loanClientId = event.target.dataset.clientLoan;
  if (loanClientId) {
    openModal("loanModal");
    document.getElementById("loanClient").value = loanClientId;
  }
});

[els.loanSearch, els.loanStatusFilter, els.clientSearch, els.dueFilter, els.dueDateFilter].forEach(control => {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
});

els.paymentDate.value = today();
render();
