import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("App-Container fehlt.");
}

app.innerHTML = `
  <section class="welcome-card">
    <div class="brand-mark" aria-hidden="true">✓</div>
    <p class="eyebrow">Gemeinsam einkaufen</p>
    <h1>Unser Einkaufszettel</h1>
    <p class="intro">Alles, was ihr braucht – übersichtlich, aktuell und ohne Zettelwirtschaft.</p>
    <div class="paper-preview" aria-hidden="true">
      <div class="preview-row"><span class="check"></span><span>Hafermilch</span><strong>2 l</strong></div>
      <div class="preview-row"><span class="check"></span><span>Äpfel</span><strong>6 Stück</strong></div>
      <div class="preview-row"><span class="check"></span><span>Brot</span><strong>1</strong></div>
    </div>
    <p class="status-line" data-status>Die Anwendung wird vorbereitet …</p>
  </section>
`;

const currentVersion = document.documentElement.dataset.version;
const status = document.querySelector<HTMLElement>("[data-status]");

async function verifyVersion(): Promise<void> {
  try {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Versionsprüfung fehlgeschlagen");
    }
    const payload = (await response.json()) as { version?: unknown };
    if (typeof payload.version === "string" && payload.version !== currentVersion) {
      window.location.reload();
      return;
    }
    if (status) {
      status.textContent = "Bereit.";
    }
  } catch {
    if (status) {
      status.textContent = navigator.onLine ? "Verbindung wird hergestellt …" : "Du bist offline.";
    }
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void verifyVersion();
  }
});
window.addEventListener("online", () => void verifyVersion());
window.addEventListener("pageshow", () => void verifyVersion());
void verifyVersion();
