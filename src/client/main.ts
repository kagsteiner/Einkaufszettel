import { ApiError, api, apiFile } from "./api.ts";
import "./styles.css";
import type { AppState, ShoppingItem, ShoppingList, User } from "./types.ts";

const appElement = document.querySelector<HTMLElement>("#app");
if (!appElement) {
  throw new Error("App-Container fehlt.");
}
const app: HTMLElement = appElement;

const categoryIcons: Readonly<Record<string, string>> = {
  bakery: "🥖",
  canned: "🥫",
  dairy: "🥛",
  drinks: "🧃",
  frozen: "❄️",
  household: "🧽",
  meat: "🥩",
  other: "🛒",
  pet: "🐾",
  produce: "🥬",
  spices: "🌿",
  staples: "🍚",
};
const categoryLabels: Readonly<Record<string, string>> = {
  bakery: "Brot & Backwaren",
  canned: "Konserven",
  dairy: "Milchprodukte",
  drinks: "Getränke",
  frozen: "Tiefkühlkost",
  household: "Haushalt",
  meat: "Fleisch & Alternativen",
  other: "Sonstiges",
  pet: "Tiernahrung",
  produce: "Obst & Gemüse",
  spices: "Gewürze",
  staples: "Grundnahrungsmittel",
};

let currentUser: User | null = null;
let currentState: AppState | null = null;
let activeListId = localStorage.getItem("active-list-id");
let sortMode: "alphabetical" | "store" =
  localStorage.getItem("sort-mode") === "store" ? "store" : "alphabetical";
let eventSource: EventSource | null = null;
let refreshPending = false;
let refreshQueued = false;

void boot();

async function boot(): Promise<void> {
  app.innerHTML = loadingMarkup("Einkaufszettel wird geöffnet …");
  try {
    currentUser = (await api<{ user: User }>("/api/session")).user;
    await openApplication();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      renderAuthentication("login");
      return;
    }
    renderFatalError(error);
  }
}

function renderAuthentication(mode: "login" | "register", message = ""): void {
  closeEventStream();
  const registering = mode === "register";
  app.innerHTML = `
    <div class="auth-layout">
      <section class="auth-intro">
        <div class="brand-mark" aria-hidden="true">✓</div>
        <p class="eyebrow">Gemeinsam einkaufen</p>
        <h1>Unser<br>Einkaufszettel</h1>
        <p>Ein klassischer Zettel, der bei allen im Haushalt gleichzeitig aktuell bleibt.</p>
      </section>
      <section class="auth-card paper-card">
        <div class="segmented" role="tablist" aria-label="Konto">
          <button type="button" data-auth-mode="login" class="${registering ? "" : "active"}">Anmelden</button>
          <button type="button" data-auth-mode="register" class="${registering ? "active" : ""}">Neu hier</button>
        </div>
        <form data-auth-form data-mode="${mode}">
          <h2>${registering ? "Konto anlegen" : "Willkommen zurück"}</h2>
          ${
            registering
              ? `<label>Name<input name="displayName" autocomplete="name" maxlength="80" required></label>`
              : ""
          }
          <label>E-Mail<input name="email" type="email" autocomplete="email" maxlength="320" required></label>
          <label>Passwort<input name="password" type="password" autocomplete="${
            registering ? "new-password" : "current-password"
          }" minlength="12" required></label>
          <p class="form-hint">${registering ? "Mindestens 12 Zeichen; Satzzeichen-Zwang gibt es nicht." : ""}</p>
          <p class="form-error" role="alert">${escapeHtml(message)}</p>
          <button class="primary-button" type="submit">${registering ? "Loslegen" : "Anmelden"}</button>
        </form>
      </section>
    </div>`;

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-auth-mode]")) {
    button.addEventListener("click", () =>
      renderAuthentication(button.dataset.authMode === "register" ? "register" : "login"),
    );
  }
  app.querySelector<HTMLFormElement>("[data-auth-form]")?.addEventListener("submit", (event) => {
    void submitAuthentication(event);
  });
}

async function submitAuthentication(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]");
  setBusy(submit, true);
  const values = new FormData(form);
  const mode = form.dataset.mode === "register" ? "register" : "login";
  try {
    const payload = await api<{ user: User }>(`/api/auth/${mode}`, {
      body: {
        displayName: values.get("displayName"),
        email: values.get("email"),
        password: values.get("password"),
      },
      method: "POST",
    });
    currentUser = payload.user;
    await openApplication();
  } catch (error) {
    renderAuthentication(mode, messageFromError(error));
  } finally {
    setBusy(submit, false);
  }
}

async function openApplication(): Promise<void> {
  await refreshState(false);
  openEventStream();
  await handleInvitationPath();
}

