const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const state = {
  settings: { currency: "$", company: "Prestamos Pro", lateFeeType: "none", lateFeeValue: 0 },
  clients: [],
  loans: [],
  payments: [],
  users: []
};

let currentUser = null; // { id, email, username, role, companyId }
let session = null;
let dataLoaded = false;

const els = {
  loginScreen: document.getElementById("loginScreen"),
  loginForm: document.getElementById("loginForm"),
  pageTitle: document.getElementById("pageTitle"),
  sessionLabel: document.getElementById("sessionLabel"),
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  toast: document.getElementById("toast"),
  metricPrincipal: document.getElementById("metricPrincipal"),
  metricBalance: document.getElementById("metricBalance"),
  metricInterest: document.getElementById("metricInterest"),
  metricLateFees: document.getElementById("metricLateFees"),
  metricOverdue: document.getElementById("metricOverdue"),
  recentLoansTable: document.getElementById("recentLoansTable"),
  upcomingList: document.getElementById("upcomingList"),
  loanCards: document.getElementById("loanCards"),
  clientsTable: document.getElementById("clientsTable"),
  paymentsTable: document.getElementById("paymentsTable"),
  paymentCount: document.getElementById("paymentCount"),
  paymentLoanSelect: document.getElementById("paymentLoanSelect"),
  dueList: document.getElementById("dueList"),
  loanSearch: document.getElementById("loanSearch"),
  clientSearch: document.getElementById("clientSearch"),
  loanStatusFilter: document.getElementById("loanStatusFilter"),
  dueFilter: document.getElementById("dueFilter"),
  dueDateFilter: document.getElementById("dueDateFilter"),
  reportFrom: document.getElementById("reportFrom"),
  reportTo: document.getElementById("reportTo"),
  reportsTable: document.getElementById("reportsTable"),
  reportCollected: document.getElementById("reportCollected"),
  reportLent: document.getElementById("reportLent"),
  reportInterest: document.getElementById("reportInterest"),
  reportLateClients: document.getElementById("reportLateClients"),
  currencyInput: document.getElementById("currencyInput"),
  companyInput: document.getElementById("companyInput"),
  lateFeeType: document.getElementById("lateFeeType"),
  lateFeeValue: document.getElementById("lateFeeValue"),
  usersTable: document.getElementById("usersTable"),
  paymentDate: document.getElementById("paymentDate"),
  paymentAmount: document.getElementById("paymentAmount"),
  reportFromInput: document.getElementById("reportFrom")
};

