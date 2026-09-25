# Store listing — one voice for every marketplace

Everything a marketplace asks for, written once. Copy the fields into the store form;
the images live next to this file.

* **Publisher:** SumOffice — https://sumoffice.com — hello@sumoffice.com
* **Legal entity (when a form insists):** HEALTH INFORMATIC SECURITY SYSTEM S.L., Málaga, Spain
* **Price:** free listing. Licensing is answered by e-mail: “contact us for licensing”.
* **Icons:** `icon-140.png` (small catalogues), `icon-512.png` (Rocket.Chat and anything asking for a large square)
* **Screenshots:** `screenshot-workbook.png` (a macro-enabled workbook open in the browser),
  `screenshot-document.png` (a Word document with pictures)

## Short description (one line, ≤ 120 characters)

Open and edit Excel and Word files in place — macros and pictures come back intact.

## Summary (the approved sentence, use it verbatim where a “tagline” is asked)

Excel and Word files keep working — macros, Power Query, files back intact — with the SumOffice
editors as your Office server.

## Full description

SumOffice opens the office files you already store — .xlsx, .xlsm, .xlsb and .docx — in the browser,
and saves them back into the same file. The macro project travels with the workbook byte for byte,
and the pictures of a Word document come back byte for byte.

Nothing leaves your system: the editors run on a server you control, the file stays where it was,
and every read and write happens with the rights of the person who opened it. Connection is over
WOPI — the same protocol the big office suites use — with signed access tokens and verified proof
keys.

**What you need:** a SumOffice server reachable by the browser and by your platform, and one
setting: its address.

**What is proven for this integration:** a round trip on a live stand — a macro-enabled workbook and
a Word document were opened, edited and saved back; the VBA project and every picture returned byte
for byte.

Questions and licensing: hello@sumoffice.com

## Words we do not use until they are measured per host

* “Microsoft Excel opens the result without a repair dialog” — only where a real Excel has opened the
  file after the round trip on that host. As of 26.09.2026 that is ownCloud Infinite Scale and
  Nextcloud. Everywhere else the honest sentence is “macros preserved byte for byte”.
* Any speed figure — only measured, with version and environment; never from an emulated stand.
* “Supported” — only after a round on a live stand of that host.