async function refreshState(preserveFocus = true): Promise<void> {
  if (refreshPending) {
    refreshQueued = true;
    return;
  }
  refreshPending = true;
  const focusedName = preserveFocus
    ? (document.activeElement as HTMLInputElement | null)?.name || null
    : null;
  const quickAddDraft = preserveFocus
    ? Object.fromEntries(
        [...document.querySelectorAll<HTMLInputElement>("[data-add-item] input")].map((input) => [
          input.name,
          input.value,
        ]),
      )
    : null;
  try {
    currentState = await api<AppState>("/api/state");
    if (!currentState.lists.some((list) => list.id === activeListId)) {
      activeListId = currentState.lists[0]?.id || null;
    }
    if (activeListId) {
      localStorage.setItem("active-list-id", activeListId);
    }
    renderApplication();
    if (focusedName) {
      document.querySelector<HTMLInputElement>(`[name="${focusedName}"]`)?.focus();
    }
    if (quickAddDraft) {
      for (const [name, value] of Object.entries(quickAddDraft)) {
        const input = document.querySelector<HTMLInputElement>(`[data-add-item] [name="${name}"]`);
        if (input) {
          input.value = value;
        }
      }
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      currentUser = null;
      currentState = null;
      renderAuthentication("login", "Deine Sitzung ist abgelaufen.");
      return;
    }
    showToast(messageFromError(error), "error");
  } finally {
    refreshPending = false;
    if (refreshQueued) {
      refreshQueued = false;
      void refreshState(preserveFocus);
    }
  }
}

