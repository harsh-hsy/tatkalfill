# TatkalFill

**Fast. Simple. Ready to Book.**

TatkalFill is an independent Chrome/Edge Manifest V3 extension that stores journey and passenger details and assists with filling matching fields across supported IRCTC booking pages.

> TatkalFill is not affiliated with, sponsored by, or officially endorsed by IRCTC or Indian Railways. Always verify every filled field before continuing.

## Repository structure

```text
tatkal-fill/
├── extension/     # Chrome/Edge extension source
├── website/       # Independent static product website
│   └── downloads/ # Downloadable extension ZIP
├── README.md
└── LICENSE
```

## Install the extension

1. Download `website/downloads/TatkalFill.zip` or clone this repository.
2. Extract the ZIP if you downloaded it.
3. Open `chrome://extensions` (or `edge://extensions`).
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the extracted `extension` folder.
6. Pin TatkalFill, enter your details, and click **Save** or **Book**.

## Extension behavior

**Book** starts a time-limited, page-by-page booking session. It fills the journey page, searches trains, selects the saved train number/class/date availability, handles the IRCTC login modal, fills the passenger page, selects the saved payment mode, and opens Review Booking through IRCTC's Continue button. CAPTCHA, final review, OTP, and payment confirmation remain manual.

Up to five passengers can be saved. Lower is limited to two passengers and Side Lower to one passenger in the popup. If berth preference is left as No preference, IRCTC may use the saved master-passenger preference when available.

Refreshing an already completed page does not run autofill again. A new workflow starts only when **Book** is clicked. The user name and saved personal details remain in Chrome local extension storage. The password is kept in `chrome.storage.session` and is cleared when the browser session ends. Use **Reset** before uninstalling if you want to erase saved details immediately.

## Run the website

The landing page is a dependency-free static website. Open `website/index.html` directly or serve `website/` with any static HTTP server.

## License

Licensed under the [MIT License](./LICENSE).
