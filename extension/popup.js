document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  const liveClock = document.getElementById("liveClock");
  const clockFormatter = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const updateClock = () => {
    liveClock.textContent = clockFormatter.format(new Date());
  };
  updateClock();
  window.setInterval(updateClock, 1000);
  document.getElementById("reloadPopupButton").addEventListener("click", () => window.location.reload());

  const passwordInput = document.getElementById("irctcPassword");
  const passwordToggleButton = document.getElementById("passwordToggleButton");
  const setPasswordVisibility = (visible) => {
    passwordInput.type = visible ? "text" : "password";
    passwordToggleButton.setAttribute("aria-pressed", String(visible));
    passwordToggleButton.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    passwordToggleButton.title = visible ? "Hide password" : "Show password";
  };
  passwordToggleButton.addEventListener("click", () => {
    const selectionStart = passwordInput.selectionStart;
    const selectionEnd = passwordInput.selectionEnd;
    setPasswordVisibility(passwordInput.type === "password");
    passwordInput.focus({ preventScroll: true });
    if (selectionStart !== null && selectionEnd !== null) passwordInput.setSelectionRange(selectionStart, selectionEnd);
  });

  const passengerContainer = document.getElementById("passenger-details");
  const passengerNumbers = [1, 2, 3, 4, 5];
  passengerContainer.innerHTML = passengerNumbers.map((number) => passengerTemplate(number)).join("");

  const journeyDateInput = document.getElementById("journeyDate");
  const journeyDatePicker = document.getElementById("journeyDatePicker");
  const now = new Date();
  journeyDatePicker.min = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const openDatePicker = () => {
    if (typeof journeyDatePicker.showPicker === "function") journeyDatePicker.showPicker();
    else journeyDatePicker.click();
  };
  journeyDateInput.addEventListener("click", openDatePicker);
  document.getElementById("datePickerButton").addEventListener("click", openDatePicker);
  journeyDatePicker.addEventListener("change", () => {
    journeyDateInput.value = toDisplayDate(journeyDatePicker.value);
  });

  const fields = ["irctcUsername", "fromStation", "toStation", "journeyDate", "trainNumber", "class", "quota", "autoUpgradation", "bookOnlyIfConfirmed", "coachNumber", "mobileNumber", "paymentMode"];
  passengerNumbers.forEach((number) => fields.push(`passengerName${number}`, `passengerAge${number}`, `passengerGender${number}`, `berthPreference${number}`));

  const berthSelects = passengerNumbers.map((number) => document.getElementById(`berthPreference${number}`));
  const syncBerthAvailability = () => {
    const selectedSideLower = berthSelects.filter((select) => select.value === "SL").length;
    const selectedLower = berthSelects.filter((select) => select.value === "LB").length;
    berthSelects.forEach((select) => {
      const sideLowerOption = select.querySelector('option[value="SL"]');
      const lowerOption = select.querySelector('option[value="LB"]');
      sideLowerOption.disabled = selectedSideLower >= 1 && select.value !== "SL";
      lowerOption.disabled = selectedLower >= 2 && select.value !== "LB";
    });
  };
  berthSelects.forEach((select) => select.addEventListener("change", syncBerthAvailability));

  const notify = (message, error = false) => {
    status.textContent = message;
    status.className = `text-xs font-medium px-2 py-1 rounded ${error ? "bg-red-500" : "bg-green-500"} text-white`;
    window.setTimeout(() => { status.textContent = ""; status.className = ""; }, 2500);
  };
  const collect = () => Object.fromEntries(fields.map((id) => {
    const element = document.getElementById(id);
    let value = element.type === "checkbox" ? element.checked : element.value.trim();
    if (id === "fromStation" || id === "toStation") value = value.toUpperCase();
    return [id, value];
  }));
  const validate = (data) => {
    if (!data.fromStation || !data.toStation || !data.journeyDate) return "Journey details required";
    if (!/^\d{5}$/.test(data.trainNumber)) return "Enter a valid 5-digit train number";
    const journeyDate = parseDisplayDate(data.journeyDate);
    if (!journeyDate) return "Use date format DD/MM/YYYY";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (journeyDate < today) return "Journey date is in the past";
    if (!data.passengerName1 || !data.passengerAge1) return "Passenger 1 required";
    const sideLowerCount = passengerNumbers.filter((number) => data[`berthPreference${number}`] === "SL").length;
    if (sideLowerCount > 1) return "Side Lower can be selected for only one passenger";
    const lowerCount = passengerNumbers.filter((number) => data[`berthPreference${number}`] === "LB").length;
    if (lowerCount > 2) return "Lower can be selected for maximum two passengers";
    if (data.mobileNumber && !/^\d{10}$/.test(data.mobileNumber)) return "Enter 10-digit mobile";
    return "";
  };
  const save = (callback, successMessage = "Saved") => {
    const data = collect();
    const error = validate(data);
    if (error) { notify(error, true); return; }
    const password = document.getElementById("irctcPassword").value;
    const savePassword = password
      ? chrome.storage.session.set({ irctcSessionPassword: password })
      : chrome.storage.session.remove("irctcSessionPassword");
    Promise.all([chrome.storage.local.set({ irctcFormData: data }), savePassword]).then(() => {
      notify(successMessage);
      if (callback) callback();
    }).catch(() => notify("Could not save details", true));
  };
  const load = () => chrome.storage.local.get("irctcFormData", ({ irctcFormData }) => {
    if (!irctcFormData) return;
    fields.forEach((id) => {
      const element = document.getElementById(id);
      if (irctcFormData[id] === undefined) return;
      if (element.type === "checkbox") element.checked = Boolean(irctcFormData[id]);
      else if (id === "journeyDate") {
        element.value = toDisplayDate(irctcFormData[id]);
        journeyDatePicker.value = toIsoDate(element.value);
      }
      else element.value = irctcFormData[id];
    });
    syncBerthAvailability();
  });

  chrome.storage.session.get("irctcSessionPassword", ({ irctcSessionPassword }) => {
    if (irctcSessionPassword) document.getElementById("irctcPassword").value = irctcSessionPassword;
  });

  document.getElementById("saveButton").addEventListener("click", () => save());
  document.getElementById("clearButton").addEventListener("click", () => {
    Promise.all([
      chrome.storage.local.remove(["irctcFormData", "autofillPending", "bookingSession"]),
      chrome.storage.session.remove("irctcSessionPassword")
    ]).then(() => {
      document.querySelectorAll("input").forEach((input) => { if (input.type === "checkbox") input.checked = false; else input.value = ""; });
      document.querySelectorAll("select").forEach((select) => { select.selectedIndex = 0; });
      setPasswordVisibility(false);
      syncBerthAvailability();
      notify("Reset complete");
    }).catch(() => notify("Reset failed", true));
  });
  document.getElementById("bookButton").addEventListener("click", () => save(() => {
    const bookingSession = {
      active: true,
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      startedAt: Date.now(),
      completedStages: []
    };
    chrome.storage.local.remove("autofillPending", () => chrome.storage.local.set({ bookingSession }, () => {
      if (chrome.runtime.lastError) { notify("Could not start autofill", true); return; }
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (chrome.runtime.lastError || !tab?.id) { notify("Active tab not found", true); return; }
        if (tab?.url?.includes("irctc.co.in")) {
          triggerCurrentTabAutofill(tab.id);
        } else {
          chrome.tabs.create({ url: "https://www.irctc.co.in/nget/train-search" });
          window.close();
        }
      });
    }));
  }, "Starting…"));
  load();

  function triggerCurrentTabAutofill(tabId) {
    notify("Connecting…");
    // Always execute the file. Its versioned controller reuses an existing
    // instance when present, so this works for both old and newly opened tabs.
    chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }, () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError.message);
        notify("IRCTC access failed — reload extension", true);
        return;
      }
      notify("Autofill sent");
      window.setTimeout(() => window.close(), 450);
    });
  }
});

function parseDisplayDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || "");
  if (!match) return null;
  const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  if (date.getFullYear() !== Number(match[3]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[1])) return null;
  return date;
}

function toDisplayDate(value) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value || "";
}

function toIsoDate(value) {
  const display = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || "");
  return display ? `${display[3]}-${display[2]}-${display[1]}` : (/^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "");
}

function passengerTemplate(i) {
  return `<section class="bg-slate-800 p-4 rounded-lg mb-4 shadow-md">
    <h2 class="text-lg font-semibold text-white mb-3"><svg class="ui-icon" aria-hidden="true"><use href="#icon-user"></use></svg> Passenger ${i}${i > 1 ? " (Optional)" : ""}</h2>
    <div class="grid grid-cols-3 gap-4">
      <div class="col-span-3"><label for="passengerName${i}" class="block text-xs text-slate-400 mb-1">Full Name</label><input id="passengerName${i}" type="text" maxlength="35" class="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-1.5 text-sm" /></div>
      <div><label for="passengerAge${i}" class="block text-xs text-slate-400 mb-1">Age</label><input id="passengerAge${i}" type="number" min="1" max="125" class="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-1.5 text-sm" /></div>
      <div><label for="passengerGender${i}" class="block text-xs text-slate-400 mb-1">Gender</label><select id="passengerGender${i}" class="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-1.5 text-sm"><option value="M">Male</option><option value="F">Female</option><option value="T">Transgender</option></select></div>
      <div><label for="berthPreference${i}" class="block text-xs text-slate-400 mb-1">Berth</label><select id="berthPreference${i}" class="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-1.5 text-sm"><option value="">No preference</option><option value="LB">Lower</option><option value="MB">Middle</option><option value="UB">Upper</option><option value="SL">Side Lower</option><option value="SU">Side Upper</option></select></div>
    </div>
  </section>`;
}