function renderApplication(): void {
  if (!currentUser || !currentState) {
    return;
  }
  const activeList = currentState.lists.find((list) => list.id === activeListId) || null;
  app.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <button class="wordmark" type="button" aria-label="Zur Zettelübersicht">
          <span aria-hidden="true">✓</span><strong>Zettel</strong>
        </button>
        <div class="household-title">
          <strong>${escapeHtml(currentState.household.name)}</strong>
          <span>${currentState.household.members.length} ${currentState.household.members.length === 1 ? "Person" : "Personen"}</span>
        </div>
        <button class="icon-button" type="button" data-open-settings aria-label="Einstellungen">⚙</button>
      </header>
      <nav class="list-tabs" aria-label="Einkaufszettel">
        ${currentState.lists
          .map(
            (list) =>
              `<button type="button" data-list-id="${escapeHtml(list.id)}" class="${
                list.id === activeListId ? "active" : ""
              }">${escapeHtml(list.name)}<span>${list.items.filter((item) => !item.completedAt).length}</span></button>`,
          )
          .join("")}
        <button class="add-list-tab" type="button" data-add-list aria-label="Neuen Zettel anlegen">＋</button>
      </nav>
      ${activeList ? listMarkup(activeList) : emptyListsMarkup()}
    </div>
  `;
  bindApplicationEvents(activeList);
}

function listMarkup(list: ShoppingList): string {
  const activeItems = list.items.filter((item) => !item.completedAt);
  const completedItems = list.items.filter((item) => item.completedAt);
  return `
    <main class="list-paper">
      <header class="list-heading">
        <div class="list-title">${list.imageId ? `<img src="/api/images/${escapeHtml(list.imageId)}" alt="">` : ""}<div><p class="eyebrow">Einkaufszettel</p><h1>${escapeHtml(list.name)}</h1></div></div>
        <div class="heading-actions"><button class="quiet-button sort-button" type="button" data-sort-mode aria-label="Sortierung wechseln">${sortMode === "alphabetical" ? "A–Z" : "Laden"}</button><label class="quiet-button recipe-button"><span class="desktop-label">Rezeptfoto</span><span class="mobile-label">Foto</span><input type="file" data-recipe-file accept="image/*,.heic,.heif"></label><button class="quiet-button" type="button" data-list-menu aria-label="Zettel bearbeiten"><span class="desktop-label">Bearbeiten</span><span class="mobile-label" aria-hidden="true">•••</span></button></div>
      </header>
      <section class="shopping-items" aria-label="Offene Produkte">
        ${
          activeItems.length
            ? openItemsMarkup(activeItems)
            : `<div class="empty-note"><span aria-hidden="true">✓</span><strong>Alles erledigt</strong><p>Füge unten etwas hinzu, sobald euch wieder etwas einfällt.</p></div>`
        }
      </section>
      ${
        completedItems.length
          ? `<details class="completed-items"><summary>${completedItems.length} erledigt</summary>${completedItems
              .map(itemMarkup)
              .join("")}</details>`
          : ""
      }
      <form class="quick-add" data-add-item>
        <label class="product-field"><span>Produkt</span><input name="name" maxlength="120" placeholder="Was fehlt?" autocomplete="off" required></label>
        <label class="amount-field"><span>Menge</span><input name="amount" inputmode="decimal" placeholder="2"></label>
        <label class="unit-field"><span>Einheit</span><input name="unit" maxlength="40" placeholder="Stück"></label>
        <button class="round-add" type="submit" aria-label="Zum Zettel hinzufügen">＋</button>
      </form>
    </main>`;
}

function openItemsMarkup(items: ReadonlyArray<ShoppingItem>): string {
  if (sortMode === "alphabetical") {
    return [...items]
      .sort((left, right) => left.name.localeCompare(right.name, "de", { sensitivity: "base" }))
      .map(itemMarkup)
      .join("");
  }
  const sections = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const section = sections.get(item.category) || [];
    section.push(item);
    sections.set(item.category, section);
  }
  return [...sections]
    .map(
      ([category, section]) =>
        `<div class="category-heading">${escapeHtml(categoryLabels[category] || "Sonstiges")}</div>${section.map(itemMarkup).join("")}`,
    )
    .join("");
}

function itemMarkup(item: ShoppingItem): string {
  const quantities = item.quantities
    .map(
      (quantity) =>
        `${escapeHtml(formatAmount(quantity.amount))}${quantity.unit ? ` ${escapeHtml(formatUnit(quantity.unit, quantity.amount))}` : ""}`,
    )
    .join(" + ");
  return `<article class="shopping-row ${item.completedAt ? "completed" : ""}" data-item-id="${escapeHtml(item.id)}">
    <button class="check-button" type="button" data-toggle-item aria-label="${
      item.completedAt ? "Wieder auf die Liste setzen" : "Als erledigt markieren"
    }"><span aria-hidden="true">✓</span></button>
    <button class="item-image ${item.imageId ? "" : "fallback"}" type="button" ${item.imageId ? "data-preview-image" : "data-edit-item"} aria-label="${escapeHtml(item.imageId ? `${item.name} Bild ansehen` : `${item.name} bearbeiten`)}">${item.imageId ? `<img src="/api/images/${escapeHtml(item.imageId)}" alt="">` : categoryIcons[item.category] || "🛒"}</button>
    <button class="item-copy" type="button" data-edit-item>
      <strong>${escapeHtml(item.name)}</strong>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
    </button>
    <span class="item-quantity">${quantities || "–"}</span>
  </article>`;
}

function emptyListsMarkup(): string {
  return `<main class="empty-lists paper-card">
    <div class="brand-mark" aria-hidden="true">＋</div>
    <h1>Dein erster Zettel</h1>
    <p>Lege zum Beispiel „Supermarkt“, „Drogerie“ oder „Baumarkt“ an.</p>
    <button class="primary-button" type="button" data-add-list>Zettel anlegen</button>
  </main>`;
}

function bindApplicationEvents(activeList: ShoppingList | null): void {
  for (const tab of app.querySelectorAll<HTMLButtonElement>("[data-list-id]")) {
    tab.addEventListener("click", () => {
      activeListId = tab.dataset.listId || null;
      if (activeListId) {
        localStorage.setItem("active-list-id", activeListId);
      }
      renderApplication();
    });
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-add-list]")) {
    button.addEventListener("click", () => void openListDialog());
  }
  app
    .querySelector<HTMLButtonElement>("[data-open-settings]")
    ?.addEventListener("click", () => openSettingsDialog());
  app.querySelector<HTMLButtonElement>("[data-list-menu]")?.addEventListener("click", () => {
    if (activeList) {
      void openListDialog(activeList);
    }
  });
  app.querySelector<HTMLButtonElement>("[data-sort-mode]")?.addEventListener("click", () => {
    sortMode = sortMode === "alphabetical" ? "store" : "alphabetical";
    localStorage.setItem("sort-mode", sortMode);
    renderApplication();
  });
  app.querySelector<HTMLFormElement>("[data-add-item]")?.addEventListener("submit", (event) => {
    if (activeList) {
      void submitItem(event, activeList.id);
    }
  });
  app.querySelector<HTMLInputElement>("[data-recipe-file]")?.addEventListener("change", (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file && activeList) {
      void analyzeRecipe(file, activeList.id);
    }
  });
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-toggle-item]")) {
    button.addEventListener(
      "click",
      () => void toggleItem(button.closest<HTMLElement>("[data-item-id]")),
    );
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-edit-item]")) {
    button.addEventListener("click", () => {
      const id = button.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
      const item = activeList?.items.find((candidate) => candidate.id === id);
      if (item) {
        openItemDialog(item);
      }
    });
  }
  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-preview-image]")) {
    button.addEventListener("click", () => {
      const id = button.closest<HTMLElement>("[data-item-id]")?.dataset.itemId;
      const item = activeList?.items.find((candidate) => candidate.id === id);
      if (item?.imageId) {
        openImagePreview(item);
      }
    });
  }
}

async function submitItem(event: SubmitEvent, listId: string): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const values = new FormData(form);
  const amount = String(values.get("amount") || "").trim();
  const unit = String(values.get("unit") || "").trim();
  if (!amount && unit) {
    showToast("Gib zur Einheit auch eine Menge ein.", "error");
    return;
  }
  try {
    const result = await api<{
      merge: "appended" | "created" | "increased" | "reactivated" | "unchanged";
    }>(`/api/lists/${encodeURIComponent(listId)}/items`, {
      body: {
        name: values.get("name"),
        quantities: amount ? [{ amount, unit }] : undefined,
      },
      method: "POST",
    });
    form.reset();
    await refreshState(false);
    const messages = {
      appended: "Zusätzliche Einheit ergänzt – bitte kurz prüfen.",
      created: "Zum Zettel hinzugefügt.",
      increased: "Vorhandene Menge wurde erhöht.",
      reactivated: "Erneut mit der neuen Menge auf den Zettel gesetzt.",
      unchanged: "Das Produkt stand bereits auf dem Zettel.",
    };
    showToast(messages[result.merge]);
    form.querySelector<HTMLInputElement>("[name=name]")?.focus();
  } catch (error) {
    showToast(messageFromError(error), "error");
  }
}

async function toggleItem(row: HTMLElement | null): Promise<void> {
  const itemId = row?.dataset.itemId;
  const list = currentState?.lists.find((candidate) => candidate.id === activeListId);
  const item = list?.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    return;
  }
  row?.classList.toggle("leaving", !item.completedAt);
  try {
    await api(`/api/items/${encodeURIComponent(item.id)}/completed`, {
      body: { completed: !item.completedAt },
      method: "PUT",
    });
    await refreshState(false);
  } catch (error) {
    row?.classList.remove("leaving");
    showToast(messageFromError(error), "error");
  }
}

async function openListDialog(list?: ShoppingList): Promise<void> {
  const dialog = createDialog(`
    <form method="dialog" class="dialog-form" data-list-form>
      <div class="dialog-heading"><div><p class="eyebrow">Zettel</p><h2>${list ? "Zettel bearbeiten" : "Neuer Zettel"}</h2></div><button class="close-button" type="button" data-close aria-label="Schließen">×</button></div>
      <label>Name<input name="name" maxlength="80" value="${escapeHtml(list?.name || "")}" required></label>
      <label>Bild (optional)<input name="image" type="file" accept="image/*,.heic,.heif"></label>
      ${list?.imageId ? `<label class="check-label"><input type="checkbox" name="removeImage"> Vorhandenes Bild entfernen</label>` : ""}
      <p class="form-error" role="alert"></p>
      <div class="dialog-actions">
        ${list ? `<button class="danger-button" type="button" data-delete-list>Löschen</button>` : ""}
        <button class="primary-button" type="submit">Speichern</button>
      </div>
    </form>`);
  dialog.querySelector<HTMLFormElement>("[data-list-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        const form = event.currentTarget as HTMLFormElement;
        const formData = new FormData(form);
        const name = formData.get("name");
        const payload = await api<{ list: { id: string } }>(
          list ? `/api/lists/${list.id}` : "/api/lists",
          {
            body: { name },
            method: list ? "PATCH" : "POST",
          },
        );
        const imageFile = formData.get("image");
        if (imageFile instanceof File && imageFile.size > 0) {
          const uploaded = await apiFile<{ image: { id: string } }>("/api/images", imageFile);
          await api(`/api/lists/${payload.list.id}/image`, {
            body: { imageId: uploaded.image.id },
            method: "PUT",
          });
        } else if (list && formData.get("removeImage")) {
          await api(`/api/lists/${payload.list.id}/image`, {
            body: { imageId: null },
            method: "PUT",
          });
        }
        activeListId = payload.list.id;
        dialog.close();
        await refreshState(false);
      } catch (error) {
        setDialogError(dialog, messageFromError(error));
      }
    })();
  });
  dialog.querySelector<HTMLButtonElement>("[data-delete-list]")?.addEventListener("click", () => {
    if (!list || !window.confirm(`„${list.name}“ mit allen Produkten löschen?`)) {
      return;
    }
    void (async () => {
      try {
        await api(`/api/lists/${list.id}`, { method: "DELETE" });
        dialog.close();
        await refreshState(false);
      } catch (error) {
        setDialogError(dialog, messageFromError(error));
      }
    })();
  });
  dialog.showModal();
  dialog.querySelector<HTMLInputElement>("input")?.focus();
}

function openItemDialog(item: ShoppingItem): void {
  const quantityInputs = [...item.quantities, { id: "", amount: "", unit: "" }]
    .map(
      (quantity) =>
        `<div class="quantity-edit-row"><input name="amount" inputmode="decimal" value="${escapeHtml(quantity.amount)}" placeholder="Menge"><input name="unit" value="${escapeHtml(quantity.unit)}" maxlength="40" placeholder="Einheit"></div>`,
    )
    .join("");
  const dialog = createDialog(`
    <form method="dialog" class="dialog-form" data-item-form>
      <div class="dialog-heading"><div><p class="eyebrow">Produkt</p><h2>Eintrag bearbeiten</h2></div><button class="close-button" type="button" data-close aria-label="Schließen">×</button></div>
      <label>Name<input name="name" maxlength="120" value="${escapeHtml(item.name)}" required></label>
      <label>Notiz<textarea name="note" maxlength="500" rows="2">${escapeHtml(item.note || "")}</textarea></label>
      <label>Einkaufsbereich<select name="category">${Object.entries(categoryLabels)
        .map(
          ([value, label]) =>
            `<option value="${escapeHtml(value)}" ${item.category === value ? "selected" : ""}>${escapeHtml(label)}</option>`,
        )
        .join("")}</select></label>
      <label>Foto<input name="image" type="file" accept="image/*,.heic,.heif"></label>
      ${item.imageId ? `<label class="check-label"><input type="checkbox" name="removeImage"> Vorhandenes Foto entfernen</label>` : ""}
      <fieldset><legend>Mengen</legend>${quantityInputs}</fieldset>
      <p class="form-error" role="alert"></p>
      <div class="dialog-actions"><button class="danger-button" type="button" data-delete-item>Löschen</button><button class="primary-button" type="submit">Speichern</button></div>
    </form>`);
  dialog.querySelector<HTMLFormElement>("[data-item-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      const form = event.currentTarget as HTMLFormElement;
      const amounts = [...form.querySelectorAll<HTMLInputElement>("[name=amount]")];
      const units = [...form.querySelectorAll<HTMLInputElement>("[name=unit]")];
      const quantities = amounts
        .map((amount, index) => ({
          amount: amount.value.trim(),
          unit: units[index]?.value.trim() || "",
        }))
        .filter((quantity) => quantity.amount);
      try {
        const formData = new FormData(form);
        await api(`/api/items/${item.id}`, {
          body: {
            name: formData.get("name"),
            note: formData.get("note"),
            category: formData.get("category"),
            quantities,
          },
          method: "PATCH",
        });
        const imageFile = formData.get("image");
        if (imageFile instanceof File && imageFile.size > 0) {
          const uploaded = await apiFile<{ image: { id: string } }>("/api/images", imageFile);
          await api(`/api/items/${item.id}/image`, {
            body: { imageId: uploaded.image.id },
            method: "PUT",
          });
        } else if (formData.get("removeImage")) {
          await api(`/api/items/${item.id}/image`, {
            body: { imageId: null },
            method: "PUT",
          });
        }
        dialog.close();
        await refreshState(false);
      } catch (error) {
        setDialogError(dialog, messageFromError(error));
      }
    })();
  });
  dialog.querySelector<HTMLButtonElement>("[data-delete-item]")?.addEventListener("click", () => {
    if (!window.confirm(`„${item.name}“ vom Zettel löschen?`)) {
      return;
    }
    void (async () => {
      try {
        await api(`/api/items/${item.id}`, { method: "DELETE" });
        dialog.close();
        await refreshState(false);
      } catch (error) {
        setDialogError(dialog, messageFromError(error));
      }
    })();
  });
  dialog.showModal();
}

function openImagePreview(item: ShoppingItem): void {
  if (!item.imageId) {
    return;
  }
  const dialog = createDialog(
    `<section class="image-preview"><div class="dialog-heading"><h2>${escapeHtml(item.name)}</h2><button class="close-button" type="button" data-close aria-label="Schließen">×</button></div><img src="/api/images/${escapeHtml(item.imageId)}" alt="${escapeHtml(item.name)}"><button class="secondary-button" type="button" data-edit-from-preview>Eintrag bearbeiten</button></section>`,
  );
  dialog
    .querySelector<HTMLButtonElement>("[data-edit-from-preview]")
    ?.addEventListener("click", () => {
      dialog.close();
      openItemDialog(item);
    });
  dialog.showModal();
}

async function analyzeRecipe(file: File, listId: string): Promise<void> {
  const loading = createDialog(
    `<section class="analysis-loading"><span class="spinner dark" aria-hidden="true"></span><h2>Terra liest das Rezept …</h2><p>Das kann einen Moment dauern. Am Zettel wird noch nichts verändert.</p></section>`,
  );
  loading.showModal();
  try {
    const result = await apiFile<{
      analysis: {
        ingredients: Array<{
          amount: string | null;
          category: string;
          inPantry: boolean;
          name: string;
          note: string | null;
          unit: string | null;
        }>;
        title: string;
      };
    }>("/api/ai/recipe-analysis", file);
    loading.close();
    const { analysis } = result;
    const rows = analysis.ingredients
      .map(
        (ingredient, index) => `<fieldset class="ingredient-preview" data-ingredient="${index}">
          <label class="ingredient-select"><input type="checkbox" name="selected" value="${index}" ${ingredient.inPantry ? "" : "checked"}><span>${ingredient.inPantry ? "Im Vorrat" : "Hinzufügen"}</span></label>
          <label>Produkt<input name="name-${index}" value="${escapeHtml(ingredient.name)}" maxlength="120" required></label>
          <div class="quantity-edit-row"><label>Menge<input name="amount-${index}" value="${escapeHtml(ingredient.amount || "")}" inputmode="decimal"></label><label>Einheit<input name="unit-${index}" value="${escapeHtml(ingredient.unit || "")}" maxlength="40"></label></div>
          <label>Notiz<input name="note-${index}" value="${escapeHtml(ingredient.note || "")}" maxlength="500"></label>
          <input type="hidden" name="category-${index}" value="${escapeHtml(ingredient.category)}">
        </fieldset>`,
      )
      .join("");
    const dialog = createDialog(`<form class="dialog-form recipe-preview" data-recipe-preview>
      <div class="dialog-heading"><div><p class="eyebrow">Terra-Vorschlag</p><h2>${escapeHtml(analysis.title)}</h2></div><button class="close-button" type="button" data-close aria-label="Schließen">×</button></div>
      <p class="settings-copy">Prüfe Namen und Mengen. Vorräte sind zunächst abgewählt.</p>
      <div class="ingredient-list">${rows}</div>
      <p class="form-error" role="alert"></p>
      <div class="dialog-actions"><button class="primary-button" type="submit">Auswahl hinzufügen</button></div>
    </form>`);
    dialog
      .querySelector<HTMLFormElement>("[data-recipe-preview]")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        void (async () => {
          const form = event.currentTarget as HTMLFormElement;
          const selected = [...form.querySelectorAll<HTMLInputElement>("[name=selected]:checked")];
          if (selected.length === 0) {
            setDialogError(dialog, "Wähle mindestens eine Zutat aus.");
            return;
          }
          const formData = new FormData(form);
          const items = selected.map((checkbox) => {
            const index = checkbox.value;
            return {
              amount: String(formData.get(`amount-${index}`) || "").trim() || null,
              category: formData.get(`category-${index}`),
              name: formData.get(`name-${index}`),
              note: String(formData.get(`note-${index}`) || "").trim() || null,
              unit: String(formData.get(`unit-${index}`) || "").trim() || null,
            };
          });
          try {
            await api(`/api/lists/${listId}/recipe-items`, { body: { items }, method: "POST" });
            dialog.close();
            await refreshState(false);
            showToast(`${items.length} ${items.length === 1 ? "Zutat" : "Zutaten"} übernommen.`);
          } catch (error) {
            setDialogError(dialog, messageFromError(error));
          }
        })();
      });
    dialog.showModal();
  } catch (error) {
    loading.close();
    showToast(messageFromError(error), "error");
  }
}

function openSettingsDialog(): void {
  if (!currentUser || !currentState) {
    return;
  }
  const dialog = createDialog(`
    <div class="settings-dialog">
      <div class="dialog-heading"><div><p class="eyebrow">Persönlich</p><h2>Einstellungen</h2></div><button class="close-button" type="button" data-close aria-label="Schließen">×</button></div>
      <section><h3>Dein Profil</h3><form data-profile-form><label>Name<input name="displayName" maxlength="80" value="${escapeHtml(currentUser.displayName)}" required></label><button class="secondary-button" type="submit">Name speichern</button></form></section>
      <section><h3>OpenAI</h3><p class="settings-copy">${currentUser.openAiKeyMask ? `Aktiv: ${escapeHtml(currentUser.openAiKeyMask)}` : "Noch kein persönlicher API Key gespeichert."}</p><form data-key-form><label>API Key<input name="apiKey" type="password" autocomplete="off" placeholder="sk-…" required></label><div class="inline-actions"><button class="secondary-button" type="submit">Key speichern</button>${currentUser.openAiKeyMask && currentUser.openAiKeyMask !== "Entwicklungsschlüssel" ? `<button class="text-button danger-text" type="button" data-delete-key>Key löschen</button>` : ""}</div></form></section>
      <section><h3>Haushalt einladen</h3><p class="settings-copy">Der Link ist sieben Tage gültig und funktioniert nur für die angegebene E-Mail-Adresse.</p><form data-invite-form><label>E-Mail<input name="email" type="email" required></label><button class="secondary-button" type="submit">Link erzeugen</button></form><div class="copy-output" data-invite-output hidden></div></section>
      <section><h3>Vorrat</h3><form class="inline-form" data-pantry-form><label><span class="sr-only">Vorratsprodukt</span><input name="name" placeholder="z. B. Salz" required></label><button class="secondary-button" type="submit">Hinzufügen</button></form><div class="pantry-chips">${currentState.pantry.map((item) => `<button type="button" data-pantry-id="${escapeHtml(item.id)}" title="Aus Vorrat entfernen">${escapeHtml(item.name)} <span>×</span></button>`).join("") || "<small>Noch nichts eingetragen.</small>"}</div></section>
      <p class="form-error" role="alert"></p>
      <button class="text-button danger-text logout-button" type="button" data-logout>Abmelden</button>
    </div>`);
  dialog
    .querySelector<HTMLButtonElement>("[data-close]")
    ?.addEventListener("click", () => dialog.close());
  dialog
    .querySelector<HTMLFormElement>("[data-profile-form]")
    ?.addEventListener("submit", (event) => void saveProfile(event, dialog));
  dialog
    .querySelector<HTMLFormElement>("[data-key-form]")
    ?.addEventListener("submit", (event) => void saveApiKey(event, dialog));
  dialog
    .querySelector<HTMLButtonElement>("[data-delete-key]")
    ?.addEventListener("click", () => void deleteApiKey(dialog));
  dialog
    .querySelector<HTMLFormElement>("[data-invite-form]")
    ?.addEventListener("submit", (event) => void createInvitation(event, dialog));
  dialog
    .querySelector<HTMLFormElement>("[data-pantry-form]")
    ?.addEventListener("submit", (event) => void addPantry(event, dialog));
  for (const chip of dialog.querySelectorAll<HTMLButtonElement>("[data-pantry-id]")) {
    chip.addEventListener("click", () => void deletePantry(chip.dataset.pantryId || "", dialog));
  }
  dialog
    .querySelector<HTMLButtonElement>("[data-logout]")
    ?.addEventListener("click", () => void logout(dialog));
  dialog.showModal();
}

async function saveProfile(event: SubmitEvent, dialog: HTMLDialogElement): Promise<void> {
  event.preventDefault();
  try {
    const displayName = new FormData(event.currentTarget as HTMLFormElement).get("displayName");
    await api("/api/settings/profile", { body: { displayName }, method: "PATCH" });
    currentUser = (await api<{ user: User }>("/api/session")).user;
    dialog.close();
    await refreshState(false);
    openEventStream();
    showToast("Name gespeichert.");
  } catch (error) {
    setDialogError(dialog, messageFromError(error));
  }
}

async function saveApiKey(event: SubmitEvent, dialog: HTMLDialogElement): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  try {
    await api("/api/settings/openai-key", {
      body: { apiKey: new FormData(form).get("apiKey") },
      method: "PUT",
    });
    currentUser = (await api<{ user: User }>("/api/session")).user;
    dialog.close();
    renderApplication();
    showToast("API Key verschlüsselt gespeichert.");
  } catch (error) {
    setDialogError(dialog, messageFromError(error));
  }
}

async function deleteApiKey(dialog: HTMLDialogElement): Promise<void> {
  if (!window.confirm("Persönlichen OpenAI API Key löschen?")) {
    return;
  }
  try {
    await api("/api/settings/openai-key", { method: "DELETE" });
    currentUser = (await api<{ user: User }>("/api/session")).user;
    dialog.close();
    renderApplication();
    showToast("API Key gelöscht.");
  } catch (error) {
    setDialogError(dialog, messageFromError(error));
  }
}

async function createInvitation(event: SubmitEvent, dialog: HTMLDialogElement): Promise<void> {
  event.preventDefault();
  try {
    const email = new FormData(event.currentTarget as HTMLFormElement).get("email");
    const result = await api<{ invitation: { url: string } }>("/api/invitations", {
      body: { email },
      method: "POST",
    });
    const output = dialog.querySelector<HTMLElement>("[data-invite-output]");
    if (output) {
      output.hidden = false;
      output.innerHTML = `<input readonly value="${escapeHtml(result.invitation.url)}"><button class="secondary-button" type="button">Kopieren</button>`;
      output.querySelector<HTMLButtonElement>("button")?.addEventListener("click", () => {
        void navigator.clipboard
          .writeText(result.invitation.url)
          .then(() => showToast("Link kopiert."));
      });
    }
  } catch (error) {
    setDialogError(dialog, messageFromError(error));
  }
}

async function addPantry(event: SubmitEvent, dialog: HTMLDialogElement): Promise<void> {
  event.preventDefault();
  try {
    const name = new FormData(event.currentTarget as HTMLFormElement).get("name");
    await api("/api/pantry", { body: { name }, method: "POST" });
    await refreshState(false);
    dialog.close();
    openSettingsDialog();
  } catch (error) {
    setDialogError(dialog, messageFromError(error));
  }
}

async function deletePantry(id: string, dialog: HTMLDialogElement): Promise<void> {
  try {
    await api(`/api/pantry/${id}`, { method: "DELETE" });
    await refreshState(false);
    dialog.close();
    openSettingsDialog();
  } catch (error) {
    setDialogError(dialog, messageFromError(error));
  }
}

async function logout(dialog: HTMLDialogElement): Promise<void> {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    dialog.close();
    currentUser = null;
    currentState = null;
    renderAuthentication("login");
  }
}

async function handleInvitationPath(): Promise<void> {
  const match = window.location.pathname.match(/^\/einladung\/([^/]+)$/);
  if (!match?.[1]) {
    return;
  }
  const token = decodeURIComponent(match[1]);
  try {
    const result = await api<{
      invitation: {
        canMoveExistingData: boolean;
        existingListCount: number;
        existingPantryCount: number;
        expiresAt: string;
        householdName: string;
      };
    }>(`/api/invitations/${encodeURIComponent(token)}`);
    const invitation = result.invitation;
    const dialog = createDialog(
      `<form class="dialog-form" data-accept-invite><div class="dialog-heading"><div><p class="eyebrow">Einladung</p><h2>${escapeHtml(invitation.householdName)}</h2></div></div><p>Du wurdest eingeladen, diesem Haushalt beizutreten.</p>${invitation.canMoveExistingData ? `<div class="transfer-summary"><strong>Dein bisheriger Haushalt</strong><span>${invitation.existingListCount} Zettel · ${invitation.existingPantryCount} Vorratsprodukte</span></div><label class="check-label"><input type="checkbox" name="moveExistingData" checked> Meine bisherigen Zettel und Vorräte mitnehmen</label>` : ""}<p class="form-error" role="alert"></p><div class="dialog-actions"><button class="secondary-button" type="button" data-decline>Später</button><button class="primary-button" type="submit">Beitreten</button></div></form>`,
    );
    dialog
      .querySelector<HTMLButtonElement>("[data-decline]")
      ?.addEventListener("click", () => dialog.close());
    dialog
      .querySelector<HTMLFormElement>("[data-accept-invite]")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        void (async () => {
          try {
            const moveExistingData = Boolean(
              new FormData(event.currentTarget as HTMLFormElement).get("moveExistingData"),
            );
            await api(`/api/invitations/${encodeURIComponent(token)}/accept`, {
              body: { moveExistingData },
              method: "POST",
            });
            window.history.replaceState(null, "", "/");
            currentUser = (await api<{ user: User }>("/api/session")).user;
            dialog.close();
            await refreshState(false);
            showToast("Haushalt beigetreten.");
          } catch (error) {
            setDialogError(dialog, messageFromError(error));
          }
        })();
      });
    dialog.showModal();
  } catch (error) {
    showToast(messageFromError(error), "error");
  }
}

function openEventStream(): void {
  closeEventStream();
  eventSource = new EventSource("/api/events");
  eventSource.addEventListener("state-changed", () => void refreshState());
  eventSource.addEventListener("ready", () => {
    void verifyVersion();
    void refreshState();
  });
}

function closeEventStream(): void {
  eventSource?.close();
  eventSource = null;
}

function createDialog(content: string): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "modal";
  dialog.innerHTML = content;
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  for (const closeButton of dialog.querySelectorAll<HTMLButtonElement>("[data-close]")) {
    closeButton.addEventListener("click", () => dialog.close());
  }
  document.body.append(dialog);
  return dialog;
}

function showToast(message: string, kind: "default" | "error" = "default"): void {
  document.querySelector(".toast-region")?.remove();
  const region = document.createElement("div");
  region.className = "toast-region";
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  region.append(toast);
  document.body.append(region);
  window.setTimeout(() => region.remove(), 3_500);
}

function setDialogError(dialog: HTMLDialogElement, message: string): void {
  const target = dialog.querySelector<HTMLElement>(".form-error");
  if (target) {
    target.textContent = message;
  }
}

function renderFatalError(error: unknown): void {
  app.innerHTML = `<section class="fatal paper-card"><h1>Das hat nicht geklappt.</h1><p>${escapeHtml(messageFromError(error))}</p><button class="primary-button" type="button">Erneut versuchen</button></section>`;
  app.querySelector("button")?.addEventListener("click", () => void boot());
}

function loadingMarkup(message: string): string {
  return `<section class="loading"><span class="spinner" aria-hidden="true"></span><p>${escapeHtml(message)}</p></section>`;
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Etwas ist schiefgegangen.";
}

function setBusy(button: HTMLButtonElement | null, busy: boolean): void {
  if (button) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }
}

function formatAmount(amount: string): string {
  return amount.replace(".", ",");
}

function formatUnit(unit: string, amount: string): string {
  if (Number(amount) === 1) {
    return unit;
  }
  return (
    {
      Dose: "Dosen",
      Flasche: "Flaschen",
      Packung: "Packungen",
      Tasse: "Tassen",
      Zehe: "Zehen",
    }[unit] || unit
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function verifyVersion(): Promise<void> {
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    const payload = (await response.json()) as { version?: unknown };
    const currentVersion = document.documentElement.dataset.version;
    if (typeof payload.version === "string" && payload.version !== currentVersion) {
      window.location.reload();
    }
  } catch {
    showToast(
      navigator.onLine ? "Verbindung wird wiederhergestellt …" : "Du bist offline.",
      "error",
    );
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void verifyVersion();
    if (currentUser) {
      void refreshState();
    }
  }
});
window.addEventListener("online", () => {
  void verifyVersion();
  if (currentUser) {
    void refreshState();
  }
});
window.addEventListener("pageshow", () => void verifyVersion());
