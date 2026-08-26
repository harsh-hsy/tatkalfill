# TatkalFill

**Fast. Simple. Ready to Book.**

A local Chrome/Edge Manifest V3 extension that stores journey and passenger details and fills matching fields on IRCTC.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open the extension, enter details, and click **Save** or **Book**.

**Book** starts a time-limited, page-by-page booking session. It fills the journey page, searches trains, selects the saved train number/class/date availability, handles the IRCTC login modal, fills the passenger page, selects the saved payment mode, and opens Review Booking through IRCTC's Continue button. CAPTCHA, final review, OTP, and payment confirmation remain manual. Always verify every filled field before continuing.

Up to five passengers can be saved. Lower is limited to two passengers and Side Lower to one passenger in the popup; remaining matching options are disabled after each limit is reached. If berth preference is left as No preference, IRCTC may use the saved master-passenger preference when available.

If IRCTC shows its language dialog, choose English or Hindi once. The helper waits for the dialog to close and then continues without reloading the page. When no CAPTCHA or OTP challenge is present, the login modal is submitted automatically. If IRCTC displays a challenge, complete it and press **Sign In** manually.

Refreshing an already completed page does not run autofill again. A new workflow starts only when **Book** is clicked. The user name and saved personal details remain in the browser's local extension storage. The password is kept only in `chrome.storage.session` and is cleared when the browser session ends. Use **Reset** before uninstalling if you want to erase the stored data immediately.
