(() => {
  const CONTROLLER_KEY = "__irctcAutofillController";
  window[CONTROLLER_KEY]?.dispose?.();

  const CLASS_LABELS = {
    "1A": "AC First Class (1A)", "2A": "AC 2 Tier (2A)", "3A": "AC 3 Tier (3A)",
    "3E": "AC 3 Economy (3E)", "2S": "Second Sitting (2S)", SL: "Sleeper (SL)",
    CC: "AC Chair car (CC)", EC: "Exec. Chair Car (EC)"
  };
  const QUOTA_LABELS = { TQ: "TATKAL", GN: "GENERAL", PT: "PREMIUM TATKAL" };
  const GENDER_LABELS = { M: "Male", F: "Female", T: "Transgender" };
  const BERTH_LABELS = { LB: "Lower", MB: "Middle", UB: "Upper", SL: "Side Lower", SU: "Side Upper" };
  const SESSION_TTL = 15 * 60 * 1000;
  const PASSENGER_NAME_SELECTOR = 'input[formcontrolname="passengerName"], input[placeholder*="Full Name" i]';
  const PASSENGER_AGE_SELECTOR = 'input[formcontrolname="passengerAge"], input[placeholder="Age" i]';

  let running = false;
  let rerun = false;
  let observerTimer;
  let lastSignature = "";
  let passengerRetryCount = 0;
  let retrySessionId = "";
  let disposed = false;

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const visible = (element) => Boolean(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));

  function getStage() {
    if (findLoginDialog()) return "login";
    const path = location.pathname.toLowerCase();
    if (path.endsWith("/train-search")) return "search";
    if (path.includes("/booking/train-list")) return "train-list";
    if (path.includes("/booking/psgninput")) return "passengers";
    if (path.includes("/booking/reviewbooking")) return "review";
    return "";
  }

  function findLoginDialog() {
    const passwordInput = [...document.querySelectorAll('input[type="password"]')].find(visible);
    if (!passwordInput) return null;

    let root = passwordInput.closest('[role="dialog"], p-dialog, .ui-dialog, .modal, .login-modal') || passwordInput.parentElement;
    while (root && root !== document.body) {
      const signInButton = findButton(root, /^SIGN\s*IN$/i);
      if (signInButton) {
        const usernameInput = [
          'input[formcontrolname="userid"]',
          'input[formcontrolname="userName"]',
          'input[formcontrolname="username"]',
          'input[name="userName"]',
          'input[name="username"]',
          'input[placeholder*="User" i]',
          'input[type="text"]'
        ].map((selector) => [...root.querySelectorAll(selector)].find(visible)).find(Boolean);
        if (usernameInput) return { root, usernameInput, passwordInput, signInButton };
      }
      root = root.parentElement;
    }
    return null;
  }

  function getSessionPassword() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_IRCTC_SESSION_PASSWORD" }, (response) => {
        if (chrome.runtime.lastError) { resolve(""); return; }
        resolve(response?.password || "");
      });
    });
  }

  function loginNeedsManualChallenge(root) {
    const challengeInput = [...root.querySelectorAll("input")].find((input) => {
      if (!visible(input) || input.type === "checkbox") return false;
      const description = [input.getAttribute("formcontrolname"), input.name, input.placeholder, input.getAttribute("aria-label")]
        .filter(Boolean).join(" ");
      return /captcha|otp/i.test(description);
    });
    const challengeImage = [...root.querySelectorAll("img")].find((image) => {
      if (!visible(image)) return false;
      return /captcha/i.test([image.alt, image.id, image.className, image.src].filter(Boolean).join(" "));
    });
    return Boolean(challengeInput || challengeImage);
  }

  async function fillLogin(data) {
    const dialog = await waitFor(findLoginDialog, 8000);
    if (!dialog) return { error: "IRCTC login window was not found." };
    const password = await getSessionPassword();
    if (!data.irctcUsername || !password) {
      return { error: "Open the extension, enter IRCTC user name and password, then click Book again." };
    }

    nativeSet(dialog.usernameInput, data.irctcUsername);
    nativeSet(dialog.passwordInput, password);
    dialog.usernameInput.dispatchEvent(new Event("blur", { bubbles: true }));
    dialog.passwordInput.dispatchEvent(new Event("blur", { bubbles: true }));
    // Give IRCTC's Angular form enough time to update validation/session state.
    // Submitting immediately after synthetic input can make the post-login
    // booking continuation fail with "Unable to Process Request".
    await sleep(900);

    if (dialog.usernameInput.value !== data.irctcUsername) nativeSet(dialog.usernameInput, data.irctcUsername);
    if (dialog.passwordInput.value !== password) nativeSet(dialog.passwordInput, password);
    const enabledSignIn = await waitFor(() => !dialog.signInButton.disabled ? dialog.signInButton : null, 3000);
    if (!enabledSignIn) return { error: "IRCTC Sign In is not ready. Verify the login fields and try again." };

    if (loginNeedsManualChallenge(dialog.root)) return { manual: true };
    return { button: enabledSignIn };
  }

  async function waitFor(getter, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const result = getter();
      if (result) return result;
      await sleep(200);
    }
    return null;
  }

  function nativeSet(element, value) {
    if (!element || value === undefined || value === null || value === "") return false;
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, String(value)); else element.value = String(value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function setElement(element, value) {
    if (!element || value === undefined || value === null || value === "") return false;
    element.focus();
    if (element.value !== String(value)) nativeSet(element, value);
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function selectNative(element, value, label) {
    if (!element) return false;
    const option = [...element.options].find((item) => item.value === value)
      || [...element.options].find((item) => item.text.trim().toLowerCase() === String(label || "").toLowerCase())
      || [...element.options].find((item) => item.text.toLowerCase().includes(String(label || "").toLowerCase()));
    if (!option) return false;
    nativeSet(element, option.value);
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  async function chooseDropdown(control, wantedLabel) {
    if (!control || !wantedLabel) return false;
    if (control instanceof HTMLSelectElement) return selectNative(control, "", wantedLabel);
    const current = (control.textContent || control.querySelector('input[role="listbox"]')?.getAttribute("aria-label") || "").trim();
    if (current.toLowerCase().includes(wantedLabel.toLowerCase())) return true;
    (control.querySelector(".ui-dropdown") || control).click();
    await sleep(180);
    const options = [...document.querySelectorAll('li[role="option"], .ui-dropdown-item')].filter(visible);
    const wanted = wantedLabel.toLowerCase();
    const option = options.find((item) => (item.textContent || "").trim().toLowerCase() === wanted)
      || options.find((item) => (item.textContent || "").toLowerCase().includes(wanted));
    if (!option) return false;
    option.click();
    await sleep(100);
    return true;
  }

  async function fillStation(controlName, code) {
    if (!code) return false;
    const control = await waitFor(() => document.querySelector(`p-autocomplete[formcontrolname="${controlName}"]`));
    const input = control?.querySelector("input");
    if (!input) return false;
    const normalized = String(code).trim().toUpperCase();
    if (input.value.toUpperCase().includes(normalized) && control.classList.contains("ng-valid")) return true;
    input.focus();
    nativeSet(input, normalized);
    await sleep(350);
    const exactCode = new RegExp(`(?:^|\\s|-)${escapeRegex(normalized)}(?:\\s|$|\\()`, "i");
    const option = await waitFor(() => {
      const options = [...document.querySelectorAll('li[role="option"], .ui-autocomplete-list-item')].filter(visible);
      return options.find((item) => exactCode.test(item.textContent || "")) || null;
    }, 5000);
    if (!option) return false;
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    option.click();
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    return Boolean(await waitFor(() => {
      const selected = control.classList.contains("ng-valid") && input.value.toUpperCase().includes(normalized);
      return selected ? true : null;
    }, 2500));
  }

  function parseDate(value) {
    let match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || "");
    if (match) return { day: Number(match[1]), month: Number(match[2]) - 1, year: Number(match[3]) };
    match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    return match ? { day: Number(match[3]), month: Number(match[2]) - 1, year: Number(match[1]) } : null;
  }

  async function fillCalendarDate(value) {
    const target = parseDate(value);
    const control = document.querySelector('p-calendar[formcontrolname="journeyDate"]');
    const input = control?.querySelector("input");
    if (!target || !control || !input) return false;
    const formatted = `${String(target.day).padStart(2, "0")}/${String(target.month + 1).padStart(2, "0")}/${target.year}`;
    if (input.value === formatted) return true;
    input.click();
    await sleep(140);
    for (let attempts = 0; attempts < 24; attempts += 1) {
      const monthName = control.querySelector(".ui-datepicker-month")?.textContent?.trim();
      const year = Number(control.querySelector(".ui-datepicker-year")?.textContent?.trim());
      if (!monthName || !year) return false;
      const month = new Date(`${monthName} 1, ${year}`).getMonth();
      const difference = (target.year - year) * 12 + target.month - month;
      if (!difference) break;
      const arrow = control.querySelector(difference > 0 ? ".ui-datepicker-next" : ".ui-datepicker-prev");
      if (!arrow) return false;
      arrow.click();
      await sleep(90);
    }
    const day = [...control.querySelectorAll("td:not(.ui-datepicker-other-month) a.ui-state-default")]
      .find((element) => Number((element.textContent || "").trim()) === target.day);
    if (!day) return false;
    day.click();
    await sleep(140);
    return input.value === formatted;
  }

  async function fillSearch(data) {
    const searchFormReady = await waitFor(() => {
      const originControl = document.querySelector('p-autocomplete[formcontrolname="origin"]');
      const destinationControl = document.querySelector('p-autocomplete[formcontrolname="destination"]');
      const dateControl = document.querySelector('p-calendar[formcontrolname="journeyDate"]');
      return originControl && destinationControl && dateControl && !languageDialogVisible() ? true : null;
    }, 12000);
    if (!searchFormReady) return false;

    // When the language dialog has just been dismissed, IRCTC can render the
    // controls before Angular finishes attaching the search handlers. A small
    // settle window prevents the first programmatic interaction from locking
    // the Search Trains button.
    await sleep(700);
    const origin = await fillStation("origin", data.fromStation);
    const destination = await fillStation("destination", data.toStation);
    const date = await fillCalendarDate(data.journeyDate);
    const journeyClass = await chooseDropdown(document.querySelector('p-dropdown[formcontrolname="journeyClass"]'), CLASS_LABELS[data.class]);
    const quota = await chooseDropdown(document.querySelector('p-dropdown[formcontrolname="journeyQuota"]'), QUOTA_LABELS[data.quota]);
    const originValid = document.querySelector('p-autocomplete[formcontrolname="origin"]')?.classList.contains("ng-valid");
    const destinationValid = document.querySelector('p-autocomplete[formcontrolname="destination"]')?.classList.contains("ng-valid");
    const dateValid = document.querySelector('p-calendar[formcontrolname="journeyDate"]')?.classList.contains("ng-valid");
    if (!origin || !destination || !date || !journeyClass || !quota || !originValid || !destinationValid || !dateValid) return false;
    const searchButton = await waitFor(() => {
      const button = findButton(document, /^(Search|Search Trains)$/i);
      return buttonReady(button) ? button : null;
    }, 5000);
    if (!searchButton) return false;
    return { button: searchButton };
  }

  function smallestTextElement(root, predicate) {
    return [...root.querySelectorAll("h1,h2,h3,h4,strong,span,div,button,a")]
      .filter((element) => visible(element) && predicate((element.textContent || "").trim(), element))
      .sort((a, b) => (a.textContent || "").length - (b.textContent || "").length)[0];
  }

  function findTrainCard(trainNumber) {
    const escaped = escapeRegex(String(trainNumber));
    const title = smallestTextElement(document, (text) => new RegExp(`\\(${escaped}\\)`).test(text));
    if (!title) return null;
    let node = title;
    while (node && node !== document.body) {
      if (/Book Now/i.test(node.innerText || "") && (node.innerText || "").length < 12000) return node;
      node = node.parentElement;
    }
    return title.parentElement;
  }

  function journeyDateLabel(value) {
    const parsed = parseDate(value);
    if (!parsed) return "";
    const date = new Date(parsed.year, parsed.month, parsed.day);
    return `${date.toLocaleDateString("en-US", { weekday: "short" })}, ${String(parsed.day).padStart(2, "0")} ${date.toLocaleDateString("en-US", { month: "short" })}`;
  }

  async function selectTrain(data) {
    document.activeElement?.blur();
    document.body.click();
    const card = await waitFor(() => findTrainCard(data.trainNumber), 15000);
    if (!card) return { error: `Train ${data.trainNumber} was not found in these results.` };
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.style.outline = "3px solid #18a86b";
    card.style.outlineOffset = "3px";

    const classLabel = CLASS_LABELS[data.class];
    const classChoice = smallestTextElement(card, (text) => text === classLabel);
    if (!classChoice) return { error: `${classLabel} is not shown for train ${data.trainNumber}.` };
    classChoice.click();
    await sleep(900);

    const dateLabel = journeyDateLabel(data.journeyDate);
    const dateChoice = smallestTextElement(card, (text) => text.startsWith(dateLabel) && text.length < 100);
    if (dateChoice) {
      dateChoice.click();
      await sleep(500);
    }

    const bookButton = await waitFor(() => {
      const button = findButton(card, /^Book Now$/i);
      return button && !button.disabled ? button : null;
    }, 12000);
    if (!bookButton) return { error: `Booking is not available for train ${data.trainNumber}, ${classLabel}, ${dateLabel}.` };
    return { button: bookButton };
  }

  async function ensurePassengerRows(required) {
    let attempts = 0;
    while (passengerNameInputs().length < required && attempts < required + 2) {
      attempts += 1;
      const previousCount = passengerNameInputs().length;
      const label = await waitFor(() => smallestTextElement(document, (text) => /^\+?\s*Add Passenger\s*\//i.test(text)), 4000);
      if (!label) return false;
      const addButton = label.closest('button, a, [role="button"]') || label;
      addButton.scrollIntoView({ behavior: "smooth", block: "center" });
      addButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      addButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      addButton.click();

      const rowAdded = await waitFor(() => passengerNameInputs().length > previousCount ? true : null, 4000);
      if (!rowAdded) return false;
      await sleep(180);
    }
    return passengerNameInputs().length >= required;
  }

  function passengerNameInputs() {
    return [...document.querySelectorAll(PASSENGER_NAME_SELECTOR)].filter(visible);
  }

  function passengerAgeInputs() {
    return [...document.querySelectorAll(PASSENGER_AGE_SELECTOR)].filter(visible);
  }

  function normalizedName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function editDistance(left, right) {
    const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
    for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
    for (let row = 1; row <= left.length; row += 1) {
      for (let column = 1; column <= right.length; column += 1) {
        rows[row][column] = Math.min(
          rows[row - 1][column] + 1,
          rows[row][column - 1] + 1,
          rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
        );
      }
    }
    return rows[left.length][right.length];
  }

  async function selectMasterPassenger(input, savedName) {
    const wanted = normalizedName(savedName);
    if (!input || !wanted) return false;
    input.focus();
    nativeSet(input, savedName);
    await sleep(250);
    const options = await waitFor(() => {
      const visibleOptions = [...document.querySelectorAll('li[role="option"], .ui-autocomplete-list-item')].filter(visible);
      return visibleOptions.length ? visibleOptions : null;
    }, 3500);
    if (!options) return false;

    const candidates = options.map((option) => {
      const optionName = normalizedName((option.textContent || "").split("|")[0]);
      return { option, optionName, distance: editDistance(wanted, optionName) };
    }).filter((candidate) => candidate.optionName);
    let match = candidates.find((candidate) => candidate.optionName === wanted);
    if (!match) {
      const near = candidates.filter((candidate) => candidate.distance <= 1);
      if (near.length === 1) match = near[0];
    }
    if (!match) return false;

    match.option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    match.option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    match.option.click();
    await sleep(220);
    return normalizedName(input.value) === match.optionName || input.closest("p-autocomplete")?.classList.contains("ng-valid");
  }

  function controlAt(name, index) {
    return [...document.querySelectorAll(`select[formcontrolname="${name}"], p-dropdown[formcontrolname="${name}"]`)].filter(visible)[index];
  }

  function passengerControlCount(name) {
    return [...document.querySelectorAll(`select[formcontrolname="${name}"], p-dropdown[formcontrolname="${name}"]`)].filter(visible).length;
  }

  async function waitForPassengerControls(required) {
    return Boolean(await waitFor(() => {
      const ready = passengerNameInputs().length >= required
        && passengerAgeInputs().length >= required
        && passengerControlCount("passengerGender") >= required
        && passengerControlCount("passengerBerthChoice") >= required;
      return ready ? true : null;
    }, 8000));
  }

  async function fillPassengerIdentity(index, number, data) {
    const wantedName = data[`passengerName${number}`];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let nameInput = passengerNameInputs()[index];
      if (!nameInput) return false;
      const selectedMaster = await selectMasterPassenger(nameInput, wantedName);
      if (!selectedMaster) {
        // The newest Angular row can be replaced once after it is added.
        nameInput = passengerNameInputs()[index];
        const ageInput = passengerAgeInputs()[index];
        setElement(nameInput, wantedName);
        setElement(ageInput, data[`passengerAge${number}`]);
        const gender = controlAt("passengerGender", index);
        if (gender instanceof HTMLSelectElement) selectNative(gender, data[`passengerGender${number}`], GENDER_LABELS[data[`passengerGender${number}`]]);
        else await chooseDropdown(gender, GENDER_LABELS[data[`passengerGender${number}`]]);
      }
      await sleep(300);
      const actual = normalizedName(passengerNameInputs()[index]?.value);
      const wanted = normalizedName(wantedName);
      if (actual === wanted || (actual && editDistance(actual, wanted) <= 1)) return true;
    }
    return false;
  }

  async function fillPassengers(data) {
    const firstVisibleName = await waitFor(() => passengerNameInputs()[0] || null, 18000);
    if (!firstVisibleName) return false;
    const passengers = [1, 2, 3, 4, 5].filter((number) => data[`passengerName${number}`]);
    if (!passengers.length) return false;
    if (!await ensurePassengerRows(passengers.length)) return false;
    if (!await waitForPassengerControls(passengers.length)) return false;
    await sleep(300);
    for (let index = 0; index < passengers.length; index += 1) {
      const number = passengers[index];
      if (!await fillPassengerIdentity(index, number, data)) return false;
      const berth = controlAt("passengerBerthChoice", index);
      if (berth instanceof HTMLSelectElement) selectNative(berth, data[`berthPreference${number}`], BERTH_LABELS[data[`berthPreference${number}`]] || "No Preference");
      else await chooseDropdown(berth, BERTH_LABELS[data[`berthPreference${number}`]] || "No Preference");
    }

    await sleep(350);
    const filledNames = passengerNameInputs();
    const allNamesFilled = passengers.every((number, index) => {
      const actual = normalizedName(filledNames[index]?.value);
      const wanted = normalizedName(data[`passengerName${number}`]);
      return actual === wanted || (actual && editDistance(actual, wanted) <= 1);
    });
    if (!allNamesFilled) return false;

    setText(['input[formcontrolname="mobileNumber"]', 'input[name="mobileNumber"]'], data.mobileNumber);
    setText(['input[formcontrolname="coachId"]'], data.coachNumber);
    setCheckbox('input[formcontrolname="autoUpgradationSelected"]', data.autoUpgradation);
    setCheckbox('input[formcontrolname="bookOnlyIfCnf"]', data.bookOnlyIfConfirmed);
    return await selectPayment(data.paymentMode);
  }

  function setText(selectors, value) {
    const element = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    return setElement(element, value);
  }

  function setCheckbox(selector, wanted) {
    const element = document.querySelector(selector);
    if (!element || typeof wanted !== "boolean") return false;
    if (element.checked !== wanted) element.click();
    return true;
  }

  async function selectPayment(mode) {
    const wanted = mode === "UPI" ? /Pay through BHIM\/UPI/i : /Pay through Credit.*Debit/i;
    const textElement = [...document.querySelectorAll("label,span,strong,p,div")]
      .filter((element) => visible(element) && wanted.test((element.textContent || "").trim()) && (element.textContent || "").trim().length < 220)
      .sort((left, right) => (left.textContent || "").length - (right.textContent || "").length)[0];
    if (!textElement) return false;
    let container = textElement.closest("label") || textElement.parentElement;
    while (container?.parentElement && container !== document.body
      && !container.querySelector('input[type="radio"], p-radiobutton, .ui-radiobutton, .p-radiobutton')) {
      container = container.parentElement;
    }
    const radio = container?.querySelector('input[type="radio"]');
    const radioBox = container?.querySelector('.ui-radiobutton-box, .p-radiobutton-box, p-radiobutton, .ui-radiobutton, .p-radiobutton');
    textElement.scrollIntoView({ behavior: "smooth", block: "center" });
    if (radio?.checked) return true;
    if (radio && !radio.disabled) radio.click();
    else if (radioBox) radioBox.click();
    else textElement.click();
    await sleep(250);

    // IRCTC's PrimeNG radio can keep the native input hidden and expose its
    // selected state only through component classes/ARIA. Finding and clicking
    // the matching payment option is sufficient; IRCTC validates it on Continue.
    return Boolean(
      radio?.checked
      || container?.querySelector('[aria-checked="true"], .ui-state-active, .p-highlight, .ui-radiobutton-box.ui-state-active, .p-radiobutton-box.p-highlight')
      || textElement
    );
  }

  function passengerChallengeVisible() {
    const challengeInput = [...document.querySelectorAll("input")].find((input) => {
      if (!visible(input) || input.type === "checkbox") return false;
      const description = [input.getAttribute("formcontrolname"), input.name, input.placeholder, input.getAttribute("aria-label")]
        .filter(Boolean).join(" ");
      return /captcha|otp/i.test(description);
    });
    const challengeImage = [...document.querySelectorAll("img")].find((image) => {
      if (!visible(image)) return false;
      return /captcha/i.test([image.alt, image.id, image.className, image.src].filter(Boolean).join(" "));
    });
    return Boolean(challengeInput || challengeImage);
  }

  function findButton(root, pattern) {
    return [...root.querySelectorAll("button")].find((button) => visible(button) && pattern.test((button.textContent || "").trim()));
  }

  function buttonReady(button) {
    return Boolean(button
      && button.isConnected
      && visible(button)
      && !button.disabled
      && button.getAttribute("aria-disabled") !== "true"
      && !button.classList.contains("ui-state-disabled")
      && !button.classList.contains("p-disabled"));
  }

  async function activateButton(button) {
    const readyButton = await waitFor(() => buttonReady(button) ? button : null, 5000);
    if (!readyButton) return false;
    readyButton.scrollIntoView({ behavior: "smooth", block: "center" });
    readyButton.focus({ preventScroll: true });
    await sleep(250);
    readyButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    readyButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    readyButton.click();
    return true;
  }

  async function markStage(session, stage, finish = false) {
    const { bookingSession } = await chrome.storage.local.get("bookingSession");
    if (!bookingSession || bookingSession.id !== session.id) return;
    const completedStages = [...new Set([...(bookingSession.completedStages || []), stage])];
    await chrome.storage.local.set({ bookingSession: { ...bookingSession, active: !finish, completedStages } });
  }

  async function unmarkStage(session, stage) {
    const { bookingSession } = await chrome.storage.local.get("bookingSession");
    if (!bookingSession || bookingSession.id !== session.id) return;
    const completedStages = (bookingSession.completedStages || []).filter((item) => item !== stage);
    await chrome.storage.local.set({ bookingSession: { ...bookingSession, active: true, completedStages } });
  }

  async function executeAutofill(force = false) {
    if (disposed) return;
    if (running) { rerun = true; return; }
    running = true;
    try {
      const { irctcFormData, bookingSession } = await chrome.storage.local.get(["irctcFormData", "bookingSession"]);
      if (!irctcFormData || !bookingSession?.active) return;
      if (retrySessionId !== bookingSession.id) {
        retrySessionId = bookingSession.id;
        passengerRetryCount = 0;
      }
      if (Date.now() - bookingSession.startedAt > SESSION_TTL) {
        await chrome.storage.local.set({ bookingSession: { ...bookingSession, active: false } });
        return;
      }
      const stage = getStage();
      if (!stage || (!force && (bookingSession.completedStages || []).includes(stage))) return;
      if ((bookingSession.completedStages || []).includes(stage)) return;
      if (languageDialogVisible()) {
        showNotice("Select English or Hindi once. Booking will continue after the dialog closes.", true);
        return;
      }

      if (stage === "login") {
        const loginAttemptKey = `login-${bookingSession.id}`;
        if (document.documentElement.dataset.irctcAutofillLoginAttempt === loginAttemptKey) return;
        const result = await fillLogin(irctcFormData);
        if (result.error) { showNotice(result.error, true); return; }
        await markStage(bookingSession, stage);
        if (result.manual) {
          showNotice("Login details filled. Complete CAPTCHA/OTP and press Sign In manually.");
          return;
        }
        document.documentElement.dataset.irctcAutofillLoginAttempt = loginAttemptKey;
        showNotice("Login details filled. Signing in…");
        result.button.click();
        const moved = await waitFor(() => getStage() === "passengers" ? true : null, 12000);
        if (!moved && !findLoginDialog() && getStage() === "train-list") {
          // IRCTC often authenticates successfully but does not resume the
          // pre-login Book Now request. Re-open the saved train once in the
          // authenticated session instead of forcing the passenger URL.
          await unmarkStage(bookingSession, "train-list");
          showNotice("Signed in. Re-opening the selected train…");
          window.setTimeout(() => executeAutofill(true), 600);
        } else if (!moved) {
          showNotice("Automatic sign in did not finish. Verify the credentials or CAPTCHA/OTP, then press Sign In manually.", true);
        }
      } else if (stage === "search") {
        const result = await fillSearch(irctcFormData);
        if (!result) { showNotice("Journey form could not be completed. Check station/date availability.", true); return; }
        await markStage(bookingSession, stage);
        showNotice("Journey filled. Searching matching trains…");
        const submitted = await activateButton(result.button);
        if (!submitted) {
          await unmarkStage(bookingSession, stage);
          showNotice("IRCTC Search Trains is not ready yet. Wait a moment and click Book again.", true);
          return;
        }
        const moved = await waitFor(() => getStage() === "train-list" ? true : null, 20000);
        if (!moved) {
          await unmarkStage(bookingSession, stage);
          showNotice("IRCTC did not open the train list. Verify the visible fields, then click Book to retry.", true);
        }
      } else if (stage === "train-list") {
        const result = await selectTrain(irctcFormData);
        if (result.error) { showNotice(result.error, true); return; }
        await markStage(bookingSession, stage);
        showNotice(`Train ${irctcFormData.trainNumber} selected. Opening passenger details…`);
        result.button.click();
      } else if (stage === "passengers") {
        if (!await fillPassengers(irctcFormData)) {
          passengerRetryCount += 1;
          if (passengerRetryCount <= 3) {
            showNotice(`Passenger or payment controls are still updating. Retrying (${passengerRetryCount}/3)…`);
            window.setTimeout(() => executeAutofill(true), 1200);
          } else {
            showNotice("Passenger fields could not be detected. Reload this IRCTC page, then click Book again.", true);
          }
          return;
        }
        passengerRetryCount = 0;
        await markStage(bookingSession, stage);
        if (passengerChallengeVisible()) {
          showNotice("Passenger and payment details filled. Complete CAPTCHA/OTP and press Continue manually.");
          return;
        }
        const continueButton = await waitFor(() => {
          const button = findButton(document, /^Continue$/i);
          return button && !button.disabled ? button : null;
        }, 8000);
        if (!continueButton) {
          showNotice("Details are filled, but IRCTC Continue is not ready. Verify the form and press Continue manually.", true);
          return;
        }
        continueButton.scrollIntoView({ behavior: "smooth", block: "center" });
        showNotice("Passenger and payment details filled. Opening review…");
        continueButton.click();
        // IRCTC can keep the passenger page loader active for 30 seconds or
        // longer while preparing Review Booking. Do not report a false error
        // during that normal server-side transition.
        const moved = await waitFor(() => getStage() === "review" ? true : null, 60000);
        if (!moved) showNotice("IRCTC did not open Review Booking. Check the visible validation message and press Continue manually.", true);
      } else if (stage === "review") {
        await markStage(bookingSession, stage, true);
        showNotice("Review the journey and fare. Final Continue and payment are manual.");
      }
    } catch (error) {
      console.error("IRCTC Autofill Helper:", error);
      showNotice("Booking helper stopped on this page. Check the extension data and try Book again.", true);
    } finally {
      running = false;
      if (rerun) { rerun = false; window.setTimeout(() => executeAutofill(false), 350); }
    }
  }

  function languageDialogVisible() {
    return [...document.querySelectorAll('p-confirmdialog button, [role="dialog"] button')]
      .some((button) => visible(button) && /^(English|हिंदी)$/i.test((button.textContent || "").trim()));
  }

  function signature() {
    return [getStage(), Boolean(findLoginDialog()), languageDialogVisible(), passengerNameInputs().length,
      Boolean(document.querySelector('p-autocomplete[formcontrolname="origin"]')), Boolean(findTrainCardSafe())].join("|");
  }

  function findTrainCardSafe() {
    return document.querySelector("app-train-avl-enq, .train_avl_enq_box, .tbis-div");
  }

  function schedule() {
    if (disposed) return;
    const current = signature();
    if (current === lastSignature) return;
    lastSignature = current;
    window.clearTimeout(observerTimer);
    observerTimer = window.setTimeout(() => executeAutofill(false), 500);
  }

  function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function showNotice(message, error = false) {
    let notice = document.getElementById("irctc-autofill-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "irctc-autofill-notice";
      Object.assign(notice.style, { position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
        maxWidth: "390px", padding: "13px 16px", borderRadius: "10px", color: "white",
        font: "600 13px/1.4 system-ui", boxShadow: "0 10px 30px #0006" });
      document.documentElement.appendChild(notice);
    }
    notice.textContent = message;
    notice.style.background = error ? "#a93838" : "#166534";
    window.clearTimeout(notice.__removeTimer);
    notice.__removeTimer = window.setTimeout(() => notice.remove(), 7000);
  }

  const observer = new MutationObserver(schedule);
  window[CONTROLLER_KEY] = {
    run: executeAutofill,
    dispose() {
      disposed = true;
      observer.disconnect();
      window.clearTimeout(observerTimer);
    }
  };
  observer.observe(document.documentElement, { childList: true, subtree: true });
  executeAutofill(false);
})();
