const form = document.querySelector("[data-generation-form]");
const referenceInput = form.querySelector('input[name="references"]');
const referenceDrop = document.querySelector("[data-reference-drop]");
const referencePreview = document.querySelector("[data-reference-preview]");
const formMessage = document.querySelector("[data-form-message]");
const submitButton = form.querySelector('button[type="submit"]');
const engineState = document.querySelector("[data-engine-state]");
const jobList = document.querySelector("[data-job-list]");
const emptyState = document.querySelector("[data-empty-state]");
const jobTemplate = document.querySelector("[data-job-template]");
const resultTemplate = document.querySelector("[data-result-template]");
const refreshButton = document.querySelector("[data-refresh]");

const statusLabels = {
  queued: "Wartet",
  running: "Generiert",
  completed: "Fertig",
  failed: "Fehler",
  cancelled: "Abgebrochen",
};

let referenceFiles = [];
let jobs = [];
let pollingTimer;

void boot();

async function boot() {
  bindEvents();
  await Promise.all([loadHealth(), loadJobs()]);
  schedulePoll();
}

function bindEvents() {
  form.addEventListener("submit", (event) => void submitJob(event));
  referenceInput.addEventListener("change", () => {
    addReferenceFiles([...referenceInput.files]);
    referenceInput.value = "";
  });
  for (const eventName of ["dragenter", "dragover"]) {
    referenceDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      referenceDrop.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    referenceDrop.addEventListener(eventName, (event) => {
      event.preventDefault();
      referenceDrop.classList.remove("dragging");
    });
  }
  referenceDrop.addEventListener("drop", (event) => {
    addReferenceFiles([...event.dataTransfer.files]);
  });
  refreshButton.addEventListener("click", () => void loadJobs());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void loadJobs();
    }
  });
}

async function loadHealth() {
  try {
    const health = await api("/api/health");
    engineState.classList.add("ready");
    engineState.querySelector("span:last-child").textContent =
      `${shortModelName(health.model)} · ${health.device.toUpperCase()}`;
  } catch {
    engineState.classList.remove("ready");
    engineState.querySelector("span:last-child").textContent = "Server nicht erreichbar";
  }
}

async function loadJobs() {
  try {
    const payload = await api("/api/jobs");
    jobs = payload.jobs;
    renderJobs();
  } catch (error) {
    formMessage.textContent = messageFromError(error);
  }
}

function schedulePoll() {
  window.clearTimeout(pollingTimer);
  const active = jobs.some((job) => job.status === "queued" || job.status === "running");
  pollingTimer = window.setTimeout(
    async () => {
      await loadJobs();
      schedulePoll();
    },
    active ? 1000 : 4000,
  );
}

function addReferenceFiles(files) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  const wouldOverflow = referenceFiles.length + images.length > 4;
  referenceFiles = [...referenceFiles, ...images].slice(0, 4);
  renderReferences();
  if (files.length !== images.length) {
    formMessage.textContent = "Es können nur Bilddateien als Referenz verwendet werden.";
  } else if (wouldOverflow) {
    formMessage.textContent = "Es werden höchstens vier Referenzbilder verwendet.";
  } else {
    formMessage.textContent = "";
  }
}

