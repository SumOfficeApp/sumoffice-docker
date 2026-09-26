# SumOffice for Frappe and ERPNext

Open the Excel and Word files attached to any document in the SumOffice editors, edit them in
the browser, and save them straight back — macros, defined names, queries and pictures come
back byte for byte.

The app makes Frappe itself a **WOPI host**: `CheckFileInfo`, `GetFile`, `PutFile` and locking,
with signed access tokens whose signature is verified on every request. Rights are the ones you
already granted — reading needs the right to the file, writing needs write access to the
document the file hangs on. The editors run in your own Docker; nothing about your files leaves
your servers.

## Install

    bench get-app https://github.com/SumOfficeApp/sumoffice-docker --branch frappe
    bench --site your.site install-app sumoffice

Then open **SumOffice Settings** and enter the address of your SumOffice server.

## Measured

Frappe / ERPNext 15.97: a macro workbook and a document with five pictures went through the
full round — opened from the form sidebar, edited, saved back. `vbaProject.bin` and every
picture returned byte for byte, the edit in place; refusals (unsigned request, forged
signature, corrupted token, wrong path) were checked too.

- Setup and the other hosts we measured: https://sumoffice.com/frappe.html
- Contact: hello@sumoffice.com
- Licence: AGPL-3.0-or-later, the same licence as Frappe itself.