function isAdmin() {
  return currentUser?.role === "admin" || currentUser?.role === "owner";
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthStart() {
  return `${today().slice(0, 8)}01`;
}

function money(value) {
  return `${state.settings.currency}${Number(value || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateLabel(dateString) {
  if (!dateString) return "";
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" });
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
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

function inRange(date, from, to) {
  return (!from || date >= from) && (!to || date <= to);
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
  if (loan.interestType === "simple") return principal + principal * rate * Number(loan.terms || 1);
  return principal + principal * rate;
}

function paymentStep(frequency) {
  if (frequency === "weekly") return { type: "days", value: 7 };
  if (frequency === "biweekly") return { type: "days", value: 15 };
  return { type: "months", value: 1 };
}

function lateFeeForInstallment(item) {
  if (item.status !== "overdue") return 0;
  const daysLate = Math.max(daysBetween(item.dueDate, today()), 0);
  const value = Number(state.settings.lateFeeValue || 0);
  if (state.settings.lateFeeType === "fixed") return value;
  if (state.settings.lateFeeType === "daily") return value * daysLate;
  if (state.settings.lateFeeType === "percent") return item.balance * (value / 100);
  return 0;
}

function generateSchedule(loan) {
  const terms = Number(loan.terms || 1);
  const total = totalLoanAmount(loan);
  const amount = total / terms;
  const step = paymentStep(loan.frequency);
  let remainingPaid = totalPaid(loan.id);

  return Array.from({ length: terms }, (_, index) => {
    const dueDate = step.type === "months" ? addMonths(loan.startDate, index + 1) : addDays(loan.startDate, step.value * (index + 1));
    const paidForInstallment = Math.min(amount, Math.max(remainingPaid, 0));
    remainingPaid -= paidForInstallment;
    const balance = Math.max(amount - paidForInstallment, 0);
    const status = balance <= 0 ? "paid" : daysBetween(dueDate, today()) > 0 ? "overdue" : "pending";
    const item = { number: index + 1, dueDate, amount, paid: paidForInstallment, balance, status };
    item.lateFee = lateFeeForInstallment(item);
    return item;
  });
}

function loanSummary(loan) {
  const total = totalLoanAmount(loan);
  const paid = totalPaid(loan.id);
  const schedule = generateSchedule(loan);
  const lateFees = schedule.reduce((sum, item) => sum + item.lateFee, 0);
  const balance = Math.max(total + lateFees - paid, 0);
  const overdue = schedule.filter(item => item.status === "overdue").length;
  const status = balance <= 0 ? "closed" : overdue > 0 ? "late" : "active";
  return {
    total, paid, balance, lateFees,
    interest: total - Number(loan.principal || 0),
    progress: total + lateFees > 0 ? Math.min((paid / (total + lateFees)) * 100, 100) : 0,
    overdue, status,
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
  if (viewId === "settings" && !isAdmin()) {
    showToast("Solo el administrador puede abrir respaldo y configuracion.");
    return;
  }
  els.views.forEach(view => view.classList.toggle("active", view.id === viewId));
  els.navItems.forEach(item => item.classList.toggle("active", item.dataset.view === viewId));
  const active = [...els.navItems].find(item => item.dataset.view === viewId);
  els.pageTitle.textContent = active ? active.textContent : "Inicio";
  render();
}

function applyAuthState() {
  const logged = Boolean(currentUser);
  document.body.classList.toggle("locked", !logged);
  els.loginScreen.classList.toggle("hidden", logged);
  document.querySelectorAll(".admin-only").forEach(item => {
    item.style.display = isAdmin() ? "" : "none";
  });
  els.sessionLabel.textContent = logged ? `${currentUser.username} - ${currentUser.role === "admin" ? "Admin" : currentUser.role === "owner" ? "Dueño" : "Cobrador"}` : "Control financiero";
}

// ------------------------------------------------------------------
// AUTENTICACION (Supabase Auth)
// ------------------------------------------------------------------

async function login(event) {
  event.preventDefault();
  const email = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value;
  const submitBtn = event.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Entrando...";
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      showToast("Correo o clave incorrectos.");
      return;
    }
    await handleSession(data.session);
    event.target.reset();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrar";
  }
}

async function logout() {
  await sb.auth.signOut();
  currentUser = null;
  session = null;
  dataLoaded = false;
  state.clients = []; state.loans = []; state.payments = []; state.users = [];
  applyAuthState();
}

async function handleSession(newSession) {
  session = newSession;
  const { data: profile, error } = await sb
    .from("profiles")
    .select("id, username, role, company_id")
    .eq("id", newSession.user.id)
    .single();

  if (error || !profile) {
    showToast("Tu cuenta no tiene un perfil asignado. Contacta al administrador.");
    await sb.auth.signOut();
    return;
  }

  currentUser = {
    id: profile.id,
    email: newSession.user.email,
    username: profile.username,
    role: profile.role,
    companyId: profile.company_id
  };

  applyAuthState();
  await loadEverything();
}

// ------------------------------------------------------------------
// CARGA DE DATOS DESDE SUPABASE
// ------------------------------------------------------------------

function rowToClient(row) {
  return { id: row.id, name: row.name, document: row.document, phone: row.phone, address: row.address, createdAt: row.created_at };
}

function rowToLoan(row) {
  return {
    id: row.id, clientId: row.client_id, code: row.code, principal: row.principal, rate: row.rate,
    frequency: row.frequency, terms: row.terms, startDate: row.start_date, interestType: row.interest_type,
    note: row.note, createdAt: row.created_at
  };
}

function rowToPayment(row) {
  return { id: row.id, loanId: row.loan_id, date: row.date, amount: row.amount, userId: row.created_by, createdAt: row.created_at };
}

async function loadEverything() {
  if (!currentUser?.companyId) {
    showToast("Tu cuenta no esta vinculada a ninguna empresa todavia.");
    return;
  }
  try {
    const [companyRes, clientsRes, loansRes, paymentsRes, usersRes] = await Promise.all([
      sb.from("companies").select("*").eq("id", currentUser.companyId).single(),
      sb.from("clients").select("*").order("created_at", { ascending: false }),
      sb.from("loans").select("*").order("created_at", { ascending: false }),
      sb.from("payments").select("*").order("date", { ascending: false }),
      sb.from("profiles").select("*").eq("company_id", currentUser.companyId)
    ]);

    if (companyRes.data) {
      state.settings = {
        currency: companyRes.data.currency || "$",
        company: companyRes.data.name || "Prestamos Pro",
        lateFeeType: companyRes.data.late_fee_type || "none",
        lateFeeValue: Number(companyRes.data.late_fee_value || 0)
      };
    }
    state.clients = (clientsRes.data || []).map(rowToClient);
    state.loans = (loansRes.data || []).map(rowToLoan);
    state.payments = (paymentsRes.data || []).map(rowToPayment);
    state.users = usersRes.data || [];

    dataLoaded = true;
    render();
  } catch (e) {
    showToast("No se pudieron cargar los datos. Revisa tu conexion.");
  }
}

// ------------------------------------------------------------------
// MODALES Y NAVEGACION
// ------------------------------------------------------------------

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  if (id === "clientModal") resetClientForm();
  if (id === "loanModal") resetLoanForm();
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
  select.innerHTML = state.clients.map(client => `<option value="${client.id}">${escapeHtml(client.name)}</option>`).join("");
}

// ------------------------------------------------------------------
// RENDER
// ------------------------------------------------------------------

function render() {
  if (!currentUser || !dataLoaded) return;
  renderSettings();
  renderDashboard();
  renderLoans();
  renderClients();
  renderPayments();
  renderDue();
  renderReports();
  renderUsers();
  fillPaymentLoanSelect();
}

function renderSettings() {
  els.currencyInput.value = state.settings.currency;
  els.companyInput.value = state.settings.company;
  els.lateFeeType.value = state.settings.lateFeeType;
  els.lateFeeValue.value = state.settings.lateFeeValue;
  const brandName = document.querySelector(".brand strong");
  if (brandName) brandName.textContent = state.settings.company;
  document.title = state.settings.company;
}

function renderDashboard() {
  const summaries = state.loans.map(loanSummary);
  els.metricPrincipal.textContent = money(state.loans.reduce((sum, loan) => sum + Number(loan.principal || 0), 0));
  els.metricBalance.textContent = money(summaries.reduce((sum, item) => sum + item.balance, 0));
  els.metricInterest.textContent = money(summaries.reduce((sum, item) => sum + item.interest, 0));
  els.metricLateFees.textContent = money(summaries.reduce((sum, item) => sum + item.lateFees, 0));
  els.metricOverdue.textContent = summaries.reduce((sum, item) => sum + item.overdue, 0);

  const recent = [...state.loans].slice(0, 5);
  els.recentLoansTable.innerHTML = recent.length ? recent.map(loan => {
    const client = getClient(loan.clientId);
    const summary = loanSummary(loan);
    return `<tr><td>${escapeHtml(client?.name || "Sin cliente")}</td><td>${money(loan.principal)}</td><td>${money(summary.balance)}</td><td>${statusBadge(summary.status)}</td></tr>`;
  }).join("") : `<tr><td colspan="4">No hay prestamos registrados.</td></tr>`;

  const upcoming = getAllDueItems().filter(item => item.status !== "paid").sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  els.upcomingList.innerHTML = upcoming.length ? upcoming.map(item => `<div class="stack-item">
    <div><strong>${escapeHtml(item.clientName)}</strong><span class="muted">${item.loanCode} - cuota ${item.number}</span></div>
    <div><strong>${money(item.balance + item.lateFee)}</strong><span class="${item.status === "overdue" ? "danger-text" : "muted"}">${dateLabel(item.dueDate)}</span></div>
  </div>`).join("") : `<div class="empty">No hay cobros pendientes.</div>`;
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

  els.loanCards.innerHTML = loans.length ? loans.map(loan => {
    const client = getClient(loan.clientId);
    const summary = loanSummary(loan);
    return `<article class="loan-card">
      <div class="loan-head"><div><h3>${escapeHtml(client?.name || "Sin cliente")}</h3><span class="loan-code">${escapeHtml(loan.code)}</span></div>${statusBadge(summary.status)}</div>
      <div class="loan-stats">
        <div class="mini-stat"><span>Prestado</span><strong>${money(loan.principal)}</strong></div>
        <div class="mini-stat"><span>Balance</span><strong>${money(summary.balance)}</strong></div>
        <div class="mini-stat"><span>Mora</span><strong>${money(summary.lateFees)}</strong></div>
      </div>
      <div class="progress" aria-label="Progreso de pago"><span style="width:${summary.progress}%"></span></div>
      <p class="muted" style="margin:12px 0 0;">${summary.nextDue ? `Proxima cuota: ${dateLabel(summary.nextDue.dueDate)} por ${money(summary.nextDue.balance + summary.nextDue.lateFee)}` : "Prestamo saldado"}</p>
      <div class="action-row">
        <button class="ghost-btn compact-btn" type="button" data-loan-detail="${loan.id}">Detalle</button>
        <button class="ghost-btn compact-btn" type="button" data-loan-edit="${loan.id}">Editar</button>
        <button class="success-btn compact-btn" type="button" data-loan-whatsapp="${loan.id}">WhatsApp</button>
        ${isAdmin() ? `<button class="danger-btn compact-btn" type="button" data-loan-delete="${loan.id}">Eliminar</button>` : ""}
      </div>
    </article>`;
  }).join("") : `<div class="empty">No hay prestamos que coincidan con el filtro.</div>`;
}

function renderClients() {
  const query = els.clientSearch.value.trim().toLowerCase();
  const clients = state.clients.filter(client => `${client.name} ${client.document} ${client.phone}`.toLowerCase().includes(query));
  els.clientsTable.innerHTML = clients.length ? clients.map(client => {
    const count = state.loans.filter(loan => loan.clientId === client.id).length;
    return `<tr>
      <td><strong>${escapeHtml(client.name)}</strong><br><span class="muted">${escapeHtml(client.address || "")}</span></td>
      <td>${escapeHtml(client.document || "-")}</td>
      <td>${escapeHtml(client.phone || "-")}</td>
      <td>${count}</td>
      <td>
        <div class="action-row">
          <button class="ghost-btn compact-btn" type="button" data-client-loan="${client.id}">Prestar</button>
          <button class="ghost-btn compact-btn" type="button" data-client-edit="${client.id}">Editar</button>
          ${isAdmin() ? `<button class="danger-btn compact-btn" type="button" data-client-delete="${client.id}">Eliminar</button>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="5">No hay clientes registrados.</td></tr>`;
}

function fillPaymentLoanSelect() {
  const activeLoans = state.loans.filter(loan => loanSummary(loan).status !== "closed");
  els.paymentLoanSelect.innerHTML = activeLoans.length ? activeLoans.map(loan => {
    const client = getClient(loan.clientId);
    return `<option value="${loan.id}">${escapeHtml(loan.code)} - ${escapeHtml(client?.name || "Sin cliente")}</option>`;
  }).join("") : `<option value="">No hay prestamos activos</option>`;
}

function renderPayments() {
  const payments = [...state.payments].sort((a, b) => b.date.localeCompare(a.date));
  els.paymentCount.textContent = `${payments.length} pagos`;
  els.paymentsTable.innerHTML = payments.length ? payments.map(payment => {
    const loan = state.loans.find(item => item.id === payment.loanId);
    const client = loan ? getClient(loan.clientId) : null;
    return `<tr>
      <td>${dateLabel(payment.date)}</td><td>${escapeHtml(client?.name || "Cliente eliminado")}</td><td>${escapeHtml(loan?.code || "-")}</td><td><strong>${money(payment.amount)}</strong></td>
      <td><button class="ghost-btn compact-btn" type="button" data-payment-receipt="${payment.id}">Recibo</button>${isAdmin() ? ` <button class="danger-btn compact-btn" type="button" data-payment-delete="${payment.id}">Eliminar</button>` : ""}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="5">Todavia no hay pagos registrados.</td></tr>`;
}

function getAllDueItems() {
  return state.loans.flatMap(loan => {
    const client = getClient(loan.clientId);
    return generateSchedule(loan).map(item => ({ ...item, loanId: loan.id, loanCode: loan.code, clientName: client?.name || "Sin cliente", phone: client?.phone || "" }));
  });
}

function renderDue() {
  const filter = els.dueFilter.value;
  const dateFilter = els.dueDateFilter.value;
  const items = getAllDueItems()
    .filter(item => item.status !== "paid")
    .filter(item => !dateFilter || item.dueDate === dateFilter)
    .filter(item => filter === "overdue" ? item.status === "overdue" : filter === "today" ? item.dueDate === today() : filter === "future" ? item.dueDate > today() : true)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  els.dueList.innerHTML = items.length ? items.map(item => `<article class="due-card">
    <div class="due-head"><div><h3>${escapeHtml(item.clientName)}</h3><span class="muted">${escapeHtml(item.loanCode)} - cuota ${item.number}</span></div>${item.status === "overdue" ? statusBadge("late") : statusBadge("active", "Pendiente")}</div>
    <div class="loan-stats"><div class="mini-stat"><span>Fecha</span><strong>${dateLabel(item.dueDate)}</strong></div><div class="mini-stat"><span>Cuota</span><strong>${money(item.balance)}</strong></div><div class="mini-stat"><span>Mora</span><strong>${money(item.lateFee)}</strong></div></div>
    <div class="action-row"><button class="success-btn compact-btn" type="button" data-loan-whatsapp="${item.loanId}">WhatsApp</button><button class="ghost-btn compact-btn" type="button" data-loan-detail="${item.loanId}">Detalle</button></div>
  </article>`).join("") : `<div class="empty">No hay cuotas para este filtro.</div>`;
}

function renderReports() {
  const from = els.reportFrom.value;
  const to = els.reportTo.value;
  const payments = state.payments.filter(payment => inRange(payment.date, from, to));
  const loans = state.loans.filter(loan => inRange((loan.createdAt || loan.startDate).slice(0, 10), from, to));
  const summaries = state.loans.map(loanSummary);
  const lateClients = new Set(state.loans.filter(loan => loanSummary(loan).status === "late").map(loan => loan.clientId)).size;

  els.reportCollected.textContent = money(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  els.reportLent.textContent = money(loans.reduce((sum, loan) => sum + Number(loan.principal || 0), 0));
  els.reportInterest.textContent = money(summaries.reduce((sum, item) => sum + item.interest, 0));
  els.reportLateClients.textContent = lateClients;

  els.reportsTable.innerHTML = state.loans.length ? state.loans.map(loan => {
    const client = getClient(loan.clientId);
    const summary = loanSummary(loan);
    const paidPeriod = payments.filter(payment => payment.loanId === loan.id).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    return `<tr><td>${escapeHtml(client?.name || "Sin cliente")}</td><td>${escapeHtml(loan.code)}</td><td>${money(loan.principal)}</td><td>${money(paidPeriod)}</td><td>${money(summary.balance)}</td><td>${statusBadge(summary.status)}</td></tr>`;
  }).join("") : `<tr><td colspan="6">No hay prestamos para reportar.</td></tr>`;
}

function renderUsers() {
  els.usersTable.innerHTML = state.users.map(user => `<tr>
    <td>${escapeHtml(user.username)}</td><td>${user.role === "admin" ? "Administrador" : user.role === "owner" ? "Dueño" : "Cobrador"}</td>
    <td>${user.id === currentUser.id ? `<span class="muted">Tu cuenta</span>` : `<button class="danger-btn compact-btn" type="button" data-user-delete="${user.id}">Eliminar</button>`}</td>
  </tr>`).join("");
}

function statusBadge(status, label) {
  const labels = { active: "Activo", late: "Atrasado", closed: "Saldado" };
  return `<span class="status ${status}">${label || labels[status] || status}</span>`;
}

function resetClientForm() {
  document.getElementById("clientModalTitle").textContent = "Nuevo cliente";
  document.getElementById("clientForm").reset();
  document.getElementById("clientEditId").value = "";
}

function resetLoanForm() {
  document.getElementById("loanModalTitle").textContent = "Nuevo prestamo";
  document.getElementById("loanForm").reset();
  document.getElementById("loanEditId").value = "";
  fillLoanClientSelect();
  document.getElementById("loanCode").value = `PRE-${String(state.loans.length + 1).padStart(4, "0")}`;
  document.getElementById("loanStartDate").value = today();
}

// ------------------------------------------------------------------
// ESCRITURA EN SUPABASE (clientes, prestamos, pagos)
// ------------------------------------------------------------------

async function saveClient(event) {
  event.preventDefault();
  const id = document.getElementById("clientEditId").value;
  const data = {
    name: document.getElementById("clientName").value.trim(),
    document: document.getElementById("clientDocument").value.trim(),
    phone: document.getElementById("clientPhone").value.trim(),
    address: document.getElementById("clientAddress").value.trim()
  };
  let error;
  if (id) {
    ({ error } = await sb.from("clients").update(data).eq("id", id));
  } else {
    ({ error } = await sb.from("clients").insert({ ...data, company_id: currentUser.companyId }));
  }
  if (error) { showToast("No se pudo guardar el cliente."); return; }
  closeModals();
  await loadEverything();
  showToast("Cliente guardado.");
}

function editClient(id) {
  const client = getClient(id);
  if (!client) return;
  closeModals();
  openModal("clientModal");
  document.getElementById("clientModalTitle").textContent = "Editar cliente";
  document.getElementById("clientEditId").value = client.id;
  document.getElementById("clientName").value = client.name;
  document.getElementById("clientDocument").value = client.document || "";
  document.getElementById("clientPhone").value = client.phone || "";
  document.getElementById("clientAddress").value = client.address || "";
}

async function deleteClient(id) {
  if (!isAdmin()) return;
  if (state.loans.some(loan => loan.clientId === id)) {
    showToast("No puedes eliminar un cliente con prestamos.");
    return;
  }
  if (!confirm("Eliminar cliente permanentemente?")) return;
  const { error } = await sb.from("clients").delete().eq("id", id);
  if (error) { showToast("No se pudo eliminar."); return; }
  await loadEverything();
}

async function saveLoan(event) {
  event.preventDefault();
  const clientId = document.getElementById("loanClient").value;
  if (!clientId) {
    showToast("Registra un cliente antes de crear el prestamo.");
    return;
  }
  const id = document.getElementById("loanEditId").value;
  const data = {
    client_id: clientId,
    code: document.getElementById("loanCode").value,
    principal: Number(document.getElementById("loanPrincipal").value),
    rate: Number(document.getElementById("loanRate").value),
    frequency: document.getElementById("loanFrequency").value,
    terms: Number(document.getElementById("loanTerms").value),
    start_date: document.getElementById("loanStartDate").value,
    interest_type: document.getElementById("loanInterestType").value,
    note: document.getElementById("loanNote").value.trim()
  };
  let error;
  if (id) {
    ({ error } = await sb.from("loans").update(data).eq("id", id));
  } else {
    ({ error } = await sb.from("loans").insert({ ...data, company_id: currentUser.companyId, created_by: currentUser.id }));
  }
  if (error) { showToast("No se pudo guardar el prestamo."); return; }
  closeModals();
  await loadEverything();
  showToast("Prestamo guardado.");
}

function editLoan(id) {
  const loan = state.loans.find(item => item.id === id);
  if (!loan) return;
  closeModals();
  openModal("loanModal");
  document.getElementById("loanModalTitle").textContent = "Editar prestamo";
  document.getElementById("loanEditId").value = loan.id;
  document.getElementById("loanClient").value = loan.clientId;
  document.getElementById("loanCode").value = loan.code;
  document.getElementById("loanPrincipal").value = loan.principal;
  document.getElementById("loanRate").value = loan.rate;
  document.getElementById("loanFrequency").value = loan.frequency;
  document.getElementById("loanTerms").value = loan.terms;
  document.getElementById("loanStartDate").value = loan.startDate;
  document.getElementById("loanInterestType").value = loan.interestType;
  document.getElementById("loanNote").value = loan.note || "";
}

async function deleteLoan(id) {
  if (!isAdmin()) { showToast("Solo el administrador puede eliminar prestamos."); return; }
  if (!confirm("Eliminar prestamo y sus pagos?")) return;
  const { error } = await sb.from("loans").delete().eq("id", id);
  if (error) { showToast("No se pudo eliminar."); return; }
  await loadEverything();
}

async function registerPayment() {
  const loanId = els.paymentLoanSelect.value;
  const amount = Number(els.paymentAmount.value);
  const loan = state.loans.find(item => item.id === loanId);
  if (!loan || amount <= 0) {
    showToast("Selecciona un prestamo y escribe un monto valido.");
    return;
  }
  const summary = loanSummary(loan);
  const paymentData = {
    loan_id: loanId,
    company_id: currentUser.companyId,
    date: els.paymentDate.value || today(),
    amount: Math.min(amount, summary.balance),
    created_by: currentUser.id
  };
  const { data, error } = await sb.from("payments").insert(paymentData).select().single();
  if (error) { showToast("No se pudo registrar el pago."); return; }
  els.paymentAmount.value = "";
  await loadEverything();
  showToast("Pago registrado.");
  showReceipt(data.id);
}

async function deletePayment(id) {
  if (!isAdmin() || !confirm("Eliminar este pago?")) return;
  const { error } = await sb.from("payments").delete().eq("id", id);
  if (error) { showToast("No se pudo eliminar."); return; }
  await loadEverything();
}

function showLoanDetail(id) {
  const loan = state.loans.find(item => item.id === id);
  const client = loan ? getClient(loan.clientId) : null;
  if (!loan || !client) return;
  const summary = loanSummary(loan);
  const scheduleRows = generateSchedule(loan).map(item => `<tr><td>${item.number}</td><td>${dateLabel(item.dueDate)}</td><td>${money(item.amount)}</td><td>${money(item.paid)}</td><td>${money(item.lateFee)}</td><td>${statusBadge(item.status === "paid" ? "closed" : item.status === "overdue" ? "late" : "active", item.status === "paid" ? "Pagada" : item.status === "overdue" ? "Vencida" : "Pendiente")}</td></tr>`).join("");
  const paymentRows = loanPayments(loan.id).map(payment => `<tr><td>${dateLabel(payment.date)}</td><td>${money(payment.amount)}</td><td><button class="ghost-btn compact-btn" type="button" data-payment-receipt="${payment.id}">Recibo</button></td></tr>`).join("");
  document.getElementById("loanDetailTitle").textContent = `${client.name} - ${loan.code}`;
  document.getElementById("loanDetailContent").innerHTML = `
    <div class="detail-grid">
      <div class="detail-box"><span>Total</span><strong>${money(summary.total)}</strong></div>
      <div class="detail-box"><span>Pagado</span><strong>${money(summary.paid)}</strong></div>
      <div class="detail-box"><span>Mora</span><strong>${money(summary.lateFees)}</strong></div>
      <div class="detail-box"><span>Balance</span><strong>${money(summary.balance)}</strong></div>
    </div>
    <div class="action-row no-print"><button class="success-btn compact-btn" type="button" data-loan-whatsapp="${loan.id}">Enviar WhatsApp</button><button class="ghost-btn compact-btn" type="button" data-loan-edit="${loan.id}">Editar</button></div>
    <h2>Plan de cuotas</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>Fecha</th><th>Cuota</th><th>Pagado</th><th>Mora</th><th>Estado</th></tr></thead><tbody>${scheduleRows}</tbody></table></div>
    <h2 style="margin-top:18px;">Pagos</h2><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Monto</th><th>Accion</th></tr></thead><tbody>${paymentRows || `<tr><td colspan="3">Sin pagos.</td></tr>`}</tbody></table></div>
    <p class="muted" style="margin-top:14px;">Nota: ${escapeHtml(loan.note || "Sin nota")}</p>`;
  document.getElementById("loanDetailModal").classList.add("open");
}

function showReceipt(paymentId) {
  const payment = state.payments.find(item => item.id === paymentId);
  const loan = payment ? state.loans.find(item => item.id === payment.loanId) : null;
  const client = loan ? getClient(loan.clientId) : null;
  if (!payment || !loan || !client) return;
  const summary = loanSummary(loan);
  document.getElementById("receiptContent").innerHTML = `<div class="receipt">
    <h2>${escapeHtml(state.settings.company)}</h2>
    <p class="muted" style="text-align:center;">Recibo de pago</p>
    <div class="receipt-meta">
      <strong>Recibo: ${escapeHtml(payment.id.slice(-8).toUpperCase())}</strong>
      <span>Fecha: ${dateLabel(payment.date)}</span>
      <span>Cliente: ${escapeHtml(client.name)}</span>
      <span>Documento: ${escapeHtml(client.document || "-")}</span>
      <span>Prestamo: ${escapeHtml(loan.code)}</span>
    </div>
    <div class="receipt-total">${money(payment.amount)}</div>
    <div class="receipt-meta">
      <span>Balance restante: ${money(summary.balance)}</span>
      <span>Registrado por: ${escapeHtml(currentUser?.username || "usuario")}</span>
    </div>
    <div class="signature-line">Firma autorizada</div>
  </div>`;
  document.getElementById("receiptModal").classList.add("open");
}

function sendWhatsApp(loanId) {
  const loan = state.loans.find(item => item.id === loanId);
  const client = loan ? getClient(loan.clientId) : null;
  if (!loan || !client) return;
  const summary = loanSummary(loan);
  const next = summary.nextDue;
  const phone = String(client.phone || "").replace(/\D/g, "");
  if (!phone) {
    showToast("Este cliente no tiene telefono.");
    return;
  }
  const msg = `Hola ${client.name}, le recordamos su prestamo ${loan.code}. ${next ? `Proxima cuota: ${money(next.balance + next.lateFee)} vence el ${dateLabel(next.dueDate)}.` : ""} Balance actual: ${money(summary.balance)}.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `respaldo-${state.settings.company || "prestamos"}-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Importa un respaldo viejo (formato localStorage) hacia Supabase, re-creando IDs.
async function importBackup(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.clients) || !Array.isArray(imported.loans) || !Array.isArray(imported.payments)) throw new Error("Formato invalido");

      showToast("Importando datos, no cierres esta pestaña...");
      const clientIdMap = {};
      for (const client of imported.clients) {
        const { data, error } = await sb.from("clients").insert({
          company_id: currentUser.companyId, name: client.name, document: client.document, phone: client.phone, address: client.address
        }).select().single();
        if (!error) clientIdMap[client.id] = data.id;
      }

      const loanIdMap = {};
      for (const loan of imported.loans) {
        const newClientId = clientIdMap[loan.clientId];
        if (!newClientId) continue;
        const { data, error } = await sb.from("loans").insert({
          company_id: currentUser.companyId, client_id: newClientId, code: loan.code, principal: loan.principal,
          rate: loan.rate, frequency: loan.frequency, terms: loan.terms, start_date: loan.startDate,
          interest_type: loan.interestType, note: loan.note, created_by: currentUser.id
        }).select().single();
        if (!error) loanIdMap[loan.id] = data.id;
      }

      for (const payment of imported.payments) {
        const newLoanId = loanIdMap[payment.loanId];
        if (!newLoanId) continue;
        await sb.from("payments").insert({
          company_id: currentUser.companyId, loan_id: newLoanId, date: payment.date, amount: payment.amount, created_by: currentUser.id
        });
      }

      await loadEverything();
      showToast("Respaldo importado.");
    } catch {
      showToast("No se pudo importar el archivo.");
    }
  };
  reader.readAsText(file);
}

async function saveSettings() {
  if (!isAdmin()) return;
  const data = {
    currency: els.currencyInput.value.trim() || "$",
    name: els.companyInput.value.trim() || "Prestamos Pro",
    late_fee_type: els.lateFeeType.value,
    late_fee_value: Number(els.lateFeeValue.value || 0)
  };
  const { error } = await sb.from("companies").update(data).eq("id", currentUser.companyId);
  if (error) { showToast("No se pudo guardar la configuracion."); return; }
  await loadEverything();
  showToast("Configuracion guardada.");
}

async function callManageUser(payload) {
  const res = await fetch(`${window.SUPABASE_URL}/functions/v1/manage-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload)
  });
  return res.json();
}

async function createUser(event) {
  event.preventDefault();
  if (!isAdmin()) return;
  const username = document.getElementById("newUserName").value.trim();
  const email = document.getElementById("newUserEmail").value.trim();
  const pass = document.getElementById("newUserPass").value;
  const role = document.getElementById("newUserRole").value;
  if (!email || pass.length < 6) {
    showToast("Escribe un correo valido y una clave de al menos 6 caracteres.");
    return;
  }
  const result = await callManageUser({ action: "create_user", email, password: pass, username, role });
  if (result.error) { showToast(result.error); return; }
  event.target.reset();
  await loadEverything();
  showToast("Usuario creado.");
}

async function deleteUser(id) {
  if (!isAdmin()) return;
  if (!confirm("Eliminar este usuario?")) return;
  const result = await callManageUser({ action: "delete_user", userId: id });
  if (result.error) { showToast(result.error); return; }
  await loadEverything();
}

function printReport() {
  window.print();
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

document.querySelectorAll("[data-open-modal]").forEach(button => button.addEventListener("click", () => openModal(button.dataset.openModal)));
document.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", closeModals));
document.querySelectorAll(".modal").forEach(modal => modal.addEventListener("click", event => { if (event.target === modal) closeModals(); }));
els.navItems.forEach(item => item.addEventListener("click", () => setView(item.dataset.view)));
document.querySelectorAll("[data-view-shortcut]").forEach(item => item.addEventListener("click", () => setView(item.dataset.viewShortcut)));

els.loginForm.addEventListener("submit", login);
document.getElementById("logoutBtn").addEventListener("click", logout);
document.getElementById("clientForm").addEventListener("submit", saveClient);
document.getElementById("loanForm").addEventListener("submit", saveLoan);
document.getElementById("registerPaymentBtn").addEventListener("click", registerPayment);
document.getElementById("exportBtn").addEventListener("click", exportBackup);
document.getElementById("saveSettingsBtn").addEventListener("click", saveSettings);
document.getElementById("userForm").addEventListener("submit", createUser);
document.getElementById("printReceiptBtn").addEventListener("click", () => window.print());
document.getElementById("printReportBtn").addEventListener("click", printReport);
document.getElementById("importInput").addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) importBackup(file);
  event.target.value = "";
});

document.addEventListener("click", event => {
  const target = event.target;
  if (target.dataset.clientLoan) { openModal("loanModal"); document.getElementById("loanClient").value = target.dataset.clientLoan; }
  if (target.dataset.clientEdit) editClient(target.dataset.clientEdit);
  if (target.dataset.clientDelete) deleteClient(target.dataset.clientDelete);
  if (target.dataset.loanDetail) showLoanDetail(target.dataset.loanDetail);
  if (target.dataset.loanEdit) editLoan(target.dataset.loanEdit);
  if (target.dataset.loanDelete) deleteLoan(target.dataset.loanDelete);
  if (target.dataset.loanWhatsapp) sendWhatsApp(target.dataset.loanWhatsapp);
  if (target.dataset.paymentReceipt) showReceipt(target.dataset.paymentReceipt);
  if (target.dataset.paymentDelete) deletePayment(target.dataset.paymentDelete);
  if (target.dataset.userDelete) deleteUser(target.dataset.userDelete);
});

[els.loanSearch, els.loanStatusFilter, els.clientSearch, els.dueFilter, els.dueDateFilter, els.reportFrom, els.reportTo].forEach(control => {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
});

els.paymentDate.value = today();
els.reportFrom.value = monthStart();
els.reportTo.value = today();
applyAuthState();

// Restaurar sesion si ya habia una activa (recargar pagina, volver despues)
sb.auth.getSession().then(({ data }) => {
  if (data.session) handleSession(data.session);
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