function renderReferences() {
  referencePreview.replaceChildren();
  referenceFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "reference-thumbnail";
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = `Stilreferenz ${index + 1}`;
    image.addEventListener("load", () => URL.revokeObjectURL(image.src), { once: true });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Stilreferenz ${index + 1} entfernen`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      referenceFiles.splice(index, 1);
      renderReferences();
    });
    item.append(image, remove);
    referencePreview.append(item);
  });
}

async function submitJob(event) {
  event.preventDefault();
  formMessage.textContent = "";
  submitButton.disabled = true;
  const values = new FormData(form);
  try {
    const referenceImages = await Promise.all(
      referenceFiles.map(async (file) => ({
        name: file.name,
        type: file.type,
        data: await fileToDataUrl(file),
      })),
    );
    const seedValue = String(values.get("seed") || "").trim();
    const payload = {
      productName: values.get("productName"),
      direction: values.get("direction"),
      variantCount: Number(values.get("variantCount")),
      imageSize: Number(values.get("imageSize")),
      referenceImages,
    };
    if (seedValue) {
      payload.seed = Number(seedValue);
    }
    const response = await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    jobs = [response.job, ...jobs.filter((job) => job.id !== response.job.id)];
    renderJobs();
    form.reset();
    referenceFiles = [];
    renderReferences();
    form.querySelector('select[name="variantCount"]').value = "4";
    form.querySelector('select[name="imageSize"]').value = "768";
    document.querySelector("[data-job-list]").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    schedulePoll();
  } catch (error) {
    formMessage.textContent = messageFromError(error);
  } finally {
    submitButton.disabled = false;
  }
}

function renderJobs() {
  jobList.replaceChildren();
  emptyState.hidden = jobs.length > 0;
  for (const job of jobs) {
    const fragment = jobTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".job-card");
    fragment.querySelector("[data-job-name]").textContent = job.productName;
    const status = fragment.querySelector("[data-job-status]");
    status.textContent = statusLabels[job.status] || job.status;
    status.classList.add(job.status);
    fragment.querySelector("[data-job-meta]").textContent = jobMeta(job);
    const progressTrack = fragment.querySelector("[data-progress-track]");
    progressTrack.hidden = !["queued", "running"].includes(job.status);
    fragment.querySelector("[data-progress-bar]").style.width = `${job.progress}%`;
    const error = fragment.querySelector("[data-job-error]");
    error.textContent = job.error || "";
    error.hidden = !job.error;

    const cancel = fragment.querySelector("[data-cancel-job]");
    cancel.hidden = !["queued", "running"].includes(job.status);
    cancel.addEventListener("click", () => void performJobAction(job.id, "cancel"));
    const remove = fragment.querySelector("[data-delete-job]");
    remove.hidden = job.status === "running";
    remove.addEventListener("click", () => void deleteJob(job.id));

    const resultGrid = fragment.querySelector("[data-result-grid]");
    resultGrid.hidden = job.results.length === 0;
    job.results.forEach((result, index) => {
      const resultFragment = resultTemplate.content.cloneNode(true);
      const resultCard = resultFragment.querySelector(".result-card");
      resultCard.classList.toggle("selected", job.selectedIndex === index);
      const image = resultFragment.querySelector("[data-result-image]");
      image.src = result.url;
      image.alt = `${job.productName}, Variante ${index + 1}`;
      resultFragment.querySelector("[data-result-label]").textContent = `Variante ${index + 1}`;
      const download = resultFragment.querySelector("[data-download-result]");
      download.href = result.url;
      download.download = `${safeFilename(job.productName)}-${index + 1}.png`;
      const select = resultFragment.querySelector("[data-select-result]");
      select.setAttribute("aria-label", `${job.productName}, Variante ${index + 1} auswählen`);
      select.disabled = job.status !== "completed";
      select.addEventListener("click", () => void selectResult(job.id, index));
      resultGrid.append(resultFragment);
    });
    card.dataset.jobId = job.id;
    jobList.append(fragment);
  }
}

function jobMeta(job) {
  const pieces = [`${job.variantCount} Varianten`, `${job.imageSize} px`, `Seed ${job.seed}`];
  if (job.referenceCount) {
    pieces.push(`${job.referenceCount} Stilreferenz${job.referenceCount === 1 ? "" : "en"}`);
  }
  if (job.status === "running") {
    pieces.push(`${job.progress} %`);
  }
  return pieces.join(" · ");
}

async function performJobAction(jobId, action) {
  try {
    const response = await api(`/api/jobs/${jobId}/${action}`, {
      method: "POST",
      body: "{}",
    });
    replaceJob(response.job);
  } catch (error) {
    formMessage.textContent = messageFromError(error);
  }
}

async function selectResult(jobId, selectedIndex) {
  try {
    const response = await api(`/api/jobs/${jobId}/select`, {
      method: "POST",
      body: JSON.stringify({ selectedIndex }),
    });
    replaceJob(response.job);
  } catch (error) {
    formMessage.textContent = messageFromError(error);
  }
}

async function deleteJob(jobId) {
  if (!window.confirm("Diesen Auftrag und seine erzeugten Bilder wirklich löschen?")) {
    return;
  }
  try {
    await api(`/api/jobs/${jobId}`, { method: "DELETE" });
    jobs = jobs.filter((job) => job.id !== jobId);
    renderJobs();
  } catch (error) {
    formMessage.textContent = messageFromError(error);
  }
}

function replaceJob(updated) {
  jobs = jobs.map((job) => (job.id === updated.id ? updated : job));
  renderJobs();
  schedulePoll();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Der Server antwortete mit HTTP ${response.status}.`);
  }
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener(
      "error",
      () => reject(new Error(`${file.name} konnte nicht gelesen werden.`)),
      {
        once: true,
      },
    );
    reader.readAsDataURL(file);
  });
}

function shortModelName(model) {
  return String(model).split("/").at(-1);
}

function safeFilename(value) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "produkt"
  );
}

function messageFromError(error) {
  return error instanceof Error ? error.message : "Unbekannter Fehler";
}
