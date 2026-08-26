chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GET_IRCTC_SESSION_PASSWORD") return false;

  let trustedIrctcPage = false;
  try {
    const hostname = new URL(sender.url || "").hostname.toLowerCase();
    trustedIrctcPage = sender.id === chrome.runtime.id && (hostname === "irctc.co.in" || hostname.endsWith(".irctc.co.in"));
  } catch (_error) {
    trustedIrctcPage = false;
  }
  if (!trustedIrctcPage) {
    sendResponse({ password: "" });
    return false;
  }

  chrome.storage.session.get("irctcSessionPassword", ({ irctcSessionPassword = "" }) => {
    sendResponse({ password: irctcSessionPassword });
  });
  return true;
});
